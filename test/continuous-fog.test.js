import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FogSpatialIndex, smoothSightEnvelope, nearPolygon, inPolygon } from "../shared/map/fog-spatial.mjs";
import { FOG_RULES, withoutNavalPreview } from "../shared/config/fog.mjs";
import { FogService } from "../server/application/fog-service.mjs";
import { unproject } from "../client/map-three/projection.js";
import { ReliefField } from "../client/map-three/relief-field.js";
import { AtlasTerrain } from "../client/map-three/atlas-terrain.js";

const geoPoint=([x,z])=>{const p=unproject(x,z);return [p.lng,p.lat];};
const ring=(x,z,w=2,h=2)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]].map(geoPoint);
const feature=(id,...rings)=>({type:"Feature",properties:{territoryId:id,region:"europe"},geometry:
  rings.length===1?{type:"Polygon",coordinates:[rings[0]]}:{type:"MultiPolygon",coordinates:rings.map(r=>[r])}});
const geography=(...features)=>({type:"FeatureCollection",features});

test("continuous sight rounds corners and reveals only part of a large neighbouring province",()=>{
  const spatial=new FogSpatialIndex(geography(feature("home",ring(0,0)),feature("neighbour",ring(2,0,30,10))));
  const plan=spatial.plan(["home"]);
  assert.deepEqual(spatial.visibleIds(plan),["home","neighbour"]);
  assert.ok(spatial.pointVisible(plan,[4,4]));
  const corner=2+(FOG_RULES.radius+FOG_RULES.feather)*.8;
  assert.ok(!spatial.pointVisible(plan,[corner,corner]),"rounded corners do not fill the buffer's bounding box");
  assert.ok(!spatial.pointVisible(plan,[20,1]),"discovering a province does not expose its interior");
  assert.equal(spatial.plan(["home"]),plan,"panning reuses the spatial plan");
});

test("smooth sight connects holdings and reveals intervening islands without revealing land outside the contour",()=>{
  const spatial=new FogSpatialIndex(geography(feature("islands",ring(0,0),ring(40,0)),
    feature("south",ring(40,30)),feature("foreign",ring(18,8,5,5))));
  const plan=spatial.plan(["islands","south"]);
  assert.ok(spatial.pointVisible(plan,[20,1]),"corridor between parts of the same province");
  assert.ok(spatial.pointVisible(plan,[30,12]),"sea within the distribution of own holdings");
  assert.ok(spatial.pointVisible(plan,[20,10]),"islands inside the circular area are visible");
  assert.ok(spatial.visibleIds(plan).includes("foreign"));
  assert.ok(!spatial.pointVisible(plan,[-20,30]),"unrelated ocean stays unexplored");
});

function fogFixture() {
  let time=1000;
  const geo=geography(feature("home",ring(0,0)),feature("coast",ring(40,0,15,15)));
  const world={seasonId:"one",territories:{home:{ownerType:"player",ownerId:"p"},coast:{ownerType:"player",ownerId:"q"}}};
  const account={id:"p",homeTerritoryId:"home",expeditionPiece:{territoryId:"home",movement:null}};
  const service=new FogService({territoryGeoJson:geo,now:()=>time});
  const result={sourceTerritoryId:"home",sourcePoint:geoPoint([1,1]),routes:[{targetTerritoryId:"coast",targetPoint:geoPoint([40,1])}]};
  return {service,world,account,result,advance:n=>time+=n};
}

