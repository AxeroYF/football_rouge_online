import {placeTerritoryUnits,insideUnitTerritory,createUnitTerritoryLayout} from '../shared/map/unit-territory-layout.mjs';
import { unitTravelProgress, interpolateMapTravel } from '../shared/map/unit-travel.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { createScoutUnitController, scoutTokenMetrics } from "../client/map/scout-unit-controller.js";

function fixture() {
  let clock=1000, zoom=6.2, sequence=0, refreshes=0;
  const callbacks=new Map(), events={}, markers=[], paths=[], opens=[], plans=[];
  const documentRef={hidden:false,addEventListener:(key,fn)=>events[key]=fn,removeEventListener:key=>delete events[key]};
  const state={scouting:{scouts:[{id:"s1",name:"Oliver Reed",territoryId:"a",status:"idle",movableTerritoryIds:["b","c"]},{id:"s2",name:"James Reed",territoryId:"a",status:"idle",movableTerritoryIds:["b","c"]}]}};
  const layer={removed:[],removeLayer(marker){this.removed.push(marker);}};
  const geometry=(kind,position,options)=>{ const item={kind,position,options,addTo(){return this;}}; paths.push(item); return item; };
  const Leaflet={polyline:(...args)=>geometry("line",...args),circleMarker:(...args)=>geometry("point",...args),divIcon:options=>({options}),marker:(position,options)=>{
    const marker={position,options,events:{},icons:0,element:{style:{}},addTo(){return this;},on(k,f){this.events[k]=f;return this;},setLatLng(p){this.position=p;},setIcon(icon){this.options.icon=icon;this.icons++;},getElement(){return this.element;}};
    markers.push(marker);return marker;
  }};
  const metadata=new Map(["a","b","c"].map((id,i)=>[id,{centroid:[i*10,i*5]}]));
  const controller=createScoutUnitController({Leaflet,map:{getZoom:()=>zoom},mapElement:{classList:{toggle(){}}},layer,
    territoryMetadataById:metadata,
    sourcePointToDisplay:(_,p)=>[p[1],p[0]],getCampaignState:()=>state,getServerNow:()=>clock,documentRef,
    onOpen:(...args)=>opens.push(args),onPlanMove:(...args)=>plans.push(args),refreshTerritoryDisplay:()=>refreshes++,
    requestFrame:fn=>{const id=++sequence;callbacks.set(id,fn);return id;},cancelFrame:id=>callbacks.delete(id)});
  const frame=()=>{const entries=[...callbacks];callbacks.clear();entries.forEach(([,fn])=>fn());};
  return {controller,metadata,state,markers,paths,opens,plans,layer,callbacks,events,documentRef,frame,setTime:t=>clock=t,setZoom:z=>zoom=z,refreshes:()=>refreshes};
}
test("scouts at one center have separated anchors; polling and zoom reuse token DOM",()=>{
  const f=fixture();f.controller.refresh();
  assert.equal(f.markers.length,2);
  assert.notDeepEqual(f.markers[0].options.icon.options.iconAnchor,f.markers[1].options.icon.options.iconAnchor);
  f.controller.refresh();f.setZoom(4);f.controller.updateZoom();
  assert.equal(f.markers.length,2);assert.equal(f.markers[0].icons,0);
  assert.ok(scoutTokenMetrics(4).width<scoutTokenMetrics(6.2).width);
  assert.equal(f.callbacks.size,0,"idle scouts do not keep an animation loop");
  f.markers[0].events.click();assert.deepEqual(f.opens[0],["s1",{showResults:false}]);
  f.controller.destroy();assert.equal(f.layer.removed.length,2);
});
test("destination mode only accepts reachable targets and cancels when scout starts working",()=>{
  const f=fixture();f.controller.refresh();
  assert.equal(f.controller.beginMoveMode("s1"),true);
  assert.deepEqual([...f.controller.getTargetIds()],["b","c"]);
  assert.equal(f.controller.handleTerritoryClick("foreign"),true);assert.equal(f.plans.length,0);
  assert.equal(f.controller.handleTerritoryClick("c"),true);assert.deepEqual(f.plans,[["s1","c"]]);
  assert.equal(f.controller.isSelectingDestination(),false);
  f.controller.beginMoveMode("s1");f.state.scouting.scouts[0].status="working";f.controller.refresh();
  assert.equal(f.controller.isSelectingDestination(),false);
  f.state.scouting.scouts[0].status="ready";f.controller.refresh();f.markers[0].events.click();
  assert.deepEqual(f.opens.at(-1),["s1",{showResults:true}]);
  f.controller.destroy();
});
test("displayed travel follows a straight full-duration route and pauses in hidden tabs",()=>{
  const f=fixture();
  Object.assign(f.state.scouting.scouts[0],{status:"moving",movement:{path:["a","b","c"],stepDurationMs:60000,startedAt:1000,arrivesAt:121000}});
  f.metadata.get("b").centroid=[100,100];
  f.setTime(31000);f.controller.refresh();assert.deepEqual(f.markers[0].position,[2.5,5]);assert.equal(f.callbacks.size,1);
  f.setTime(91000);f.frame();assert.deepEqual(f.markers[0].position,[7.5,15]);
  f.documentRef.hidden=true;f.events.visibilitychange();assert.equal(f.callbacks.size,0);
  f.documentRef.hidden=false;f.events.visibilitychange();assert.equal(f.callbacks.size,1);
  f.setTime(121000);f.frame();assert.deepEqual(f.markers[0].position,[10,20]);assert.equal(f.callbacks.size,0);
  f.controller.destroy();
});
test("account state changes remove old markers and stop stale movement input",()=>{
  const f=fixture();f.controller.refresh();f.controller.beginMoveMode("s1");
  f.state.scouting.scouts=[];f.controller.refresh();
  assert.equal(f.layer.removed.length,2);assert.equal(f.controller.isSelectingDestination(),false);
  assert.equal(f.controller.handleTerritoryClick("b"),false);
  f.controller.destroy();
});

