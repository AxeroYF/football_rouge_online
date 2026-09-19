import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import crypto from 'node:crypto';
import { coalitionFixture } from './coalition-fixture.mjs';
import { setTestWar } from './diplomacy-fixture.mjs';
import { createMaritimeRoutePlanner, nearestPointOnCoastlines } from "../maritime-routes.mjs";

const square=(id,x0,y0,x1,y1)=>({type:"Feature",properties:{territoryId:id},geometry:{type:"Polygon",coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]}});
const territory=(territoryId,bounds)=>({territoryId,region:"europe",bounds,landNeighbors:[],neighbors:[]});
const geoJson={type:"FeatureCollection",features:[square("source",0,0,1,1),square("near",3,0,4,1),square("far",6,0,7,1),square("blocked",3,3,4,4),square("wall",1.7,1.5,2.3,2.5)]};
const index={territories:[{...territory("source",[0,0,1,1]),landNeighbors:["land-coast"]},territory("near",[3,0,4,1]),territory("far",[6,0,7,1]),territory("blocked",[3,3,4,4]),territory("wall",[1.7,1.5,2.3,2.5]),territory("land-coast",[2,-2,3,-1])]};
const coastlineData={maxRangeKm:900,angularSectorDegrees:12,territories:{
  source:{samplePoints:[[1,.5]],coastlines:[[[1,0],[1,1]]]},
  near:{samplePoints:[[3,.5]],coastlines:[[[3,0],[3,1]]]},
  far:{samplePoints:[[6,.5]],coastlines:[[[6,0],[6,1]]]},
  blocked:{samplePoints:[[3,3.5]],coastlines:[[[3,3],[3,4]]]},
  "land-coast":{samplePoints:[[2,-1.5]],coastlines:[[[2,-2],[2,-1]]]},
}};

test("maritime routes keep the nearest visible landing in each direction",()=>{
  const planner=createMaritimeRoutePlanner({coastlineData,territoryGeoJson:geoJson,territoryIndex:index});
  const world={territories:{source:{ownerType:"player",ownerId:"p",buildings:[{type:"port",status:"active",level:1}]},near:{ownerType:"neutral"},far:{ownerType:"neutral"},blocked:{ownerType:"neutral"},wall:{ownerType:"neutral"},"land-coast":{ownerType:"neutral"}}};
  const result=planner.routesFrom(world,"p","source",[1,.5]);
  assert.ok(result.routes.some((route)=>route.targetTerritoryId==="near"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="far"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="blocked"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="land-coast"));
});

test("maritime routes reject inland sources and protected or owned targets",()=>{
  const planner=createMaritimeRoutePlanner({coastlineData,territoryGeoJson:geoJson,territoryIndex:index});
  const world={territories:{source:{ownerType:"player",ownerId:"p",buildings:[{type:"port",status:"active",level:1}]},near:{ownerType:"neutral",protectedUntil:200},far:{ownerType:"player",ownerId:"p"},blocked:{ownerType:"neutral"},wall:{ownerType:"player",ownerId:"p"},"land-coast":{ownerType:"neutral"}}};
  const result=planner.routesFrom(world,"p","source",[1,.5],100);
  assert.ok(!result.routes.some((route)=>["near","far"].includes(route.targetTerritoryId)));
  assert.throws(()=>planner.routesFrom(world,"p","wall",[2,2],100),/没有可用海岸线/);
});

test("coast snapping projects continuously onto line segments",()=>{
  const snapped=nearestPointOnCoastlines([[[1,0],[1,1]]],[1.05,.25]);
  assert.ok(snapped);
  assert.ok(Math.abs(snapped.candidate[0]-1)<1e-9);
  assert.ok(Math.abs(snapped.candidate[1]-.25)<1e-9);
});

