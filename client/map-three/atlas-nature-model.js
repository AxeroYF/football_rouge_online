import { decodeSnowMask } from "./environment.js";
import { mapAssetUrl } from "../../shared/config/map-assets.mjs";
import { unproject } from "./projection.js";
import { smooth } from "./atlas-style.js";

export const NATURE_VERSION = "20260905-nature-v1";
export const WATER_STENCIL_BIT = 16;
export const natureHash = (x, z) => { const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n); };
export function natureNoise(x,z,scale=1) {
  x/=scale;z/=scale;const ix=Math.floor(x),iz=Math.floor(z),fx=smooth(0,1,x-ix),fz=smooth(0,1,z-iz);
  return (natureHash(ix,iz)*(1-fx)+natureHash(ix+1,iz)*fx)*(1-fz)
    +(natureHash(ix,iz+1)*(1-fx)+natureHash(ix+1,iz+1)*fx)*fz;
}

export function insideRing(x,z,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,az]=ring[i],[bx,bz]=ring[j];
    if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
  }
  return inside;
}
export const insideLake = (x,z,rings) => insideRing(x,z,rings[0])&&!rings.slice(1).some(r=>insideRing(x,z,r));
export function lakeBounds(rings) {
  const x=rings[0].map(p=>p[0]),z=rings[0].map(p=>p[1]);
  return {minX:Math.min(...x),maxX:Math.max(...x),minZ:Math.min(...z),maxZ:Math.max(...z)};
}

export function natureWeights(field,x,z) {
  if(field.meta.region==="svalbard")return [0,0,0,0];
  const col=Math.round((x-field.origin[0])/field.step),row=Math.round((z-field.origin[1])/field.step);
  if(col<0||row<0||col>=field.width||row>=field.height)return [0,0,0,0];
  const i=row*field.width+col;
  if(field.mask[i]<200||field.nature?.placement[i]===0)return [0,0,0,0];
  const location=unproject(x,z),latitude=Math.abs(field.meta.region==="south-america"?location.lng-41.5:location.lat);
  const metres=field.elevations[i],slope=Math.hypot(field.node(col+1,row)-field.node(col-1,row),field.node(col,row+1)-field.node(col,row-1))/(2*field.step);
  const climate=1-smooth(62,73,latitude),altitude=1-smooth(1300,latitude>55?1900:2600,metres);
  const woods=smooth(.40,.72,natureNoise(x+21,z-17,3.6))*climate*altitude*(1-smooth(.6,1.3,slope));
  const farm=smooth(.38,.68,natureNoise(x-33,z+19,4.8))*(1-woods)*climate*(1-smooth(500,1200,metres))*(1-smooth(.06,.30,slope));
  const meadow=smooth(.30,.70,natureNoise(x+2,z,2.4))*(1-woods*.7)*(1-farm)*altitude*climate;
  const shrubs=smooth(.44,.72,natureNoise(x-8,z+11,2.6))*(1-farm)*(1-woods*.6)*climate*altitude;
  return [woods,farm,meadow,shrubs];
}

