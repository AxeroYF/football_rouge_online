import test from "node:test";
import assert from "node:assert/strict";
import { representativePlayers, representativeTactics } from "../shared/config/representative-players.mjs";
import { autoCompletePlayerSquads } from "../shared/config/player-squads.mjs";
import { normalizeTacticsSquads } from "../tactics-page.js";
import { createTeamController } from "../client/team/team-controller-ydl.js";
import { buildAccountMatchSeat } from "../engine/campaign-match-engine.mjs";
import { CampaignService } from "../campaign-service.mjs";

function fixture() {
  const roster = ["expedition", "garrison"].flatMap(squad => ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"].map((pool, index) => ({id:`${squad}-${index}`,name:`${squad}-${index}`,cardDefinitionId:`${squad}-${index}`,pool,role:{GK:"GK",DEF:"CB",MID:"DM",ATT:"ST"}[pool],overall:70,upgradeLevel:0,attributes:{passing:60}})));
  const assignments = Object.fromEntries(roster.map(p => [p.id,p.id.split("-")[0]]));
  const squads = Object.fromEntries(["expedition","garrison"].map(squad => {
    const players = roster.filter(p => assignments[p.id] === squad), starters = players.map(p=>p.id);
    const positions = Object.fromEntries(players.map((p,i)=>[p.id,{x:15+i*6,y:{GK:90,DEF:68,MID:44,ATT:20}[p.pool]}]));
    return [squad,{starters,positions,planSnapshots:{__s4V2:{starters,positionPresets:{position1:positions,position2:positions,position3:positions},captainId:starters[8],tacticalPlans:{opening:{playerDuties:{[starters[8]]:"advancedForward"}}}}}}];
  }));
  return {id:"fixture",setupComplete:true,draft:{roster},playerSquads:{assignments},tactics:{squads}};
}

test("representatives rank enhancement first, then total training, preserve stable ties and different definitions",()=>{
  const players=[{id:"base",cardDefinitionId:"p",upgradeLevel:0,trainingBonuses:{passing:500}}, {id:"enhanced",cardDefinitionId:"p",upgradeLevel:2,trainingBonuses:{passing:5}}, {id:"trained",cardDefinitionId:"p",upgradeLevel:2,trainingBonuses:{passing:3,pace:7}}, {id:"tie",cardDefinitionId:"p",upgradeLevel:2,trainingBonuses:{passing:10}}, {id:"different",cardDefinitionId:"q",name:"同名"}];
  const before=structuredClone(players);
  assert.deepEqual(representativePlayers(players).map(p=>p.id),["trained","different"]);
  players[2].upgradeLevel=1;
  assert.equal(representativePlayers(players)[0].id,"tie");
  players[2].upgradeLevel=2;
  assert.deepEqual(players,before);
});

test("duplicates cannot satisfy squad minimums and all inventory assignments remain intact",()=>{
  const account=fixture();
  const onlyEleven=account.draft.roster.slice(0,11);
  const roster=[...onlyEleven,...onlyEleven.map(p=>({...p,id:`copy-${p.id}`}))];
  const completed=autoCompletePlayerSquads(null,roster);
  assert.equal(completed.ready,false);
  assert.equal(completed.readiness.expedition.count+completed.readiness.garrison.count,11);
  assert.equal(Object.keys(completed.playerSquads.assignments).length,22);
});

test("stronger copies replace old starter references, retain every preset, duties and captain without modifying inventory",()=>{
  const account=fixture(), old=account.draft.roster[8];
  const best={...old,id:"best",upgradeLevel:3,trainingBonuses:{pace:10}};
  account.draft.roster.push(best);
  account.playerSquads.assignments.best="expedition";
  account.tactics.squads.expedition.positions.best={x:99,y:99};
  const before=structuredClone(account);
  const projected=representativeTactics(account.tactics,account.draft.roster);
  const normalized=normalizeTacticsSquads(account.tactics,account.draft.roster,account.playerSquads);
  assert.equal(normalized.squads.expedition.starters[8],"best");
  assert.equal(normalized.squads.expedition.captainId,"best");
  for(const key of ["position1","position2","position3"]) assert.deepEqual(normalized.squads.expedition.positionPresets[key].best,account.tactics.squads.expedition.positions[old.id]);
  assert.equal(normalized.squads.expedition.tacticalPlans.opening.playerDuties.best,"advancedForward");
  assert.deepEqual(projected.squads.expedition.positions.best,account.tactics.squads.expedition.positions[old.id]);
  const seat=buildAccountMatchSeat(account,"expedition");
  assert.equal(seat.players.some(p=>p.id===old.id),false);
  assert.equal(seat.players.filter(p=>p.id==="best").length,1);
  assert.deepEqual(seat.positions.best,account.tactics.squads.expedition.positions[old.id]);
  assert.deepEqual(account,before);
  // Exercise production save validation without a disk repository.
  const service={training:{settle(){}},save(){},state:a=>a};
  CampaignService.prototype.saveTactics.call(service,account,account.tactics);
  assert.equal(account.draft.roster.length,23);
  assert.equal(account.tactics.squads.expedition.starters.includes("best"),true);
  assert.equal(account.tactics.squads.expedition.bench.includes(old.id),false);
});

test("squad list renders only the best instance before applying level filters",()=>{
  const account=fixture(), old=account.draft.roster[8];
  account.draft.roster.push({...old,id:"best",upgradeLevel:3});
  const nodes={filter:[]};
  const panel={dataset:{},classList:{add(){},remove(){}},setAttribute(){},ownerDocument:{addEventListener(){}},closest:()=>null,querySelector:()=>null,querySelectorAll:selector=>{
    if(selector==='[data-team-filter]') return nodes.filter=[{tagName:"SELECT",dataset:{teamFilter:"upgradeLevel"},value:"0",addEventListener(type,fn){this.change=fn;}}];
    return [];
  }};
  const controller=createTeamController({panel,getCampaignState:()=>account});
  controller.render();
  assert.match(panel.innerHTML,/data-team-squad-player="best"/);
  assert.doesNotMatch(panel.innerHTML,new RegExp(`data-team-squad-player="${old.id}"`));
  assert.match(panel.innerHTML,/<h2>编队<\/h2>/);
  assert.doesNotMatch(panel.innerHTML,/data-team-view|team-player-grid|ydl-player-card/);
  assert.match(panel.innerHTML,/data-player-card-id="best"/);
  assert.doesNotMatch(panel.innerHTML,new RegExp(`data-player-card-id="${old.id}"`));
  nodes.filter[0].change();
  assert.doesNotMatch(panel.innerHTML,/data-player-card-id="best"/);
  assert.doesNotMatch(panel.innerHTML,new RegExp(`data-player-card-id="${old.id}"`));
});