test("naval previews reveal landing circles temporarily; close, timeout and JSON reload do not preserve preview discovery",()=>{
  const {service,world,account,result,advance}=fogFixture();
  assert.deepEqual(service.update(account,world).view.visibleTerritoryIds,["home"]);
  const first=service.survey(account,world,result),view=service.update(account,world).view;
  assert.ok(view.visibleTerritoryIds.includes("coast"));
  assert.ok(!view.exploredTerritoryIds.includes("coast"));
  assert.deepEqual(view.metPlayerIds,["q"]);
  const plan=service.spatial.models(view).current;
  assert.ok(service.spatial.pointVisible(plan,[40,1]));
  assert.ok(!service.spatial.pointVisible(plan,[50,10]));
  service.clearPreview(account,first.id);
  assert.deepEqual(service.update(account,world).view.visibleTerritoryIds,["home"]);
  const second=service.survey(account,world,result);
  service.clearPreview(account,first.id);
  assert.equal(service.update(account,world).view.preview.id,second.id,"late cancellation cannot close a newer preview");
  advance(FOG_RULES.previewLifetime-1);service.renewPreview(account,second.id);
  advance(2);assert.ok(service.update(account,world).view.preview,"active heartbeat renews expiry");
  advance(FOG_RULES.previewLifetime);assert.equal(service.update(account,world).view.preview,null);
  assert.throws(()=>service.renewPreview(account,second.id),e=>e.statusCode===409);
  const restored=JSON.parse(JSON.stringify(account));
  assert.deepEqual(service.update(restored,world).view.exploredSourceTerritoryIds,["home"]);
  assert.ok(!JSON.stringify(restored).includes("sourcePoint"),"temporary routes are never serialized");
});

test("actual conquest creates persistent exploration, and legacy province previews migrate without retaining oversized sight",()=>{
  const {service,world,account}=fogFixture();
  account.fog={schemaVersion:1,seasonId:"one",exploredTerritoryIds:["home","coast"],metPlayerIds:["q"],firstMetAt:{q:5}};
  assert.deepEqual(service.update(account,world).view.exploredTerritoryIds,["home"]);
  world.territories.coast.ownerId="p";
  service.update(account,world);
  world.territories.coast.ownerId="q";
  const view=service.update(account,world).view;
  assert.deepEqual(view.exploredSourceTerritoryIds,["coast","home"]);
  assert.deepEqual(view.visibleTerritoryIds,["home"]);
  assert.deepEqual(view.metPlayerIds,["q"]);
});

test("inactive preview snapshots immediately remove target ownership and attackability",()=>{
  const state={fog:{enabled:true,preview:{id:"preview"},visibleTerritoryIds:["home","coast"],baseVisibleTerritoryIds:["home"]},
    world:{territories:{home:{ownerId:"p"},coast:{ownerId:"q"}}},attackableTerritoryIds:["coast"],coastalTerritoryIds:["home","coast"]};
  const closed=withoutNavalPreview(state);
  assert.equal(closed.fog.preview,null);assert.deepEqual(Object.keys(closed.world.territories),["home"]);
  assert.deepEqual(closed.attackableTerritoryIds,[]);assert.deepEqual(state.attackableTerritoryIds,["coast"]);
});

test("fogged terrain has no meshes until visible; expansion builds in batches and hiding/disposal cancels work",async()=>{
  const width=257,height=33,buffer=new ArrayBuffer(width*height*3);
  new Uint8Array(buffer,width*height*2).fill(255);
  const field=new ReliefField({schemaVersion:1,region:"europe",width,height,origin:[0,0],step:.25},buffer);
  let visible=false;
  const scene=new THREE.Scene(),terrain=new AtlasTerrain(scene,[field],{isAreaVisible:()=>visible});
  await terrain.build();
  try {
    assert.equal(terrain.chunks.length,0);assert.equal(terrain.stats().deferred,8);assert.equal(scene.children.length,0);
    visible=true;terrain.update({minX:-2,maxX:72,minZ:-2,maxZ:12},null,10);
    assert.equal(terrain.chunks.length,4);assert.equal(terrain.stats().deferred,4);
    assert.notEqual(terrain.fillTimer,null);
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(terrain.chunks.length,8);assert.equal(terrain.stats().deferred,0);
    visible=false;terrain.update({minX:-2,maxX:72,minZ:-2,maxZ:12},null,10);
    assert.equal(terrain.chunks.length,0);assert.equal(terrain.stats().deferred,8);
  }finally{terrain.dispose();}
  assert.equal(scene.children.length,0);assert.equal(terrain.fillTimer,null);
});