// Only the atlas field owns these height buffers. Original DEM arrays, masks
// and province geometry remain immutable. Lakes use one water level per basin.
export function prepareNatureFields(fields,data) {
  if(!data)return;
  if(data.schemaVersion!==1||!data.regions)throw new Error("自然地貌数据损坏");
  for(const field of fields) {
    const region=data.regions[field.meta.region];if(!region)continue;
    const p=region.placement;
    if(p.width!==field.width||p.height!==field.height||p.step!==field.step||p.origin.some((v,i)=>v!==field.origin[i]))throw new Error("自然地貌与高程网格不匹配");
    field.nature={placement:decodeSnowMask(p),lakes:[],mouths:region.mouths??[]};
    for(const lake of region.lakes??[]) {
      if(!lake.rings?.length||lake.rings.some(r=>r.length<4||r.some(v=>v.length!==2||!v.every(Number.isFinite))))throw new Error("湖泊轮廓损坏");
      const bounds=lakeBounds(lake.rings),samples=[];
      for(const [x,z]of lake.rings[0])for(const [dx,dz]of [[0,0],[.25,0],[-.25,0],[0,.25],[0,-.25]]) {
        if(field.maskAt(x+dx,z+dz)>200)samples.push(field.sample(x+dx,z+dz));
      }
      samples.sort((a,b)=>a-b);
      const level=samples.length?samples[Math.floor(samples.length*.40)]:0;
      const model={...lake,bounds,level};field.nature.lakes.push(model);
      const minX=Math.max(0,Math.floor((bounds.minX-field.origin[0])/field.step)),maxX=Math.min(field.width-1,Math.ceil((bounds.maxX-field.origin[0])/field.step));
      const minZ=Math.max(0,Math.floor((bounds.minZ-field.origin[1])/field.step)),maxZ=Math.min(field.height-1,Math.ceil((bounds.maxZ-field.origin[1])/field.step));
      for(let row=minZ;row<=maxZ;row++)for(let col=minX;col<=maxX;col++) {
        const x=field.origin[0]+col*field.step,z=field.origin[1]+row*field.step;
        if(insideLake(x,z,lake.rings)) {
          const i=row*field.width+col;field.heights[i]=Math.max(0,level-.035);field.nature.placement[i]=0;
        }
      }
    }
  }
}

function coverWeights(field,x,z) {
  const col=Math.round((x-field.origin[0])/field.step),row=Math.round((z-field.origin[1])/field.step);
  if(col<0||row<0||col>=field.width||row>=field.height)return [0,0,0,0];
  const bytes=field.nature?.cover;if(!bytes)return natureWeights(field,x,z);
  const i=(row*field.width+col)*4;return [bytes[i]/255,bytes[i+1]/255,bytes[i+2]/255,bytes[i+3]/255];
}

export function natureSites(field) {
  if(!field.nature||field.meta.region==="svalbard")return [];
  const sites=[],spacing=1.05;
  for(let row=Math.ceil(field.origin[1]/spacing);row*spacing<field.origin[1]+(field.height-1)*field.step;row++)
    for(let col=Math.ceil(field.origin[0]/spacing);col*spacing<field.origin[0]+(field.width-1)*field.step;col++) {
      const x=(col+.15+natureHash(col,row)*.7)*spacing,z=(row+.15+natureHash(row,col+13)*.7)*spacing;
      if(field.oilSites?.some(s=>Math.hypot(x-s.x,z-s.z)<s.radius*1.5))continue;
      const weights=coverWeights(field,x,z),kind=weights[0]>.22?"forest":weights[3]>.25?"shrub":null;
      if(!kind||natureHash(col+67,row-5)>(kind==="forest"?weights[0]*1.5:weights[3]))continue;
      const count=kind==="forest"?4+Math.floor(natureHash(col,row+9)*4):3;
      for(let n=0;n<count;n++) {
        const angle=n*2.399+col,extent=.13+Math.sqrt(n/count)*.36;
        const px=x+Math.cos(angle)*extent,pz=z+Math.sin(angle)*extent,w=coverWeights(field,px,pz);
        if((kind==="forest"?w[0]:w[3])<.15)continue;
        // Check crown extent as well as the trunk, preserving clear margins.
        if([[.22,0],[-.22,0],[0,.22],[0,-.22]].some(([dx,dz])=>!coverWeights(field,px+dx,pz+dz).some(v=>v>0)))continue;
        sites.push({x:px,z:pz,kind,scale:.78+natureHash(px,pz)*.42,rotation:natureHash(pz,px)*Math.PI*2});
      }
    }
  return sites;
}

export async function loadMapNature({signal,fetchImpl=fetch}={}) {
  const response=await fetchImpl(mapAssetUrl("./assets/data/map-nature.json"),{signal,cache:"default"});
  if(!response.ok)throw new Error("自然地貌资源读取失败");
  return response.json();
}
