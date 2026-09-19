import test from 'node:test';
import assert from 'node:assert/strict';
import {geoDistanceKm,recoveryRing,strongestRecoveryCenter} from '../shared/map/recovery-aura.mjs';
import {facilityEffects} from '../shared/config/facility-levels.mjs';
import {relationKey,canUseTerritory} from '../shared/config/diplomacy.mjs';
import {ExpeditionFitnessService} from '../server/application/expedition-fitness-service.mjs';
import {moveExpeditionPiece,normalizeExpeditionPiece} from '../server/domain/expedition-piece.mjs';
function fixture(){
 const territories=[{territoryId:'a',centroid:[0,0]},{territoryId:'b',centroid:[1,0]},{territoryId:'far',centroid:[3,0]},{territoryId:'outside',centroid:[10,0]}];
 const metadata=new Map(territories.map(t=>[t.territoryId,t]));
 const world={players:{a:{territoryIds:['a'],capitalTerritoryId:'a'},b:{territoryIds:['b','far','outside']}},territories:Object.fromEntries(territories.map(t=>[t.territoryId,{ownerType:'player',ownerId:t.territoryId==='a'?'a':'b',buildings:[]}]))};
 world.diplomacy={relationships:{[relationKey('a','b')]:{players:['a','b'],state:'alliance'}}};
 const center={id:'center',type:'recovery-center',status:'active',level:1,builtAt:0};world.territories.b.buildings.push(center);
 const a={id:'a',homeTerritoryId:'a',expeditionPiece:{schemaVersion:1,tokenId:'default',territoryId:'a',movement:null},playerSquads:{assignments:{p:'expedition',g:'garrison'}},draft:{roster:[{id:'p',state:{fitness:40}},{id:'g',state:{fitness:40}}]}};
 const fitness=new ExpeditionFitnessService({world,accounts:new Map([['a',a]]),territoryIndex:{territories},now:()=>0});
 return {world,metadata,center,a,fitness,index:{territories}};
}
test('all five radii increase, prices stay 700, and every animation boundary matches the geodesic radius',()=>{
 for(let level=1;level<=5;level++){
  const e=facilityEffects('recovery-center',level);assert.equal(e.recoveryRadiusKm,150+(level-1)*75);assert.equal(e.recoveryPerMinute,1+(level-1)*.25);assert.equal(facilityEffects('scout-center',level).costGold,700);
  for(const p of recoveryRing([2,48],e.recoveryRadiusKm))assert.ok(Math.abs(geoDistanceKm([2,48],p)-e.recoveryRadiusKm)<1e-6);
 }
});
test('ally radius crosses territory boundaries; upgrades extend reach and overlaps use the strongest center',()=>{
 const f=fixture();assert.equal(strongestRecoveryCenter(f.world,'a','a',f.metadata).buildingId,'center');
 assert.equal(strongestRecoveryCenter(f.world,'a','far',f.metadata),null);f.center.level=2;assert.equal(strongestRecoveryCenter(f.world,'a','far',f.metadata).level,2);
 f.world.territories.a.buildings.push({...f.center,id:'own',level:5});assert.equal(strongestRecoveryCenter(f.world,'a','b',f.metadata).buildingId,'own');
 assert.equal(strongestRecoveryCenter(f.world,'a','outside',f.metadata),null);f.world.territories.a.buildings=[];
 f.world.diplomacy.relationships[relationKey('a','b')].state='friendship';assert.equal(strongestRecoveryCenter(f.world,'a','a',f.metadata),null);
});
test('radius recovery settles before alliance revocation, pauses in matches and never stacks',()=>{
 const f=fixture();f.fitness.prepare(0);f.fitness.prepare(60000);assert.equal(f.a.draft.roster[0].state.fitness,41);assert.equal(f.a.draft.roster[1].state.fitness,40.5);
 f.world.diplomacy.relationships[relationKey('a','b')].state='friendship';f.fitness.prepare(60000);f.fitness.prepare(120000);assert.equal(f.a.draft.roster[0].state.fitness,41.5);
 f.world.activeChallenges={x:{attackerId:'a',phase:'first-leg',live:{attacker:{players:[{id:'p'}]}}}};f.fitness.prepare(120000);f.fitness.prepare(180000);assert.equal(f.a.draft.roster[0].state.fitness,41.5);
});
test('allied movement uses authoritative ownership and evacuates revoked destinations',()=>{
 const f=fixture();moveExpeditionPiece({account:f.a,world:f.world,territoryIndex:f.index,targetTerritoryId:'far',now:0});normalizeExpeditionPiece(f.a,f.world,600000);assert.equal(f.a.expeditionPiece.territoryId,'far');
 f.world.diplomacy.relationships[relationKey('a','b')].state='friendship';normalizeExpeditionPiece(f.a,f.world,600000);assert.equal(f.a.expeditionPiece.territoryId,'a');assert.equal(canUseTerritory(f.world,'a','far'),false);
});

test('naval preview remains usable on an allied coast and disappears immediately after leaving',async()=>{
 const {FogService}=await import('../server/application/fog-service.mjs');const f=fixture();f.world.seasonId='season';f.a.expeditionPiece.territoryId='b';
 const fog=new FogService({territoryIndex:f.index,now:()=>1000});
 const preview=fog.survey(f.a,f.world,{sourceTerritoryId:'b',sourcePoint:[1,0],routes:[{targetTerritoryId:'outside',targetPoint:[10,0]}]});
 assert.equal(fog.preview(f.a,f.world).id,preview.id);
 f.world.diplomacy.relationships[relationKey('a','b')].state='friendship';assert.equal(fog.preview(f.a,f.world),null);
});

test('same-territory recovery is guaranteed even when tile geometry has no usable center',()=>{
 const f=fixture();f.metadata.set('b',{territoryId:'b'});
 assert.equal(strongestRecoveryCenter(f.world,'a','b',f.metadata).buildingId,'center');
});
test('all facility upgrades compare matching current and next quantities',async()=>{
 const {facilityUpgradeText,FACILITY_UPGRADES}=await import('../shared/config/facility-levels.mjs');
 assert.equal(facilityUpgradeText('recovery-center',1),'范围 150 → 225 公里 · 恢复 1 → 1.25 体力/分钟');
 assert.match(facilityUpgradeText('scout-center',1),/A级概率 0 → 4.95%/);assert.match(facilityUpgradeText('scout-center',1),/S级概率 0.5 → 1%/);
 for(const type of Object.keys(FACILITY_UPGRADES))for(let level=1;level<FACILITY_UPGRADES[type].gold.length;level++)assert.match(facilityUpgradeText(type,level),/ → /);
});