test("hidden foliage, lakes and estuaries allocate no meshes and appear when sight expands",async()=>{
  const width=65,height=65,origin=[0,-180],step=.25,count=width*height,buffer=new ArrayBuffer(count*3),v=new DataView(buffer);
  for(let i=0;i<count;i++)v.setUint16(i*2,450,true);
  new Uint8Array(buffer,count*2).fill(255);
  const field=new ReliefField({schemaVersion:1,region:"europe",width,height,origin,step},buffer);
  const data={schemaVersion:1,regions:{europe:{placement:{width,height,origin,step,rle:Buffer.from([count&255,count>>8,255]).toString("base64")},
    lakes:[{name:"Test",rings:[[[5,-175],[8,-175],[8,-172],[5,-172],[5,-175]]],area:9}],
    mouths:[{name:"River",inland:[12,-169],coast:[12,-168],width:.1}]}}};
  let visible=false;
  const terrain=new AtlasTerrain(new THREE.Scene(),[field],{natureData:data,isAreaVisible:()=>visible});
  await terrain.build();
  try {
    assert.equal(terrain.nature.group.children.length,0);assert.ok(terrain.nature.pending.length>0);
    visible=true;terrain.update({minX:-1,maxX:18,minZ:-182,maxZ:-162},null,20);
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.ok(terrain.nature.batches.length>0);assert.equal(terrain.nature.lakes.length,1);assert.equal(terrain.nature.mouths.length,1);
    visible=false;terrain.update({minX:-1,maxX:18,minZ:-182,maxZ:-162},null,20);
    assert.equal(terrain.nature.group.children.length,0);
    assert.equal(terrain.nature.lakes.length,0);assert.equal(terrain.nature.mouths.length,0);
  }finally{terrain.dispose();}
  assert.equal(terrain.nature.fillTimer,null);
});


for(const early of [false,true])test(early?"cancelling an in-flight survey closes its late server preview without showing targets":"closing an active survey retracts locally before the server responds and stops its heartbeat",async()=>{
  const {createMaritimeController}=await import("../client/maritime/maritime-controller.js");
  const layer=()=>({addTo(){return this;},remove(){},on(){return this;},bindTooltip(){return this;},setLatLng(){},setStyle(){}});
  const point=(x,y)=>({x,y,distanceTo(p){return Math.hypot(x-p.x,y-p.y);}});
  const calls=[],events=[];let resolveSurvey,heartbeat=null;
  const response={sourcePoint:[.5,0],sourceTerritoryId:"a",previewId:"temporary",routes:[{targetTerritoryId:"b",sourcePoint:[.5,0],targetPoint:[8,0],distanceKm:800}],state:{}};
  const request=(url,options)=>{calls.push({url,...options});return url.endsWith("routes")?new Promise(resolve=>resolveSurvey=resolve):Promise.resolve({});};
  const controller=createMaritimeController({Leaflet:{layerGroup:layer,polyline:layer,circleMarker:layer,point,latLng:(lat,lng)=>({lat,lng})},
    map:{latLngToLayerPoint:({lat,lng})=>point(lng,lat),layerPointToLatLng:({x,y})=>({lat:y,lng:x})},
    mapElement:{classList:{add(){},remove(){}}},maritimeRenderer:{},territoryMetadataById:new Map(),
    getCoastlineData:()=>({territories:{a:{coastlines:[[[0,0],[1,0]]]}}}),
    getTerritoryWorld:()=>({territories:{a:{ownerType:"player",ownerId:"p"}}}),
    getCampaignState:()=>({playerId:"p",coastalTerritoryIds:["a"],expeditionPiece:{territoryId:"a",moving:false}}),
    getSelectedTerritoryId:()=>"a",getCampaignRequest:()=>request,ownActiveChallenge:()=>null,
    sourcePointToDisplay:(_id,[lng,lat])=>[lat,lng],displayPointToSource:(_id,{lat,lng})=>[lng,lat],
    selectTerritory(){},refreshTerritoryDisplay(){},renderTerritoryInspector(){},showToast:message=>events.push(message),
    onSurveyState(){events.push("revealed");},onSurveyClose(){events.push("closed");},
    timer:{setInterval(fn){heartbeat=fn;return 1;},clearInterval(){heartbeat=null;}}});
  controller.beginMaritimeCampaign();const pending=controller.confirmMaritimePoint({lat:0,lng:.5});
  if(early)controller.cancelMaritimeCampaign();
  resolveSurvey(response);await pending;
  if(!early){assert.ok(controller.getTargetIds().has("b"));assert.ok(heartbeat);controller.cancelMaritimeCampaign();assert.ok(events.includes("closed"));}
  else assert.ok(!events.includes("revealed"));
  assert.equal(controller.getMode(),null);assert.equal(heartbeat,null);assert.equal(controller.getTargetIds().size,0);
  assert.deepEqual(calls.at(-1).body,{action:"close",previewId:"temporary"});
});

