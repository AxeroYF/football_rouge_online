import * as T from 'three';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const smoothUnion=(a,b,r)=>{const h=clamp(.5+.5*(b-a)/r,0,1);return b+(a-b)*h-r*h*(1-h);};

// Sample the complete limb before assigning skin/cloth materials, so both sides
// of every material boundary retain the same positions and smooth normals.
export function smoothBodyLoft(k,knots,part,colorAt,{frontPower=1,steps=k.detail(72,44,28),sides=k.detail(32,22,14)}={}){
 const points=knots[0][1]>knots.at(-1)[1]?[...knots].reverse():knots;
 const curves=[0,1,2,3,4].map(c=>points.map(p=>p[c]));
 const sample=(c,t)=>{const a=t*(points.length-1),i=Math.min(points.length-2,Math.floor(a)),u=a-i,p0=curves[c][Math.max(0,i-1)],p1=curves[c][i],p2=curves[c][i+1],p3=curves[c][Math.min(points.length-1,i+2)];return .5*((2*p1)+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+(-p0+3*p1-3*p2+p3)*u*u*u);};
 const v=[],index=[];
 for(let i=0;i<=steps;i++){const t=i/steps,x=sample(0,t),y=sample(1,t),z=sample(2,t),rx=Math.max(.001,sample(3,t)),rz=Math.max(.001,sample(4,t));for(let j=0;j<sides;j++){const a=j/sides*Math.PI*2,c=Math.cos(a);v.push(x+Math.sin(a)*rx,y,z+Math.sign(c)*Math.abs(c)**frontPower*rz);}}
 for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides;index.push(a,b,a+sides,b,b+sides,a+sides);}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setIndex(index);g.computeVertexNormals();splitSurface(k,g,part,colorAt);g.dispose();
}

