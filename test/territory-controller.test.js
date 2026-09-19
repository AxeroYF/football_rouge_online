import assert from "node:assert/strict";
import test from "node:test";
import { createTerritoryController } from "../client/territory/territory-controller.js";
import { createTerritoryInteraction } from "../client/map/territory-interaction.js";
import { OWNER_TYPES } from "../territory-model.js";

function createController({ metadata, territories, ...overrides }) {
  return createTerritoryController({
    documentRef: {},
    mapElement: {},
    ownerTypes: OWNER_TYPES,
    territoryMetadataById: new Map(metadata.map((entry) => [entry.territoryId, entry])),
    territoryLayersById: new Map(),
    attackableTerritoryIds: new Set(),
    getTerritoryWorld: () => ({ territories }),
    getCampaignState: () => ({}),
    getCityData: () => [],
    getClubData: () => [],
    getCampaignRequest: () => null,
    getMaritimeMode: () => null,
    getMaritimeTargetIds: () => new Set(),
    getTerritoryChallengePending: () => false,
    campaignStore: {},
    applyCampaignWorldSnapshot() {},
    territoryStyle() {},
    territoryTooltipMarkup() {},
    territoryOwnerLabel() {},
    challengeSummary() {},
    ownActiveChallenge: () => null,
    showToast() {},
    ...overrides,
  });
}

test("territory controller owns home selection permission rules", () => {
  const baseMetadata = {
    playable: true,
    spawnAllowed: true,
    landNeighbors: [],
    initialOwner: { type: "neutral" },
  };
  const controller = createController({
    metadata: [
      { ...baseMetadata, territoryId: "open" },
      { ...baseMetadata, territoryId: "occupied" },
      { ...baseMetadata, territoryId: "club", playable: false },
      { ...baseMetadata, territoryId: "adjacent", landNeighbors: ["club"] },
    ],
    territories: {
      open: { ownerType: OWNER_TYPES.NEUTRAL },
      occupied: { ownerType: OWNER_TYPES.PLAYER, ownerId: "other-player" },
      club: { ownerType: OWNER_TYPES.CLUB },
      adjacent: { ownerType: OWNER_TYPES.NEUTRAL },
    },
  });

  assert.deepEqual(controller.homeSelectionPermission("open"), {
    allowed: true,
    reason: "可以在这里建立俱乐部总部",
  });
  assert.equal(controller.homeSelectionPermission("occupied").allowed, false);
  assert.equal(controller.homeSelectionPermission("club").reason, "豪门中立区域不能作为主场");
  assert.match(controller.homeSelectionPermission("adjacent").reason, /直接接壤/);
  assert.equal(controller.homeSelectionPermission("missing").reason, "无法读取该地块");
});


test("own land hides scouting rows and resets its theme when selecting another owner or clearing",()=>{
  const nodes=new Map(),rows=Array.from({length:4},()=>({hidden:false}));
  function node(selector) {
    if(!nodes.has(selector)) {
      const classes=new Set();
      nodes.set(selector,{hidden:false,textContent:"",dataset:{},removeAttribute(){},
        classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),
          toggle:(value,enabled)=>enabled?classes.add(value):classes.delete(value),contains:value=>classes.has(value)}});
    }
    return nodes.get(selector);
  }
  const territories={home:{ownerType:OWNER_TYPES.PLAYER,ownerId:"me"},owned:{ownerType:OWNER_TYPES.PLAYER,ownerId:"me"},
    other:{ownerType:OWNER_TYPES.PLAYER,ownerId:"someone"},neutral:{ownerType:OWNER_TYPES.NEUTRAL},club:{ownerType:OWNER_TYPES.CLUB}};
  let buildingTerritory=null, facilityOpen=true;
  const inspectorOpens=[];
  const controller=createController({onInspectorOpen:id=>{facilityOpen=false;inspectorOpens.push(id);},onBuildingsChange:id=>{buildingTerritory=id;},territories,metadata:Object.keys(territories).map(territoryId=>({territoryId,country:"国家",name:territoryId})),
    documentRef:{querySelector:node,querySelectorAll:()=>rows},
    getCampaignState:()=>({playerId:"me",homeTerritoryId:"home",setupComplete:true,fog:{enabled:true,visibleTerritoryIds:Object.keys(territories),exploredTerritoryIds:Object.keys(territories)},world:{}}),
  });
  for(const id of ["home","neutral","owned","other","home","club"]) {
    facilityOpen=true;
    controller.renderTerritoryInspector(id);
    assert.equal(facilityOpen,false);
    assert.equal(inspectorOpens.at(-1),id);
    const own=territories[id].ownerId === "me";
    assert.equal(node("#territory-inspector").classList.contains("is-own-territory"),own);
    assert.ok(rows.every(row=>row.hidden===own));
    assert.equal(buildingTerritory,id === "neutral" ? null : id);
  }
  controller.renderTerritoryInspector("owned");
  facilityOpen=true;
  const opensBeforeClear=inspectorOpens.length;
  controller.clearTerritorySelection();
  assert.equal(facilityOpen,true);
  assert.equal(inspectorOpens.length,opensBeforeClear);
  assert.equal(buildingTerritory,null);
  assert.equal(node("#territory-inspector").hidden,true);
  assert.equal(node("#territory-inspector").classList.contains("is-own-territory"),false);
});