test("maritime routes only leave from the outward-facing side of the coast",()=>{
  const localGeoJson={type:"FeatureCollection",features:[
    square("source",0,0,1,1),
    square("outward",3,0,4,1),
    square("reverse",-3,0,-2,1),
  ]};
  const localIndex={territories:[
    territory("source",[0,0,1,1]),
    territory("outward",[3,0,4,1]),
    territory("reverse",[-3,0,-2,1]),
  ]};
  const localCoastlines={maxRangeKm:900,angularSectorDegrees:12,territories:{
    source:{coastlines:[[[1,0],[1,1]]]},
    outward:{coastlines:[[[3,0],[3,1]]]},
    reverse:{coastlines:[[[-2,0],[-2,1]]]},
  }};
  const planner=createMaritimeRoutePlanner({coastlineData:localCoastlines,territoryGeoJson:localGeoJson,territoryIndex:localIndex});
  const world={territories:{source:{ownerType:"player",ownerId:"p",buildings:[{type:"port",status:"active",level:1}]},outward:{ownerType:"neutral"},reverse:{ownerType:"neutral"}}};
  const result=planner.routesFrom(world,"p","source",[1,.5]);
  assert.ok(result.routes.some((route)=>route.targetTerritoryId==="outward"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="reverse"));
});

test("full Iceland coastline data keeps the Faroe Islands reachable from the south coast",async()=>{
  const [realCoastlines,realGeoJson,realIndex]=await Promise.all([
    readFile(new URL("../assets/data/campaign-coastlines.json",import.meta.url),"utf8").then(JSON.parse),
    readFile(new URL("../assets/data/campaign-territories.geojson",import.meta.url),"utf8").then(JSON.parse),
    readFile(new URL("../assets/data/territory-index.json",import.meta.url),"utf8").then(JSON.parse),
  ]);
  assert.equal(realCoastlines.schemaVersion,2);
  const world={territories:Object.fromEntries(realIndex.territories.map((entry)=>[entry.territoryId,{ownerType:"neutral",ownerId:null}]))};
  const source=realIndex.territoryIdAliases["adm1:isl-705"]??"adm1:isl-705";
  world.territories[source]={ownerType:"player",ownerId:"p"};
  const planner=createMaritimeRoutePlanner({coastlineData:realCoastlines,territoryGeoJson:realGeoJson,territoryIndex:realIndex});
  const nearRoute=planner.routesFrom(world,"p",source,[-18.5,63.42]).routes.find(r=>r.targetTerritoryId==="adm1:fro-1443");
  assert.ok(nearRoute && nearRoute.distanceKm<=600);
  world.territories[source].buildings=[{type:"port",status:"active",level:1}];
  const result=planner.routesFrom(world,"p",source,[-18.5,63.42]);
  assert.ok(result.routes.some((route)=>route.targetTerritoryId==="adm1:fro-1443"));
});
test("multiple reachable coasts in one angular sector remain selectable; range still limits targets",()=>{
  const features=[square("source",0,0,1,1),square("first",3,.25,3.3,.35),square("second",6,.45,6.3,.55),square("distant",12,.45,12.3,.55)];
  const localIndex={territories:features.map(f=>{const ring=f.geometry.coordinates[0];return territory(f.properties.territoryId,[ring[0][0],ring[0][1],ring[2][0],ring[2][1]]);})};
  const coasts={maxRangeKm:900,angularSectorDegrees:12,territories:{
    source:{coastlines:[[[1,0],[1,1]]]},first:{coastlines:[[[3,.25],[3,.35]]]},
    second:{coastlines:[[[6,.45],[6,.55]]]},distant:{coastlines:[[[12,.45],[12,.55]]]},
  }};
  const world={territories:Object.fromEntries(features.map(f=>[f.properties.territoryId,{ownerType:"neutral"}]))};
  world.territories.source={ownerType:"player",ownerId:"p",buildings:[{type:"port",status:"active",level:1}]};
  const planner=createMaritimeRoutePlanner({coastlineData:coasts,territoryGeoJson:{type:"FeatureCollection",features},territoryIndex:localIndex});
  const routes=planner.routesFrom(world,"p","source",[1,.5]).routes;
  assert.deepEqual(routes.map(r=>r.targetTerritoryId).sort(),["first","second"]);
  assert.equal(Math.floor(routes[0].bearing/12),Math.floor(routes[1].bearing/12));
});


