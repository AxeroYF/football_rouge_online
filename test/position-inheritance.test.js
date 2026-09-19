import test from 'node:test';
import assert from 'node:assert/strict';
import {initializePositionInheritance, syncInheritedPositions, markPositionCustomized} from '../shared/config/position-inheritance.mjs';
import {normalizeTacticsSquads} from '../tactics-page.js';
import {buildAccountMatchSeat, defaultPositions} from '../shared/football/account-match-seat.mjs';
import {DEFAULT_FORMATION_LINES as lines} from '../formation-rules.js';
const copy=v=>structuredClone(v);
function fixture(){
 const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
 const roster=Array.from({length:22},(_,i)=>({id:'p'+i,name:'P'+i,role:roles[i%11],pool:i%11===0?'GK':i%11<5?'DEF':i%11<9?'MID':'ATT',overall:80,grade:'A',state:{fitness:100}}));
 const a={id:'test',draft:{roster},playerSquads:{schemaVersion:2,assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<11?'expedition':'garrison']))},tactics:{activeSquadId:'expedition',squads:{}}};
 for(const [sid,ps] of [['expedition',roster.slice(0,11)],['garrison',roster.slice(11)]]){const positions=defaultPositions(ps);const starters=ps.map(p=>p.id);a.tactics.squads[sid]={starters,positions,formationLines:copy(lines),planSnapshots:{__s4V2:{starters,positionPresets:{position1:copy(positions),position2:copy(positions),position3:copy(positions)},formationLinePresets:{position1:copy(lines),position2:copy(lines),position3:copy(lines)}}}};}
 return a;
}
test('untouched plans follow default coordinates and lines without sharing mutable objects',()=>{
 const a=fixture(),s=normalizeTacticsSquads(a.tactics,a.draft.roster,a.playerSquads).squads.expedition;
 assert.deepEqual(s.customPositionPresets,{position2:false,position3:false});s.positionPresets.position1.p9.x=42;s.formationLinePresets.position1.attack=23;syncInheritedPositions(s);
 for(const key of ['position2','position3']){assert.deepEqual(s.positionPresets[key],s.positionPresets.position1);assert.deepEqual(s.formationLinePresets[key],s.formationLinePresets.position1);assert.notEqual(s.positionPresets[key],s.positionPresets.position1);}
 markPositionCustomized(s,'position2');s.positionPresets.position2.p9.x=70;s.positionPresets.position1.p9.x=48;syncInheritedPositions(s);assert.equal(s.positionPresets.position2.p9.x,70);assert.equal(s.positionPresets.position3.p9.x,48);
});
test('legacy generated secondary grids migrate, genuinely different saved layouts are retained',()=>{
 const a=fixture(),e=a.tactics.squads.expedition.planSnapshots.__s4V2;e.positionPresets.position1.p9.x+=8;e.positionPresets.position3.p9.x+=15;
 const s=normalizeTacticsSquads(a.tactics,a.draft.roster,a.playerSquads).squads.expedition;assert.equal(s.customPositionPresets.position2,false);assert.equal(s.customPositionPresets.position3,true);assert.deepEqual(s.positionPresets.position2,s.positionPresets.position1);assert.equal(s.positionPresets.position3.p9.x,e.positionPresets.position3.p9.x);
});
for(const sid of ['expedition','garrison'])test(sid+': stored edit flags survive reopen and match seat uses the same inheritance',()=>{
 const a=fixture(),e=a.tactics.squads[sid].planSnapshots.__s4V2,id=e.starters[9];e.customPositionPresets={position2:false,position3:true};e.positionPresets.position1[id].x+=9;e.positionPresets.position2[id]={x:50,y:50};e.positionPresets.position3[id].x+=17;
 const before=copy(a);const ui=normalizeTacticsSquads(a.tactics,a.draft.roster,a.playerSquads).squads[sid],seat=buildAccountMatchSeat(a,sid);assert.deepEqual(seat.positionPresets.position2,seat.positionPresets.position1);assert.deepEqual(seat.positionPresets,ui.positionPresets);assert.deepEqual(a,before);
});
test('inherited research follows default, customized research remains independent',()=>{
 const state={customPositionPresets:{position2:false,position3:true},positionPresets:{position1:{p:{x:20,y:20}},position3:{p:{x:30,y:20}}},formationLinePresets:{position1:copy(lines),position3:copy(lines)},researchFormationIds:{position1:'default',position3:'custom'},researchFormationBackups:{position1:{positions:{p:{x:10,y:20}}}}};
 initializePositionInheritance(state);assert.equal(state.researchFormationIds.position2,'default');assert.equal(state.researchFormationIds.position3,'custom');delete state.researchFormationIds.position1;syncInheritedPositions(state);assert.equal(state.researchFormationIds.position2,undefined);assert.equal(state.researchFormationIds.position3,'custom');
});
