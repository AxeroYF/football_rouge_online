import assert from "node:assert/strict";
import test from "node:test";
import { FOG_RULES, campaignFog, fogTerritoryStatus, fogMinimumZoom } from "../shared/config/fog.mjs";
import { applyFogWorldSnapshot } from "../client/map/fog-state.js";
import { pointInFogGeometry, exploredBounds } from "../client/map/fog-geometry.js";
import { transformSouthAmericaFeature } from "../client/map/campaign-map-geometry.js";
import { createMinimapTerritoryStyle } from "../client/map/campaign-minimap-controller.js";
import { createTerritoryPresentation } from "../client/map/territory-presentation.js";
import { OWNER_TYPES } from "../territory-model.js";

const square=(x,y,size=1)=>[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const feature=(id,x=0,y=0)=>({type:"Feature",properties:{territoryId:id},geometry:{type:"Polygon",coordinates:[square(x,y)]}});

test("smaller exploration raises the minimum zoom while maximum remains 30x",()=>{
  assert.ok(fogMinimumZoom(6)>fogMinimumZoom(4));
  assert.equal(fogMinimumZoom(-2),3);
  assert.equal(fogMinimumZoom(20),FOG_RULES.maxZoom-.75);
  assert.ok(Math.abs(2**(FOG_RULES.maxZoom-3)-30)<1e-10);
  assert.equal(fogMinimumZoom(NaN),3);
});

test("missing fog payload after establishing home fails closed to owned cells",()=>{
  const fog=campaignFog({playerId:"p",homeTerritoryId:"a",world:{territories:{a:{ownerType:"player",ownerId:"p"},b:{ownerType:"player",ownerId:"q"}}}});
  assert.equal(fog.enabled,true);assert.equal(fog.pending,true);
  assert.equal(fogTerritoryStatus(fog,"a"),"visible"); assert.equal(fogTerritoryStatus(fog,"b"),"unexplored");
  assert.equal(campaignFog({}).enabled,false);
});

test("scoped snapshot replaces stale preview ownership and old building markers",()=>{
  const world={territories:{a:{ownerType:"player",ownerId:"p"},b:{ownerType:"player",ownerId:"secret",buildings:[{id:"private-building"}]}}};
  const idx={territories:[{territoryId:"a",initialOwner:{type:"neutral"}},{territoryId:"b",initialOwner:{type:"club",id:"static"}}]};
  const snapshot={territories:{a:{ownerType:"player",ownerId:"p"}}};
  applyFogWorldSnapshot(world,snapshot,idx,{enabled:true,visibleTerritoryIds:["a"]});
  assert.equal(world.territories.b.ownerType,"unknown");assert.equal(world.territories.b.ownerId,null);assert.deepEqual(world.territories.b.buildings,[]);
  applyFogWorldSnapshot(world,{territories:{}},idx,{enabled:false});
  assert.equal(world.territories.a.ownerType,"neutral");assert.equal(world.territories.b.ownerType,"club");
});

test("visible metadata, fogged terrain and unknown cells have separate presentation",()=>{
  const fog={enabled:true,visibleTerritoryIds:["a"],exploredTerritoryIds:["a","b"],metPlayerIds:[]};
  const style=createMinimapTerritoryStyle({ownerTypes:OWNER_TYPES,getWorld:()=>({territories:{}}),getPlayers:()=>({}),getFog:()=>fog});
  assert.ok(style(feature("a")).fillOpacity>0);
  assert.equal(style(feature("b")).fillColor,"#56615f");
  assert.equal(style(feature("c")).fillOpacity,0); assert.equal(style(feature("c")).opacity,0);
  const presentation=createTerritoryPresentation({ownerTypes:OWNER_TYPES,escapeHtml:String,getContext:()=>({campaignState:{fog},mapRenderer:"three"})});
  assert.equal(presentation.territoryHoverStyle(feature("c")).interactive,false);
  assert.equal(presentation.territoryHoverStyle(feature("c")).fillOpacity,0);
  assert.equal(presentation.territoryTooltipMarkup({territoryId:"c",name:"Secret"},{}),"");
});

test("fog point lookup respects polygon holes and disconnected islands",()=>{
  const shape={type:"MultiPolygon",coordinates:[[square(0,0,10),square(3,3,2)],[square(20,20)]]};
  assert.equal(pointInFogGeometry([1,1],shape),true);
  assert.equal(pointInFogGeometry([4,4],shape),false);
  assert.equal(pointInFogGeometry([15,15],shape),false);
  assert.equal(pointInFogGeometry([20.5,20.5],shape),true);
});

test("camera bounds use displayed South America coordinates and exclude unexplored regions",()=>{
  const south=transformSouthAmericaFeature(feature("south",-58,-22));
  assert.deepEqual(exploredBounds([south,feature("hidden",100,80)],["south"]),[[6.5,19.5],[7.5,20.5]]);
  assert.equal(exploredBounds([south],[]),null);
  const tiny=feature("tiny");tiny.geometry.coordinates=[square(0,0,.01)];
  const box=exploredBounds([tiny],["tiny"]);
  assert.ok(box[1][0]-box[0][0]>=.4);
});


for (const invalidate of [false, true]) test(
  invalidate ? "invalidated naval survey never redraws stale target markers" : "naval survey applies newly visible state before enabling target selection",
  async () => {
    const { createMaritimeController } = await import("../client/maritime/maritime-controller.js");
    const events=[];
    const layer=()=>({addTo(){return this;},remove(){},on(){events.push("target");return this;},bindTooltip(){return this;},setStyle(){},setLatLng(){}});
    const point=(x,y)=>({x,y,distanceTo(p){return Math.hypot(x-p.x,y-p.y);}});
    const state={playerId:"p",coastalTerritoryIds:["a"],expeditionPiece:{territoryId:"a",moving:false}};
    const surveyed={...state,fog:{enabled:true,visibleTerritoryIds:["a","overseas"],exploredTerritoryIds:["a","overseas"],metPlayerIds:[]}};
    const route={sourcePoint:[.5,0],targetPoint:[4,0],targetTerritoryId:"overseas",distanceKm:389};
    let selected=null,controller;
    controller=createMaritimeController({
      Leaflet:{layerGroup:layer,polyline:layer,circleMarker:layer,point,latLng:(lat,lng)=>({lat,lng})},
      map:{latLngToLayerPoint:({lat,lng})=>point(lng,lat),layerPointToLatLng:({x,y})=>({lat:y,lng:x})},
      mapElement:{classList:{add(){},remove(){}}},maritimeRenderer:{},territoryMetadataById:new Map(),
      getCoastlineData:()=>({territories:{a:{coastlines:[[[0,0],[1,0]]]}}}),
      getTerritoryWorld:()=>({territories:{a:{ownerType:"player",ownerId:"p"}}}),
      getCampaignState:()=>state,getSelectedTerritoryId:()=>"a",ownActiveChallenge:()=>null,
      getCampaignRequest:()=>async()=>({sourceTerritoryId:"a",sourcePoint:[.5,0],routes:[route],state:surveyed}),
      sourcePointToDisplay:(_id,[lng,lat])=>[lat,lng],displayPointToSource:(_id,{lat,lng})=>[lng,lat],
      selectTerritory:id=>{selected=id;},refreshTerritoryDisplay(){},renderTerritoryInspector(){},showToast(){},
      onSurveyState(next){
        assert.equal(next,surveyed);assert.equal(controller.getTargetIds().size,0);
        events.push("state");if(invalidate)controller.clearMaritimeMode();
      },
    });
    controller.beginMaritimeCampaign();
    await controller.confirmMaritimePoint({lat:0,lng:.5});
    assert.equal(events[0],"state");assert.equal(selected,null);
    assert.equal(controller.getTargetIds().has("overseas"),!invalidate);
    assert.equal(events.includes("target"),!invalidate);
    assert.equal(controller.getRouteTo("overseas"),invalidate?null:route);
  }
);
