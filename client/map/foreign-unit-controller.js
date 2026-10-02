import { expeditionArtIcon } from '../../shared/config/expedition-art.mjs';
import { SCOUT_TOKEN_URL } from '../../shared/scouting/scout-units.mjs';
import { expeditionTokenMetrics } from './expedition-piece-controller.js';
import { scoutTokenMetrics } from './scout-unit-controller.js';
import { unitTeamBadge, compactUnitBadge } from './map-unit-color.js';
import {unitTravelProgress,interpolateMapTravel} from '../../shared/map/unit-travel.mjs';
export function createForeignUnitController({Leaflet:L,map,layer,getState,getDisplayMetrics=(_u,m)=>m,isPointVisible=()=>true,escapeHtml=String,onInspect=()=>{},getServerNow=Date.now,notices,getTerritoryLabel=id=>id,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}){
 const markers=new Map(),routes=new Map();let timer=null,noticeKey='';
 const traveling=u=>u.kind==='coalition'&&u.allied&&u.movement?.fromPosition&&u.movement?.toPosition;
 function paint(){
  for(const {marker,unit:u} of markers.values())if(traveling(u)){
   const progress=unitTravelProgress(u.movement,getServerNow());
   marker.setLatLng(interpolateMapTravel(map,u.movement.fromPosition,u.movement.toPosition,progress));
   const card=notices&&[...notices.children].find(n=>n.dataset.unitId===u.id);
   if(card){const bar=card.querySelector('[role=progressbar]');bar.setAttribute('aria-valuenow',String(Math.floor(progress*100)));bar.querySelector('i').style.width=progress*100+'%';const seconds=Math.max(0,Math.ceil((u.movement.arrivesAt-getServerNow())/1000));card.querySelector('[data-time]').textContent=seconds?`剩余 ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · ${Math.floor(progress*100)}%`:'已抵达，等待服务器确认';}
  }
 }
 function movementDisplay(){
  const units=[...markers.values()].map(e=>e.unit).filter(traveling),ids=new Set(units.map(u=>u.id));
  for(const [id,entry] of routes)if(!ids.has(id)){for(const item of entry.layers)layer.removeLayer(item);routes.delete(id);}
  for(const u of units){const points=[u.movement.fromPosition,u.movement.toPosition],key=JSON.stringify(points);if(routes.get(u.id)?.key===key)continue;
   for(const item of routes.get(u.id)?.layers??[])layer.removeLayer(item);
   const style={pane:'expeditionPane',color:'#f0cb69',weight:2,interactive:false};
   routes.set(u.id,{key,layers:[L.polyline(points,{...style,dashArray:'7 8',opacity:.8}).addTo(layer),...points.map(p=>L.circleMarker(p,{...style,radius:4,fillOpacity:1}).addTo(layer))]});
  }
  const key=JSON.stringify(units.map(u=>[u.id,u.ownerName,u.movement]));
  if(notices){notices.hidden=!units.length;if(key!==noticeKey){noticeKey=key;notices.innerHTML=units.map(u=>`<article class="campaign-expedition-card" data-unit-id="${escapeHtml(u.id)}"><span class="campaign-expedition-kicker">${escapeHtml(u.ownerName)} · 联军${u.movement.mode==='air'?'空运':'移动'}中</span><strong>${escapeHtml(getTerritoryLabel(u.movement.fromTerritoryId))} → ${escapeHtml(getTerritoryLabel(u.movement.toTerritoryId))}</strong><div class="campaign-expedition-progress" role="progressbar" aria-label="联军移动进度" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="campaign-expedition-footer"><span data-time></span></div></article>`).join('');}}
  if(units.length&&timer===null)timer=setIntervalImpl(paint,250);
  if(!units.length&&timer!==null){clearIntervalImpl(timer);timer=null;}paint();
 }

 function refresh(){
  const active=new Set();
  for(const u of getState()?.world?.units??[]){
   if(!u.position||(!u.allied&&!isPointVisible(u.position)))continue;
   active.add(u.id);
   const s=scoutTokenMetrics(map.getZoom()),base=u.kind==='scout'?{iconSize:[s.width,s.height],iconAnchor:[s.width/2,s.height-6*s.scale]}:expeditionTokenMetrics(map.getZoom());
   const m=u.moving?base:getDisplayMetrics(u,base),label=`${u.ownerName} · ${u.name} · ${u.moving?'移动中':'驻扎'}`;
   const html=`<button type="button" class="foreign-map-token" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${unitTeamBadge({color:u.color,kind:u.kind,ownerName:u.ownerName,compact:compactUnitBadge(map)})}<img src="${u.kind==='coalition'?'assets/icons/coalition.svg':u.kind==='scout'?SCOUT_TOKEN_URL:expeditionArtIcon(u.tokenId)}" alt="" draggable="false"></button>`;
   const key=JSON.stringify([m,html]);let entry=markers.get(u.id);
   if(!entry){const marker=L.marker(u.position,{pane:'expeditionPane',icon:L.divIcon({className:'foreign-unit-map-icon',...m,html}),zIndexOffset:20}).addTo(layer);entry={marker,key,unit:u};markers.set(u.id,entry);marker.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent??e);onInspect(entry.unit.ownerId,entry.unit,e);});}
   else{entry.unit=u;entry.marker.setLatLng(u.position);if(entry.key!==key){entry.marker.setIcon(L.divIcon({className:'foreign-unit-map-icon',...m,html}));entry.key=key;}}
  }
  for(const [id,e] of markers)if(!active.has(id)){layer.removeLayer(e.marker);markers.delete(id);}
  movementDisplay();
 }
 return {refresh,updateZoom:refresh,destroy(){if(timer!==null)clearIntervalImpl(timer);for(const e of markers.values())layer.removeLayer(e.marker);for(const e of routes.values())for(const item of e.layers)layer.removeLayer(item);markers.clear();routes.clear();if(notices){notices.replaceChildren();notices.hidden=true;}}};
}
