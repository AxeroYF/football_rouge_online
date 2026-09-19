import * as THREE from "three";
import { MapEnvironment, environmentVisibility } from "./environment.js";
import { LAND_STENCIL_BIT } from "./settings.js";
import { ribbonGeometry, partitionRiverPaths } from "./atlas-ribbons.js";
import { intersectBounds } from "./projection.js";

export class AtlasEnvironment extends MapEnvironment {
  constructor(data,options={}) {
    // Retain authoritative snow masks without building the legacy river meshes.
    super({...data,regions:Object.fromEntries(Object.entries(data.regions).map(([id,region])=>[id,{...region,rivers:[]}]))},options);
    for(const region of Object.values(data.regions))for(const major of [true,false]) {
      const paths=region.rivers.filter(r=>(r.rank<=3)===major).map(r=>r.points.map(([x,z])=>({x,z})));
      const material=new THREE.MeshBasicMaterial({color:major?"#488b9a":"#609fa5",transparent:true,opacity:0,
        side:THREE.DoubleSide,forceSinglePass:true,depthWrite:false,toneMapped:false,
        stencilWrite:true,stencilRef:LAND_STENCIL_BIT,stencilFuncMask:LAND_STENCIL_BIT|8,stencilWriteMask:8,
        stencilFunc:THREE.EqualStencilFunc,stencilZPass:THREE.InvertStencilOp});
      material.onBeforeCompile=shader=>{
        shader.vertexShader="varying float vRiverWidth;\n"+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvRiverWidth = uv.y;");
        shader.fragmentShader="varying float vRiverWidth;\n"+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>",
          "#include <color_fragment>\nfloat bank=smoothstep(.65,1.0,abs(vRiverWidth*2.0-1.0));\ndiffuseColor.rgb*=mix(1.1,.70,bank);");
      };
      material.customProgramCacheKey=()=>"atlas-river-v1";
      let used=false;
      for(const [key,parts] of partitionRiverPaths(paths)) {
        const geometry=ribbonGeometry(parts,major ? .047 : .028,{step:.25});
        if(!geometry.index.count){geometry.dispose();continue;}
        const [x,z]=key.split(",").map(Number),mesh=new THREE.Mesh(geometry,material);
        mesh.position.y=.06;mesh.renderOrder=10;
        this.riverMeshes.push({mesh,major,bounds:{minX:x*16-.7,maxX:(x+1)*16+.7,minZ:z*16-.7,maxZ:(z+1)*16+.7}});
        this.group.add(mesh);used=true;
      }
      if(!used)material.dispose();
    }
    if(options.surface)this.setSurface(options.surface);
  }
  setRiversVisible(visible){super.setRiversVisible(visible);this.surface?.nature?.setRiversVisible(visible);}
  update(pixelsPerUnit,view) {
    const lod=environmentVisibility(pixelsPerUnit);
    for(const {mesh,major,bounds} of this.riverMeshes){
      mesh.material.opacity=major?Math.min(.92,lod.majorRiver+.1):lod.minorRiver;
      mesh.visible=mesh.material.opacity>.01&&(!this.surface?.isAreaVisible||this.surface.isAreaVisible(bounds))&&(!view||!!intersectBounds(bounds,view));
    }
  }
  dispose() {
    if(this.disposed)return;
    // Materials are shared by spatial batches; dispose each resource once.
    for(const material of new Set(this.riverMeshes.map(r=>r.mesh.material)))material.dispose();
    for(const {mesh} of this.riverMeshes)mesh.geometry.dispose();
    for(const {texture} of this.masks.values())texture.dispose();
    this.group.removeFromParent();this.group.clear();this.disposed=true;
  }
}
