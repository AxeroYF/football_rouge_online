// Optional offline Canvas diagnostic. No browser or game server is used.
// FOG_CANVAS_MODULE may point at a local @napi-rs/canvas installation.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createCampaignFogController } from "../client/map/campaign-fog-controller.js";
import { geometryBounds, polygonRings } from "../client/map/fog-geometry.js";
import { transformSouthAmericaFeature, CAMPAIGN_BOUNDS } from "../client/map/campaign-map-geometry.js";
import { FogService } from "../server/application/fog-service.mjs";
import { createTerritoryWorld } from "../territory-model.js";
import { createMaritimeRoutePlanner } from "../maritime-routes.mjs";
const require=createRequire(import.meta.url);
const { createCanvas }=require(process.env.FOG_CANVAS_MODULE || "@napi-rs/canvas");
const output=process.env.FOG_REVIEW_OUTPUT||"outputs/fog-smooth-review"; fs.mkdirSync(output,{recursive:true});
const tilt=Math.cos(35*Math.PI/180);
const projected=([lng,lat])=>({x:(lng+180)/360,y:(.5-Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*Math.PI/360))/(2*Math.PI))*tilt});
const unproject=({x,y})=>({lng:x*360-180,lat:(2*Math.atan(Math.exp((.5-y/tilt)*2*Math.PI))-Math.PI/2)*180/Math.PI});
class Bounds {
  constructor(points){this.s=points[0][0];this.w=points[0][1];this.n=points[1][0];this.e=points[1][1];}
  pad(r){const x=(this.e-this.w)*r,y=(this.n-this.s)*r;return new Bounds([[this.s-y,this.w-x],[this.n+y,this.e+x]]);}
  getWest(){return this.w;} getEast(){return this.e;} getSouth(){return this.s;} getNorth(){return this.n;}
}
function harness(features,state) {
  const jobs=new Map(),handlers=new Map();let job=0,overlay=null;
  const pane={style:{},append(value){overlay=value;}};
  const element={classList:{toggle(){}},append(node){if(node.className==="campaign-fog-canvas")overlay=node;}};
  const view={devicePixelRatio:1,requestAnimationFrame(fn){jobs.set(++job,fn);return job;},cancelAnimationFrame(id){jobs.delete(id);}};
  const doc={defaultView:view,createElement(type){const node=type==="canvas"?createCanvas(300,150):{};return Object.assign(node,{style:{},setAttribute(){},remove(){this.removed=true;}});}};
  element.ownerDocument=doc;
  const map={width:960,height:580,zoom:5,center:[0,0],offset:{x:0,y:0},options:{},min:3,
    getSize(){return {x:this.width,y:this.height};},getZoom(){return this.zoom;},
    getPane(){return pane;},createPane(){return pane;},
    containerPointToLayerPoint(){return {x:-this.offset.x,y:-this.offset.y};},
    latLngToContainerPoint([lat,lng]){const p=projected([lng,lat]),c=projected(this.center),scale=256*2**this.zoom;return {x:(p.x-c.x)*scale+this.width/2+this.offset.x,y:(p.y-c.y)*scale+this.height/2+this.offset.y};},
    inverse(x,y){const c=projected(this.center),scale=256*2**this.zoom;return unproject({x:c.x+(x-this.width/2-this.offset.x)/scale,y:c.y+(y-this.height/2-this.offset.y)/scale});},
    getBounds(){const a=this.inverse(0,this.height),b=this.inverse(this.width,0);return new Bounds([[a.lat,a.lng],[b.lat,b.lng]]);},
    getBoundsZoom(b,_inside,pad){const a=projected([b.w,b.n]),z=projected([b.e,b.s]);return Math.log2(Math.min((this.width-pad.x)/(Math.abs(z.x-a.x)*256),(this.height-pad.y)/(Math.abs(z.y-a.y)*256)));},
    setMinZoom(z){this.min=z;this.zoom=Math.max(this.zoom,z);},setMaxBounds(b){this.maximum=b;},panInsideBounds(){},
    fitBounds(b,options={}){b=b instanceof Bounds?b:new Bounds(b);this.center=[(b.w+b.e)/2,(b.s+b.n)/2];this.offset={x:0,y:0};this.zoom=Math.max(this.min,Math.min(options.maxZoom??8,this.getBoundsZoom(b,false,{x:48,y:48})));},
    on(events,fn){handlers.set(events,fn);},off(events){handlers.delete(events);},
    emit(name){for(const [events,fn] of handlers)if(events.split(" ").includes(name))fn();},
  };
  const controller=createCampaignFogController({Leaflet:{latLngBounds:p=>new Bounds(p),point:(x,y)=>({x,y})},map,element,
    displayTerritories:{features},getCampaignState:()=>state,campaignBounds:CAMPAIGN_BOUNDS});
  const flush=()=>{for(const [id,fn] of [...jobs]){jobs.delete(id);fn();}};
  const alpha=([lng,lat])=>{const p=map.latLngToContainerPoint([lat,lng]);return overlay.getContext("2d").getImageData(Math.round(p.x),Math.round(p.y),1,1).data[3];};
  return {map,controller,flush,alpha,get overlay(){return overlay;},features,state};
}

