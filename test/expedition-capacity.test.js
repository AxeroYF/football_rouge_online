import test from "node:test";
import assert from "node:assert/strict";
import { EXPEDITION_MAX_PLAYERS, expeditionPlayerCount, autoCompletePlayerSquads } from "../shared/config/player-squads.mjs";
import { buildAccountMatchSeat } from "../shared/football/account-match-seat.mjs";
import { CampaignService } from "../campaign-service.mjs";
import { createTeamController, teamPlayerListMarkup } from "../client/team/team-controller-ydl.js";

function fixture(expedition = 22, garrison = 24) {
  const roster = ["expedition", "garrison"].flatMap(squad => Array.from({length:squad === "expedition" ? expedition : garrison}, (_, i) => {
    const pool = ["GK","DEF","DEF","DEF","DEF","MID","MID","MID","ATT","ATT","ATT"][i % 11];
    return {id:`${squad}-${i}`,name:`${squad}-${i}`,pool,role:{GK:"GK",DEF:"CB",MID:"DM",ATT:"ST"}[pool],overall:70,attributes:{passing:60},state:{fitness:100}};
  }));
  return {id:"cap",setupComplete:true,draft:{roster},playerSquads:{assignments:Object.fromEntries(roster.map(p=>[p.id,p.id.split("-")[0]]))}};
}
const service = (save = () => {}) => ({training:{settle(){}},world:{activeChallenges:{}},save,state:a=>a});
const assign = (s,a,id,squad) => CampaignService.prototype.assignPlayerSquad.call(s,a,id,squad);

test("22 permits a full expedition; the 23rd assignment is rejected without mutation", () => {
  assert.equal(EXPEDITION_MAX_PLAYERS,22);
  const a=fixture(21),s=service();
  assign(s,a,"garrison-0","expedition");
  assert.equal(expeditionPlayerCount(a.playerSquads,a.draft.roster),22);
  const before=structuredClone(a);
  assert.throws(()=>assign(s,a,"garrison-1","expedition"),/最多 22 人/);
  assert.deepEqual(a,before);
  assign(s,a,"garrison-0","garrison");
  assign(s,a,"garrison-1","expedition");
  assert.equal(expeditionPlayerCount(a.playerSquads,a.draft.roster),22);
});

test("legacy overcapacity can be reduced and failed saves restore assignments and tactics", () => {
  const a=fixture(24),s=service();
  assign(s,a,"expedition-23","garrison");
  assert.equal(expeditionPlayerCount(a.playerSquads,a.draft.roster),23);
  assign(s,a,"expedition-22","garrison");
  const before=structuredClone(a);
  assert.throws(()=>assign(service(()=>{throw Error("disk failure");}),a,"expedition-21","garrison"),/disk failure/);
  assert.deepEqual(a,before);
});

test("tactics submission cannot bypass capacity; departure rejects legacy oversized expedition", () => {
  const a=fixture(),before=structuredClone(a),candidate=structuredClone(a.playerSquads);
  candidate.assignments["garrison-0"]="expedition";
  assert.throws(()=>CampaignService.prototype.saveTactics.call(service(),a,{playerSquads:candidate}),/最多 22 人/);
  assert.deepEqual(a,before);
  assert.equal(buildAccountMatchSeat(a,"expedition").players.length,11);
  a.playerSquads=candidate;
  assert.throws(()=>buildAccountMatchSeat(a,"expedition"),/最多 22 人/);
  assert.equal(buildAccountMatchSeat(a,"garrison").players.length,11);
});

test("automatic role completion cannot add a 23rd player and garrison has no upper cap", () => {
  const a=fixture();
  for(const p of a.draft.roster.filter(p=>p.id.startsWith("expedition"))) {p.pool="ATT";p.role="ST";}
  const result=autoCompletePlayerSquads(a.playerSquads,a.draft.roster);
  assert.equal(result.readiness.expedition.count,22);
  assert.equal(result.ready,false);
  assert.deepEqual(result.autoAssignedPlayerIds,[]);
  assert.equal(result.readiness.garrison.count,24);
  assert.equal(result.readiness.garrison.ready,true);
});

test("capacity counts the same representative players as management and match selection", () => {
  const a=fixture(),original=a.draft.roster[0];
  a.draft.roster.push({...original,id:"weaker-copy",cardDefinitionId:original.id});
  a.playerSquads.assignments["weaker-copy"]="expedition";
  assert.equal(expeditionPlayerCount(a.playerSquads,a.draft.roster),22);
});

test("full squad disables additions, keeps removals available, and does not shrink capacity when filtered", () => {
  const a=fixture(),filters=[];
  const panel={dataset:{},classList:{add(){},remove(){}},setAttribute(){},ownerDocument:{addEventListener(){}},closest:()=>null,querySelector:()=>null,querySelectorAll:selector=>{
    if(selector==='[data-team-filter]') { const node={tagName:"SELECT",dataset:{teamFilter:"squad"},value:"garrison",addEventListener(type,fn){this.change=fn;}};filters.push(node);return [node]; } return [];
  }};
  const controller=createTeamController({panel,getCampaignState:()=>a});
  controller.render();
  assert.match(panel.innerHTML,/<strong>22 \/ 22<\/strong>/);
  assert.match(panel.innerHTML,/远征队最多 22 人（含首发与替补）/);
  assert.match(panel.innerHTML,/<option value="expedition" selected>远征<\/option>/);
  filters[0].change();
  assert.doesNotMatch(panel.innerHTML,/data-team-squad-player="expedition-/);
  assert.match(panel.innerHTML,/<option value="expedition" disabled>远征 · 已满 22 人<\/option>/);
  assert.match(panel.innerHTML,/<strong>22 \/ 22<\/strong>/);
  const available=teamPlayerListMarkup([a.draft.roster.at(-1)],a.playerSquads.assignments,21);
  assert.doesNotMatch(available,/已满 22 人/);
});
