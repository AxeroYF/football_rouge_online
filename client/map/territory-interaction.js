// One screen-space tooltip above the fog canvas. Leaflet's normal tooltips
// live inside the translating map pane and can be covered by screen-space fog.
export function createTerritoryInteraction({map, element, isTerritoryVisible, isPointVisible,
  getTooltipContent, getStyle, getHoverStyle, onSelect, documentRef=element.ownerDocument}) {
  const tooltip=documentRef.createElement("div");
  tooltip.className="leaflet-tooltip territory-tooltip campaign-territory-tooltip";
  tooltip.setAttribute("role","tooltip");tooltip.hidden=true;element.append(tooltip);
  const records=new Map();let active=null,lastEvent=null,destroyed=false;
  const allowed=(record,event)=>isTerritoryVisible(record.id)&&!!event?.latlng&&isPointVisible(event.latlng);
  function hide() {
    if(active)active.layer.setStyle(getStyle(active.feature));
    active=null;lastEvent=null;tooltip.hidden=true;
    element.classList.remove("is-hovering-territory");
  }
  function hover(record,event,restyle=false) {
    if(destroyed)return;
    if(!allowed(record,event)){hide();return;}
    const content=getTooltipContent(record.id);
    if(!content){hide();return;}
    if(active!==record){hide();active=record;record.layer.bringToFront();restyle=true;}
    lastEvent=event;if(restyle)record.layer.setStyle(getHoverStyle(record.feature));
    element.classList.add("is-hovering-territory");
    if(tooltip.innerHTML!==content)tooltip.innerHTML=content;
    tooltip.hidden=false;
    const point=map.latLngToContainerPoint(event.latlng),size=map.getSize();
    const width=tooltip.offsetWidth,height=tooltip.offsetHeight;
    const x=Math.max(8,Math.min(size.x-width-8,point.x-width/2));
    const y=Math.max(8,Math.min(size.y-height-8,point.y-height-12));
    tooltip.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }
  function refreshLayer(layer,id,visible=isTerritoryVisible(id)) {
    layer.options.interactive=visible;
    // Canvas reads options.interactive on every hit test. SVG also needs its
    // DOM hit target restored when a formerly unknown province is discovered.
    const path=layer.getElement?.();
    if(path){path.classList.toggle("leaflet-interactive",visible);
      if(visible)layer.addInteractiveTarget(path);else layer.removeInteractiveTarget(path);}
    if(active?.id===id){if(visible)hover(active,lastEvent,true);else hide();}
  }
  function bind(layer,id,feature) {
    const record={layer,id,feature};
    const handlers={
      mouseover:event=>hover(record,event),
      mousemove:event=>hover(record,event),
      mouseout:()=>{if(active===record)hide();},
      click:event=>{if(!destroyed&&allowed(record,event)){hide();onSelect(id,event);}},
      remove:()=>{if(active===record)hide();},
    };
    records.set(layer,{record,handlers});layer.on(handlers);refreshLayer(layer,id);
  }
  function destroy() {
    if(destroyed)return;destroyed=true;hide();
    for(const [layer,{handlers}] of records)layer.off(handlers);records.clear();
    map.off("movestart zoomstart",hide);map.off("unload",destroy);element.removeEventListener("mouseleave",hide);tooltip.remove();
  }
  map.on("movestart zoomstart",hide);map.on("unload",destroy);element.addEventListener("mouseleave",hide);
  return {bind,refreshLayer,destroy};
}
