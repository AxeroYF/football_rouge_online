import { FOG_RULES, campaignFog, fogMinimumZoom } from "../../shared/config/fog.mjs";
import { FogSpatialIndex, leafletBounds, fogGeometryKey } from "../../shared/map/fog-spatial.mjs";
import { project, unproject } from "../map-three/projection.js";
import { buildFogRaster } from "./fog-raster.js";

export function createCampaignFogController({Leaflet:L,map,element,displayTerritories,getCampaignState,campaignBounds,
  spatialIndex=new FogSpatialIndex(displayTerritories,{displayCoordinates:true}),manageCamera=true,showStatus=false,
  documentRef=element.ownerDocument,view=documentRef.defaultView??globalThis}={}) {
  const canvas=documentRef.createElement("canvas"),context=canvas.getContext("2d");
  if(!context)throw new Error("地图迷雾画布无法初始化");
  canvas.className="campaign-fog-canvas";canvas.setAttribute("aria-hidden","true");
  // Screen-fixed sibling of Leaflet's translating pane: rapid dragging cannot
  // uncover canvas edges. Panning draws just one cached image synchronously.
  element.append(canvas);
  // Diagnostic statistics are opt-in; ordinary play has no persistent HUD.
  const status=showStatus?documentRef.createElement("div"):null;
  if(status){status.className="campaign-fog-status";element.append(status);}
  let fog=null,models=null,raster=null,bounds=null,identity=null,signature=null,destroyed=false;
  function draw(){
    if(destroyed||!fog?.enabled)return;
    const size=map.getSize(),dpr=Math.min(view.devicePixelRatio||1,1.5);
    const width=Math.max(1,Math.ceil(size.x*dpr)),height=Math.max(1,Math.ceil(size.y*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    canvas.style.width=size.x+"px";canvas.style.height=size.y+"px";
    context.setTransform(dpr,0,0,dpr,0,0);context.globalAlpha=1;context.globalCompositeOperation="source-over";
    context.fillStyle=FOG_RULES.unexploredColor;context.fillRect(0,0,size.x,size.y);
    if(!raster)return;
    const nw=unproject(raster.bounds.minX,raster.bounds.minZ),se=unproject(raster.bounds.maxX,raster.bounds.maxZ);
    const a=map.latLngToContainerPoint([nw.lat,nw.lng]),b=map.latLngToContainerPoint([se.lat,se.lng]);
    // Replace, including transparent pixels, only inside the image rectangle.
    context.clearRect(a.x,a.y,b.x-a.x,b.y-a.y);
    context.drawImage(raster.texture,a.x,a.y,b.x-a.x,b.y-a.y);
    // The padded raster border is fully opaque. Cover fractional resampling
    // seams so distant coastlines cannot peek through a one-pixel frame.
    context.strokeStyle=FOG_RULES.unexploredColor;context.lineWidth=2;context.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
  }
  function updateCamera({fit=false}={}){
    if(!manageCamera)return;
    if(!fog?.enabled){map.setMinZoom(FOG_RULES.baseMinZoom);map.setMaxBounds([[-60,-70],[85,125]]);map.options.maxBoundsViscosity=.35;return;}
    if(!bounds)return;
    map.options.maxBoundsViscosity=1;map.setMinZoom(fogMinimumZoom(map.getBoundsZoom(bounds,false,L.point(48,48))));map.setMaxBounds(bounds);
    if(fit)map.fitBounds(bounds,{animate:false,padding:[24,24],maxZoom:FOG_RULES.maxZoom-FOG_RULES.zoomRoom});
    else map.panInsideBounds?.(bounds,{animate:false});
  }
  function refresh(){
    const state=getCampaignState();fog=campaignFog(state);
    const nextIdentity=`${state?.playerId??""}:${!!fog.enabled}`;
    const key=JSON.stringify([nextIdentity,fogGeometryKey(fog)]);
    canvas.hidden=!fog.enabled;
    if(status){
      status.hidden=!fog.enabled;
      status.textContent=fog.pending?"视野数据待更新":`当前可见 ${fog.visibleTerritoryIds.length} · 已探索 ${fog.exploredTerritoryIds.length} · 已相遇 ${fog.metPlayerIds.length}${fog.preview?" · 临时海岸预览":""}`;
    }
    if(key===signature)return;
    models=spatialIndex.models(fog);const raw=leafletBounds(models.bounds);bounds=raw?L.latLngBounds(raw).pad(.16):null;
    raster=fog.enabled?buildFogRaster(spatialIndex,models,documentRef):null;
    const fit=identity!==nextIdentity&&fog.enabled;identity=nextIdentity;signature=key;
    updateCamera({fit});draw();
  }
  function isPointVisible(latlng){
    if(!fog?.enabled)return true;
    const lat=Array.isArray(latlng)?latlng[0]:latlng.lat,lng=Array.isArray(latlng)?latlng[1]:latlng.lng,p=project(lng,lat);
    return spatialIndex.pointVisible(models.current,[p.x,p.z]);
  }
  function resize(){updateCamera();draw();}
  function destroy(){destroyed=true;map.off("move zoom viewreset",draw);map.off("resize",resize);map.off("unload",destroy);canvas.remove();status?.remove();raster=null;}
  map.on("move zoom viewreset",draw);map.on("resize",resize);map.on("unload",destroy);refresh();
  return {refresh,destroy,isPointVisible,getBounds:()=>fog?.enabled?bounds:null,
    fit:()=>map.fitBounds(fog?.enabled&&bounds?bounds:campaignBounds,{animate:false,padding:[24,24],maxZoom:fog?.enabled?FOG_RULES.maxZoom-FOG_RULES.zoomRoom:FOG_RULES.maxZoom})};
}