test("naval preview endpoint authenticates and forwards matching preview IDs for cancellation and renewal",async()=>{
  const {createCampaignApiHandler}=await import("../server/http/campaign-api-handler.mjs");
  const account={id:"p"},calls=[];
  const handler=createCampaignApiHandler({campaign:{authenticate(token){assert.equal(token,"session");return account;},
    maritimePreview(a,id,action){assert.equal(a,account);calls.push([id,action]);return {previewId:id};}}});
  for(const action of ["close","keepalive"]){
    const request={method:"POST",headers:{authorization:"Bearer session"},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({previewId:"one",action}));}};
    const response={writeHead(code){assert.equal(code,200);},end(body){assert.equal(JSON.parse(body).previewId,"one");}};
    await handler(request,response,"/api/campaign/maritime/preview","http://localhost/api/campaign/maritime/preview");
  }
  assert.deepEqual(calls,[["one","close"],["one","keepalive"]]);
});


test("smooth sight preserves the holdings outline, bows long edges and is independent of point density/order",()=>{
  const points=[[0,0],[60,0],[60,3],[12,20],[0,3]],area=smoothSightEnvelope(points);
  for(const p of points)assert.ok(nearPolygon(p,area.rings,.026),"smoothing must cover the original hull");
  const denser=[...points,...Array.from({length:60},(_,x)=>[x,0])];
  assert.deepEqual(smoothSightEnvelope(denser.toReversed()),area);
  assert.ok(inPolygon([30,-3],area.rings),"long edges bow out into a real curve");
  assert.ok(!inPolygon([3,-3],area.rings),"edge curvature varies along its length");
  assert.ok(area.bounds.minZ>=-FOG_RULES.radius*2&&area.bounds.maxZ<=20+FOG_RULES.radius*2);
  const spatial=new FogSpatialIndex(geography(feature("a",ring(0,0)),feature("b",ring(60,0))));
  const plan=spatial.plan(["a","b"]);
  assert.ok(spatial.pointVisible(plan,[30,0]),"the sea between holdings stays open");
  assert.ok(!spatial.pointVisible(plan,[30,20]),"an elongated chain must not become a global circle or ellipse");
  assert.equal(smoothSightEnvelope([]),null);
  assert.deepEqual(smoothSightEnvelope([[2,3],[2,3]]).rings,[[[2,3],[2,3]]]);
});

test("partly revealed islands in the soft edge get server intel and share the mouse visibility margin",()=>{
  const edge=-(FOG_RULES.radius+FOG_RULES.feather*.75),hidden=-(FOG_RULES.radius+FOG_RULES.feather+3);
  const spatial=new FogSpatialIndex(geography(feature("home",ring(0,0)),feature("edge",ring(.8,edge,.4,.3)),feature("hidden",ring(.8,hidden,.4,.3))));
  const plan=spatial.plan(["home"]),point=[1,edge+.1];
  assert.ok(!spatial.landVisible(plan,point),"fixture lies outside the solid reveal mask");
  assert.ok(spatial.pointVisible(plan,point),"visible feather supports mouse interaction");
  assert.ok(spatial.visibleIds(plan).includes("edge"));
  assert.ok(!spatial.visibleIds(plan).includes("hidden"));
  assert.ok(!spatial.pointVisible(plan,[1,hidden]));
});

