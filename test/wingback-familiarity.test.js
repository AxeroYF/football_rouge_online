import test from 'node:test';
import assert from 'node:assert/strict';
import {positionFamiliarity,positionFitScore,ATTRIBUTE_NAMES} from '../engine/s4-v2.1/game/public/schema.js';
import {inferElevenBoardRoles,formationRoleZones,DEFAULT_FORMATION_LINES} from '../formation-rules.js';
import {inferElevenBoardRoles as engineRoles} from '../engine/s4-v2.1/versus/public/formation-rules.js';
import {buildV2SpatialMatchup} from '../engine/s4-v2.1/versus/v2/spatial-model-v2.js';
import {playerTooltip} from '../tactics-page.js';
test('fullback and same-side wingback have identical primary familiarity and engine fit',()=>{
 for(const [back,wing,foot] of [['LB','LWB','left'],['RB','RWB','right']])for(const preferredFoot of [foot,'both','left','right']){
  const p={role:back,secondaryRole:'CB',preferredFoot};assert.equal(positionFamiliarity(p,wing),'primary');assert.equal(positionFitScore(p,wing),positionFitScore(p,back));assert.equal(p.secondaryRole,'CB');
 }
});
test('secondary fullback gives same-side wingback secondary familiarity, never opposite-side mastery',()=>{
 assert.equal(positionFamiliarity({role:'CB',secondaryRole:'LB'},'LWB'),'secondary');
 assert.equal(positionFamiliarity({role:'CB',secondaryRole:'RB'},'RWB'),'secondary');
 assert.equal(positionFamiliarity({role:'LB',secondaryRole:'CB'},'RWB'),'unfamiliar');
 assert.equal(positionFamiliarity({role:'RB',secondaryRole:'CB'},'LWB'),'unfamiliar');
});
test('wingback regions and their midfield boundary agree in board and V2.1 engine',()=>{
 for(const lines of [DEFAULT_FORMATION_LINES,{attack:18,midfield:40,defense:64,goalkeeper:88}]){
  const boundary=(lines.midfield+lines.defense)/2;
  for(const [x,wing,back,mid] of [[15,'LWB','LB','LM'],[85,'RWB','RB','RM']]){
   const entries=[{id:'mid',position:{x,y:boundary-.01}},{id:'edge',position:{x,y:boundary}},{id:'wing',position:{x,y:lines.defense-.01}},{id:'back',position:{x,y:lines.defense}}];
   const expected={mid,edge:wing,wing,back};assert.deepEqual(inferElevenBoardRoles(entries,lines),expected);assert.deepEqual(engineRoles(entries,lines),expected);
   const zone=formationRoleZones(lines).find(z=>z.role===wing);assert.equal(zone.yMin,boundary);assert.equal(zone.yMax,lines.defense);
  }
 }
});
test('position shadow interiors all match automatic role detection',()=>{
 for(const z of formationRoleZones()){
  const p={id:'p',position:{x:(z.xMin+z.xMax)/2,y:(z.yMin+z.yMax)/2}};
  assert.equal(inferElevenBoardRoles([p],DEFAULT_FORMATION_LINES).p,z.role);
 }
});
test('actual spatial engine assigns wingback roles without fullback position penalty',()=>{
 const players=['LB','RB','GK'].map((role,i)=>({id:String(i),role,pool:role==='GK'?'GK':'DEF',preferredFoot:i===0?'left':'right',attributes:Object.fromEntries(ATTRIBUTE_NAMES.map(k=>[k,80])),state:{fitness:100}}));
 const team={id:'a',players,positions:{0:{x:15,y:60},1:{x:85,y:60},2:{x:50,y:90}},formationLines:DEFAULT_FORMATION_LINES};
 const result=buildV2SpatialMatchup([team,{...structuredClone(team),id:'b'}]);
 for(const i of [0,1]){const p=result.teams[0].players[i];assert.equal(p.assignedRole,i===0?'LWB':'RWB');assert.equal(p.fit,positionFitScore(players[i],players[i].role));}
});
test('tooltip exposes wingback familiarity alongside original secondary position',()=>{
 const p={id:'p',role:'LB',secondaryRole:'CB',attributes:{},overall:80};const text=playerTooltip(p,'LWB');assert.match(text,/左后卫 \/ 左翼卫/);assert.match(text,/副位置：中后卫/);
});
