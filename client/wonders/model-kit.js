import * as T from 'three';
import {wonderMaterial,WONDER_MATERIAL_VERSION} from './wonder-materials.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export class ModelKit {
  constructor(lod=0,assetId) {
    this.assetId=assetId;
    this.lod=lod; this.sides=[12,8,6][lod]; this.curve=[8,5,3][lod];
    this.parts=new Map(); this.materials=new Map();
  }
  detail(a,b,c) {return [a,b,c][this.lod];}
  material(color) {
    if(!this.materials.has(color)) this.materials.set(color,new T.MeshStandardMaterial(wonderMaterial(this.assetId,color)));
    return this.materials.get(color);
  }
  put(geo,color,x=0,y=0,z=0,rotation=null,scale=null,part='body') {
    const g=geo.clone();g.deleteAttribute('uv');
    const q=rotation instanceof T.Quaternion?rotation:new T.Quaternion().setFromEuler(new T.Euler(...(rotation??[0,0,0])));
    g.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x,y,z),q,new T.Vector3(...(scale??[1,1,1]))));
    const k=part+'|'+color;if(!this.parts.has(k))this.parts.set(k,[]);
    this.parts.get(k).push(g.index?g.toNonIndexed():g);return this;
  }
  box(x,y,z,w,h,d,c,part='body',ry=0) {return this.put(new T.BoxGeometry(w,h,d),c,x,y,z,[0,ry,0],null,part);}
  cyl(x,y,z,rt,rb,h,c,part='body',n=this.sides) {return this.put(new T.CylinderGeometry(rt,rb,h,n,1),c,x,y,z,null,null,part);}
  sphere(x,y,z,r,c,part='detail',scale=[1,1,1]) {return this.put(new T.SphereGeometry(r,this.sides,this.detail(6,4,3)),c,x,y,z,null,scale,part);}
  beam(a,b,r,c,part='body',n=4) {
    const d=new T.Vector3(...b).sub(new T.Vector3(...a)),mid=new T.Vector3(...a).add(new T.Vector3(...b)).multiplyScalar(.5);
    return this.put(new T.CylinderGeometry(r,r,d.length(),n,1),c,...mid.toArray(),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()),null,part);
  }
  mesh(vertices,faces,c,part='body') {
    const a=[];for(const f of faces)for(const i of f)a.push(...vertices[i]);
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a,3));g.computeVertexNormals();
    this.put(g,c,0,0,0,null,null,part);g.dispose();
  }
  roof(x,y,z,w,d,h,c,part='roof',ry=0) {
    const v=[[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],[-w*.28,h,0],[w*.28,h,0]];
    const m=new T.Matrix4().makeRotationY(ry);
    const points=v.map(a=>new T.Vector3(...a).applyMatrix4(m).add(new T.Vector3(x,y,z)).toArray());
    this.mesh(points,[[0,4,5],[0,5,1],[1,5,2],[2,5,4],[2,4,3],[3,4,0],[0,1,2],[0,2,3]],c,part);
  }
  pyramid(x,y,z,w,d,h,c,part='roof') {
    this.put(new T.ConeGeometry(1,h,4),c,x,y+h/2,z,[0,Math.PI/4,0],[w/Math.SQRT2,1,d/Math.SQRT2],part);
  }
  extrude(shape,depth,c,x,y,z,rotation=[0,0,0],part='body') {
    const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:this.curve,steps:1});
    this.put(g,c,x,y,z,rotation,null,part);g.dispose();
  }
  arch(x,y,z,w,h,depth,c,part='body',ry=0) {
    const r=w/2,t=w*.15,ri=r-t,cy=h-r;
    const s=new T.Shape();s.moveTo(-r,0);s.lineTo(-r,cy);
    s.absarc(0,cy,r,Math.PI,0,true);s.lineTo(r,0);s.lineTo(ri,0);s.lineTo(ri,cy);
    s.absarc(0,cy,ri,0,Math.PI,false);s.lineTo(-ri,0);s.closePath();
    const off=new T.Vector3(0,0,-depth/2).applyAxisAngle(new T.Vector3(0,1,0),ry);
    const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:this.detail(4,3,2),steps:1});this.put(g,c,x+off.x,y,z+off.z,[0,ry,0],null,part);g.dispose();
  }
  ring(x,y,z,rx,rz,ix,iz,h,c,part='body',power=2,range=null) {
    // Closed annular footprint; the hole remains a real opening in the exported mesh.
    const n=Math.max(rx,rz)<.35?this.detail(12,8,6):this.detail(32,20,12), point=(a,aX,aZ)=>[Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**(2/power)*aX,Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**(2/power)*aZ];
    if(range) {
      const vs=[],faces=[],[start,end]=range;
      for(let i=0;i<=n;i++){const a=start+(end-start)*i/n;const [ox,oz]=point(a,rx,rz),[xx,zz]=point(a,ix,iz);vs.push([x+ox,y,z+oz],[x+xx,y,z+zz],[x+ox,y+h,z+oz],[x+xx,y+h,z+zz]);}
      for(let i=0;i<n;i++){const a=i*4,b=a+4;faces.push([a,b,a+2],[b,b+2,a+2],[a+1,a+3,b+1],[b+1,a+3,b+3],[a+2,b+2,a+3],[b+2,b+3,a+3],[a,a+1,b],[b,a+1,b+1]);}
      faces.push([0,2,1],[1,2,3]);const e=n*4;faces.push([e,e+1,e+2],[e+1,e+3,e+2]);this.mesh(vs,faces.map(([a,b,c])=>[a,c,b]),c,part);return;
    }
    const s=new T.Shape(),hole=new T.Path();
    for(let i=0;i<=n;i++){const a=2*Math.PI*i/n,[aX,aZ]=point(a,rx,rz);i?s.lineTo(aX,aZ):s.moveTo(aX,aZ);}
    for(let i=0;i<=n;i++){const a=-2*Math.PI*i/n,[aX,aZ]=point(a,ix,iz);i?hole.lineTo(aX,aZ):hole.moveTo(aX,aZ);}
    s.holes.push(hole);this.extrude(s,h,c,x,y,z,[-Math.PI/2,0,0],part);
  }
  disk(x,y,z,rx,rz,h,c,part='base',n=this.sides) {this.put(new T.CylinderGeometry(1,1,h,n),c,x,y+h/2,z,null,[rx,1,rz],part);}
  column(x,y,z,r,h,c) {
    this.cyl(x,y+h/2,z,r*.84,r,h,c,'body',r<.025?this.detail(6,5,4):this.sides);
    if(this.lod<2 && h>.2){this.cyl(x,y+.02,z,r*1.25,r*1.25,.04,c);this.cyl(x,y+h-.02,z,r*1.25,r*1.25,.04,c);}
  }
  facade(x,y,z,w,h,c,rows=2,ry=0) {
    const n=this.detail(7,5,3),rot=new T.Matrix4().makeRotationY(ry);
    for(let r=0;r<rows;r++)for(let i=0;i<n;i++){
      const p=new T.Vector3((i-(n-1)/2)*w/n,y+(r+.5)*h/rows,0).applyMatrix4(rot).add(new T.Vector3(x,0,z));
      this.box(p.x,p.y,p.z,w/n*.32,h/rows*.43,.013,c,'detail',ry);
    }
  }
  stairs(x,y,z,w,d,h,c,part='base') {
    const n=this.detail(6,4,3);
    for(let i=0;i<n;i++)this.box(x,y+h*(i+.5)/n,z-d/2+d*(i+.5)/n,w,h/n,d*(1-i/n),c,part);
  }
  tree(x,y,z,h=.18) {this.cyl(x,y+h*.3,z,.012,.015,h*.6,'#77674C','landscape',5);this.put(new T.IcosahedronGeometry(1,0),'#657F58',x,y+h*.7,z,null,[h*.35,h*.48,h*.35],'landscape');}
  hill(x,z,w,d,h,c='#8B8F79') {
    // Irregular but deterministic low-poly rock, with a flat, stable footprint.
    const n=9,vs=[[x,h,z]],faces=[];
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2;vs.push([x+Math.cos(a)*w*.32,h*(.45+.12*Math.sin(i*3)),z+Math.sin(a)*d*.32]);}
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2;vs.push([x+Math.cos(a)*w*.5,0,z+Math.sin(a)*d*.5]);}
    vs.push([x,0,z]);const bottom=vs.length-1;
    for(let i=0;i<n;i++){const a=1+i,b=1+(i+1)%n,A=a+n,B=b+n;faces.push([0,b,a],[a,b,B],[a,B,A],[A,B,bottom]);}
    this.mesh(vs,faces,c,'base');
  }
  finish(name) {
    const root=new T.Group();root.name=name;const groups=new Map();
    for(const [key,geos] of this.parts){const [part,color]=key.split('|');let group=groups.get(part);if(!group){group=new T.Group();group.name=part;groups.set(part,group);root.add(group);}
      const merged=mergeGeometries(geos);const g=mergeVertices(merged,1e-5);merged.dispose();geos.forEach(a=>a.dispose());
      g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,this.material(color));mesh.name=part+'_'+color.replace('#','');mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    }
    root.updateMatrixWorld(true);let box=new T.Box3().setFromObject(root);const size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
    const s=1/Math.max(size.x,size.z);root.position.set(-center.x*s,-box.min.y*s,-center.z*s);root.scale.setScalar(s);root.updateMatrixWorld(true);
    root.userData={assetId:name,lod:this.lod,style:'stylized-landmark-color-v2',materialVersion:WONDER_MATERIAL_VERSION,units:'normalized footprint',front:'+Z'};
    return root;
  }
}



