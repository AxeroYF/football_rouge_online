export function windowLayout(area, saved={}, launcher=false){
 const width=Math.min(area.width,Math.max(Math.min(launcher?560:900,area.width),Number.isFinite(saved.width)?saved.width:launcher?680:1440));
 const height=Math.min(area.height,Math.max(Math.min(launcher?440:560,area.height),Number.isFinite(saved.height)?saved.height:launcher?520:940));
 return {width,height,minWidth:Math.min(launcher?560:900,area.width),minHeight:Math.min(launcher?440:560,area.height),x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2)};
}