function interactionHarness({visible=new Set(["partial","island"]),onSelect=()=>{}}={}) {
  const nodes=new Map(),children=[],mapEvents=new Map(),elementEvents=new Map(),selected=[];
  const classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v),toggle:(v,on)=>on?values.add(v):values.delete(v)};};
  function node(){return {style:{},dataset:{},hidden:false,innerHTML:"",textContent:"",offsetWidth:190,offsetHeight:100,classList:classes(),
    setAttribute(){},removeAttribute(){},remove(){this.removed=true;}};}
  const documentRef={createElement:()=>node(),querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[]};
  const element={ownerDocument:documentRef,classList:classes(),append:n=>children.push(n),addEventListener:(name,fn)=>elementEvents.set(name,fn),removeEventListener:name=>elementEvents.delete(name)};
  const map={getSize:()=>({x:800,y:600}),latLngToContainerPoint:({lat,lng})=>({x:lng*20,y:lat*20}),
    on:(names,fn)=>mapEvents.set(names,fn),off:names=>mapEvents.delete(names),emit:name=>{for(const [names,fn] of mapEvents)if(names.split(" ").includes(name))fn();}};
  const control=createTerritoryInteraction({map,element,isTerritoryVisible:id=>visible.has(id),isPointVisible:p=>p.lng<10,
    getTooltipContent:id=>"<strong>"+id+"</strong>",getStyle:()=>({hover:false}),getHoverStyle:()=>({hover:true}),
    onSelect:(id,event)=>{selected.push(id);onSelect(id,event);}});
  function layer(id,{svg=false}={}) {
    const path=svg?node():null,targets=new Set(),events={};
    const layer={options:{},feature:{properties:{territoryId:id}},style:{},styleChanges:0,
      on:handlers=>Object.assign(events,handlers),off:handlers=>{for(const name of Object.keys(handlers))delete events[name];},
      setStyle(value){this.style=value;this.styleChanges++;},bringToFront(){},getElement:()=>path,
      addInteractiveTarget:p=>targets.add(p),removeInteractiveTarget:p=>targets.delete(p)};
    control.bind(layer,id,layer.feature);
    return {layer,path,targets,events,emit:(name,lng=5,lat=10)=>events[name]?.({latlng:{lat,lng}})};
  }
  return {control,map,element,documentRef,nodes,visible,selected,layer,tooltip:children[0],children,mapEvents,elementEvents};
}

