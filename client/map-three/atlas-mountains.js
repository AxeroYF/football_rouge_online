import { smooth } from "./atlas-style.js";

// Sculpt the continuous DEM instead of attaching independent cone meshes.
// A normalized, land-only Gaussian rounds crests and fills narrow notches;
// plains and the original coastline mask are preserved. Filtering is global,
// before chunking/LOD, so a mountain never changes shape at chunk boundaries.
export function roundedMountainHeights(source) {
  const heights=new Float32Array(source.heights.length),kernel=[1,4,6,4,1];
  for(let z=0;z<source.height;z++)for(let x=0;x<source.width;x++) {
    const i=z*source.width+x;if(source.mask[i]<=32)continue;
    const h=source.heights[i],strength=smooth(350,1500,source.elevations[i])*.62;
    let total=0,weight=0;
    if(strength>0)for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++) {
      const col=Math.max(0,Math.min(source.width-1,x+dx)),row=Math.max(0,Math.min(source.height-1,z+dz));
      const index=row*source.width+col;if(source.mask[index]<=32)continue;
      const w=kernel[dx+2]*kernel[dz+2];total+=source.heights[index]*w;weight+=w;
    }
    const rounded=h+(weight?total/weight-h:0)*strength;
    heights[i]=Math.max(0,Math.min(3.85,rounded*(1.04+smooth(.25,1.5,h)*.12)));
  }
  return heights;
}
