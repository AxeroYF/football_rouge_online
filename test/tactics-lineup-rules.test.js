import assert from "node:assert/strict";
import test from "node:test";
import { optimalLineupAssignment, remapLineupPresetSlots } from "../tactics-lineup-rules.js";

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
