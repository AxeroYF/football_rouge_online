import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FORMATION_RESEARCH_DIRECTIONS as directions, FORMATION_RESEARCH_POINTS as points, normalizeFormationResearchSlots, createFormationResearchSlot, analyzeResearchFormation, limitFormationPoint, moveResearchFormationLine} from '../shared/config/formation-research.mjs';
import {analyzeElevenBoardFormation, formationRoleZones} from '../formation-rules.js';
const params=JSON.parse(fs.readFileSync(new URL('../engine/s4-v2.1/versus/v2/match-parameters-v2.json',import.meta.url),'utf8'));
test('all twelve directions correspond to real V2.1 outfield metrics',()=>{
 assert.deepEqual(directions.map(d=>d.id).sort(),Object.keys(params.metrics).filter(k=>k!=='goalkeeping').sort());
 for(const d of directions)assert.ok(Object.values(params.metrics[d.id]).reduce((a,b)=>a+b,0)>.99);
});
test('three independent custom slots with exactly ten outfield points and fixed goalkeeper',()=>{
 const slots=normalizeFormationResearchSlots();assert.equal(slots.length,3);assert.equal(new Set(slots.map(s=>s.id)).size,3);
 for(const s of slots){assert.deepEqual(Object.keys(s.positions),points);assert.deepEqual(analyzeResearchFormation(s).counts,{GK:1,DEF:4,MID:3,ATT:3});}
 slots[0].positions[points[0]].x=90;slots[0].lines.attack=10;slots[0].previewLevels.buildUp=5;assert.equal(slots[1].positions[points[0]].x,16);assert.equal(slots[1].lines.attack,20);assert.equal(slots[1].previewLevels.buildUp,1);assert.equal(slots[0].previewLevels.pressing,1);
});
test('dragging changes automatic shape using mature board rules',()=>{
 const s=createFormationResearchSlot(0);s.positions[points[0]]={x:20,y:44};assert.equal(analyzeResearchFormation(s).name,'4-4-2');
 const expected=analyzeElevenBoardFormation([...points,'fixed-gk'].map(id=>({id})),{...s.positions,'fixed-gk':{x:50,y:94}},s.lines);assert.deepEqual(analyzeResearchFormation(s),expected);
 const zone=formationRoleZones(s.lines).find(z=>z.role==='LM');assert.ok(s.positions[points[0]].y>=zone.yMin&&s.positions[points[0]].y<=zone.yMax);
});
test('point and line boundaries always keep one goalkeeper',()=>{
 const s=createFormationResearchSlot(0);
 for(const key of ['attack','midfield','defense','goalkeeper'])for(const y of [-500,6,30,78,94,1000]){
  moveResearchFormationLine(s,key,y);for(const id of points)s.positions[id]=limitFormationPoint({x:999,y:999},s.lines);
  assert.equal(analyzeResearchFormation(s).counts.GK,1);assert.ok(Object.values(s.positions).every(p=>p.x<=94&&p.y<94));
 }
});
test('draft normalization rejects extra slots, phantom players and fabricated progress',()=>{
 const raw=createFormationResearchSlot(0);raw.name='   ';raw.positions[points[0]]={x:Infinity,y:-999};raw.positions.fake={x:50,y:94};raw.previewLevels.buildUp=999;raw.previewLevels.pressing=4;raw.direction='unknown';raw.completedLevels={buildUp:5};raw.lines.goalkeeper=-100;
 const slots=normalizeFormationResearchSlots([raw,null,7,raw]);assert.equal(slots.length,3);assert.equal(slots[0].name,'自定义阵型 1');assert.equal(slots[0].positions[points[0]].x,50);assert.equal(slots[0].positions[points[0]].y,6);assert.equal(slots[0].direction,'buildUp');assert.equal(slots[0].previewLevels.buildUp,1);assert.equal(slots[0].previewLevels.pressing,4);assert.equal(slots[0].completedLevels,undefined);assert.equal(Object.keys(slots[0].positions).length,10);assert.equal(analyzeResearchFormation(slots[0]).counts.GK,1);
});
test('stored shape, lines, name and independent level previews round trip',()=>{
 const slots=normalizeFormationResearchSlots();slots[2].name='自定义压迫';slots[2].configured=true;slots[2].direction='pressing';slots[2].previewLevels.pressing=5;slots[2].previewLevels.movement=3;slots[2].showZones=false;moveResearchFormationLine(slots[2],'attack',16);
 assert.deepEqual(normalizeFormationResearchSlots(JSON.parse(JSON.stringify(slots))),slots);
});
