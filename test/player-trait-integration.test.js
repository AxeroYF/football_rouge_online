import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { YDL_TRAIT_CARDS, YDL_TRAIT_BY_ID } from "../engine/s4-v2.1/versus/trait-pool.js";
import { buildV2TeamSnapshots } from "../engine/s4-v2.1/versus/v2/team-snapshot-v2.js";
import { createV2Match } from "../engine/s4-v2.1/versus/v2/match-engine-v2.js";
import { presentPlayerTraits } from "../shared/config/player-trait-presentation.mjs";
import { playerDetailBodyMarkup } from "../client/player-card/player-detail-window.js";
import { playerTooltip } from "../tactics-page.js";

const basePlayer=(traitId)=>({id:"player",name:"测试球员",role:"ST",pool:"ATT",overall:95,baseOverall:95,upgradeLevel:4,heightCm:187,nationality:"中国",club:"测试",attributes:{passing:70,finishing:80,pace:75,stamina:99,offBall:78,dribbling:77,composure:76},effectiveAttributes:{passing:70,finishing:80,pace:75,stamina:99,offBall:78,dribbling:77,composure:76},state:{fitness:100},traits:[{id:traitId,name:YDL_TRAIT_BY_ID[traitId].name,summary:YDL_TRAIT_BY_ID[traitId].summary}]});

test("all YDL enhancement traits reach the V2 match snapshot",()=>{
  for(const trait of YDL_TRAIT_CARDS){
    const player=basePlayer(trait.id);
    const snapshot=buildV2TeamSnapshots([{id:"team",players:[player],positions:{player:{x:50,y:20}},tactic:"balanced",style:"possession"}],{state:{minute:25,score:[0,0]},environment:{weather:"sunny",precipitation:0}})[0].players[0];
    assert.ok(snapshot.v2AppliedTraitIds.includes(trait.id),trait.id);
    assert.ok(snapshot.traitDefinitions.some(entry=>entry.id===trait.id),trait.id);
  }
});

test("every YDL rule hook has an engine application path",()=>{
  const hooks=new Set(YDL_TRAIT_CARDS.flatMap(trait=>trait.rules.map(rule=>rule.hook)));
  const expected=new Set(["affinityWildcard","allAttributes","argentinaCount","attribute","chemistry","firstPenaltySave","fixedFitness","height","injury","penaltyDraw","position","redCardImmune","teamInjuryTransfer","teamLightningProtection"]);
  assert.deepEqual(hooks,expected);
  const snapshot=readFileSync(new URL("../engine/s4-v2.1/versus/v2/team-snapshot-v2.js",import.meta.url),"utf8")+readFileSync(new URL("../engine/s4-v2.1/versus/v2/team-player-effects.js",import.meta.url),"utf8");
  const match=readFileSync(new URL("../engine/s4-v2.1/versus/v2/match-engine-v2.js",import.meta.url),"utf8");
  const chain=readFileSync(new URL("../engine/s4-v2.1/versus/v2/possession-chain-v2.js",import.meta.url),"utf8");
  const spatial=readFileSync(new URL("../engine/s4-v2.1/versus/v2/spatial-model-v2.js",import.meta.url),"utf8");
  const bonds=readFileSync(new URL("../engine/s4-v2.1/versus/public/bond-rules.js",import.meta.url),"utf8");
  for(const hook of ["attribute","allAttributes","fixedFitness","height","chemistry"]) assert.match(snapshot,new RegExp(`hook === "${hook}"`));
  assert.match(spatial,/traitPositionFit/);
  assert.match(chain,/hook === "penaltyDraw"/);
  for(const hook of ["argentinaCount","firstPenaltySave","fixedFitness","redCardImmune","teamInjuryTransfer","teamLightningProtection"]) assert.match(match,new RegExp(`"${hook}"`));
  assert.match(match,/injuryImmune/);
  assert.match(bonds,/S4_BOND_WILDCARD_TRAIT_ID/);
});

test("996 fixes fitness to 94 in engine snapshots and every player-facing frontend projection",()=>{
  const player=basePlayer("stoppage-time-expert");
  const snapshot=buildV2TeamSnapshots([{id:"team",players:[player]}])[0].players[0];
  assert.equal(snapshot.state.fitness,94);
  const match=createV2Match([{id:"home",name:"主队",players:[player]},{id:"away",name:"客队",players:[{...basePlayer("lone-finisher"),id:"away"}]}],{seed:"fixed-fitness"});
  assert.equal(match.teams[0].players[0].state.fitness,94);
  assert.equal(presentPlayerTraits(player).effectiveFitness,94);
  const tooltip=playerTooltip(player,"ST");
  assert.match(tooltip,/体能：94/);
  assert.match(tooltip,/冷静 76\n996：该球员的体力值固定为94/);
  assert.doesNotMatch(tooltip,/强化特性|\n\n/);
  const detail=playerDetailBodyMarkup(player);
  assert.match(detail,/<dt>体能<\/dt><dd>94<\/dd>/);
  assert.match(detail,/996：该球员的体力值固定为94，不会随着比赛消耗变化。/);
});

test("frontend and engine agree on unconditional attribute and height traits",()=>{
  const id="custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20",player=basePlayer(id);
  const frontend=presentPlayerTraits(player),snapshot=buildV2TeamSnapshots([{id:"team",players:[player]}])[0].players[0];
  assert.equal(frontend.effectiveHeightCm,182);
  assert.equal(snapshot.heightCm,182);
  for(const key of ["finishing","pace","dribbling"]) assert.equal(frontend.effectiveAttributes[key],snapshot.displayAttributes[key]);
});


test("conditional tactical and weather traits use the selected context on frontend and engine",()=>{
  for(const scenario of [
    {id:"custom-3b12d163-d3d9-47df-b6b7-e1d124abcb62",context:{teamTactic:"parkBus"},team:{tactic:"parkBus",style:"possession"}},
    {id:"rain-boots",context:{weather:"rain",precipitation:70},team:{tactic:"balanced",style:"possession"},environment:{weather:"rain",precipitation:70}},
  ]){
    const player=basePlayer(scenario.id);
    const frontend=presentPlayerTraits(player,scenario.context);
    const snapshot=buildV2TeamSnapshots([{id:"team",players:[player],...scenario.team}],{state:{minute:25,score:[0,0]},environment:scenario.environment??{weather:"sunny",precipitation:0}})[0].players[0];
    assert.equal(frontend.effectiveAttributes.finishing,snapshot.displayAttributes.finishing,scenario.id);
    assert.ok(frontend.effectiveAttributes.finishing>player.effectiveAttributes.finishing,scenario.id);
  }
});

test("position traits affect frontend fit and are carried to the spatial engine",()=>{
  const player={...basePlayer("aerial-beacon"),role:"CB",pool:"DEF",secondaryRole:null};
  const frontend=presentPlayerTraits(player,{assignedRole:"ST"});
  const snapshot=buildV2TeamSnapshots([{id:"team",players:[player],positions:{player:{x:50,y:20}}}])[0].players[0];
  assert.equal(frontend.positionFit,1);
  assert.ok(snapshot.v2TraitHooks.some(rule=>rule.hook==="position"&&rule.familiarRoles.includes("ST")));
});
