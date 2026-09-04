import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { optimalLineupAssignment, remapLineupPresetSlots } from "../tactics-lineup-rules.js";
import { autoCompletePlayerSquads } from "../shared/config/player-squads.mjs";
import { normalizeTacticsSquads } from "../tactics-page.js";

const tacticsSource = readFileSync(new URL("../tactics-page.js",import.meta.url),"utf8");

function twoSquadRoster() {
  return [
    ...[0,1].map((index) => ({ id:`gk-${index}`,name:`门将${index}`,pool:"GK",role:"GK",overall:90-index })),
    ...Array.from({length:8},(_,index) => ({ id:`def-${index}`,name:`后卫${index}`,pool:"DEF",role:"CB",overall:88-index })),
    ...Array.from({length:6},(_,index) => ({ id:`mid-${index}`,name:`中场${index}`,pool:"MID",role:"DM",overall:86-index })),
    ...Array.from({length:6},(_,index) => ({ id:`att-${index}`,name:`前锋${index}`,pool:"ATT",role:"ST",overall:84-index })),
  ];
}

test("players default to garrison and automatically form one disjoint expedition squad", () => {
  const roster = [
    ...[0,1].map((index) => ({ id:`gk-${index}`,name:`门将${index}`,pool:"GK",overall:90-index })),
    ...Array.from({length:8},(_,index) => ({ id:`def-${index}`,name:`后卫${index}`,pool:"DEF",overall:88-index })),
    ...Array.from({length:6},(_,index) => ({ id:`mid-${index}`,name:`中场${index}`,pool:"MID",overall:86-index })),
    ...Array.from({length:6},(_,index) => ({ id:`att-${index}`,name:`前锋${index}`,pool:"ATT",overall:84-index })),
  ];
  const completed = autoCompletePlayerSquads(null,roster);
  assert.equal(completed.ready,true);
  assert.equal(completed.readiness.expedition.count,11);
  assert.equal(completed.readiness.garrison.count,11);
  assert.equal(Object.keys(completed.playerSquads.assignments).length,22);
  assert.equal(Object.values(completed.playerSquads.assignments).includes(""),false);
  for (const squad of ["expedition","garrison"]) for (const pool of ["GK","DEF","MID","ATT"]) assert.ok(completed.readiness[squad].pools[pool] >= 1);
});

test("automatic completion draws expedition players from the default garrison complement", () => {
  const roster = [
    { id:"fixed",pool:"ATT",overall:99 },
    ...[0,1].map((index) => ({ id:`gk-${index}`,pool:"GK",overall:90-index })),
    ...Array.from({length:9},(_,index) => ({ id:`def-${index}`,pool:"DEF",overall:88-index })),
    ...Array.from({length:6},(_,index) => ({ id:`mid-${index}`,pool:"MID",overall:86-index })),
    ...Array.from({length:6},(_,index) => ({ id:`att-${index}`,pool:"ATT",overall:84-index })),
  ];
  const completed = autoCompletePlayerSquads({assignments:{fixed:"garrison"}},roster);
  assert.equal(completed.playerSquads.assignments.fixed,"expedition");
  assert.equal(completed.ready,true);
});

test("tactics board exposes two fixed squad schemes with independent automatic lineups", () => {
  const roster=twoSquadRoster();
  const normalized=normalizeTacticsSquads(null,roster,null);
  const expedition=new Set(normalized.squads.expedition.starters);
  const garrison=new Set(normalized.squads.garrison.starters);
  assert.equal(expedition.size,11);
  assert.equal(garrison.size,11);
  assert.deepEqual([...expedition].filter((id)=>garrison.has(id)),[]);
  assert.match(tacticsSource,/data-lineup-squad/);
  assert.doesNotMatch(tacticsSource,/<select data-lineup-squad/);
  assert.match(tacticsSource,/league-lineup-squad-tabs/);
  assert.match(tacticsSource,/PLAYER_SQUAD_DEFINITIONS\.map/);
  assert.match(tacticsSource,/playerSquads:\{schemaVersion:2,assignments:\{\.\.\.squadAssignments\}\}/);
  assert.match(tacticsSource,/setSaveStatus\("error",message\)/);
  assert.doesNotMatch(tacticsSource,/适配赛事|方案 1|重命名当前方案|新增阵容方案/);
  assert.match(tacticsSource,/const rosterValue=squadRoster\(\)/);
  assert.match(tacticsSource,/bench:eligible\.map\(\(player\)=>player\.id\)/);
});

test("S4 lineup assignment uses each candidate once", () => {
  const slots=[{playerId:"a",role:"GK"},{playerId:"b",role:"ST"}];
  const candidates=[{id:"gk",role:"GK"},{id:"st",role:"ST"},{id:"spare",role:"ST"}];
  const result=optimalLineupAssignment(slots,candidates,(player,slot)=>player.role===slot.role?100:0);
  assert.deepEqual(result.map((entry)=>entry.player.id),["gk","st"]);
  assert.equal(new Set(result.map((entry)=>entry.player.id)).size,2);
});

test("default lineup replacements preserve every preset's independent slot coordinates", () => {
  const starters=["a","b"];
  const assignments=[{slot:{playerId:"a"},player:{id:"x"}},{slot:{playerId:"b"},player:{id:"y"}}];
  const presets={position1:{a:{x:10,y:20},b:{x:30,y:40}},position2:{a:{x:11,y:21},b:{x:31,y:41}},position3:{a:{x:12,y:22},b:{x:32,y:42}}};
  const result=remapLineupPresetSlots(starters,assignments,presets,["position1","position2","position3"]);
  assert.deepEqual(result.positionPresets.position1,{x:{x:10,y:20},y:{x:30,y:40}});
  assert.deepEqual(result.positionPresets.position2,{x:{x:11,y:21},y:{x:31,y:41}});
  assert.deepEqual(result.positionPresets.position3,{x:{x:12,y:22},y:{x:32,y:42}});
});

test("leading lineup optimization remaps only the active preset", () => {
  const starters=["a","b"];
  const assignments=[{slot:{playerId:"a"},player:{id:"b"}},{slot:{playerId:"b"},player:{id:"a"}}];
  const presets={position1:{a:{x:10,y:20},b:{x:30,y:40}},position2:{a:{x:11,y:21},b:{x:31,y:41}},position3:{a:{x:12,y:22},b:{x:32,y:42}}};
  const result=remapLineupPresetSlots(starters,assignments,presets,["position2"]);
  assert.deepEqual(result.positionPresets.position1,presets.position1);
  assert.deepEqual(result.positionPresets.position2,{b:{x:11,y:21},a:{x:31,y:41}});
  assert.deepEqual(result.positionPresets.position3,presets.position3);
});
