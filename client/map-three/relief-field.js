import { MAP_THREE_SETTINGS } from "./settings.js";
import { mapAssetUrl } from "../../shared/config/map-assets.mjs";

export const RELIEF_VERSION = "20260904-relief-mesh-v1";
export const RELIEF_SHEAR = Math.tan(MAP_THREE_SETTINGS.pitch * Math.PI / 180);

// Cartographic vertical exaggeration: quiet plains, visible major ranges.
export function reliefHeight(metres) {
  return Math.min(3.3, 1.05 * (Math.max(0, metres - 80) / 1800) ** 1.25);
}

// Move along the fixed camera's viewing ray. Actual height/normals/shadows
// change, while every point keeps its Leaflet screen footprint at 35 degrees.
export function reliefPoint(x, z, height, thickness = 0) {
  return { x, y: thickness + height, z: z + RELIEF_SHEAR * height };
}

export class ReliefField {
  constructor(meta, buffer) {
    const count = meta.width * meta.height;
    if (meta.schemaVersion !== 1 || !Number.isSafeInteger(count) || count < 4 || count > 4000000
      || meta.width < 2 || meta.height < 2 || !Number.isInteger(meta.width) || !Number.isInteger(meta.height)
      || !Number.isFinite(meta.step) || meta.step <= 0 || !meta.origin?.every(Number.isFinite)
      || meta.origin.length !== 2 || buffer.byteLength !== count * 3) throw new Error("地形高程数据损坏");
    this.meta = meta;
    this.width = meta.width; this.height = meta.height; this.step = meta.step;
    this.origin = meta.origin;
    const view = new DataView(buffer);
    this.elevations = new Uint16Array(count);
    this.heights = new Float32Array(count);
    this.mask = new Uint8Array(buffer, count * 2, count);
    for (let i = 0; i < count; i++) {
      const metres = view.getUint16(i*2, true);
      if (metres > 9000) throw new Error("地形高程超出范围");
      this.elevations[i] = metres;
      this.heights[i] = this.mask[i] > 32 ? reliefHeight(metres) : 0;
    }
  }
  contains(x, z) {
    return x >= this.origin[0] && z >= this.origin[1]
      && x <= this.origin[0]+(this.width-1)*this.step && z <= this.origin[1]+(this.height-1)*this.step;
  }
  maskAt(x,z) {
    if (!this.contains(x,z)) return 0;
    const col=Math.min(this.width-1,Math.max(0,Math.round((x-this.origin[0])/this.step)));
    const row=Math.min(this.height-1,Math.max(0,Math.round((z-this.origin[1])/this.step)));
    return this.mask[row*this.width+col];
  }
  node(column, row) {
    return this.heights[Math.max(0,Math.min(this.height-1,row))*this.width + Math.max(0,Math.min(this.width-1,column))];
  }
  sample(x, z) {
    if (!this.contains(x,z)) return 0;
    const px=(x-this.origin[0])/this.step, pz=(z-this.origin[1])/this.step;
    const col=Math.min(this.width-2,Math.floor(px)), row=Math.min(this.height-2,Math.floor(pz));
    const fx=px-col, fz=pz-row;
    const a=this.node(col,row), b=this.node(col+1,row), c=this.node(col,row+1), d=this.node(col+1,row+1);
    // Same diagonal and triangle interpolation as the actual mesh, not a
    // bilinear approximation that could put rivers below the surface.
    return fx+fz <= 1 ? a+(b-a)*fx+(c-a)*fz : d+(c-d)*(1-fx)+(b-d)*(1-fz);
  }
  normal(col,row) {
    const dx=(this.node(col+1,row)-this.node(col-1,row))/(2*this.step);
    const dz=(this.node(col,row+1)-this.node(col,row-1))/(2*this.step);
    const normal=[-dx,1+RELIEF_SHEAR*dz,-dz];
    const length=Math.hypot(...normal);
    return normal.map((v)=>v/length);
  }
}

export function sampleRelief(fields,x,z) {
  return fields.find((field)=>field.maskAt(x,z)>32)?.sample(x,z) ?? 0;
}

export function subdivideReliefPath(points, maximumStep = 0.125) {
  const result=[];
  for(let i=0;i<points.length;i++) {
    const current=points[i];
    if(i) {
      const previous=points[i-1];
      const steps=Math.ceil(Math.hypot(current.x-previous.x,current.z-previous.z)/maximumStep);
      for(let j=1;j<steps;j++) result.push({x:previous.x+(current.x-previous.x)*j/steps,z:previous.z+(current.z-previous.z)*j/steps});
    }
    result.push(current);
  }
  return result;
}

export async function loadReliefFields({signal,fetchImpl=fetch}={}) {
  return Promise.all(["europe","south-america","svalbard"].map(async(region)=>{
    // Names are local and known up front; metadata must not delay the binary
    // request or redirect it to an arbitrary URL.
    const prefix = "./assets/map-relief/relief-mesh/" + region;
    const [meta, buffer] = await Promise.all([
      fetchImpl(mapAssetUrl(prefix + ".json"), { signal, cache: "default" }).then(response => {
        if (!response.ok) throw new Error("立体地形清单加载失败：" + region);
        return response.json();
      }),
      fetchImpl(mapAssetUrl(prefix + ".bin"), { signal, cache: "default" }).then(response => {
        if (!response.ok) throw new Error("立体地形高程加载失败：" + region);
        return response.arrayBuffer();
      }),
    ]);
    return new ReliefField(meta, buffer);
  }));
}
