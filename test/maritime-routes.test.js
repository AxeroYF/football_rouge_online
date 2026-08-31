import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  const world={territories:{source:{ownerType:"player",ownerId:"p"},near:{ownerType:"neutral"},far:{ownerType:"neutral"},blocked:{ownerType:"neutral"},wall:{ownerType:"neutral"},"land-coast":{ownerType:"neutral"}}};
  const result=planner.routesFrom(world,"p","source",[1,.5]);
  assert.ok(result.routes.some((route)=>route.targetTerritoryId==="near"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="far"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="blocked"));
  assert.ok(!result.routes.some((route)=>route.targetTerritoryId==="land-coast"));
});

test("maritime routes reject inland sources and protected or owned targets",()=>{
  const planner=createMaritimeRoutePlanner({coastlineData,territoryGeoJson:geoJson,territoryIndex:index});
  const world={territories:{source:{ownerType:"player",ownerId:"p"},near:{ownerType:"neutral",protectedUntil:200},far:{ownerType:"player",ownerId:"p"},blocked:{ownerType:"neutral"},wall:{ownerType:"player",ownerId:"p"},"land-coast":{ownerType:"neutral"}}};
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
  const world={territories:{source:{ownerType:"player",ownerId:"p"},outward:{ownerType:"neutral"},reverse:{ownerType:"neutral"}}};
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
  world.territories["adm1:isl-705"]={ownerType:"player",ownerId:"p"};
  const planner=createMaritimeRoutePlanner({coastlineData:realCoastlines,territoryGeoJson:realGeoJson,territoryIndex:realIndex});
  const result=planner.routesFrom(world,"p","adm1:isl-705",[-18.5,63.42]);
  assert.ok(result.routes.some((route)=>route.targetTerritoryId==="adm1:fro-1443"));
});