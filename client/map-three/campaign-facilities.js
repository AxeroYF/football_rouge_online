import {airportTerritoryIdentity} from '../../shared/config/airport-identity.mjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facilitySites } from './facility-layout.js';
import { FACILITY_ART, FACILITY_ART_VERSION } from '../../shared/config/facility-art.mjs';
import { ribbonGeometry } from './atlas-ribbons.js';
import { RELIEF_SHEAR } from './relief-field.js';
import { buildingMarkerMarkup } from '../buildings/building-marker-controller.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class CampaignFacilities {
 constructor({scene,surface,element,metadata,features,coastlines,getState,onSelect,onChange}){
  Object.assign(this,{scene,surface,element,coastlines,getState,onSelect,onChange});
  this.metadata=new Map(metadata.map(t=>[t.territoryId,t]));this.features=new Map(features.map(f=>[f.properties.territoryId,f]));
  this.roads=new THREE.Group();this.roads.name='facility-paths';scene.add(this.roads);this.roadRevision=-1;
  this.cache=new Map();this.records=new Map();this.signature='';this.group=new THREE.Group();this.group.name='campaign-facilities';scene.add(this.group);
  this.overlay=document.createElement('div');this.overlay.className='facility-mesh-overlay';element.append(this.overlay);this.loader=new GLTFLoader();this.disposed=false;this.errors=[];
 }
 async prototype(type,level,teamColor){
  const assetKey=type+'-lv'+level,key=assetKey+(teamColor??'');if(this.cache.has(key))return this.cache.get(key);
  const pending=this.loader.loadAsync('/assets/facilities/models/lod1/'+assetKey+'.glb?v='+FACILITY_ART_VERSION).then(gltf=>{
   const geometries=[];gltf.scene.updateMatrixWorld(true);
   gltf.scene.traverse(o=>{if(!o.isMesh)return;
    if(type==='port'&&/foundation|wavelets/.test(o.name))return;
    let g=o.geometry.clone();if(g.index){const flat=g.toNonIndexed();g.dispose();g=flat;}g.applyMatrix4(o.matrixWorld);
    for(const name of Object.keys(g.attributes))if(!['position','normal'].includes(name))g.deleteAttribute(name);
    if(!g.attributes.normal)g.computeVertexNormals();
    const color=teamColor&&o.material.name==='airportTeam'?new THREE.Color(teamColor):o.material.color??new THREE.Color('#ffffff'),colors=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3)color.toArray(colors,i);g.setAttribute('color',new THREE.BufferAttribute(colors,3));geometries.push(g);
   });
   const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());
   gltf.scene.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();});
   return geometry;
  });this.cache.set(key,pending);return pending;
 }
 refresh(){
  const state=this.getState(),entries=Object.entries(state?.world?.territories??{}).filter(([,t])=>t.buildings?.length);
  const signature=JSON.stringify(entries.map(([id,t])=>[id,t.ownerId,state?.world?.players?.[t.ownerId]?.color,t.buildings.map(b=>[b.id,b.type,b.level,b.status,b.name,b.upgradeTo])]));
  if(signature===this.signature)return;this.signature=signature;
  const sites=entries.flatMap(([id,t])=>facilitySites(this.metadata.get(id),this.features.get(id),t.buildings,this.coastlines?.territories?.[id]?.coastlines??[]));
  this.sites=sites;this.surface.setFacilitySites?.(sites);this.buildPaths();
  const wanted=new Set(sites.map(s=>s.building.id));
  for(const [id,r]of this.records)if(!wanted.has(id)){r.mesh?.removeFromParent();r.mesh?.material.dispose();r.outline?.material.dispose();r.dom.remove();this.records.delete(id);}
  for(const site of sites){
   const b=site.building;if(!FACILITY_ART.some(f=>f.type===b.type))continue;
   let r=this.records.get(b.id);
   const teamColor=b.type==='airport'?airportTerritoryIdentity(state.world,site.territoryId).color:null;
   const key=b.type+':'+b.level+':'+teamColor;
   if(r&&r.key!==key){r.mesh?.removeFromParent();r.dom.remove();r.mesh?.material.dispose();r.outline?.material.dispose();this.records.delete(b.id);r=null;}
   if(r){r.site=site;this.label(r);continue;}
   const dom=document.createElement('div');dom.className='facility-mesh-hit';dom.hidden=true;this.overlay.append(dom);
   r={key,site,dom,loading:true};this.records.set(b.id,r);
   void this.prototype(b.type,Math.max(1,Math.min(5,b.level??1)),teamColor).then(geometry=>{
    if(this.disposed||this.records.get(b.id)!==r)return;
    r.mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,metalness:0}));
    r.mesh.castShadow=true;r.mesh.receiveShadow=true;
    r.outline=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#ffdf87',side:THREE.BackSide}));r.outline.scale.setScalar(1.04);r.outline.visible=false;r.mesh.add(r.outline);
    this.group.add(r.mesh);r.loading=false;this.label(r);this.onChange();
   }).catch(error=>{if(!this.disposed){this.errors.push(b.type+': '+error.message);r.failed=true;r.dom.remove();this.onChange();}});
  }
 }
 label(r){
  if(r.loading||r.failed)return;
  const state=this.getState(),site=r.site,b=site.building;
  const html=buildingMarkerMarkup({territoryId:site.territoryId,territoryLabel:this.metadata.get(site.territoryId)?.name,buildings:[b],catalog:state?.buildings?.catalog,scoutingTasks:state?.scouting?.tasks,trainingTasks:state?.training?.tasks,escapeHtml:esc});
  if(r.html===html)return;r.html=html;r.dom.innerHTML=html;
  const button=r.dom.querySelector('button');
  button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();this.onSelect({territoryId:site.territoryId,buildingId:b.id});});
  for(const event of ['pointerdown','dblclick','wheel'])r.dom.addEventListener(event,e=>e.stopPropagation());
  for(const event of ['pointerenter','focusin'])button.addEventListener(event,()=>{r.outline.visible=true;this.onChange();});
  for(const event of ['pointerleave','focusout'])button.addEventListener(event,()=>{r.outline.visible=false;this.onChange();});
 }
 hasTerritory(id){const found=[...this.records.values()].filter(r=>r.site.territoryId===id);return found.length>0&&found.every(r=>!r.loading&&!r.failed);}
 buildPaths(){
  for(const mesh of [...this.roads.children]){mesh.geometry.dispose();mesh.material.dispose();mesh.removeFromParent();}
  const groups=new Map();for(const s of this.sites??[]){if(s.coastal)continue;if(!groups.has(s.territoryId))groups.set(s.territoryId,[]);groups.get(s.territoryId).push(s);}
  for(const sites of groups.values())if(sites.length>1){const center={x:sites.reduce((n,s)=>n+s.x,0)/sites.length,z:sites.reduce((n,s)=>n+s.z,0)/sites.length},paths=sites.map(s=>[{x:s.x,z:s.z},center]);
   const geometry=ribbonGeometry(paths,sites[0].width*.048,{step:.08});geometry.userData.ground=geometry.attributes.position.array.slice();
   const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#b8a884',roughness:1,side:THREE.DoubleSide}));mesh.receiveShadow=true;mesh.renderOrder=5;this.roads.add(mesh);
  }this.roadRevision=-1;
 }
 update(view,camera,size,zoom){
  if(this.roadRevision!==this.surface.revision){this.roadRevision=this.surface.revision;for(const mesh of this.roads.children){const p=mesh.geometry.attributes.position,a=mesh.geometry.userData.ground;for(let i=0;i<p.count;i++){const x=a[i*3],z=a[i*3+2],h=this.surface.sample(x,z)+.04;p.setXYZ(i,x,this.surface.height+h,z+RELIEF_SHEAR*h);}p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();}}
  for(const r of this.records.values()){
   if(r.loading||r.failed)continue;const s=r.site;
   const visible=this.hasTerritory(s.territoryId)&&zoom>=3&&s.x>view.bounds.minX-3&&s.x<view.bounds.maxX+3&&s.z>view.bounds.minZ-3&&s.z<view.bounds.maxZ+3;
   r.mesh.visible=visible;r.dom.hidden=!visible;if(!visible)continue;
   const h=this.surface.sample(s.x,s.z)+.04;
   r.mesh.position.set(s.x,this.surface.height+h-s.width*.035,s.z+RELIEF_SHEAR*h);r.mesh.rotation.y=s.rotation;r.mesh.scale.setScalar(s.width);r.mesh.updateMatrixWorld(true);
   const center=new THREE.Vector3(s.x,this.surface.height+h+s.width*.20,s.z+RELIEF_SHEAR*h).project(camera);
   const naturalWidth=s.width*view.pixelsPerUnit*1.1,width=Math.max(20,naturalWidth),height=Math.max(22,width*.8);
   const siblings=(this.sites??[]).filter(t=>t.territoryId===s.territoryId),overview=naturalWidth<28;
   r.dom.hidden=overview&&siblings[0]?.building.id!==s.building.id;
   r.dom.classList.toggle('is-overview',overview);
   const label=r.dom.querySelector('.building-map-level');if(label)label.textContent=overview?(siblings.length>1?siblings.length+' 座':this.metadata.get(s.territoryId)?.name??'设施'):(s.building.status==='constructing'?'施工中':'LV.'+(s.building.level??1));
   r.dom.style.left=((center.x*.5+.5)*size.x)+'px';r.dom.style.top=((-center.y*.5+.5)*size.y)+'px';
   r.dom.style.width=width+'px';r.dom.style.height=height+'px';
  }
 }
 stats(){return {loaded:[...this.records.values()].filter(r=>!r.loading&&!r.failed).length,visible:[...this.records.values()].filter(r=>r.mesh?.visible).length,errors:this.errors};}
 dispose(){this.disposed=true;for(const mesh of this.roads.children){mesh.geometry.dispose();mesh.material.dispose();}this.roads.removeFromParent();for(const r of this.records.values()){r.mesh?.material.dispose();r.outline?.material.dispose();}for(const p of this.cache.values())p.then(g=>g.dispose()).catch(()=>{});this.group.removeFromParent();this.overlay.remove();}
}
