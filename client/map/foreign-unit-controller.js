import { expeditionArtIcon } from '../../shared/config/expedition-art.mjs';
import { SCOUT_TOKEN_URL } from '../../shared/scouting/scout-units.mjs';
import { expeditionTokenMetrics } from './expedition-piece-controller.js';
import { scoutTokenMetrics } from './scout-unit-controller.js';
import { unitTeamBadge, compactUnitBadge } from './map-unit-color.js';
export function createForeignUnitController({Leaflet:L,map,layer,getState,getDisplayMetrics=(_u,m)=>m,isPointVisible=()=>true,escapeHtml=String,onInspect=()=>{}}){
 const markers=new Map();
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
 }
 return {refresh,updateZoom:refresh,destroy(){for(const e of markers.values())layer.removeLayer(e.marker);markers.clear();}};
}
