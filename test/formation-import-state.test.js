import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberFormationBeforeResearch,releaseResearchFormation} from '../client/research/formation-import-state.js';
const geometry=n=>({positions:{a:{x:n,y:20},b:{x:50,y:90}},lines:{attack:n,midfield:45,defense:70,goalkeeper:90}});
const make=()=>({researchFormationIds:{},positionPresets:{position1:geometry(20).positions,position2:geometry(25).positions},formationLinePresets:{position1:geometry(20).lines,position2:geometry(25).lines},tacticalPlans:{opening:{playerDuties:{a:'creator'}}}});
const use=(s,key,id,n)=>{rememberFormationBeforeResearch(s,key);s.researchFormationIds[key]=id;s.positionPresets[key]=geometry(n).positions;s.formationLinePresets[key]=geometry(n).lines;};
test('release restores exact pre-import positions and reference lines and preserves duties',()=>{
 const s=make();use(s,'position1','custom-1',30);s.tacticalPlans.opening.playerDuties.a='runner';
 assert.equal(releaseResearchFormation(s,'position1',geometry(40)),true);assert.deepEqual(s.positionPresets.position1,geometry(20).positions);assert.deepEqual(s.formationLinePresets.position1,geometry(20).lines);assert.equal(s.tacticalPlans.opening.playerDuties.a,'runner');assert.equal(s.researchFormationIds.position1,undefined);
});
test('switching research slots and re-importing keep the first backup across saved JSON',()=>{
 let s=make();use(s,'position1','custom-1',30);use(s,'position1','custom-2',35);s=JSON.parse(JSON.stringify(s));use(s,'position1','custom-2',35);releaseResearchFormation(s,'position1',geometry(40));assert.deepEqual(s.positionPresets.position1,geometry(20).positions);
});
test('each preset has independent restoration and subsequent imports take a new backup',()=>{
 const s=make();use(s,'position1','custom-1',30);use(s,'position2','custom-2',35);releaseResearchFormation(s,'position1',geometry(40));assert.deepEqual(s.positionPresets.position2,geometry(35).positions);assert.equal(s.researchFormationIds.position2,'custom-2');s.positionPresets.position1=geometry(23).positions;use(s,'position1','custom-3',39);releaseResearchFormation(s,'position1',geometry(40));assert.deepEqual(s.positionPresets.position1,geometry(23).positions);
});
test('legacy imports without a backup return the supplied base formation, not research geometry',()=>{
 const s=make();s.researchFormationIds.position1='legacy';s.positionPresets.position1=geometry(39).positions;use(s,'position1','custom-2',36);assert.equal(releaseResearchFormation(s,'position1',geometry(22)),false);assert.deepEqual(s.positionPresets.position1,geometry(22).positions);
});
