import assert from "node:assert/strict";
import test from "node:test";
import {buildingMarkerMarkup,buildingMarkerScale,createBuildingMarkerController} from "../client/buildings/building-marker-controller.js";
const catalog=[{type:"main-stadium",label:"主体育场",iconPath:"/assets/building-icons-v2/main-stadium.png"},{type:"port",label:"港口",iconPath:"/assets/building-icons-v2/port.png"}];
const buildings=[{id:"stadium",type:"main-stadium",name:"黄狗竞技场",level:1},{id:"port",type:"port",level:2,status:"constructing"}];

test("all facilities appear as individual icons without an expansion hub",()=>{
  const markup=buildingMarkerMarkup({territoryId:"home",territoryLabel:"英国 - 高地",buildings,catalog});
  assert.equal((markup.match(/data-building-id=/g)??[]).length,2);
  assert.equal((markup.match(/<img /g)??[]).length,2);
  assert.match(markup,/黄狗竞技场/);assert.match(markup,/施工中/);assert.match(markup,/LV.2/);
  assert.doesNotMatch(markup,/building-node|building-orbit|点击展开设施/);
});

test("direct icon scale stays readable at overview and bounded at 30 times zoom",()=>{
  assert.equal(buildingMarkerScale(3),.2);
  assert.ok(buildingMarkerScale(5)<.6);
  assert.equal(buildingMarkerScale(5.8),1);
  assert.ok(Math.abs(buildingMarkerScale(3+Math.log2(30))-2.97*.85)<1e-9);
});

function fixture() {
  let zoom=3,iconChanges=0,scoutingTasks=[],trainingTasks=[];
  const fill={style:{}},progress={dataset:{buildingScoutProgress:"task"},querySelector:()=>fill,setAttribute(name,value){this[name]=value;}};
  const listeners=new Map(),selected=[];
  const button={dataset:{buildingId:"stadium"},addEventListener:(type,fn)=>listeners.set(type,fn)};
  const element={style:{setProperty(){}},querySelectorAll:(selector)=>selector==="[data-building-scout-progress]"?[progress]:[button]};
  const marker={setIcon(){iconChanges++;},setLatLng(){},getElement:()=>element,addTo(target){target.items.add(this);return this;}};
  const layer={items:new Set(),hasLayer(value){return this.items.has(value);},removeLayer(value){this.items.delete(value);}};
  const world={territories:{home:{buildings:structuredClone(buildings)}}};
  const controller=createBuildingMarkerController({
    Leaflet:{divIcon:value=>value,marker:()=>marker,DomEvent:{disableClickPropagation(){},disableScrollPropagation(){},stop(){}}},
    map:{getZoom:()=>zoom,project:(p,z)=>({x:p[1]*2**z,y:p[0]*2**z})},layer,
    territoryLayersById:new Map([["home",{getBounds:()=>({isValid:()=>true,getCenter:()=>[1,2]})}]]),
    territoryMetadataById:new Map([["home",{country:"英国",name:"高地"}]]),
    getScoutingTasks:()=>scoutingTasks,getScoutingTime:()=>1000,getTrainingTasks:()=>trainingTasks,
    getTerritoryWorld:()=>world,getBuildingCatalog:()=>catalog,selectTerritory(){throw Error("Must use integrated inspector callback");},
    onBuildingSelect:value=>selected.push(value),
  });
  return {controller,layer,marker,world,listeners,selected,fill,progress,setTasks(value){scoutingTasks=value;},setTrainingTasks(value){trainingTasks=value;},setZoom(value){zoom=value;},get changes(){return iconChanges;}};
}

test("icons remain visible without clicking even at minimum zoom, and unchanged polling preserves nodes",()=>{
  const f=fixture();f.controller.refresh();assert.equal(f.layer.hasLayer(f.marker),true);
  f.controller.refresh();f.controller.refresh();assert.equal(f.changes,0);
  f.setZoom(7.32);f.controller.updateVisibility();assert.equal(f.changes,0);
  f.world.territories.home.buildings[0].level=2;f.controller.refresh();assert.equal(f.changes,1);
  f.world.territories.home.buildings=[];f.controller.refresh();assert.equal(f.layer.items.size,0);
});

test("clicking a direct building icon selects its territory in the integrated inspector",()=>{
  const f=fixture();f.controller.refresh();f.listeners.get("click")({});
  assert.deepEqual(f.selected,[{territoryId:"home",buildingId:"stadium"}]);
});

test("scout map icon switches from progress to ready badge and clears after reward",()=>{
  const center={id:"scout",type:"scout-center",level:1,status:"active"};
  const task={id:"task",buildingId:"scout",territoryId:"home",status:"working",startedAt:1000,completesAt:601000};
  const options={territoryId:"home",buildings:[center],scoutingTasks:[task]};
  const working=buildingMarkerMarkup(options);
  assert.match(working,/data-building-scout-progress="task"/);
  assert.doesNotMatch(working,/class="building-scout-ready"/);
  task.status="ready";
  const ready=buildingMarkerMarkup(options);
  assert.match(ready,/class="building-scout-ready"/);
  assert.doesNotMatch(ready,/data-building-scout-progress/);
  task.status="claimed";
  assert.doesNotMatch(buildingMarkerMarkup(options),/building-scout-progress|building-scout-ready/);
  assert.doesNotMatch(buildingMarkerMarkup({...options,scoutingTasks:[{...task,status:"working",territoryId:"other"}]}),/building-scout-progress/);
});