test('local port levels extend the real planner beyond the legacy 900 km data limit',()=>{
 const geo={type:'FeatureCollection',features:[square('source',0,0,1,1),square('target',13,0,14,1)]};
 const index={territories:[territory('source',[0,0,1,1]),territory('target',[13,0,14,1])]};
 const data={maxRangeKm:900,territories:{source:{coastlines:[[[1,0],[1,1]]]},target:{coastlines:[[[13,0],[13,1]]]}}};
 const planner=createMaritimeRoutePlanner({coastlineData:data,territoryGeoJson:geo,territoryIndex:index});
 const world={territories:{source:{ownerType:'player',ownerId:'p',buildings:[]},target:{ownerType:'neutral'}}};
 assert.equal(planner.routesFrom(world,'p','source',[1,.5]).routes.length,0);
 const port={type:'port',level:1,status:'active'};world.territories.source.buildings=[port];
 assert.equal(planner.routesFrom(world,'p','source',[1,.5]).routes.length,0);
 port.level=2;assert.equal(planner.routesFrom(world,'p','source',[1,.5]).routes[0].targetTerritoryId,'target');
 port.status='constructing';assert.equal(planner.routesFrom(world,'p','source',[1,.5]).routes.length,0);
});

test('allied coasts permit departure and friendship alone does not',()=>{
 const planner=createMaritimeRoutePlanner({coastlineData,territoryGeoJson:geoJson,territoryIndex:index});
 const relationship={players:['p','ally'],state:'alliance'};
 const world={diplomacy:{relationships:{alliance:relationship}},territories:Object.fromEntries(index.territories.map(t=>[t.territoryId,{ownerType:'neutral'}]))};world.territories.source={ownerType:'player',ownerId:'ally',buildings:[{type:'port',status:'active',level:1}]};
 assert.ok(planner.routesFrom(world,'p','source',[1,.5]).routes.some(r=>r.targetTerritoryId==='near'));
 relationship.state='friendship';assert.throws(()=>planner.routesFrom(world,'p','source',[1,.5]),/自己或盟友/);
});


test('current range rules override old map data and require a completed departure port',()=>{
 for(const [level,range] of [[0,600],[1,1200],[2,1500],[3,1800],[4,2200],[5,2600]]) {
  for(const delta of [-2,2]) {
   const longitude=1+(range+delta)/6371*180/Math.PI;
   const features=[square('source',0,-.1,1,.1),square('target',longitude,-.1,longitude+.1,.1)];
   const index={territories:[territory('source',[0,-.1,1,.1]),territory('target',[longitude,-.1,longitude+.1,.1])]};
   const data={maxRangeKm:900,territories:{source:{coastlines:[[[1,-.1],[1,.1]]]},target:{coastlines:[[[longitude,-.1],[longitude,.1]]]}}};
   const planner=createMaritimeRoutePlanner({coastlineData:data,territoryGeoJson:{type:'FeatureCollection',features},territoryIndex:index});
   const port={type:'port',level:level||1,status:'active'};
   const world={territories:{source:{ownerType:'player',ownerId:'p',buildings:level?[port]:[]},target:{ownerType:'neutral',buildings:[{type:'port',level:5,status:'active'}]}}};
   const result=planner.routesFrom(world,'p','source',[1,0]);
   assert.equal(result.maxRangeKm,range);
   assert.equal(result.routes.length,delta<0?1:0,`level ${level}, distance ${range+delta}`);
   if(level){port.status='constructing';assert.equal(planner.routesFrom(world,'p','source',[1,0]).routes.length,0);}
  }
 }
});


