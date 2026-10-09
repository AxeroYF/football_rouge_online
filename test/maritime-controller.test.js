import assert from "node:assert/strict";
import test from "node:test";
import { createMaritimeController } from "../client/maritime/maritime-controller.js";

function removableLayer() {
  return {
    addTo() { return this; },
    remove() { this.removed = true; },
  };
}

function surveyFixture() {
  const events={},requests=[],states=[],toasts=[];let projections=0,inverses=0,refreshes=0,closes=0;
  const coastlines=[[[0,0],[10,0],[20,0],[30,0]]];
  const layer=()=>({...removableLayer(),on(){return this;},bindTooltip(){return this;},setLatLng(){},setStyle(){}});
  const state={playerId:'p',coastalTerritoryIds:['coast'],expeditionPiece:{territoryId:'coast'},world:{territories:{coast:{ownerType:'player',ownerId:'p'}}}};
  const controller=createMaritimeController({Leaflet:{layerGroup:layer,polyline:layer,circleMarker:layer,latLng:(lat,lng)=>({lat,lng}),point:(x,y)=>({x,y})},
    map:{on:(name,fn)=>events[name]=fn,latLngToLayerPoint:({lat,lng})=>{projections++;return {x:lng,y:lat};},layerPointToLatLng:({x,y})=>{inverses++;return {lat:y,lng:x};}},mapElement:{classList:{add(){},remove(){}}},maritimeRenderer:{},territoryMetadataById:new Map(),
    getCoastlineData:()=>({territories:{coast:{coastlines}}}),getCampaignState:()=>state,getTerritoryWorld:()=>state.world,getSelectedTerritoryId:()=> 'coast',ownActiveChallenge:()=>null,
    getCampaignRequest:()=> (url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),sourcePointToDisplay:(_id,p)=>p,displayPointToSource:(_id,p)=>[p.lat,p.lng],selectTerritory(){},renderTerritoryInspector(){},refreshTerritoryDisplay:()=>refreshes++,showToast:s=>toasts.push(s),onSurveyState:(s,o)=>states.push({s,o}),onSurveyClose:()=>closes++,timer:{setInterval:()=>1,clearInterval(){}}});
  const result={sourceTerritoryId:'coast',sourcePoint:[5,0],routes:[{sourcePoint:[5,0],targetPoint:[6,0],targetTerritoryId:'target',distanceKm:100}],maxRangeKm:200,previewId:'preview',statePatch:{playerId:'p',fog:{preview:{id:'preview'}}}};
  return {controller,requests,events,states,toasts,state,result,counts:()=>({projections,inverses,refreshes,closes})};
}

test('coastal snapping projects each vertex once until the viewport changes',()=>{
 const f=surveyFixture();f.controller.beginMaritimeCampaign();
 for(let i=0;i<20;i++)f.controller.updateMaritimeSnap({lat:5,lng:2});
 assert.equal(f.counts().projections,24);assert.equal(f.counts().inverses,20);
 f.events['zoomend viewreset moveend resize']();f.controller.updateMaritimeSnap({lat:5,lng:2});
 assert.equal(f.counts().projections,29);
 assert.deepEqual(f.controller.getMode().pendingPoint.sourcePoint,[5,0]);
});

test('route survey locks double clicks, updates map once without fitting and closes locally once',async()=>{
 const f=surveyFixture();f.controller.beginMaritimeCampaign();const pending=f.controller.confirmMaritimePoint({lat:5,lng:2});
 await f.controller.confirmMaritimePoint({lat:6,lng:2});assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.body.compact,true);
 f.requests[0].resolve(f.result);await pending;
 assert.equal(f.states.length,1);assert.deepEqual(f.states[0].o,{fit:false,compact:true});assert.equal(f.counts().refreshes,0);
 assert.ok(f.controller.getTargetIds().has('target'));f.controller.cancelMaritimeCampaign();
 assert.equal(f.counts().closes,1);assert.equal(f.counts().refreshes,0);assert.equal(f.requests[1].options.body.compact,true);
 f.requests[1].resolve({closed:true});await Promise.resolve();assert.equal(f.states.length,1);
});

test('cancelled survey responses cannot reopen routes and errors can be retried',async()=>{
 const f=surveyFixture();f.controller.beginMaritimeCampaign();let pending=f.controller.confirmMaritimePoint({lat:5,lng:2});
 f.requests[0].reject(Error('network'));await pending;assert.equal(f.controller.getMode().pending,false);
 pending=f.controller.confirmMaritimePoint({lat:5,lng:2});f.controller.cancelMaritimeCampaign();
 f.requests[1].resolve(f.result);await pending;
 assert.equal(f.controller.getMode(),null);assert.equal(f.states.length,0);assert.equal(f.requests[2].options.body.action,'close');f.requests[2].resolve({closed:true});
});

test('an authoritative closed preview clears overlays without a second request or state update',async()=>{
 const f=surveyFixture();f.controller.beginMaritimeCampaign();const pending=f.controller.confirmMaritimePoint({lat:5,lng:2});f.requests[0].resolve(f.result);await pending;
 f.controller.clearMaritimeMode({keepSelection:true,previewAlreadyClosed:true});
 assert.equal(f.requests.length,1);assert.equal(f.counts().closes,0);assert.equal(f.controller.getTargetIds().size,0);
});

test("maritime controller owns surveying state and clears all overlays on cancel", () => {
  const classes = new Set();
  const toasts = [];
  const rendered = [];
  let refreshCount = 0;
  const Leaflet = {
    layerGroup: removableLayer,
    polyline: removableLayer,
    circleMarker: () => ({
      ...removableLayer(),
      on() { return this; },
      bindTooltip() { return this; },
      setLatLng() {},
      setStyle() {},
    }),
  };
  const controller = createMaritimeController({
    Leaflet,
    map: {},
    mapElement: {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
    },
    maritimeRenderer: {},
    territoryMetadataById: new Map(),
    getCoastlineData: () => ({
      territories: {
        coast: { coastlines: [[[0, 0], [1, 1]]] },
      },
    }),
    getTerritoryWorld: () => ({
      territories: {
        coast: { ownerType: "player", ownerId: "player-1" },
      },
    }),
    getCampaignState: () => ({
      playerId: "player-1",
      coastalTerritoryIds: ["coast"],
      expeditionPiece: { territoryId: "coast", moving: false },
    }),
    getCampaignRequest: () => null,
    getSelectedTerritoryId: () => "coast",
    ownActiveChallenge: () => null,
    sourcePointToDisplay: (_territoryId, point) => point,
    displayPointToSource: () => [0, 0],
    selectTerritory() {},
    refreshTerritoryDisplay: () => { refreshCount += 1; },
    renderTerritoryInspector: (territoryId) => rendered.push(territoryId),
    showToast: (message) => toasts.push(message),
  });

  assert.equal(controller.getMode(), null);
  controller.beginMaritimeCampaign();
  assert.equal(controller.getMode().sourceTerritoryId, "coast");
  assert.equal(controller.isSelectingPoint(), true);
  assert.equal(classes.has("is-selecting-coast"), true);
  assert.equal(controller.cancelMaritimeCampaign(), true);
  assert.equal(controller.getMode(), null);
  assert.equal(controller.getTargetIds().size, 0);
  assert.equal(classes.has("is-selecting-coast"), false);
  assert.equal(refreshCount, 1);
  assert.deepEqual(rendered, ["coast", "coast"]);
  assert.match(toasts.at(-1), /已取消/);
  assert.equal(controller.cancelMaritimeCampaign(), false);
});
