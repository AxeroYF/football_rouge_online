import { FOG_RULES } from "../../shared/config/fog.mjs";
import { expand, intersects } from "../../shared/map/fog-spatial.mjs";

// Build once per changed sight footprint, never re-tessellate provinces on drag.
export function buildFogRaster(index, models, documentRef) {
  if(!models.bounds)return null;
  const bounds=expand(models.bounds,FOG_RULES.feather*4);
  const dx=bounds.maxX-bounds.minX,dz=bounds.maxZ-bounds.minZ;
  const scale=Math.min(10,1536/Math.max(dx,dz),Math.sqrt(1500000/(dx*dz)));
  const width=Math.max(1,Math.ceil(dx*scale)),height=Math.max(1,Math.ceil(dz*scale));
  const canvas=()=>{const c=documentRef.createElement("canvas");c.width=width;c.height=height;return c;};
  function path(ctx,rings){ctx.beginPath();for(const ring of rings){ring.forEach(([x,z],i)=>{const px=(x-bounds.minX)*scale,py=(z-bounds.minZ)*scale;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});ctx.closePath();}}
  function polygons(ctx,items,radius=0){
    ctx.fillStyle=ctx.strokeStyle=FOG_RULES.unexploredColor;ctx.lineJoin=ctx.lineCap="round";ctx.lineWidth=radius*2*scale;
    for(const p of items){if(!intersects(expand(p.bounds,radius),bounds))continue;path(ctx,p.rings);ctx.fill("evenodd");if(radius)ctx.stroke();}
  }
  function mask(plan){
    const land=canvas(),ctx=land.getContext("2d"),sea=canvas(),water=sea.getContext("2d");
    polygons(ctx,plan.polygons,plan.radius);
    polygons(ctx,plan.sharedPolygons??[]);
    for(const c of plan.circles){ctx.beginPath();ctx.arc((c.point[0]-bounds.minX)*scale,(c.point[1]-bounds.minZ)*scale,c.radius*scale,0,Math.PI*2);ctx.fill();}
    water.strokeStyle=FOG_RULES.unexploredColor;water.lineCap="round";
    for(const l of plan.seaLines){water.beginPath();water.moveTo((l.a[0]-bounds.minX)*scale,(l.a[1]-bounds.minZ)*scale);water.lineTo((l.b[0]-bounds.minX)*scale,(l.b[1]-bounds.minZ)*scale);water.lineWidth=l.radius*2*scale;water.stroke();}
    // Temporary navigation corridors expose water only. The owned smooth
    // areas above already reveal their intervening islands as well as sea.
    water.globalCompositeOperation="destination-out";
    polygons(water,[...index.entries.values()].flatMap(e=>e.polygons));
    ctx.drawImage(sea,0,0);
    const soft=canvas(),blur=soft.getContext("2d");blur.filter=`blur(${FOG_RULES.feather*scale*.5}px)`;blur.drawImage(land,0,0);
    return soft;
  }
  const explored=mask(models.explored),current=mask(models.current),texture=canvas(),ctx=texture.getContext("2d");
  // Compute alpha explicitly, keeping unexplored pixels opaque across Canvas
  // implementations and composing overlapping discovery masks exactly once.
  const memory=explored.getContext("2d").getImageData(0,0,width,height).data;
  const sight=current.getContext("2d").getImageData(0,0,width,height).data;
  const pixels=ctx.createImageData(width,height),rgb=FOG_RULES.unexploredColor.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16));
  for(let i=0;i<pixels.data.length;i+=4){
    const c=sight[i+3]<=2?0:sight[i+3]/255,e=memory[i+3]<=2?0:memory[i+3]/255;
    pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];
    pixels.data[i+3]=Math.round(255*(1-c)*(1-e*(1-FOG_RULES.exploredOpacity)));
  }
  ctx.putImageData(pixels,0,0);
  return {texture,bounds,width,height,scale};
}