// Synthetic territories are defined where players see them, then encoded as map assets.
const sourceCoordinate=(p,region)=>region==='south-america'?[p[1]-64.5,p[0]-41.5]:[...p];
function crossRegionFixture({wall=false}={}) {
  const entries=[['a','europe',[0,0,1,1]],['c','south-america',[8,0,9,1]]];
  if(wall)entries.push(['wall','south-america',[4,-1,5,2]]);
  const features=[],territories=[],coasts={};
  for(const [id,region,bounds] of entries){
    const [x0,y0,x1,y1]=bounds,convert=p=>sourceCoordinate(p,region);
    const feature=square(id,x0,y0,x1,y1);
    feature.geometry.coordinates=feature.geometry.coordinates.map(ring=>ring.map(convert));
    const a=convert([x0,y0]),b=convert([x1,y1]);
    const rawBounds=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    feature.bbox=rawBounds;features.push(feature);
    territories.push({...territory(id,rawBounds),region});
    if(id!=='wall')coasts[id]={coastlines:[[[id==='a'?x1:x0,y0],[id==='a'?x1:x0,y1]].map(convert)]};
  }
  const assets={coastlineData:{territories:coasts},territoryGeoJson:{type:'FeatureCollection',features},territoryIndex:{territories}};
  const world={territories:{a:{ownerType:'player',ownerId:'p',buildings:[{type:'port',level:1,status:'active'}]},c:{ownerType:'neutral'}}};
  return {assets,world,planner:createMaritimeRoutePlanner(assets)};
}

test('cross-region routes use displayed distances and preserve source-coordinate endpoints in both directions',()=>{
  const {planner,world}=crossRegionFixture();
  const forward=planner.routesFrom(world,'p','a',[1,.5]);
  assert.equal(forward.routes.length,1);
  assert.equal(forward.routes[0].distanceKm,778);
  assert.deepEqual(forward.routes[0].targetPoint,sourceCoordinate([8,.5],'south-america'));
  const reverseWorld={territories:{a:{ownerType:'neutral'},c:{ownerType:'player',ownerId:'p',buildings:[{type:'port',level:1,status:'active'}]}}};
  const reverse=planner.routesFrom(reverseWorld,'p','c',forward.routes[0].targetPoint);
  assert.equal(reverse.routes[0].targetTerritoryId,'a');
  assert.equal(reverse.routes[0].distanceKm,778);
  assert.deepEqual(reverse.routes[0].targetPoint,[1,.5]);
  assert.deepEqual(reverse.sourcePoint,forward.routes[0].targetPoint);
  assert.throws(()=>planner.routesFrom(reverseWorld,'p','c',sourceCoordinate([9,.5],'south-america')),/海岸线/);
});

test('cross-region targets still require port range, war and expired protection',()=>{
  const {planner,world}=crossRegionFixture(),port=world.territories.a.buildings[0];
  port.status='constructing';assert.equal(planner.routesFrom(world,'p','a',[1,.5]).routes.length,0);
  port.status='active';world.territories.c.protectedUntil=200;
  assert.equal(planner.routesFrom(world,'p','a',[1,.5],100).routes.length,0);
  assert.equal(planner.routesFrom(world,'p','a',[1,.5],201).routes.length,1);
  world.territories.c={ownerType:'player',ownerId:'q'};
  assert.equal(planner.routesFrom(world,'p','a',[1,.5]).routes.length,0);
  setTestWar(world,'p','q');
  assert.equal(planner.routesFrom(world,'p','a',[1,.5]).routes.length,1);
});

test('relocated South American land blocks sea lanes using its displayed bounds and polygon',()=>{
  const {planner,world}=crossRegionFixture({wall:true});
  assert.equal(planner.routesFrom(world,'p','a',[1,.5]).routes.length,0);
  // The eastern shore cannot depart westward through its own relocated land.
  const reverse={territories:{a:{ownerType:'neutral'},c:{ownerType:'player',ownerId:'p',buildings:[{type:'port',status:'active',level:1}]}}};
  const {assets}=crossRegionFixture();
  assets.coastlineData.territories.c.coastlines=[[sourceCoordinate([9,0],'south-america'),sourceCoordinate([9,1],'south-america')]];
  assert.equal(createMaritimeRoutePlanner(assets).routesFrom(reverse,'p','c',sourceCoordinate([9,.5],'south-america')).routes.length,0);
});