// The distance field joins shoulders into the torso and the shorts into the hips.
// This removes intersecting capped primitives and their dark joint seams.
export function sculptSurface(k,field,bounds,part,colorAt,cuts=[]){
 const step=k.detail(.018,.028,.043),[lo,hi]=bounds,n=lo.map((v,i)=>Math.ceil((hi[i]-v)/step)),delta=lo.map((v,i)=>(hi[i]-v)/n[i]);
 const ix=(x,y,z)=>(z*(n[1]+1)+y)*(n[0]+1)+x,values=new Float32Array((n[0]+1)*(n[1]+1)*(n[2]+1));
 for(let z=0;z<=n[2];z++)for(let y=0;y<=n[1];y++)for(let x=0;x<=n[0];x++)values[ix(x,y,z)]=field(lo[0]+x*delta[0],lo[1]+y*delta[1],lo[2]+z*delta[2]);
 const offsets=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]],vertices=[],normals=[];
 const grad=p=>{const e=.0007;return new T.Vector3(field(p[0]+e,p[1],p[2])-field(p[0]-e,p[1],p[2]),field(p[0],p[1]+e,p[2])-field(p[0],p[1]-e,p[2]),field(p[0],p[1],p[2]+e)-field(p[0],p[1],p[2]-e)).normalize().toArray();};
 const emit=(a,b,c)=>{const normal=grad(a),u=new T.Vector3(...b).sub(new T.Vector3(...a)),v=new T.Vector3(...c).sub(new T.Vector3(...a));if(u.cross(v).dot(new T.Vector3(...normal))<0)[b,c]=[c,b];vertices.push(...a,...b,...c);normals.push(...normal,...grad(b),...grad(c));};
 for(let z=0;z<n[2];z++)for(let y=0;y<n[1];y++)for(let x=0;x<n[0];x++){
  const d=offsets.map(o=>values[ix(x+o[0],y+o[1],z+o[2])]);if(d.every(v=>v>=0)||d.every(v=>v<0))continue;
  const p=offsets.map(o=>o.map((v,i)=>lo[i]+([x,y,z][i]+v)*delta[i]));
  const edge=(a,b)=>{const t=d[a]/(d[a]-d[b]);return p[a].map((v,i)=>v+(p[b][i]-v)*t);};
  for(const t of tetra){const inside=t.filter(i=>d[i]<0),outside=t.filter(i=>d[i]>=0);if(inside.length===1){const a=inside[0];emit(...outside.map(b=>edge(a,b)));}else if(inside.length===3){const a=outside[0];emit(...inside.map(b=>edge(a,b)));}else if(inside.length===2){const [a,b]=inside,[c,e]=outside,p0=edge(a,c),p1=edge(a,e),p2=edge(b,c),p3=edge(b,e);emit(p0,p1,p2);emit(p1,p3,p2);}}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));splitSurface(k,g,part,colorAt,cuts);g.dispose();
}
function clip(poly,x,keepAbove){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=keepAbove?a[0]>=x:a[0]<=x,ib=keepAbove?b[0]>=x:b[0]<=x;if(ia)out.push(a);if(ia!==ib){const t=(x-a[0])/(b[0]-a[0]);out.push(a.map((v,j)=>v+(b[j]-v)*t));}}return out;}
function splitSurface(k,g,part,colorAt,cuts=[]){
 const position=g.attributes.position,normal=g.attributes.normal,groups=new Map(),index=g.index?.array??Array.from({length:position.count},(_,i)=>i),slabs=[-Infinity,...cuts,Infinity];
 for(let t=0;t<index.length;t+=3){const tri=Array.from(index.slice(t,t+3),i=>[position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i)]);
  for(let s=0;s<slabs.length-1;s++){let p=tri;if(Number.isFinite(slabs[s]))p=clip(p,slabs[s],true);if(p.length<3)continue;if(Number.isFinite(slabs[s+1]))p=clip(p,slabs[s+1],false);if(p.length<3)continue;
   const center=[0,1,2].map(i=>p.reduce((v,a)=>v+a[i],0)/p.length),color=colorAt(...center);if(!groups.has(color))groups.set(color,{p:[],n:[]});const group=groups.get(color);
   for(let i=1;i<p.length-1;i++)for(const v of [p[0],p[i],p[i+1]]){group.p.push(...v.slice(0,3));const n=new T.Vector3(...v.slice(3)).normalize();group.n.push(n.x,n.y,n.z);}
  }
 }
 for(const [color,data] of groups){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(data.p,3));geo.setAttribute('normal',new T.Float32BufferAttribute(data.n,3));k.put(geo,color,0,0,0,null,null,part);geo.dispose();}
}
export function profileField(rings){
 const rows=[...rings].sort((a,b)=>a[0]-b[0]),min=rows[0][0],max=rows.at(-1)[0];
 return (x,y,z)=>{
  let i=0;while(i<rows.length-2&&y>rows[i+1][0])i++;
  const a=rows[i],b=rows[i+1],t=clamp((y-a[0])/(b[0]-a[0]),0,1),u=t*t*(3-2*t),rx=a[1]+(b[1]-a[1])*u,rz=a[2]+(b[2]-a[2])*u,cz=(a[3]??0)+((b[3]??0)-(a[3]??0))*u;
  return Math.max((Math.hypot(x/rx,(z-cz)/rz)-1)*Math.min(rx,rz),min-y,y-max);
 };
}
export function sleeveField(a,b,r0,r1,flat=.94){
 const d=b.map((v,i)=>v-a[i]),length2=d.reduce((s,v)=>s+v*v,0),length=Math.sqrt(length2);
 return (x,y,z)=>{const q=[x-a[0],y-a[1],(z-a[2])/flat],u=q.reduce((s,v,i)=>s+v*d[i],0)/length2,t=clamp(u,0,1),r=r0+(r1-r0)*t,rad=Math.hypot(...q.map((v,i)=>v-t*d[i]))-r;return Math.max(rad,(u-1)*length);};
}
