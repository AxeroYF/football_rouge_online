import {PLAYER_MAP_COLORS} from '../../shared/config/map.mjs';
import {applyAirportIdentity} from './airport-identity.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const $=s=>document.querySelector(s),canvas=$('#wonder-canvas'),host=$('#viewer'),loading=$('#loading');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.84;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color('#f8f7f0');
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,50);
const ambient=new THREE.HemisphereLight('#f5f9ff','#889271',1.05);scene.add(ambient);
const sun=new THREE.DirectionalLight('#fff3de',2.2);sun.position.set(-3,5,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-3,right:3,top:4,bottom:-2,near:.1,far:15});sun.shadow.bias=-.0004;sun.shadow.normalBias=.014;scene.add(sun);
const fill=new THREE.DirectionalLight('#d1e4ff',.55);fill.position.set(4,2,-3);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({opacity:.13}));floor.rotation.x=-Math.PI/2;floor.position.y=-.008;floor.receiveShadow=true;scene.add(floor);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.enablePan=false;controls.minZoom=.6;controls.maxZoom=3.5;controls.maxPolarAngle=Math.PI*.49;controls.addEventListener('change',()=>renderer.render(scene,camera));
let current=null,currentItem=null,lod=0,token=0,view='iso',fitSize=1,targetY=.4;const loader=new GLTFLoader();
const response=await fetch('./assets/facilities/catalog.json',{cache:'no-cache'});if(!response.ok)throw new Error('无法读取模型清单');const catalog=await response.json();
const byId=new Map(catalog.items.map(i=>[i.assetId,i]));
let airportOptions={clubName:'蓝港竞技',territoryName:'里斯本',playerColor:PLAYER_MAP_COLORS[1],playerId:'preview-owner'};
function updateAirportIdentity(options={}){
  airportOptions={...airportOptions,...options};
  $('#airport-club').value=airportOptions.clubName;$('#airport-place').value=airportOptions.territoryName;$('#airport-color').value=airportOptions.playerColor;
  if(currentItem?.type==='airport'&&current){const world={territories:{preview:{ownerType:'player',ownerId:airportOptions.playerId}},players:{[airportOptions.playerId]:{teamName:airportOptions.clubName,color:airportOptions.playerColor}}};const identity=applyAirportIdentity(current,{world,territoryId:'preview',territoryName:airportOptions.territoryName});$('#model-name').textContent=identity.name;renderer.render(scene,camera);return identity;}
}
for(const color of PLAYER_MAP_COLORS){const b=document.createElement('button');b.type='button';b.dataset.airportMapColor=color;b.style.background=color;b.title='模拟领土颜色 '+color;b.setAttribute('aria-label',b.title);b.addEventListener('click',()=>updateAirportIdentity({playerColor:color}));$('#airport-map-colors').append(b);}
for(const [selector,key]of [['#airport-club','clubName'],['#airport-place','territoryName'],['#airport-color','playerColor']])$(selector).addEventListener('input',e=>updateAirportIdentity({[key]:e.target.value}));
$('.collection-total').textContent=catalog.items.length;
$('.count').textContent=`${new Set(catalog.items.filter(i=>i.kind==='facility').map(i=>i.type)).size} 类设施（油井与机场单等级，其余五级） · ${catalog.items.filter(i=>i.kind==='unit').length} 种单位`;
for(const [kind,count]of Object.entries({airport:catalog.items.filter(i=>i.type==='airport').length,all:catalog.items.length,basic:catalog.items.filter(i=>i.kind==='facility'&&i.level<=2).length,facility:catalog.facilities,unit:catalog.units,planned:catalog.items.filter(i=>i.newFacility).length}))document.querySelector(`[data-kind="${kind}"] span`).textContent=count;