test('real European ports reach Brazilian mainland within their level range',async()=>{
  const [coastlineData,territoryGeoJson,territoryIndex]=await Promise.all(['campaign-coastlines.json','campaign-territories.geojson','territory-index.json'].map(name=>readFile(new URL('../assets/data/'+name,import.meta.url),'utf8').then(JSON.parse)));
  const planner=createMaritimeRoutePlanner({coastlineData,territoryGeoJson,territoryIndex});
  const world={territories:Object.fromEntries(territoryIndex.territories.map(t=>[t.territoryId,{ownerType:'neutral'}]))};
  for(const [source,point,target,level,distance] of [
    ['adm1:esp-5808',[1.5402884661746725,38.96756407515075],'adm1:bra-627',5,2413],
    ['adm1:grc-2883',[20.580680571135744,38.11598563743637],'adm1:bra-624',2,1451],
  ]){
    const port={type:'port',status:'active',level};world.territories[source]={ownerType:'player',ownerId:'p',buildings:[port]};
    const route=planner.routesFrom(world,'p',source,point).routes.find(r=>r.targetTerritoryId===target);
    assert.ok(route,source+' -> '+target);assert.equal(route.distanceKm,distance);
    port.level--;assert.ok(!planner.routesFrom(world,'p',source,point).routes.some(r=>r.targetTerritoryId===target));
    world.territories[source]={ownerType:'neutral'};
  }
});


for(const useCoalition of [false,true])test(`${useCoalition?'coalition':'personal expedition'} starts a cross-region battle through authoritative route validation`,()=>{
  const f=coalitionFixture(),{assets,planner}=crossRegionFixture();
  for(const entry of f.s.territoryIndex.territories){
    entry.neighbors=[];entry.landNeighbors=[];
    const geometry=assets.territoryIndex.territories.find(t=>t.territoryId===entry.territoryId);
    if(geometry)Object.assign(entry,geometry);
  }
  f.s.maritimePlanner=planner;f.s.challenges.maritimePlanner=planner;
  f.s.world.territories.a.buildings=[{type:'port',status:'active',level:1}];
  setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');
  const route={sourceTerritoryId:'a',sourcePoint:[1,.5]};
  if(!useCoalition){
    const preview=f.s.challenges.maritimeRoutes(f.a,'a',route.sourcePoint);
    assert.ok(preview.routes.some(r=>r.targetTerritoryId==='c'));
    assert.throws(()=>f.s.challenges.begin(f.a,'c'),/航线/);
    const result=f.s.challenges.begin(f.a,'c',{maritimeRoute:route});
    assert.equal(result.challenge.maritimeRoute.distanceKm,778);
  }else{
    const action=(account,action,extra={})=>{const army=f.s.coalitions.find(account);return f.s.coalitions.mutate(account,{action,requestId:crypto.randomUUID(),armyId:army?.id,revision:army?.revision,...extra});};
    action(f.a,'create');
    for(const player of f.a.draft.roster.slice(0,6))action(f.a,'lend',{playerId:player.id});
    for(const player of f.b.draft.roster.slice(6,11))action(f.b,'lend',{playerId:player.id});
    action(f.a,'auto-lineup');
    const army=f.s.coalitions.find(f.a);
    assert.ok(f.s.coalitions.routes(army,'a',route.sourcePoint).routes.some(r=>r.targetTerritoryId==='c'));
    action(f.a,'propose-target',{territoryId:'c',beneficiaryId:'a',maritimeRoute:route});
    const q=f.s.coalitions.estimate(army,{...army.proposal,kind:'attack'});
    action(f.a,'attack',{quoteId:q.quoteId});f.tick(q.durationMs);
    f.s.advanceActiveChallenges(f.now,{maximumMatches:1,maximumChainsPerMatch:1});
    const challenge=Object.values(f.s.world.activeChallenges).find(ch=>ch.coalitionId===army.id);
    assert.ok(challenge,army.lastActionError);
    assert.equal(challenge.maritimeRoute.distanceKm,778);
  }
});