test("scout map progress ticks without replacing marker DOM; state changes refresh once",()=>{
  const f=fixture();
  f.world.territories.home.buildings=[{id:"scout",type:"scout-center",level:1,status:"active"}];
  const task={id:"task",buildingId:"scout",territoryId:"home",status:"working",startedAt:1000,completesAt:601000};
  f.setTasks([task]);f.controller.refresh();
  f.controller.updateScoutingProgress(301000);
  assert.equal(f.fill.style.width,"50%");assert.equal(f.progress['aria-valuenow'],"50");
  f.controller.updateScoutingProgress(800000);assert.equal(f.fill.style.width,"100%");
  f.controller.updateScoutingProgress(0);assert.equal(f.fill.style.width,"0%");
  f.controller.refresh();assert.equal(f.changes,0);
  task.status="ready";f.controller.refresh();assert.equal(f.changes,1);
  f.setTasks([]);f.controller.refresh();assert.equal(f.changes,2);
});


test("training center badge persists while any result is completed and ignores other centers or dismissed tasks",()=>{
  const center={id:"training",type:"training-center",level:1,status:"active"};
  const task={id:"first",buildingId:"training",territoryId:"home",status:"working"};
  const options={territoryId:"home",buildings:[center],trainingTasks:[task]};
  assert.doesNotMatch(buildingMarkerMarkup(options),/building-training-ready/);
  task.status="completed";
  assert.match(buildingMarkerMarkup(options),/class="building-training-ready"/);
  options.trainingTasks.push({...task,id:"second"});
  assert.match(buildingMarkerMarkup(options),/2 名球员训练完成/);
  task.status="finished";
  assert.match(buildingMarkerMarkup(options),/1 名球员训练完成/);
  options.trainingTasks[1].status="cancelled";
  assert.doesNotMatch(buildingMarkerMarkup(options),/building-training-ready/);
  for(const other of [{territoryId:"away"},{buildingId:"other"}]) {
    assert.doesNotMatch(buildingMarkerMarkup({...options,trainingTasks:[{...task,status:"completed",...other}]}),/building-training-ready/);
  }
});

test("training completion refreshes map badges once and clearing the last result removes them",()=>{
  const f=fixture();
  f.world.territories.home.buildings=[{id:"training",type:"training-center",level:1,status:"active"}];
  const task={id:"first",buildingId:"training",territoryId:"home",status:"working"};
  f.setTrainingTasks([task]);f.controller.refresh();
  task.status="completed";f.controller.refresh();assert.equal(f.changes,1);
  f.controller.refresh();assert.equal(f.changes,1);
  f.setTrainingTasks([]);f.controller.refresh();assert.equal(f.changes,2);
});


test('coastal port has its own marker while other facilities retain the center group',()=>{
 const made=[],layer={items:new Set(),hasLayer(m){return this.items.has(m);},removeLayer(m){this.items.delete(m);}};
 const world={territories:{home:{buildings:structuredClone(buildings)}}};
 const controller=createBuildingMarkerController({
  Leaflet:{divIcon:v=>v,marker(position,options){const m={position,html:options.icon.html,setLatLng(p){this.position=p;},setIcon(icon){this.html=icon.html;},getLatLng(){return this.position;},addTo(l){l.items.add(this);return this;}};made.push(m);return m;}},
  map:{getZoom:()=>6},layer,territoryLayersById:new Map([['home',{getBounds:()=>({getCenter:()=>[5,5]})}]]),
  territoryMetadataById:new Map([['home',{region:'europe',centroid:[5,5]}]]),getCoastlines:()=>[[[0,0],[10,0]]],
  getTerritoryWorld:()=>world,getBuildingCatalog:()=>catalog,selectTerritory(){}
 });
 controller.refresh();assert.equal(layer.items.size,2);
 const port=made.find(m=>m.html.includes('data-building-id="port"')),stadium=made.find(m=>m.html.includes('data-building-id="stadium"'));
 assert.deepEqual(port.position,[0,5]);assert.deepEqual(stadium.position,[5,5]);assert.notEqual(port,stadium);
 controller.refresh();assert.equal(made.length,2);
 world.territories.home.buildings=world.territories.home.buildings.filter(b=>b.type!=='port');controller.refresh();
 assert.equal(layer.items.size,1);assert.ok(layer.items.has(stadium));
});


test('unit obstacles use stable facility anchors and cover the largest detail footprint',()=>{
 const f=fixture();f.controller.refresh();const box=f.controller.getUnitObstacles('home',[1,2],6.2)[0];
 assert.equal(box.x+box.width/2,0);assert.equal(box.y+box.height/2,0);
 for(let z=5.8;z<=8;z+=.05){f.setZoom(z);assert.deepEqual(f.controller.getUnitObstacles('home',[1,2],6.2)[0],box);assert.ok(box.width+1e-7>=110*buildingMarkerScale(z)/2**(z-6.2));}
 f.world.territories.home.buildings.push({id:'extra',type:'scout-center',level:1});f.controller.refresh();assert.ok(f.controller.getUnitObstacles('home',[1,2],6.2)[0].width>box.width);
 f.world.territories.home.buildings=[];f.controller.refresh();assert.equal(f.controller.getUnitObstacles('home',[1,2],6.2).length,0);
});