test("hover and click follow the visible portion when crossing fog within one province",()=>{
  const h=interactionHarness(),partial=h.layer("partial");
  partial.emit("mouseover",15);partial.emit("click",15);
  assert.equal(h.tooltip.hidden,true);assert.deepEqual(h.selected,[]);
  partial.emit("mousemove",5);
  assert.equal(h.tooltip.hidden,false);assert.match(h.tooltip.innerHTML,/partial/);assert.equal(partial.layer.style.hover,true);
  const changes=partial.layer.styleChanges;partial.emit("mousemove",6);
  assert.equal(partial.layer.styleChanges,changes,"moving within a visible province does not repaint all territory paths");
  partial.emit("click",6);assert.deepEqual(h.selected,["partial"]);
  partial.emit("mousemove",5);partial.emit("mousemove",15);
  assert.equal(h.tooltip.hidden,true);assert.equal(partial.layer.style.hover,false);
  assert.equal(h.element.classList.contains("is-hovering-territory"),false);
  h.control.destroy();
});

test("newly visible island restores Canvas and SVG interaction and clicking opens its intel inspector",async()=>{
  for(const svg of [false,true]) {
    let controller;const requests=[],h=interactionHarness({visible:new Set(),onSelect:id=>controller.selectTerritory(id)});
    const island=h.layer("island",{svg}),metadata={territoryId:"island",country:"群岛",name:"中间小岛"};
    const territories={island:{ownerType:OWNER_TYPES.NEUTRAL}},state={playerId:"me",homeTerritoryId:"home",setupComplete:true,world:{},fog:{enabled:true,visibleTerritoryIds:[],exploredTerritoryIds:[]}};
    controller=createController({metadata:[metadata],territories,documentRef:h.documentRef,mapElement:h.element,
      territoryLayersById:new Map([["island",island.layer]]),getCampaignState:()=>state,
      territoryStyle:()=>({hover:false}),refreshTerritoryInteraction:(...args)=>h.control.refreshLayer(...args),
      getCampaignRequest:()=>async url=>{requests.push(url);return {intel:{ai:{difficulty:1,averageOverall:65,formation:"4-4-2",mentality:"均衡",playStyle:"控球"}}};}});
    island.emit("mouseover");island.emit("click");
    assert.equal(island.layer.options.interactive,false);assert.deepEqual(requests,[]);
    if(svg)assert.equal(island.targets.has(island.path),false);
    state.fog.visibleTerritoryIds=["island"];h.visible.add("island");controller.refreshTerritoryDisplay();
    assert.equal(island.layer.options.interactive,true);
    if(svg){assert.equal(island.targets.has(island.path),true);assert.equal(island.path.classList.contains("leaflet-interactive"),true);}
    island.emit("mousemove");assert.equal(h.tooltip.hidden,false);
    island.emit("click");await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(h.selected,["island"]);assert.equal(requests.length,1);assert.match(requests[0],/island/);
    assert.equal(h.nodes.get("#territory-inspector").hidden,false);
    assert.match(h.nodes.get("#territory-name").textContent,/中间小岛/);
    island.emit("mouseover");state.fog.visibleTerritoryIds=[];h.visible.clear();controller.refreshTerritoryDisplay();
    assert.equal(h.tooltip.hidden,true);assert.equal(island.layer.options.interactive,false);
    if(svg)assert.equal(island.targets.has(island.path),false);
    island.emit("click");assert.equal(requests.length,1);
    h.control.destroy();
  }
});

test("territory tooltip stays above fog, fits screen edges and clears on navigation and disposal",()=>{
  const h=interactionHarness(),island=h.layer("island");
  assert.ok(h.children.includes(h.tooltip),"tooltip is a sibling of the fog canvas, outside Leaflet's map pane");
  assert.match(h.tooltip.className,/campaign-territory-tooltip/);
  island.emit("mouseover",.1,.1);assert.equal(h.tooltip.style.transform,"translate3d(8px,8px,0)");
  h.map.emit("movestart");assert.equal(h.tooltip.hidden,true);
  island.emit("mousemove");h.map.emit("zoomstart");assert.equal(h.tooltip.hidden,true);
  island.emit("mousemove");h.elementEvents.get("mouseleave")();assert.equal(h.tooltip.hidden,true);
  island.emit("mousemove");h.control.destroy();
  assert.equal(h.tooltip.removed,true);assert.equal(h.mapEvents.size,0);assert.equal(h.elementEvents.size,0);
  assert.deepEqual(Object.keys(island.events),[]);h.control.destroy();
});
