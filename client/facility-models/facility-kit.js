import * as T from 'three';
import {ModelKit} from '../wonders/model-kit.js';
import {FACILITY_ART_VERSION} from '../../shared/config/facility-art.mjs';
export const PALETTE={airportTeam:['#256BA4',.55,.12],airportAsphalt:['#454E53',.98,0],airportLights:['#F4D187',.45,.05],stone:['#DAC7A0',.84,0],stoneDark:['#9E896B',.9,0],paving:['#BDB499',.94,0],white:['#EDEAD8',.65,0],cream:['#E8D9BB',.76,0],roof:['#395B70',.57,.12],clay:['#AC5941',.9,0],copper:['#4F887B',.55,.45],glass:['#327F99',.19,.20],water:['#279DAA',.2,.05],pool:['#54C5CA',.2,.04],grass:['#658B47',1,0],grassLight:['#82A451',1,0],foliage:['#3C7242',1,0],wood:['#805334',.9,0],iron:['#62787A',.4,.70],gold:['#D7B15E',.35,.65],dark:['#253B40',.85,0],red:['#BD4D3B',.67,0],navy:['#31516F',.73,0],teal:['#319EAD',.58,.04],skin:['#D69D71',.9,0],skinDark:['#8E5B41',.94,0],hair:['#423B30',1,0],khaki:['#B8B17E',1,0],olive:['#5F7B60',1,0],leather:['#70482C',.92,0],black:['#233035',.87,0],royal:['#235ABD',.66,.04],violet:['#6746A3',.73,.02],violetLight:['#9B7DC4',.8,0],orange:['#CA5A28',.86,0],ochre:['#DAA127',.73,.08],burgundy:['#863B45',.84,0],jade:['#216957',.72,.03],aqua:['#198F9A',.63,.07],naval:['#253F65',.72,.03],crimson:['#AC263D',.72,0],sand:['#D9C799',.91,0],slate:['#506475',.84,0]};
export class FacilityKit extends ModelKit{
 constructor(lod){super(lod,'facility');}
 material(key){const alias={'#77674C':'wood','#657F58':'foliage'};key=alias[key]??key;if(!PALETTE[key])throw new Error('Unknown facility material '+key);if(!this.materials.has(key)){const [color,roughness,metalness]=PALETTE[key];this.materials.set(key,new T.MeshStandardMaterial({color,roughness,metalness,name:key,userData:{surface:key,artVersion:FACILITY_ART_VERSION}}));}return this.materials.get(key);}
 finish(name){const model=super.finish(name);model.userData={...model.userData,style:'district-silhouette-v2',materialVersion:FACILITY_ART_VERSION};return model;}
}
// Foundations follow the functional footprint; they never reserve an empty upgrade lawn.
export function plate(k,points,{surface='paving',edge='stoneDark',y=0,h=.085,part='foundation'}={}){
 const shape=new T.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
 k.extrude(shape,h,edge,0,y,0,[-Math.PI/2,0,0],part);k.extrude(shape,.015,surface,0,y+h,0,[-Math.PI/2,0,0],part);
}
export function ovalBase(k,rx,rz,{surface='paving',edge='stoneDark',x=0,z=0}={}){k.disk(x,0,z,rx,rz,.085,edge,'foundation',k.detail(32,20,12));k.disk(x,.085,z,rx*.98,rz*.98,.014,surface,'foundation',k.detail(32,20,12));}
export function base(k,{round=false,unit='scout'}={}){
 if(!round)throw new Error('Facilities must author their own footprint.');
 if(unit==='expedition'){
  const pts=[[-.55,-.4],[.55,-.4],[.58,.17],[.34,.43],[0,.63],[-.34,.43],[-.58,.17]];
  plate(k,pts,{surface:'crimson',edge:'slate',h:.13});
  k.beam([-.46,.15,.11],[0,.15,.48],.025,'gold','base_chevron');k.beam([0,.15,.48],[.46,.15,.11],.025,'gold','base_chevron');
 }else{
  k.cyl(0,.067,0,.51,.56,.134,'leather','foundation',k.detail(16,12,8));k.cyl(0,.145,0,.52,.52,.023,'ochre','foundation',k.detail(16,12,8));k.cyl(0,.163,0,.48,.48,.014,'sand','foundation',k.detail(16,12,8));compass(k,0,.174,0,.39,'olive');
 }
}
export function compass(k,x,y,z,r=.25,c='violet'){
 k.ring(x,y,z,r,r,r*.88,r*.88,.007,c,'compass');
 for(let i=0;i<4;i++){const a=i*Math.PI/2,p=[x+Math.sin(a)*r*.84,y+.01,z+Math.cos(a)*r*.84],q=[x+Math.cos(a)*r*.19,y+.01,z-Math.sin(a)*r*.19],t=[x-Math.cos(a)*r*.19,y+.01,z+Math.sin(a)*r*.19];k.mesh([[x,y+.01,z],p,q,t],[[0,1,2],[0,3,1]],i%2?'gold':c,'compass');}
}
export function block(k,x,z,w,d,h,{y=.1,color='cream',roof='roof',part='core',flat=false,windows=true}={}){
 k.box(x,y+h/2,z,w,h,d,color,part);k.box(x,y+.028,z,w+.025,.055,d+.025,'stoneDark',part);
 k.box(x,y+h-.017,z,w+.026,.034,d+.026,'white',part);
 if(flat){k.box(x,y+h+.014,z,w+.035,.025,d+.035,roof,part+'_roof');}
 else{k.roof(x,y+h,z,w+.07,d+.075,Math.min(w,d)*.3,roof,part+'_roof');}
 if(windows){const rows=Math.max(1,Math.floor(h/.16)),cols=k.detail(Math.max(2,Math.floor(w/.13)),Math.max(2,Math.floor(w/.2)),2);for(let r=0;r<rows;r++)for(let i=0;i<cols;i++){const xx=x+((i+.5)/cols-.5)*w,yy=y+.09+r*(h-.06)/rows;k.box(xx,yy,z+d/2+.006,w/cols*.45,.065,.016,'glass',part+'_windows');if(k.lod<2)k.box(xx,yy,z-d/2-.006,w/cols*.45,.065,.016,'glass',part+'_windows');}}
}
export function flag(k,x,z,h=.5,color='red',y=.1,part='flags'){
 k.cyl(x,y+h/2,z,.009,.012,h,'iron',part,6);k.sphere(x,y+h+.012,z,.019,'gold',part);
 const vs=[[x,y+h-.035,z],[x+.21,y+h-.06,z+.035],[x+.24,y+h-.18,z-.015],[x,y+h-.155,z]];
 k.mesh(vs,[[0,1,2],[0,2,3],[2,1,0],[3,2,0]],color,part);
}
export function lamp(k,x,z,h=.6,y=.1){k.cyl(x,y+h/2,z,.012,.019,h,'iron','lighting',6);k.box(x,y+h,z,.15,.047,.065,'white','lighting');for(const dx of [-.043,.043])k.box(x+dx,y+h+.009,z+.034,.035,.025,.01,'glass','lighting');}
export function pitch(k,x,z,w,d,y=.105){
 const n=k.detail(8,6,4);for(let i=0;i<n;i++)k.box(x,y,z-d/2+d*(i+.5)/n,w,.016,d/n,i%2?'grass':'grassLight','pitch');
 for(const xx of [-w/2,w/2])k.box(x+xx,y+.011,z,.009,.004,d,'white','pitch_lines');for(const zz of [-d/2,0,d/2])k.box(x,y+.011,z+zz,w,.004,.009,'white','pitch_lines');k.ring(x,y+.01,z,w*.14,w*.14,w*.125,w*.125,.004,'white','pitch_lines');
 for(const sign of [-1,1]){const zz=z+sign*d/2;k.beam([x-w*.15,y,zz],[x-w*.15,y+.1,zz],.007,'white','goals');k.beam([x+w*.15,y,zz],[x+w*.15,y+.1,zz],.007,'white','goals');k.beam([x-w*.15,y+.1,zz],[x+w*.15,y+.1,zz],.007,'white','goals');if(k.lod<2)for(const dx of [-w*.15,0,w*.15])k.beam([x+dx,y+.1,zz],[x+dx,y+.012,zz+sign*.065],.003,'white','goals');}
}
export function dome(k,x,y,z,r,c,part='dome',sy=1){k.put(new T.SphereGeometry(r,k.detail(20,12,8),k.detail(8,5,3),0,Math.PI*2,0,Math.PI/2),c,x,y,z,null,[1,sy,1],part);k.ring(x,y,z,r*1.02,r*1.02,r*.94,r*.94,.027,'white',part);}
export function pergola(k,x,z,w,d,h=.32,part='pergola'){
 for(const xx of [-w/2,w/2])for(const zz of [-d/2,d/2])k.column(x+xx,.1,z+zz,.024,h,'stone');
 const n=k.detail(7,5,3);for(let i=0;i<n;i++)k.box(x-w/2+w*i/(n-1),.1+h,z,.023,.04,d+.06,'wood',part);
 for(const zz of [-d/2,d/2])k.box(x,.1+h-.02,z+zz,w+.05,.045,.022,'wood',part);
}
export function pool(k,x,z,w,d,y=.11){k.box(x,y,z,w,.025,d,'white','pool_edge');k.box(x,y+.015,z,w-.06,.012,d-.06,'pool','water');if(k.lod<2)for(let i=0;i<3;i++)k.box(x-w*.22+i*w*.2,y+.023,z,w*.075,.002,d*.6,'water','water');}
export function barrel(k,x,z,w,d,y,h,c='white',part='hall_roof'){
 const n=k.detail(16,10,6),vs=[],faces=[];for(let i=0;i<=n;i++){const a=Math.PI*i/n;for(const zz of [-d/2,d/2])vs.push([x+Math.cos(a)*w/2,y+Math.sin(a)*h,z+zz]);}
 for(let i=0;i<n;i++){let a=i*2;faces.push([a,a+2,a+1],[a+1,a+2,a+3],[a+1,a+2,a],[a+3,a+2,a+1]);}k.mesh(vs,faces,c,part);
 if(k.lod<2)for(const zz of [-d/2,d/2])for(let i=0;i<n;i++)k.beam(vs[i*2+(zz>0?1:0)],vs[(i+1)*2+(zz>0?1:0)],.009,'iron',part+'_ribs');
}
export function landscape(k,level){if(k.lod<2){k.tree(-.9,.096,-.83,.2);k.tree(.87,.096,-.83,.24);if(level>=2)k.tree(-.91,.096,.83,.21);if(level>=4)k.tree(.86,.096,.8,.21);}}
export {T};