test("real Faroe islands inside the Iceland/Ireland/Scotland contour are discovered, load terrain and record encounters",async()=>{
  const {readFile}=await import("node:fs/promises");
  const geo=JSON.parse(await readFile(new URL("../assets/data/campaign-territories.geojson",import.meta.url),"utf8"));
  const world={seasonId:"round",territories:Object.fromEntries(geo.features.map(f=>[f.properties.territoryId,{ownerType:"neutral",ownerId:null}]))};
  const index=JSON.parse(await readFile(new URL("../assets/data/territory-index.json",import.meta.url),"utf8"));
  const held=["adm1:isl-705","adm1:irl-714","adm1:gbr-2745"].map(id=>index.territoryIdAliases[id]??id),island=index.territoryIdAliases["adm1:fro-1443"]??"adm1:fro-1443";
  for(const id of held)Object.assign(world.territories[id],{ownerType:"player",ownerId:"p"});
  Object.assign(world.territories[island],{ownerType:"player",ownerId:"q"});
  const account={id:"p",homeTerritoryId:held[0]},service=new FogService({territoryGeoJson:geo});
  const view=service.update(account,world).view,plan=service.spatial.models(view).current;
  assert.ok(view.visibleTerritoryIds.includes(island));assert.ok(view.exploredTerritoryIds.includes(island));
  assert.deepEqual(view.metPlayerIds,["q"]);
  const entry=service.spatial.entries.get(island);
  assert.ok(service.spatial.touchesLand(plan,entry.bounds),"visible islands must enter the terrain load queue");
  for(const polygon of entry.polygons)assert.ok(service.spatial.pointVisible(plan,polygon.rings[0][0]));
  const remote=geo.features.find(f=>f.properties.countryCode==="TUR").properties.territoryId;
  assert.ok(!view.visibleTerritoryIds.includes(remote),"the smooth range does not reveal the whole world");
});


test("expanded sight reveals the new distance band consistently on server and map without revealing remote land",()=>{
  const geo=geography(feature("home",ring(0,0)),feature("newly-visible",ring(.8,-8,.4,.3)),feature("remote",ring(.8,-15,.4,.3)));
  const service=new FogService({territoryGeoJson:geo}),account={id:"p",homeTerritoryId:"home"};
  const world={seasonId:"expanded",territories:{home:{ownerType:"player",ownerId:"p"},"newly-visible":{ownerType:"player",ownerId:"q"},remote:{ownerType:"player",ownerId:"r"}}};
  const view=service.update(account,world).view;
  const client=new FogSpatialIndex(geo),plan=client.models(view).current;
  assert.ok(!client.pointVisible({...plan,radius:4.5},[1,-7.9]),"the new band was outside the former sight radius");
  assert.ok(client.pointVisible(plan,[1,-7.9]));
  assert.deepEqual(view.visibleTerritoryIds,["home","newly-visible"]);
  assert.deepEqual(client.visibleIds(plan),view.visibleTerritoryIds);
  assert.deepEqual(view.exploredTerritoryIds,["home","newly-visible"]);
  assert.deepEqual(view.metPlayerIds,["q"]);
  assert.ok(!client.pointVisible(plan,[1,-14.9]));
});

test('allies share actual sight, exploration and temporary naval views without filling gaps or retaining revoked knowledge',()=>{
 const geo=geography(feature('home',ring(0,0)),feature('ally',ring(50,0)),feature('near-ally',ring(55,0)),feature('gap',ring(25,0)),feature('old',ring(75,0)),feature('naval',ring(100,0)));
 const a={id:'a',homeTerritoryId:'home',expeditionPiece:{territoryId:'home'}},b={id:'b',homeTerritoryId:'ally',expeditionPiece:{territoryId:'ally'}};
 const world={seasonId:'one',territories:Object.fromEntries(['home','ally','near-ally','gap','old','naval'].map(id=>[id,{ownerType:'neutral'}])),diplomacy:{relationships:{ab:{players:['a','b'],state:'alliance'}}}};world.territories.home={ownerType:'player',ownerId:'a'};world.territories.ally={ownerType:'player',ownerId:'b'};
 const fog=new FogService({accounts:new Map([['a',a],['b',b]]),territoryGeoJson:geo,now:()=>1000});fog.update(b,world);b.fog.exploredSourceTerritoryIds.push('old');b.fog.exploredTerritoryIds.push('old');
 const preview=fog.survey(b,world,{sourceTerritoryId:'ally',sourcePoint:geoPoint([51,1]),routes:[{targetTerritoryId:'naval',targetPoint:geoPoint([100,1])}]});
 const view=fog.update(a,world).view,models=fog.spatial.models(view);assert.ok(view.visibleTerritoryIds.includes('near-ally'));assert.ok(view.visibleTerritoryIds.includes('naval'));assert.ok(view.exploredTerritoryIds.includes('old'));assert.ok(!a.fog.exploredTerritoryIds.includes('old'));assert.ok(!view.visibleTerritoryIds.includes('gap'));assert.equal(fog.spatial.pointVisible(models.current,[25,1]),false);assert.equal(fog.spatial.pointVisible(models.current,[55,1]),true);assert.equal(fog.spatial.pointVisible(models.current,[100,1]),true);
 fog.clearPreview(b,preview.id);assert.ok(!fog.update(a,world).view.visibleTerritoryIds.includes('naval'));world.diplomacy.relationships.ab.state='friendship';const revoked=fog.update(a,world).view;assert.ok(!revoked.visibleTerritoryIds.includes('near-ally'));assert.ok(!revoked.exploredTerritoryIds.includes('old'));
});


