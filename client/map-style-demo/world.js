import {project} from '../map-three/projection.js';
export const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const noise=(x,z)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);};
export const SITES=[
{id:'main-stadium',name:'主体育场',x:-1.05,z:.0,width:2.5,rotation:.10,description:'蓝白看台沿场地展开，入口接入前庭，与周边训练和商业设施形成完整园区。'},
{id:'training-center',name:'训练中心',x:2.05,z:.30,width:1.9,rotation:-.15,description:'训练跑道与训练馆直接落在平原上，保留橙色识别色，并由步道连接球场。'},
{id:'club-shop',name:'俱乐部商店',x:.0,z:1.55,width:1.45,rotation:Math.PI,description:'商店面向园区广场，黄白雨棚、铺装和行道树共同组成入口商业街。'},
{id:'medical-center',name:'医疗中心',x:3.12,z:2.32,width:1.5,rotation:-.18,description:'十字楼体位于园区边缘，入口与独立通道连接，深绿屋顶保持低等级辨识度。'},
{id:'recovery-center',name:'体能恢复中心',x:-3.12,z:1.55,width:1.5,rotation:.5,description:'水院融入草地与树木，青蓝池水和圆形庭院形成安静的康复区域。'},
{id:'scout-center',name:'球探中心',x:-4.75,z:-.45,width:1.45,rotation:.2,description:'观测塔布置在园区外侧，朝向山谷，保留紫色轮廓与罗盘前庭。'},
{id:'port',name:'港口',x:-2.10,z:3.85,width:2.5,rotation:0,description:'港口沿海岸落位，仓库连向陆地，码头与泊船朝向水面，使用与地形一致的光照。'}
];
export function inside(x,z,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export function createWorld(data){
 const g=data.grid;
 const gridSample=(values,x,z)=>{let a=(x-g.origin[0])/g.step,b=(z-g.origin[1])/g.step;if(a<0||b<0||a>g.width-1||b>g.height-1)return 0;const ix=Math.min(g.width-2,Math.floor(a)),iz=Math.min(g.height-2,Math.floor(b)),fx=a-ix,fz=b-iz,i=iz*g.width+ix;return values[i]*(1-fx)*(1-fz)+values[i+1]*fx*(1-fz)+values[i+g.width]*(1-fx)*fz+values[i+g.width+1]*fx*fz;};
 const raw=(x,z)=>gridSample(g.elevations,x,z),alpha=(x,z)=>Math.min(1,gridSample(g.mask,x,z)/240);
 const relief=(x,z,enhanced=true)=>{
  const m=raw(x,z),a=alpha(x,z);if(a<.35)return -.65;
  let h=enhanced?.045+gridSample(g.heights,x,z)*1.65:gridSample(g.heights,x,z)+.035;
  if(enhanced){const ridge=(Math.sin(x*2.6+z*.8)*Math.sin(z*2.9-x*.4)+Math.sin(x*5.2+z*3.6)*.22)*.11;h+=ridge*smooth(500,1800,m);h=Math.min(7,h);}
  return -.65+(h+.65)*smooth(.35,.83,a);
 };
 const lakes=(data.lakes??[]).map(l=>{
 const flat=l.rings.flat(),xs=flat.map(p=>p[0]),zs=flat.map(p=>p[1]),shore=flat.map(p=>relief(...p)).sort((a,b)=>a-b);
 return {...l,box:[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)],level:Math.max(.06,shore[Math.floor(shore.length*.25)])};
});
 const lakeAt=(x,z)=>lakes.find(l=>x>=l.box[0]&&x<=l.box[2]&&z>=l.box[1]&&z<=l.box[3]&&inside(x,z,l.rings[0])&&!l.rings.slice(1).some(r=>inside(x,z,r)));
 const height=(x,z,enhanced=true)=>{
  let h=relief(x,z,enhanced);
  if(enhanced)for(const s of SITES){if(s.id==='port'){const r=Math.hypot(x-s.x,z-s.z)/s.width,blend=1-smooth(.45,.68,r);if(z<s.z+.1&&alpha(x,z)>.55)h=h*(1-blend)+.055*blend;continue;}const r=Math.hypot(x-s.x,z-s.z)/s.width;const flatten=1-smooth(.60,.88,r);if(flatten>0)h=h*(1-flatten)+relief(s.x,s.z,true)*flatten;}
  if(enhanced)for(const lake of lakes){
   const [a,b,c,d]=lake.box;if(x<a-.3||x>c+.3||z<b-.3||z>d+.3)continue;
   let distance=Infinity;for(const ring of lake.rings)for(let i=1;i<ring.length;i++){const p=ring[i-1],q=ring[i],dx=q[0]-p[0],dz=q[1]-p[1],t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[1])*dz)/(dx*dx+dz*dz||1)));distance=Math.min(distance,Math.hypot(x-p[0]-t*dx,z-p[1]-t*dz));}
   const submerged=inside(x,z,lake.rings[0])&&!lake.rings.slice(1).some(r=>inside(x,z,r));
   const blend=submerged?1:1-smooth(.09,.28,distance);h=h*(1-blend)+(lake.level-.025)*blend;
  }
  return h;
 };
 const faction=(x,z)=>{for(const t of data.territories)if(t.owner&&t.polygons.some(p=>inside(x,z,p[0])&&!p.slice(1).some(r=>inside(x,z,r))))return t.owner;return null;};
 const nearSite=(x,z,padding=.45)=>SITES.some(s=>Math.hypot(x-s.x,z-s.z)<s.width*.66+padding);
 const center=project(data.center.lng,data.center.lat);
 return {data,raw,alpha,height,relief,faction,nearSite,lakes,lakeAt,local:(lng,lat)=>{const p=project(lng,lat);return [p.x-center.x,p.z-center.z];}};
}