test("map movement draws departure to arrival with distinct endpoints and removes it on arrival",()=>{
  const f=fixture();
  const movement={id:"trip",fromTerritoryId:"a",toTerritoryId:"c",path:["a","b","c"],stepDurationMs:60000,startedAt:1000,arrivesAt:121000};
  Object.assign(f.state.scouting.scouts[0],{status:"moving",movement});
  f.controller.refresh();
  assert.equal(f.paths.length,3);
  assert.deepEqual(f.paths[0].position,[[0,0],[10,20]]);
  assert.deepEqual(f.paths[1].position,[0,0]);assert.deepEqual(f.paths[2].position,[10,20]);
  assert.notEqual(f.paths[1].options.fillColor,f.paths[2].options.fillColor);
  f.controller.refresh();assert.equal(f.paths.length,3);
  f.state.scouting.scouts[0].movement=null;f.state.scouting.scouts[0].status="idle";f.controller.refresh();
  assert.ok(f.paths.every(path=>f.layer.removed.includes(path)));
  f.controller.destroy();
});


test('projected interpolation and timing keep both units on the route at equal elapsed fractions',()=>{
 const movement={startedAt:1000,arrivesAt:121000,durationMs:60000};
 assert.equal(unitTravelProgress(movement,31000),.25);assert.equal(unitTravelProgress(movement,61000),.5);assert.equal(unitTravelProgress(movement,91000),.75);
 const map={project:p=>({x:p[1],y:p[0]**2}),unproject:p=>[Math.sqrt(p[1]),p[0]]};
 const result=interpolateMapTravel(map,[10,0],[30,80],.25);
 assert.equal(map.project(result).x,20);assert.ok(Math.abs(map.project(result).y-300)<1e-9);
 assert.equal(unitTravelProgress(movement,0),0);assert.equal(unitTravelProgress(movement,200000),1);
});


test('four scouts retain separate clickable slots throughout live zoom',()=>{
 const f=fixture();f.state.scouting.scouts.push(...['s3','s4'].map(id=>({...f.state.scouting.scouts[0],id})));
 f.controller.refresh();
 for(const zoom of [5.8,7,3+Math.log2(30)]){
  f.setZoom(zoom);f.controller.updateZoom();
  const boxes=f.markers.map(m=>{const o=m.options.icon.options;return {left:-o.iconAnchor[0],right:-o.iconAnchor[0]+o.iconSize[0]};}).sort((a,b)=>a.left-b.left);
  for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].left>=boxes[i-1].right,'scout hit areas must not overlap');
 }
 for(const marker of f.markers)marker.events.click();assert.deepEqual(f.opens.map(o=>o[0]),['s1','s2','s3','s4']);
 f.controller.destroy();
});

