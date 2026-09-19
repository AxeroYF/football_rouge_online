import * as T from 'three';
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

// Shared indexed surfaces keep the sculpted planes continuous across joints.
export function surface(k,vertices,indices,color,part){
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices.flat(),3));g.setIndex(indices.flat());g.computeVertexNormals();k.put(g,color,0,0,0,null,null,part);g.dispose();
}
export function loft(k,rings,color,part,{sides=k.detail(24,16,10),frontPower=1}={}){
 const v=[],f=[];
 for(const [x,y,z,rx,rz] of rings)for(let j=0;j<sides;j++){const a=j/sides*Math.PI*2,c=Math.cos(a);v.push([x+Math.sin(a)*rx,y,z+Math.sign(c)*Math.pow(Math.abs(c),c>0?frontPower:1)*rz]);}
 for(let i=0;i<rings.length-1;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides;f.push([a,b,a+sides],[b,b+sides,a+sides]);}
 v.push(rings[0].slice(0,3),rings.at(-1).slice(0,3));const lo=v.length-2,hi=v.length-1;
 for(let j=0;j<sides;j++){f.push([lo,(j+1)%sides,j]);const a=(rings.length-1)*sides+j,b=(rings.length-1)*sides+(j+1)%sides;f.push([hi,a,b]);}
 surface(k,v,f,color,part);
}
export function ellipsoid(k,p,r,scale,c,part,rotation=null){const small=r*Math.max(...scale)<.024;const g=new T.SphereGeometry(r,small?k.detail(12,8,6):k.detail(24,16,10),small?k.detail(8,6,4):k.detail(16,10,6));k.put(g,c,...p,rotation,scale,part);g.dispose();}
export function limb(k,a,b,profile,c,part,flat=.90){
 const d=new T.Vector3(...b).sub(new T.Vector3(...a)),length=d.length(),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());
 const rings=profile.map(([t,r])=>[0,t*length,0,r,r*flat]);
 // Loft locally, then transform only the newly appended geometry.
 const key=part+'|'+c,start=k.parts.get(key)?.length??0;
 loft(k,rings,c,part,{sides:k.detail(18,12,8)});
 const mat=new T.Matrix4().compose(new T.Vector3(...a),q,new T.Vector3(1,1,1));
 for(const g of k.parts.get(key).slice(start))g.applyMatrix4(mat);
}
export function stroke(k,points,r,c,part){
 const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),g=new T.TubeGeometry(curve,k.detail(12,8,4),r,k.detail(6,5,4),false);k.put(g,c,0,0,0,null,null,part);g.dispose();
}
