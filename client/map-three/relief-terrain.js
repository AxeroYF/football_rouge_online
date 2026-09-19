import * as THREE from "three";
import { LAND_STENCIL_BIT, MAP_THREE_LAND, MAP_THREE_SETTINGS } from "./settings.js";
import { RELIEF_SHEAR, sampleRelief, subdivideReliefPath } from "./relief-field.js";
import { intersectBounds } from "./projection.js";

const CHUNK_CELLS = 32;
const SURFACE_OFFSET = 0.025;
const low = new THREE.Color(MAP_THREE_LAND.flat);
const mid = new THREE.Color("#52634a");
const high = new THREE.Color("#aaa18b");

export function createReliefMaterial(visibility, mask) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, alphaMap: mask, alphaTest: .12,
    stencilWrite: true, stencilRef: LAND_STENCIL_BIT, stencilFuncMask: LAND_STENCIL_BIT,
    stencilWriteMask: 0, stencilFunc: THREE.EqualStencilFunc,
  });
  material.userData.reliefSurface = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.reliefVisible = visibility;
    shader.uniforms.reliefFlat = {value:new THREE.Color(MAP_THREE_LAND.flat)};
    shader.fragmentShader = "uniform float reliefVisible;\nuniform vec3 reliefFlat;\n"+shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.rgb = mix(reliefFlat,diffuseColor.rgb,reliefVisible);");
    // The old strong hemisphere fill washed out relief normals. Reduce fill on
    // this terrain material only; the ocean and classic/soft lighting stay intact.
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>",
      "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= mix(1.0,0.38,reliefVisible);");
  };
  material.customProgramCacheKey = () => "cartographic-relief-material-v1";
  return material;
}