function destroy(root){const mats=new Set();root.traverse(o=>{if(o.isMesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m));}});mats.forEach(m=>{m.map?.dispose();m.dispose();});}
function frame(width,height,preset=view){
  const aspect=width/height,extent=fitSize*.75;camera.left=-extent*aspect;camera.right=extent*aspect;camera.top=extent;camera.bottom=-extent;camera.zoom=1;
  if(preset==='front')camera.position.set(0,targetY+.03,5);
  else if(preset==='top')camera.position.set(.001,5,.001);
  else camera.position.set(3.8,targetY+5.3,4.6);
  camera.lookAt(0,targetY,0);controls.target.set(0,targetY,0);camera.updateProjectionMatrix();controls.update();
}
function resize(){const {width,height}=host.getBoundingClientRect();renderer.setSize(Math.max(1,width),Math.max(1,height),false);if(current)frame(width,height);renderer.render(scene,camera);}
new ResizeObserver(resize).observe(host);
async function select(id,{level=lod,preset=view,updateUI=true}={}){
  const mine=++token,item=byId.get(id);if(!item)throw new Error('Unknown model '+id);loading.hidden=false;
  try{
    const gltf=await loader.loadAsync(item.files[level].url+'?v='+item.files[level].sha256);if(mine!==token){destroy(gltf.scene);return false;}
    if(current){scene.remove(current);destroy(current);}
    const wrapper=new THREE.Group();wrapper.add(gltf.scene);wrapper.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(wrapper),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    wrapper.position.set(-center.x,-box.min.y,-center.z);wrapper.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.material.wireframe=$('#wireframe').checked;}});
    current=wrapper;scene.add(wrapper);currentItem=item;lod=level;view=preset;targetY=size.y*.43;fitSize=Math.max(size.y*1.12,Math.hypot(size.x,size.z)*.88);
    if(updateUI){
      $('#selected-id').textContent=item.assetId.toUpperCase();$('.edition i').textContent=(catalog.items.indexOf(item)+1)+' / '+catalog.items.length;
      $('#location').textContent=item.kind==='facility'?'FACILITY · LEVEL '+item.level:'MAP UNIT';$('#model-name').textContent=item.name+(item.level?' · LV'+item.level:'');$('#signature').textContent=item.signature;$('#level-change').textContent=item.change+(item.planned?' · 美术方案，尚未接入游戏':item.type==='oil-well'?' · 每小时开采石油，不可升级':item.newFacility?' · 已接入地形与邻接产出':'');levelStrip(item);
      $('#swatches').replaceChildren(...item.palette.map(c=>{const a=document.createElement('span');a.className='swatch';a.style.background=c;a.title=c;return a;}));
      $('#triangle-count').textContent=item.levels[level].triangles.toLocaleString()+' 三角面';$('#download').href=item.files[level].url+'?v='+item.files[level].sha256;$('#download').download=item.assetId+'.glb';$('#lod').value=String(level);
      for(const card of document.querySelectorAll('.model-card'))card.classList.toggle('selected',card.dataset.assetId===id);
    }
    $('#airport-identity').hidden=item.type!=='airport';if(item.type==='airport')updateAirportIdentity();
    resize();loading.hidden=true;return true;
  }catch(e){loading.textContent='模型读取失败：'+e.message;loading.hidden=false;throw e;}
}
function levelStrip(item){const strip=$('#level-strip');strip.replaceChildren();if(item.kind!=='facility')return;for(const next of catalog.items.filter(i=>i.type===item.type)){const button=document.createElement('button');button.type='button';button.textContent=catalog.items.filter(i=>i.type===item.type).length===1?'单等级':'LV'+next.level;button.dataset.level=String(next.level);button.classList.toggle('selected',item.level===next.level);button.title=next.change;button.addEventListener('click',()=>select(next.assetId).catch(console.error));strip.append(button);}}
function grid(kind='all'){
 const frag=document.createDocumentFragment(),items=catalog.items.filter(i=>kind==='all'||(kind==='airport'?i.type==='airport':kind==='planned'?i.newFacility:(kind==='basic'?i.kind==='facility'&&i.level<=2:i.kind===kind))),types=[...new Set(items.map(i=>i.kind==='unit'?'units':i.type))];
 for(const type of types){const groupItems=items.filter(i=>type==='units'?i.kind==='unit':i.type===type),section=document.createElement('section');section.className='model-family';const heading=document.createElement('h3');heading.textContent=type==='units'?'地图单位':groupItems[0].name;const row=document.createElement('div');row.className='family-levels';
 for(const item of groupItems){const card=document.createElement('button');card.className='model-card';card.dataset.assetId=item.assetId;card.title=item.name+(item.level?' LV'+item.level:'')+' · '+item.change;const img=document.createElement('img');if(!new URLSearchParams(location.search).has('render'))img.src=item.thumbnail+'?v='+catalog.version;img.alt=item.name+(item.level?' LV'+item.level:'');img.loading='lazy';const num=document.createElement('span');num.className='number';num.textContent=item.level?'LV '+item.level:'UNIT';const cap=document.createElement('span');cap.className='caption';const name=document.createElement('strong');name.textContent=item.type==='airport'?'俱乐部机场 · 单等级':item.level?['基础站点','配套扩建','完整院区','专业升级','旗舰地标'][item.level-1]:item.name;const note=document.createElement('small');note.textContent=item.change;cap.append(name,note);card.append(img,num,cap);card.classList.toggle('selected',currentItem?.assetId===item.assetId);card.addEventListener('click',()=>select(item.assetId).catch(console.error));row.append(card);}section.append(heading,row);frag.append(section);}
 $('#model-grid').replaceChildren(frag);$('#model-grid').classList.toggle('basic-comparison',kind==='basic');
}
for(const button of document.querySelectorAll('[data-kind]'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('[data-kind]'))b.classList.toggle('selected',b===button);grid(button.dataset.kind);});
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{view=button.dataset.view;for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b===button);resize();});
$('#lod').addEventListener('change',()=>select(currentItem.assetId,{level:Number($('#lod').value)}).catch(console.error));
$('#wireframe').addEventListener('change',()=>{current?.traverse(o=>{if(o.isMesh)o.material.wireframe=$('#wireframe').checked;});renderer.render(scene,camera);});
$('#reset').addEventListener('click',()=>{view='iso';for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b.dataset.view==='iso');resize();});
window.facilityPreview={
  catalog,select,setAirportIdentity:updateAirportIdentity,
  get state(){return {assetId:currentItem?.assetId,lod,view,materialVersion:catalog.version,airportIdentity:current?.userData.airportIdentity??null,renderer:renderer.info.render};},
  async capture(id,{level=0,preset='iso',size=512,transparent=false}={}){
    await select(id,{level,preset,updateUI:false});renderer.setPixelRatio(1);renderer.setSize(size,size,false);frame(size,size,preset);
    const background=scene.background;scene.background=transparent?null:new THREE.Color('#f8f7f0');renderer.setClearAlpha(transparent?0:1);renderer.render(scene,camera);
    const png=canvas.toDataURL('image/png');scene.background=background;renderer.setPixelRatio(Math.min(devicePixelRatio,2));resize();return png;
  }
};
const params=new URLSearchParams(location.search),initialKind=['basic','planned','airport'].includes(params.get('filter'))?params.get('filter'):'all';grid(initialKind);for(const b of document.querySelectorAll('[data-kind]'))b.classList.toggle('selected',b.dataset.kind===initialKind);await select(params.get('model')||'main-stadium-lv1');
window.facilityPreview.ready=true;