const ring=points=>points.map(([x,y])=>({x,y}));
test('stationed units fit concave territory and holes while avoiding the building row',()=>{
 const outer=ring([[-320,-300],[320,-300],[320,-70],[80,-70],[80,280],[-320,280],[-320,-300]]);
 const hole=ring([[-260,-250],[-140,-250],[-140,-130],[-260,-130],[-260,-250]]),polygons=[[outer,hole]];
 const units=Array.from({length:4},(_,i)=>({key:'s'+i,width:106,height:135}));
 const obstacles=[{x:-70,y:-200,width:200,height:120}];
 const placements=placeTerritoryUnits(polygons,units,obstacles);assert.equal(placements.length,4);
 for(const r of placements){assert.ok(r.fullyContained);for(const x of [0,.5,1])for(const y of [0,.5,1])assert.ok(insideUnitTerritory({x:r.x+r.width*x,y:r.y+r.height*y},polygons));}
 const intersection=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 for(let i=0;i<placements.length;i++){assert.equal(intersection(placements[i],obstacles[0]),0);for(let j=i+1;j<placements.length;j++)assert.equal(intersection(placements[i],placements[j]),0);}
});
test('tiny islands keep the unit ground contact on land instead of pushing it into a neighbour',()=>{
 const polygons=[[ring([[20,10],[45,10],[45,35],[20,35],[20,10]])]];
 const [r]=placeTerritoryUnits(polygons,[{key:'scout',width:106,height:135}]);assert.ok(r);assert.equal(r.fullyContained,false);
 assert.ok(insideUnitTerritory({x:r.x+r.width/2,y:r.y+r.height*.85},polygons));
});
test('separate islands are searched when the geographic centroid is in water',()=>{
 const polygons=[[[{x:-260,y:-180},{x:-60,y:-180},{x:-60,y:50},{x:-260,y:50}]],[[{x:100,y:70},{x:280,y:70},{x:280,y:260},{x:100,y:260}]]];
 const [r]=placeTerritoryUnits(polygons,[{key:'expedition',width:125,height:132}]);assert.ok(r.fullyContained);assert.ok(insideUnitTerritory({x:r.x+62.5,y:r.y+112.2},polygons));
});


test('fractional wheel zoom and DOM rounding never relocate a stationed scout',()=>{
 let zoom=6,pan=0,reads=0,revision='building-1';
 const ring=[[-400,-300],[400,-300],[400,300],[-400,300]].map(([x,y])=>({x,y}));
 const map={getZoom:()=>zoom,latLngToContainerPoint:p=>({x:p.x*2**(zoom-6)+pan,y:p.y*2**(zoom-6)+pan})};
 const building={dataset:{buildingTerritory:'a'},getBoundingClientRect(){reads++;return {x:-60+pan+Math.sin(zoom),y:-60+pan,width:120,height:130};}};
 const getUnits=()=>['s1','s2'].map(key=>({key,territoryId:'a',width:64,height:82}));
 const layout=createUnitTerritoryLayout({map,mapElement:{getBoundingClientRect:()=>({x:0,y:0}),querySelectorAll:()=>[building]},territoryLayersById:new Map([['a',{getLatLngs:()=>[ring]}]]),getUnits,getLayoutRevision:()=>revision});
 const fallback={iconSize:[64,82],iconAnchor:[32,76]},origin={x:0,y:0};
 const contact=m=>[(m.iconSize[0]/2-m.iconAnchor[0])/2**(zoom-6),(m.iconSize[1]*.85-m.iconAnchor[1])/2**(zoom-6)];
 const first=contact(layout.metrics('s1','a',origin,fallback));
 for(let i=0;i<160;i++){zoom=4+4*(i/159);pan=i*.31;const next=contact(layout.metrics('s1','a',origin,fallback));assert.ok(Math.hypot(first[0]-next[0],first[1]-next[1])<1e-8);assert.ok(insideUnitTerritory({x:next[0],y:next[1]},[[ring]]));}
 assert.equal(reads,1,'zoom/pan never remeasures transient building boxes');
 revision='building-2';layout.metrics('s1','a',origin,fallback);assert.equal(reads,2,'new construction invalidates the placement');
});