export function createReliefChunk(field, x0, z0, cells = CHUNK_CELLS) {
  const nx=Math.min(cells,field.width-1-x0), nz=Math.min(cells,field.height-1-z0);
  const indices=[];
  for(let z=0;z<nz;z++) for(let x=0;x<nx;x++) {
    const source=(z0+z)*field.width+x0+x;
    if(Math.max(field.mask[source],field.mask[source+1],field.mask[source+field.width],field.mask[source+field.width+1])<=32) continue;
    const a=z*(nx+1)+x,b=a+1,c=a+nx+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  if(!indices.length) return null;
  const count=(nx+1)*(nz+1), positions=new Float32Array(count*3), normals=new Float32Array(count*3);
  const colors=new Float32Array(count*3), uv=new Float32Array(count*2), mapPositions=new Float32Array(count*2);
  const heights=new Float32Array(count);
  for(let z=0;z<=nz;z++) for(let x=0;x<=nx;x++) {
    const i=z*(nx+1)+x, col=x0+x,row=z0+z, source=row*field.width+col;
    const wx=field.origin[0]+col*field.step,wz=field.origin[1]+row*field.step;
    const h=Math.fround(field.heights[source]+SURFACE_OFFSET);
    positions.set([wx,h,wz+RELIEF_SHEAR*h],i*3);
    normals.set(field.normal(col,row),i*3);
    mapPositions.set([wx,wz],i*2);
    uv.set([(col+.5)/field.width,(row+.5)/field.height],i*2);
    heights[i]=h;
    const metres=field.elevations[source];
    const t=THREE.MathUtils.clamp(metres/1800,0,1), s=THREE.MathUtils.clamp((metres-1800)/2600,0,1);
    for(const [channel,key] of [[0,"r"],[1,"g"],[2,"b"]]) colors[i*3+channel]=(low[key]*(1-t)+mid[key]*t)*(1-s)+high[key]*s;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  geometry.setAttribute("normal",new THREE.BufferAttribute(normals,3));
  geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  geometry.setAttribute("uv",new THREE.BufferAttribute(uv,2));
  geometry.setAttribute("reliefMapPosition",new THREE.BufferAttribute(mapPositions,2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.userData.reliefHeights=heights;
  geometry.userData.reliefNormals=normals.slice();
  return {geometry,bounds:{minX:field.origin[0]+x0*field.step,maxX:field.origin[0]+(x0+nx)*field.step,
    minZ:field.origin[1]+z0*field.step,maxZ:field.origin[1]+(z0+nz)*field.step}};
}

export function setChunkRelief(geometry,enabled) {
  const position=geometry.attributes.position,normal=geometry.attributes.normal,map=geometry.attributes.reliefMapPosition;
  for(let i=0;i<position.count;i++) {
    const height=enabled?geometry.userData.reliefHeights[i]:SURFACE_OFFSET;
    position.setXYZ(i,map.getX(i),height,map.getY(i)+RELIEF_SHEAR*height);
    if(enabled) normal.setXYZ(i,...geometry.userData.reliefNormals.subarray(i*3,i*3+3));
    else normal.setXYZ(i,0,1,0);
  }
  position.needsUpdate=normal.needsUpdate=true;
  geometry.computeBoundingSphere();
}

export function drapeReliefLines(geometry,sample,offset=0) {
  if(!geometry.userData.mapLinePositions) {
    const p=geometry.attributes.position, points=[];
    for(let i=0;i<p.count;i+=2) {
      const path=subdivideReliefPath([{x:p.getX(i),z:p.getZ(i)},{x:p.getX(i+1),z:p.getZ(i+1)}]);
      for(let j=1;j<path.length;j++) points.push(path[j-1].x,path[j-1].z,path[j].x,path[j].z);
    }
    geometry.userData.mapLinePositions=new Float32Array(points);
  }
  const source=geometry.userData.mapLinePositions, positions=new Float32Array(source.length/2*3);
  for(let i=0;i<source.length;i+=2) {
    const x=source[i],z=source[i+1],h=sample(x,z);
    positions.set([x,h,z+RELIEF_SHEAR*(h+offset)],i/2*3);
  }
  geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  geometry.computeBoundingSphere();
}

export class ReliefTerrain {
  constructor(scene,fields,{onChange=()=>{}}={}) {
    this.scene=scene;this.fields=fields;this.onChange=onChange;this.chunks=[];this.materials=[];this.masks=[];
    this.visibility={value:1};this.height=MAP_THREE_SETTINGS.thickness;this.disposed=false;
    this.depthMaterials=[];this.view=null;
  }
  async build(signal) {
    try {
      for(const field of this.fields) {
        const maskData=new Uint8Array(field.mask.length*2);
        for(let i=0;i<field.mask.length;i++) maskData[i*2]=maskData[i*2+1]=field.mask[i];
        const mask=new THREE.DataTexture(maskData,field.width,field.height,THREE.RGFormat);
        mask.minFilter=mask.magFilter=THREE.LinearFilter;mask.generateMipmaps=false;mask.unpackAlignment=1;mask.needsUpdate=true;
        this.masks.push(mask);
        const material=createReliefMaterial(this.visibility,mask);
        const depth=new THREE.MeshDepthMaterial({alphaMap:mask,alphaTest:.12,depthPacking:THREE.RGBADepthPacking});
        this.materials.push({region:field.meta.region,material});this.depthMaterials.push(depth);
        for(let z=0;z<field.height-1;z+=CHUNK_CELLS) {
          if(this.disposed||signal?.aborted) throw new Error("立体地形加载已取消");
          for(let x=0;x<field.width-1;x+=CHUNK_CELLS) {
            const chunk=createReliefChunk(field,x,z);
            if(!chunk) continue;
            const mesh=new THREE.Mesh(chunk.geometry,material);
            mesh.position.y=this.height;mesh.renderOrder=3;mesh.castShadow=!!this.visibility.value;mesh.receiveShadow=true;
            if(!this.visibility.value)setChunkRelief(chunk.geometry,false);
            mesh.customDepthMaterial=depth;
            this.scene.add(mesh);this.chunks.push({...chunk,mesh});
          }
          await new Promise((resolve)=>setTimeout(resolve,0));
        }
      }
      this.onChange(this.stats());
      return this;
    } catch(error) {this.dispose();throw error;}
  }
  sample(x,z) {return this.visibility.value?sampleRelief(this.fields,x,z):0;}
  update(view) {
    this.view=view;
    // A disabled colour draw can still be an offscreen mountain casting into
    // the view. Keep a bounded shadow margin around the map footprint.
    const extended={minX:view.minX-8,maxX:view.maxX+8,minZ:view.minZ-8,maxZ:view.maxZ+8};
    let changed=false;
    for(const chunk of this.chunks) {
      const visible=!!intersectBounds(chunk.bounds,extended);
      if(chunk.mesh.visible!==visible) {chunk.mesh.visible=visible;changed=true;}
    }
    if(changed)this.onChange(this.stats());
  }
  setThickness(height) {this.height=height;for(const chunk of this.chunks) chunk.mesh.position.y=height;}
  setTerrainVisible(visible) {
    const value=visible?1:0;
    if(this.visibility.value===value)return;
    this.visibility.value=value;
    for(const chunk of this.chunks){setChunkRelief(chunk.geometry,!!value);chunk.mesh.castShadow=!!value;}
    this.onChange(this.stats());
  }
  setEnvironment(environment) {for(const {region,material} of this.materials) environment.applyTo(material,region);}
  pick(raycaster) {
    for(const hit of raycaster.intersectObjects(this.chunks.filter((chunk)=>chunk.mesh.visible).map((chunk)=>chunk.mesh),false)) {
      const point={x:hit.point.x,z:hit.point.z-RELIEF_SHEAR*(hit.point.y-this.height)};
      if (this.fields.some((field)=>field.maskAt(point.x,point.z)>32)) return point;
    }
    return null;
  }
  stats() {
    const visible=this.chunks.filter((chunk)=>chunk.mesh.visible).length;
    return {loaded:visible,total:visible,cached:this.chunks.length,active:0,failed:0,zoom:"立体",
      triangles:this.chunks.reduce((sum,chunk)=>sum+chunk.geometry.index.count/3,0)};
  }
  retry() {this.onChange(this.stats());}
  dispose() {
    if(this.disposed)return;this.disposed=true;
    for(const {mesh,geometry} of this.chunks){mesh.removeFromParent();geometry.dispose();}
    for(const {material} of this.materials)material.dispose();
    for(const material of this.depthMaterials)material.dispose();
    for(const mask of this.masks)mask.dispose();
    this.chunks=[];this.materials=[];this.depthMaterials=[];this.masks=[];this.fields=[];
  }
}
