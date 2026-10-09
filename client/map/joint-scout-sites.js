// Three static markers per rotation; no animation loop or additional polling.
export function createJointScoutSites({L,map,sourcePointToDisplay,metadata,onSelect}){
 const layer=L.layerGroup().addTo(map);let key=null;
 return {refresh(sites){const next=JSON.stringify(sites??null);if(next===key)return;key=next;layer.clearLayers();
  for(const site of sites?.territories??[]){const meta=metadata.get(site.id);if(!meta?.centroid)continue;
   const point=sourcePointToDisplay(site.id,meta.centroid);if(!point)continue;
   const marker=L.marker(point,{pane:'expeditionPane',icon:L.divIcon({className:'joint-scout-site-marker',iconSize:[34,34],iconAnchor:[17,17],html:'<span aria-hidden="true">⌖</span>'}),title:'联合考察点 · '+site.label,zIndexOffset:5}).addTo(layer);
   const label=document.createElement('span');label.textContent='联合考察 · '+site.label+' · '+new Date(sites.expiresAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' 轮换';marker.bindTooltip(label);
   marker.on('click',e=>{L.DomEvent.stopPropagation(e.originalEvent??e);onSelect(site.id);});
  }
 },destroy(){layer.remove();}};
}