const square=(id,x,w=1)=>({properties:{territoryId:id},geometry:{type:"Polygon",coordinates:[[[x,0],[x+w,0],[x+w,1],[x,1],[x,0]]]}});
const fake={playerId:"p",homeTerritoryId:"a",fog:{enabled:true,visibleTerritoryIds:["a"],exploredTerritoryIds:["a","b"],metPlayerIds:[]}};
const pixels=harness([square("a",0),square("b",10),square("c",4,3)],fake);
assert.equal(pixels.alpha([.5,.5]),0);
assert.ok(pixels.alpha([10.5,.5])>=155&&pixels.alpha([10.5,.5])<=160, `explored alpha=${pixels.alpha([10.5,.5])}, projected=${JSON.stringify(pixels.map.latLngToContainerPoint([.5,10.5]))}`);
assert.equal(pixels.alpha([5.5,4]),255);
const edge=harness([square("a",0)],{...fake,fog:{...fake.fog,exploredTerritoryIds:["a"]}});
const gradient=[1.8,2.2,2.58,2.9,3.4].map(lat=>edge.alpha([.5,lat]));
edge.controller.destroy();
assert.ok(gradient[0]<gradient.at(-1)&&gradient.some(a=>a>10&&a<245));
for(let i=1;i<gradient.length;i++)assert.ok(gradient[i]>=gradient[i-1],`non-monotonic fog edge ${gradient}`);
pixels.map.offset={x:65,y:-23};pixels.map.emit("move");pixels.flush();
assert.equal(pixels.alpha([.5,.5]),0);assert.equal(pixels.alpha([5.5,4]),255);
assert.equal(pixels.overlay.style.transform,undefined);
// A whole-viewport drag still fills all screen corners synchronously.
pixels.map.offset={x:2500,y:1600};pixels.map.emit("move");
for(const [x,y] of [[0,0],[959,0],[0,579],[959,579]])assert.equal(pixels.overlay.getContext("2d").getImageData(x,y,1,1).data[3],255);
pixels.map.offset={x:0,y:0};pixels.map.emit("move");
pixels.map.zoom+=.3;pixels.map.emit("zoom");pixels.flush();assert.equal(pixels.alpha([.5,.5]),0);
pixels.map.width=800;pixels.map.emit("resize");pixels.flush();assert.equal(pixels.overlay.width,800);
fake.fog={enabled:false,visibleTerritoryIds:[],exploredTerritoryIds:[],metPlayerIds:[]};pixels.controller.refresh();assert.equal(pixels.overlay.hidden,true);assert.equal(pixels.map.min,3);
pixels.controller.destroy();assert.equal(pixels.overlay.removed,true);

const read=name=>JSON.parse(fs.readFileSync(new URL("../"+name,import.meta.url),"utf8"));
const index=read("assets/data/territory-index.json"),geo=read("assets/data/campaign-territories.geojson"),coasts=read("assets/data/campaign-coastlines.json");
const display=geo.features.map(f=>f.properties.region==="south-america"?transformSouthAmericaFeature(f):f);
const world=createTerritoryWorld(index),source="adm1:isl-705";
world.territories[source].ownerType="player";world.territories[source].ownerId="p";
const account={id:"p",homeTerritoryId:source,expeditionPiece:{territoryId:source,movement:null}};
const service=new FogService({territoryIndex:index,territoryGeoJson:geo});
const state={playerId:"p",homeTerritoryId:source,fog:service.update(account,world).view};
const real=harness(display,state);

