import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const $=s=>document.querySelector(s),canvas=$('#wonder-canvas'),host=$('#viewer'),loading=$('#loading');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color('#f8f7f0');
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,50);
const ambient=new THREE.HemisphereLight('#f5f9ff','#889271',1.05);scene.add(ambient);
const sun=new THREE.DirectionalLight('#fff3de',2.65);sun.position.set(-3,5,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-3,right:3,top:4,bottom:-2,near:.1,far:15});sun.shadow.bias=-.0004;sun.shadow.normalBias=.014;scene.add(sun);
const fill=new THREE.DirectionalLight('#d1e4ff',.55);fill.position.set(4,2,-3);scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({opacity:.13}));floor.rotation.x=-Math.PI/2;floor.position.y=-.008;floor.receiveShadow=true;scene.add(floor);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.enablePan=false;controls.minZoom=.6;controls.maxZoom=3.5;controls.maxPolarAngle=Math.PI*.49;controls.addEventListener('change',()=>renderer.render(scene,camera));
let current=null,currentItem=null,lod=0,token=0,view='iso',fitSize=1,targetY=.4;const loader=new GLTFLoader();
const response=await fetch('./assets/wonders/catalog.json',{cache:'no-cache'});if(!response.ok)throw new Error('无法读取模型清单');const catalog=await response.json();
const byId=new Map(catalog.items.map(i=>[i.assetId,i]));
function destroy(root){const mats=new Set();root.traverse(o=>{if(o.isMesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m));}});mats.forEach(m=>m.dispose());}
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
      $('#selected-id').textContent=item.id;$('.edition i').textContent=item.id.slice(1)+' / 24';
      $('#location').textContent=item.location;$('#model-name').textContent=item.name;$('#signature').textContent=item.signature;
      $('#swatches').replaceChildren(...item.palette.map(c=>{const a=document.createElement('span');a.className='swatch';a.style.background=c;a.title=c;return a;}));
      $('#triangle-count').textContent=item.levels[level].triangles.toLocaleString()+' 三角面';$('#download').href=item.files[level].url+'?v='+item.files[level].sha256;$('#download').download=item.assetId+'.glb';$('#reference').href=item.reference;$('#lod').value=String(level);
      for(const card of document.querySelectorAll('.model-card'))card.classList.toggle('selected',card.dataset.assetId===id);
    }
    resize();loading.hidden=true;return true;
  }catch(e){loading.textContent='模型读取失败：'+e.message;loading.hidden=false;throw e;}
}
function grid(region='all'){
  const frag=document.createDocumentFragment();
  for(const item of catalog.items.filter(i=>region==='all'||i.region===region)){
    const card=document.createElement('button');card.className='model-card';card.dataset.assetId=item.assetId;card.title=item.name;
    const img=document.createElement('img');img.src=item.thumbnail+'?v='+catalog.version;img.alt=item.name+' 三维模型';img.loading='lazy';
    const num=document.createElement('span');num.className='number';num.textContent=item.id;
    const cap=document.createElement('span');cap.className='caption';const name=document.createElement('strong');name.textContent=item.name;
    const loc=document.createElement('small');loc.textContent=item.location;cap.append(name,loc);card.append(img,num,cap);
    card.classList.toggle('selected',currentItem?.assetId===item.assetId);card.addEventListener('click',()=>select(item.assetId).catch(console.error));frag.append(card);
  }$('#model-grid').replaceChildren(frag);
}
for(const button of document.querySelectorAll('[data-region]'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('[data-region]'))b.classList.toggle('selected',b===button);grid(button.dataset.region);});
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{view=button.dataset.view;for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b===button);resize();});
$('#lod').addEventListener('change',()=>select(currentItem.assetId,{level:Number($('#lod').value)}).catch(console.error));
$('#wireframe').addEventListener('change',()=>{current?.traverse(o=>{if(o.isMesh)o.material.wireframe=$('#wireframe').checked;});renderer.render(scene,camera);});
$('#reset').addEventListener('click',()=>{view='iso';for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b.dataset.view==='iso');resize();});
window.wonderPreview={
  catalog,select,
  get state(){return {assetId:currentItem?.assetId,lod,view,materialVersion:catalog.version,renderer:renderer.info.render};},
  async capture(id,{level=0,preset='iso',size=512,transparent=false}={}){
    await select(id,{level,preset,updateUI:false});renderer.setPixelRatio(1);renderer.setSize(size,size,false);frame(size,size,preset);
    const background=scene.background;scene.background=transparent?null:new THREE.Color('#f8f7f0');renderer.setClearAlpha(transparent?0:1);renderer.render(scene,camera);
    const png=canvas.toDataURL('image/png');scene.background=background;renderer.setPixelRatio(Math.min(devicePixelRatio,2));resize();return png;
  }
};
grid();await select(new URLSearchParams(location.search).get('model')||'santiago-bernabeu');
window.wonderPreview.ready=true;


