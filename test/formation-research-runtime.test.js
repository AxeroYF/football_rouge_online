import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CampaignService} from '../campaign-service.mjs';
import {createFormationResearchSlot,FORMATION_RESEARCH_POINTS as points,FORMATION_RESEARCH_DIRECTIONS as directions,formationResearchLevels,researchProgress,researchRemainingTime} from '../shared/config/formation-research.mjs';
import {buildAccountMatchSeat} from '../shared/football/account-match-seat.mjs';
import {buildV2SpatialMatchup} from '../engine/s4-v2.1/versus/v2/spatial-model-v2.js';
import {createV2Match,advanceV2Match} from '../engine/s4-v2.1/versus/v2/match-engine-v2.js';
import {researchedShotMetric} from '../engine/s4-v2.1/versus/v2/formation-research-v2.js';
const H=3600000,M=60000,catalog=JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url),'utf8')).filter(p=>!p.isX);
function fixture(){
 let now=1000;const ids=['a','b','c','d'];const index={territories:ids.map((id,i)=>({territoryId:id,country:'法国',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:ids.filter(v=>v!==id),landNeighbors:ids.filter(v=>v!==id),cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const resources={schemaVersion:1,version:'research-test',periodMs:H,territories:Object.fromEntries(ids.map(id=>[id,{terrain:['plains'],yields:{gold:12,production:10,science:100}}]))};
 const s=new CampaignService({catalog,territoryIndex:index,territoryResources:resources,now:()=>now,random:()=>.2});
 const roster=[['GK',2],['DEF',8],['MID',8],['ATT',6]].flatMap(([pool,n])=>structuredClone(catalog.filter(p=>p.pool===pool).slice(0,n)));
 const a={id:'one',nickname:'研究测试',token:'test',setupComplete:true,homeTerritoryId:'a',gold:10000,goldLedger:[],draft:{teamName:'测试队',roster},mapColor:'#123456'};
 s.accounts.set(a.id,a);s.world.players.one={playerId:'one',territoryIds:ids,capitalTerritoryId:'a'};for(const id of ids)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:a.id,capitalOf:id==='a'?a.id:null,buildings:[]});s.save();
 const command=(action,body={})=>s.formationResearch.mutate(a,action,{revision:s.formationResearch.data(a).revision,...body});
 const confirm=(i=0)=>command('confirm',{slotId:'custom-'+(i+1),formation:createFormationResearchSlot(i)});
 const start=(direction='buildUp',slotId='custom-1')=>command('start',{slotId,direction});
 return {s,a,command,confirm,start,setNow:v=>now=v,get now(){return now;}};
}
test('confirmation is server-authoritative, immutable and rejects malformed geometry',()=>{const f=fixture();assert.throws(()=>f.start(),/确定/);const forged=createFormationResearchSlot(0);forged.levels={buildUp:5};f.command('confirm',{slotId:'custom-1',formation:forged});assert.equal(f.a.formationResearch.slots[0].levels.buildUp,0);assert.throws(()=>f.confirm(),/不能修改/);const bad=createFormationResearchSlot(1);bad.positions[points[0]].x=1000;assert.throws(()=>f.command('confirm',{slotId:'custom-2',formation:bad}),/超出范围/);});
test('one club queue settles fractional offline work without idle stockpiling',()=>{const f=fixture();f.setNow(1000+M*10);f.s.save();f.confirm();f.start();assert.equal(f.a.formationResearch.active.completed,0);assert.throws(()=>f.start('movement'),/同时只能/);f.setNow(f.now+M/8);f.s.save();assert.equal(f.a.formationResearch.active.completed,50);f.setNow(f.now+M/8);f.s.save();assert.equal(f.a.formationResearch.active,null);assert.equal(f.a.formationResearch.slots[0].levels.buildUp,1);f.start();assert.equal(f.a.formationResearch.active.required,200);assert.equal(f.a.formationResearch.active.completed,0);});
test('science changes settle old ownership interval before using new rate',()=>{const f=fixture();f.confirm();f.start();f.setNow(1000+M/8);for(const id of ['b','c','d'])f.s.world.territories[id].ownerId='other';f.s.save();assert.equal(f.a.formationResearch.active.completed,50);f.setNow(f.now+M/4);f.s.save();assert.equal(f.a.formationResearch.active.completed,75);});
test('cancel discards current level work and preserves completed research',()=>{const f=fixture();f.confirm();f.start();f.setNow(1000+M/4);f.s.save();f.start();f.setNow(f.now+M/8);const id=f.a.formationResearch.active.id;f.command('cancel',{jobId:id});assert.equal(f.a.formationResearch.active,null);assert.equal(f.a.formationResearch.slots[0].levels.buildUp,1);f.start();assert.equal(f.a.formationResearch.active.completed,0);});
test('wonder discount is snapshotted when research starts',()=>{const f=fixture();f.confirm();const b={id:'acropolis',type:'wonder:acropolis',wonderId:'acropolis',level:1,status:'active',builtAt:f.now,wonderActivatedAt:f.now};f.s.world.territories.a.buildings.push(b);f.s.save();f.start();assert.equal(f.a.formationResearch.active.required,80);f.s.world.territories.a.buildings=[];f.s.save();assert.equal(f.a.formationResearch.active.required,80);});
test('stale revisions and stale cancel ids cannot modify a newer queue',()=>{const f=fixture();f.confirm();assert.throws(()=>f.command('start',{slotId:'custom-1',direction:'buildUp',revision:0}),/状态已更新/);f.start();assert.throws(()=>f.command('cancel',{jobId:'other'}),/项目已变化/);});
test('save failures roll back mutation and settlement',()=>{const f=fixture();f.confirm();const real=f.s.repository.save.bind(f.s.repository);let calls=0;f.s.repository.save=(...args)=>{if(++calls===2)throw Error('disk');return real(...args);};assert.throws(()=>f.start(),/disk/);assert.equal(f.a.formationResearch.active,null);f.s.repository.save=real;f.start();const before=structuredClone(f.a.formationResearch);f.setNow(1000+M);f.s.repository.save=()=>{throw Error('disk');};assert.throws(()=>f.s.save(),/disk/);assert.deepEqual(f.a.formationResearch,before);});
function bind(f){
 const base=buildAccountMatchSeat(f.a),slot=f.a.formationResearch.slots[0],out=base.players.filter(p=>p.pool!=='GK'),gk=base.players.find(p=>p.pool==='GK');const positions=Object.fromEntries([...out.map((p,i)=>[p.id,slot.positions[points[i]]]),[gk.id,{x:50,y:94}]]);
 const old=base.players.map(p=>p.id);const saved={starters:old,positions,formationLines:slot.lines,planSnapshots:{__s4V2:{starters:old,positionPresets:{position1:positions,position2:positions,position3:positions},formationLinePresets:{position1:slot.lines,position2:slot.lines,position3:slot.lines},researchFormationIds:{position1:slot.id}}}};
 f.s.saveTactics(f.a,saved);return {slot,positions};
}
test('server locks imported shape and derives bonuses from completed account levels only',()=>{const f=fixture();f.confirm();f.start();f.setNow(1000+M/4);f.s.save();bind(f);let seat=buildAccountMatchSeat(f.a);assert.equal(seat.formationResearchPresets.position1.buildUp,1);assert.deepEqual(seat.formationResearchPresets.position2,seat.formationResearchPresets.position1);assert.deepEqual(seat.formationResearchPresets.position3,seat.formationResearchPresets.position1);const forged=structuredClone(f.a.tactics);const embedded=forged.squads.expedition.planSnapshots.__s4V2;embedded.positionPresets.position1[Object.keys(embedded.positionPresets.position1)[0]].x+=1;assert.throws(()=>f.s.saveTactics(f.a,forged),/锁定/);const direct=structuredClone(f.a);direct.tactics=forged;seat=buildAccountMatchSeat(direct);assert.deepEqual(seat.formationResearchPresets.position1,{});});
test('V2.1 spatial metrics receive directional bonuses, leaving keeper and other metrics untouched',()=>{const f=fixture();f.confirm();bind(f);const seat=buildAccountMatchSeat(f.a),team={...seat,formationResearchBonuses:{buildUp:5}},other={...structuredClone(seat),id:'other'};const raw=buildV2SpatialMatchup([seat,other]),boost=buildV2SpatialMatchup([team,other]);for(let i=0;i<11;i++){const a=raw.teams[0].players[i],b=boost.teams[0].players[i];assert.ok(Math.abs(b.metrics.buildUp-a.metrics.buildUp*(a.assignedRole==='GK'?1:1.05))<1e-6);assert.equal(b.metrics.finishing,a.metrics.finishing);}assert.deepEqual(raw.teams[1].players,boost.teams[1].players);});
test('shooting uses context-specific research and excludes penalties and free kicks',()=>{const levels=Object.fromEntries(directions.map(d=>[d.id,5]));for(const type of ['cross','setPiece','longShot','individual'])assert.equal(researchedShotMetric(80,levels,type,'ST'),84);for(const type of ['penalty','freeKick'])assert.equal(researchedShotMetric(80,levels,type,'ST'),80);assert.equal(researchedShotMetric(80,levels,'longShot','GK'),80);});
test('match starts with active formation bonuses and switches them with score-based presets',()=>{const f=fixture();f.confirm();bind(f);const seat=buildAccountMatchSeat(f.a);seat.formationResearchPresets.position1={buildUp:2};seat.formationResearchPresets.position2={pressing:3};const other={...structuredClone(seat),id:'other',formationResearchPresets:{}};const match=createV2Match([seat,other],{seed:'research-test'});assert.deepEqual(match.teams[0].formationResearchBonuses,{buildUp:2});match.teams[0].score=3;advanceV2Match(match,1);assert.deepEqual(match.teams[0].formationResearchBonuses,{pressing:3});});

test('all five levels use approved increasing costs and stop at five percent',()=>{const f=fixture();f.confirm();for(const [i,cost]of [100,200,400,800,1600].entries()){f.start();assert.equal(f.a.formationResearch.active.required,cost);f.setNow(f.now+Math.ceil(cost/400*M)+1);f.s.save();assert.equal(f.a.formationResearch.slots[0].levels.buildUp,i+1);assert.equal(f.a.formationResearch.active,null);}assert.throws(()=>f.start(),/最高等级/);});
test('fractional science phases integrate separately and never complete other directions',()=>{const f=fixture();f.confirm();f.start();const from=f.now;f.s.formationResearch.prepare(f.s.accounts,{one:[{from,to:from+M/2,units:{science:2500}},{from:from+M/2,to:from+M,units:{science:7500}}]},from+M);assert.equal(f.a.formationResearch.active.completed,5);assert.equal(f.a.formationResearch.slots[0].levels.movement,0);});


test('science capacity completes 100 work at 6.4 per minute in 15m 37.5s',()=>{
 const f=fixture();f.confirm();f.start();const from=f.now,duration=100/6.4*M;
 const job={...f.a.formationResearch.active,sciencePerMinute:6.4};
 const halfway=researchProgress(job,from+duration/2);
 assert.equal(halfway.completed,50);assert.equal(halfway.remaining,duration/2);
 f.s.formationResearch.prepare(f.s.accounts,{one:[{from,to:from+duration-1,units:{science:6400}}]},from+duration-1);
 assert.ok(f.a.formationResearch.active.completed<100);
 f.s.formationResearch.prepare(f.s.accounts,{one:[{from:from+duration-1,to:from+duration,units:{science:6400}}]},from+duration);
 assert.equal(f.a.formationResearch.active,null);assert.equal(f.a.formationResearch.slots[0].lastCompletedAt,from+duration);
 assert.equal(researchRemainingTime(duration),'剩余 15:38');
 assert.equal(researchRemainingTime(0),'等待完成确认');assert.equal(researchRemainingTime(null),'等待科技值');
 assert.equal(researchProgress({...job,sciencePerMinute:0},from+M).remaining,null);
});
test('legacy hourly projects retain old work before deployment and use minutes afterwards',()=>{
 const f=fixture();f.confirm();f.start();const from=f.now;
 delete f.a.formationResearch.active.workPeriodMs;
 f.a.formationResearch.active.completed=10;
 const cut=from+H;f.s.formationResearch.cadenceChangedAt=cut;
 // A construction boundary before deployment must not migrate early.
 f.s.formationResearch.prepare(f.s.accounts,{one:[{from,to:from+H/2,units:{science:6400}}]},from+H/2);
 assert.equal(f.a.formationResearch.active.completed,13.2);
 assert.equal(f.a.formationResearch.active.workPeriodMs,undefined);
 const result=f.s.formationResearch.prepare(f.s.accounts,{one:[{from:from+H/2,to:cut+M,units:{science:6400}}]},cut+M);
 assert.ok(Math.abs(f.a.formationResearch.active.completed-22.8)<1e-9);
 assert.equal(f.a.formationResearch.active.workPeriodMs,M);
 result.rollback();assert.equal(f.a.formationResearch.active.completed,13.2);
 f.s.formationResearch.prepare(f.s.accounts,{one:[{from:from+H/2,to:cut+M,units:{science:6400}}]},cut+M);
 const saved=structuredClone(f.a.formationResearch);
 f.s.formationResearch.prepare(f.s.accounts,{one:[{from,to:cut+M,units:{science:6400}}]},cut+M);
 assert.deepEqual(f.a.formationResearch,saved);
 f.s.formationResearch.cadenceChangedAt=cut+M;
 f.s.formationResearch.prepare(f.s.accounts,{one:[{from:cut+M,to:cut+2*M,units:{science:6400}}]},cut+2*M);
 assert.ok(Math.abs(f.a.formationResearch.active.completed-29.2)<1e-9);
});


test('renaming confirmed formation preserves geometry, levels, active work and import binding',()=>{
 const f=fixture();f.confirm();f.start();f.setNow(f.now+M/4);f.s.save();bind(f);f.start('pressing');f.setNow(f.now+M/8);f.s.save();
 const before=structuredClone(f.a.formationResearch),seat=buildAccountMatchSeat(f.a);
 f.command('rename',{slotId:'custom-1',name:'  高位控制  ',positions:{},levels:{pressing:5}});
 assert.equal(f.a.formationResearch.slots[0].name,'高位控制');
 assert.deepEqual(f.a.formationResearch.slots[0],{...before.slots[0],name:'高位控制'});
 assert.deepEqual(f.a.formationResearch.active,before.active);
 assert.deepEqual(buildAccountMatchSeat(f.a).formationResearchPresets,seat.formationResearchPresets);
 assert.throws(()=>f.command('rename',{slotId:'custom-2',name:'未确认'}),/确定/);
 for(const name of ['', ' ', '长'.repeat(25),'坏\n名字'])assert.throws(()=>f.command('rename',{slotId:'custom-1',name}),/1–24/);
 const saved=structuredClone(f.a.formationResearch);let calls=0;
 const real=f.s.repository.save.bind(f.s.repository);f.s.repository.save=(...args)=>{if(++calls===2)throw Error('disk');return real(...args);};
 assert.throws(()=>f.command('rename',{slotId:'custom-1',name:'不应保存'}),/disk/);
 assert.deepEqual(f.a.formationResearch,saved);
});
