import { recoveryRing } from '../../shared/map/recovery-aura.mjs';
import { facilityEffects } from '../../shared/config/facility-levels.mjs';
import { canUseTerritory } from '../../shared/config/diplomacy.mjs';
export function createRecoveryRangeController({Leaflet:L,map,getState,metadata,sourcePointToDisplay,showToast=()=>{}}){
 let selection=null,group=null,frame=null,timeout=null,signature='',renderer=null;
 function clear(){if(frame)cancelAnimationFrame(frame);clearTimeout(timeout);group?.remove();group=null;selection=null;signature='';}
 function info(){const s=getState(),t=s?.world?.territories?.[selection?.territoryId];const b=t?.buildings?.find(b=>b.id===selection?.buildingId);return b?.type==='recovery-center'&&b.status==='active'?{s,t,b}:null;}
 function show(target){
  clear();selection=target;const value=info(),center=metadata.get(target.territoryId)?.centroid;
  if(!value||!center){clear();showToast('体能恢复中心尚未建成或当前不可见');return;}
  const {s,b}=value,e=facilityEffects(b.type,b.level),eligible=canUseTerritory(s.world,s.playerId,target.territoryId);
  signature=JSON.stringify([b.level,eligible]);
  if(!map.getPane('recoveryRangePane')){const pane=map.createPane('recoveryRangePane');pane.style.zIndex='460';pane.style.pointerEvents='none';}
  renderer??=L.svg({pane:'recoveryRangePane'});
  group=L.layerGroup().addTo(map);const color=eligible?'#63e1d4':'#bec6ca';
  const ring=r=>recoveryRing(center,r).map(p=>sourcePointToDisplay(target.territoryId,p));
  L.polygon(ring(e.recoveryRadiusKm),{renderer,pane:'recoveryRangePane',color,weight:2,dashArray:'8 6',fillColor:color,fillOpacity:.12,interactive:false,className:'recovery-range-boundary'}).addTo(group);
  const pulse=L.polygon(ring(e.recoveryRadiusKm*.05),{renderer,pane:'recoveryRangePane',color,weight:2,fill:false,interactive:false,className:'recovery-range-pulse'}).addTo(group);
  const text='体能恢复 LV'+(b.level??1)+' · 本地块全覆盖 · 半径 '+e.recoveryRadiusKm+' 公里 · '+e.recoveryPerMinute+' 点/分钟'+(eligible?'':'（仅查看）');
  L.tooltip({permanent:true,direction:'right',className:'recovery-range-label'}).setLatLng(sourcePointToDisplay(target.territoryId,center)).setContent(text).addTo(group);
  const began=performance.now(),reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animate=now=>{if(!group)return;const progress=((now-began)%2000)/2000;pulse.setLatLngs(ring(e.recoveryRadiusKm*(.05+.95*progress)));pulse.setStyle({opacity:.8*(1-progress)});frame=requestAnimationFrame(animate);};
  if(!reduced)frame=requestAnimationFrame(animate);else pulse.remove();
  timeout=setTimeout(clear,10000);
 }
 function refresh(){if(!selection)return;const v=info();if(!v)return clear();if(signature!==JSON.stringify([v.b.level,canUseTerritory(v.s.world,v.s.playerId,selection.territoryId)]))show({...selection});}
 const onKey=e=>{if(e.key==='Escape')clear();};globalThis.document?.addEventListener('keydown',onKey);
 return {show,clear,refresh,destroy(){clear();renderer?.remove();globalThis.document?.removeEventListener('keydown',onKey);}};
}