function screenshot(name,label) {
  real.controller.refresh();real.controller.fit();real.map.emit("move");real.flush();
  const out=createCanvas(real.map.width,real.map.height+70),ctx=out.getContext("2d");
  ctx.fillStyle="#214b59";ctx.fillRect(0,0,out.width,out.height);
  const box=real.map.getBounds();
  for(const feature of display){const b=geometryBounds(feature.geometry);if(!b||b[0]>box.e||b[2]<box.w||b[1]>box.n||b[3]<box.s)continue;
    ctx.fillStyle=state.fog.sourceTerritoryIds.includes(feature.properties.territoryId)?"#c8b060":"#8f9e67";ctx.strokeStyle="#c5c5a0";ctx.lineWidth=.6;
    for(const polygon of polygonRings(feature.geometry)){ctx.beginPath();for(const ring of polygon){ring.forEach(([lng,lat],i)=>{const p=real.map.latLngToContainerPoint([lat,lng]);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();}ctx.fill("evenodd");ctx.stroke();}
  }
  ctx.drawImage(real.overlay,0,0);ctx.fillStyle="#102127";ctx.fillRect(0,real.map.height,out.width,70);
  ctx.font="18px Microsoft YaHei";ctx.fillStyle="#e8e5d1";ctx.fillText(label,24,real.map.height+28);
  ctx.font="13px Microsoft YaHei";ctx.fillStyle="#aebfb9";ctx.fillText(`离线画布诊断 · 非 WebGL 实景  |  可见 ${state.fog.visibleTerritoryIds.length}  已探索 ${state.fog.exploredTerritoryIds.length}`,24,real.map.height+51);
  fs.writeFileSync(`${output}/${name}.png`,out.toBuffer("image/png"));return out;
}
const home=screenshot("fog-home","建立主场：领地周围连续视野，邻省仅局部可见");
const planner=createMaritimeRoutePlanner({coastlineData:coasts,territoryGeoJson:geo,territoryIndex:index});
const result=planner.routesFrom(world,"p",source,[-18.5,63.42]);service.survey(account,world,result);state.fog=service.update(account,world).view;
const naval=screenshot("fog-naval","海上测绘：临时显示登陆海岸与海上航线");
account.expeditionPiece.movement={toTerritoryId:source,arrivesAt:Infinity};state.fog=service.update(account,world).view;
const recalled=screenshot("fog-recalled","结束预览：收回临时视野，不留下永久探索区");
account.expeditionPiece.movement=null;
for(const id of ["adm1:irl-714","adm1:gbr-2745"])Object.assign(world.territories[id],{ownerType:"player",ownerId:"p"});
state.fog=service.update(account,world).view;
assert.ok(state.fog.visibleTerritoryIds.includes("adm1:fro-1443"),"intervening Faroe islands are visible without a sea preview");
const islands=screenshot("fog-island-corridors","沿领地分布连接视野，边缘平滑弯曲，中间海域与岛屿可见");
const sheet=createCanvas(1440,975),ctx=sheet.getContext("2d");ctx.fillStyle="#102127";ctx.fillRect(0,0,1440,975);
ctx.drawImage(home,0,0,720,487.5);ctx.drawImage(naval,720,0,720,487.5);ctx.drawImage(recalled,0,487.5,720,487.5);ctx.drawImage(islands,720,487.5,720,487.5);
fs.writeFileSync(`${output}/fog-diagnostic.jpg`,sheet.toBuffer("image/jpeg",88));
real.controller.destroy();
const report={gradientAlpha:gradient,pixelChecks:"visible alpha=0, explored alpha≈158, unknown alpha=255; pan/zoom/resize/preview/dispose passed",navalTargets:result.routes.length,navalIncludesFaroe:result.routes.some(r=>r.targetTerritoryId==="adm1:fro-1443"),output};
fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)+"\n");console.log(report);