test('four allied sight models survive component cache churn and unchanged polling without rebuilding',()=>{
  const ids=Array.from({length:40},(_,i)=>'s'+i);
  const spatial=new FogSpatialIndex(geography(...ids.map((id,i)=>feature(id,ring(i*20,0)))));
  const views=Array.from({length:4},(_,i)=>({sourceTerritoryIds:[ids[i*10]],exploredSourceTerritoryIds:ids.slice(i*10,i*10+2),scoutSourceTerritoryIds:ids.slice(i*10+2,i*10+9),exploredScoutTerritoryIds:ids.slice(i*10+2,i*10+10),sharedTerritoryIds:ids.filter((_,j)=>j%10===0&&j!==i*10)}));
  const fog={...views[0],sharedVision:views.slice(1)},first=spatial.models(fog);
  const original=spatial.plan.bind(spatial);let calls=0;spatial.plan=(...args)=>{calls++;return original(...args);};
  for(let i=0;i<100;i++)assert.equal(spatial.models(JSON.parse(JSON.stringify(fog))),first);
  assert.equal(calls,0,'no component plans or hulls rebuilt for repeated terrain queries');
  assert.equal(first.current.sharedPolygons.length,new Set(first.current.sharedPolygons).size);
  for(let i=0;i<4;i++)assert.ok(spatial.pointVisible(first.current,[i*200+1,1]));
  assert.ok(!spatial.pointVisible(first.current,[900,1]));
  fog.sharedVision=[];fog.sharedTerritoryIds=[];
  const revoked=spatial.models(fog);assert.notEqual(revoked,first);
  assert.equal(spatial.pointVisible(revoked.current,[601,1]),false,'departed ally disappears immediately');
  fog.scoutSourceTerritoryIds=['s39'];
  const moved=spatial.models(fog);assert.notEqual(moved,revoked);assert.ok(spatial.pointVisible(moved.current,[781,1]));
  fog.sourceTerritoryIds=['s1'];assert.notEqual(spatial.models(fog),moved);
  fog.exploredSourceTerritoryIds=['s0','s1','s2'];spatial.models(fog);
  assert.ok(spatial.modelCache.size<=4,'merged models retain a bounded number of footprints');
});

test('ally survey keepalive reuses geometry while route changes and cancellation invalidate it',()=>{
  const spatial=new FogSpatialIndex(geography(feature('home',ring(0,0)),feature('ally',ring(40,0)),feature('coast',ring(90,0))));
  const preview={id:'survey',sourceTerritoryId:'ally',sourcePoint:geoPoint([41,1]),routes:[{targetTerritoryId:'coast',targetPoint:geoPoint([91,1])}],expiresAt:1000};
  const fog={sourceTerritoryIds:['home'],sharedVision:[{sourceTerritoryIds:['ally'],preview}]};
  const first=spatial.models(fog);preview.expiresAt=2000;
  assert.equal(spatial.models(fog),first);
  preview.routes[0].targetPoint=geoPoint([99,1]);
  const moved=spatial.models(fog);assert.notEqual(moved,first);assert.ok(spatial.pointVisible(moved.current,[99,1]));
  fog.sharedVision[0].preview=null;
  assert.equal(spatial.pointVisible(spatial.models(fog).current,[99,1]),false);
});
