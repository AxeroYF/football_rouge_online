import * as THREE from 'three';
import { ribbonGeometry } from './atlas-ribbons.js';
import { RELIEF_SHEAR } from './relief-field.js';
export function politicalEdges(arcs,states){
 return arcs.map(arc=>{
  const owners=[...new Set(arc.ids.map(id=>{const t=states[id];return t?.ownerType==='player'?'player:'+t.ownerId:t?.ownerType==='club'?'club:'+t.ownerId:null;}).filter(Boolean))];
  const inner=arc.ids.length>1&&arc.ids.every(id=>{const t=states[id];return t&&owners.includes(t.ownerType+':'+t.ownerId);})&&owners.length===1;
  return {...arc,owners:inner?[]:owners};
 }).filter(a=>a.owners.length);
}
export class CampaignBorders {
 constructor({scene,surface,arcs=[]}){this.scene=scene;this.surface=surface;this.arcs=arcs;this.group=new THREE.Group();this.group.name='political-frontiers';scene.add(this.group);this.signature='';}
 clear(){for(const c of [...this.group.children]){c.geometry.dispose();c.material.dispose();c.removeFromParent();}}
 update(state,pixels){
  const territories=state?.world?.territories??{},signature=JSON.stringify([Object.entries(territories).filter(([,t])=>['player','club'].includes(t.ownerType)).map(([id,t])=>[id,t.ownerType,t.ownerId]),state?.world?.players,Math.round(Math.log2(pixels)*2),this.surface.revision,this.surface.visibility?.value]);
  if(signature===this.signature)return;this.signature=signature;this.clear();
  const groups=new Map();
  for(const edge of politicalEdges(this.arcs,territories))for(const owner of edge.owners){if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(edge.points.map(([x,z])=>({x,z})));}
  for(const [owner,paths]of groups){
   const player=owner.startsWith('player:'),color=player?state.world.players?.[owner.slice(7)]?.color??'#d6bc67':'#c9aa62';
   for(const [mult,tint,opacity]of [[3.0,color,.16],[1.35,'#fff1c6',player?.92:.55],[.56,color,1]]){
    const geometry=ribbonGeometry(paths,Math.min(.22,Math.max(.008,1.2/pixels))*mult,{step:.15,tolerance:.015}),p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),h=this.surface.sample(x,z)+.075;p.setXYZ(i,x,this.surface.height+h,z+RELIEF_SHEAR*h);}
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:tint,transparent:opacity<1,opacity,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1}));
    mesh.renderOrder=7;this.group.add(mesh);
   }
  }
 }
 dispose(){this.clear();this.group.removeFromParent();}
}
