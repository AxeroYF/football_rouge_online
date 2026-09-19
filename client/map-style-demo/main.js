import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createWorld,SITES,smooth,noise} from './world.js';
const $=s=>document.querySelector(s),canvas=$('#map-canvas'),host=$('#stage');
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-16,16,11,-11,.1,240);
let renderer,controls,world,level=3,mode='enhanced',angle=50,view='overview',selected=null,frame=null,ready=false,loadToken=0;
const layers={},modelCache=new Map(),models=new Map(),sprites=new Map(),labels=new Map(),pickables=[],loader=new GLTFLoader(),textures=new THREE.TextureLoader();
const stats={models:0,trees:0,terrainTriangles:0,errors:[]};
const presets={overview:{x:0,z:-1.0,span:20.5},club:{x:0,z:.35,span:9.6},mountains:{x:-1.2,z:-4.8,span:11.4},port:{x:-2.1,z:3.8,span:7.9}};
let span=20.5;
function material(color,extra={}){return new THREE.MeshStandardMaterial({color,roughness:.95,metalness:0,...extra});}
const sun=new THREE.DirectionalLight('#fff1d1',2.45);
function invalidate(){if(frame===null)frame=requestAnimationFrame(draw);}
function draw(){
 frame=null;if(!renderer)return;renderer.render(scene,camera);
 for(const s of SITES){const label=labels.get(s.id);if(!label)continue;const p=(mode==='enhanced'?models.get(s.id):sprites.get(s.id))?.getWorldPosition(new THREE.Vector3());if(!p)continue;
 p.y+=(mode==='enhanced'?s.width*.34:.3);p.project(camera);
 const visible=$('#show-labels').checked&&p.z>-1&&p.z<1&&Math.abs(p.x)<.94&&Math.abs(p.y)<.85;
 label.hidden=!visible;label.style.display=visible?'grid':'none';
 label.style.left=(p.x*.5+.5)*host.clientWidth+'px';label.style.top=(-p.y*.5+.5)*host.clientHeight+'px';
 label.classList.toggle('active',selected===s.id);
 }
 $('#zoom-value').value=camera.zoom.toFixed(1)+'×';
}
function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);const aspect=w/h;const extent=(aspect<1?span*1.05:span)/2;camera.left=-extent*aspect;camera.right=extent*aspect;camera.top=extent;camera.bottom=-extent;camera.updateProjectionMatrix();invalidate();}
function orient(){const elevation=THREE.MathUtils.degToRad(angle);camera.position.copy(controls.target).add(new THREE.Vector3(0,Math.sin(elevation)*80,Math.cos(elevation)*80));camera.up.set(0,1,0);camera.lookAt(controls.target);controls.update();invalidate();}
function setAngle(value){angle=Number(value);for(const b of document.querySelectorAll('[data-angle]')){b.classList.toggle('active',Number(b.dataset.angle)===angle);b.setAttribute('aria-pressed',Number(b.dataset.angle)===angle);}orient();}
function setView(name){view=name;const p=presets[name];span=p.span;camera.zoom=1;controls.target.set(p.x,mode==='enhanced'&&name==='mountains'?1.5:.1,p.z);orient();resize();for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===name);hideCard();}
function binsFor(parent){const bins=new Map();return {put(g,c){if(!bins.has(c))bins.set(c,[]);bins.get(c).push(g);},finish(){for(const [c,geos]of bins){const merged=mergeGeometries(geos,false);if(!merged)continue;const mesh=new THREE.Mesh(merged,material(c));mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);for(const g of geos)g.dispose();}}};}
function baseHeight(x,z,enhanced=true){return world.height(x,z,enhanced);}
function createGround(enhanced){
 const g=world.data.grid,positions=[],colors=[],indices=[],rock=new THREE.Color('#a09a88'),snow=new THREE.Color('#e0e5df'),grass=new THREE.Color('#839a52'),gold=new THREE.Color('#c7a359'),jade=new THREE.Color('#478e79');
 const cover=enhanced?.045:.38;
 for(let z=0;z<g.height;z++)for(let x=0;x<g.width;x++){
 const px=g.origin[0]+x*g.step,pz=g.origin[1]+z*g.step,h=baseHeight(px,pz,enhanced),m=world.raw(px,pz);
 positions.push(px,h,pz);
 const variation=Math.sin(px*.91+Math.sin(pz*.44))*.06+Math.sin(pz*.64-px*.22)*.045;
 const c=grass.clone().lerp(new THREE.Color('#b4b466'),.25+variation*2);
 const slope=Math.hypot(baseHeight(px+.14,pz,enhanced)-baseHeight(px-.14,pz,enhanced),baseHeight(px,pz+.14,enhanced)-baseHeight(px,pz-.14,enhanced))/.28;
 c.lerp(rock,Math.max(smooth(750,1700,m),smooth(.6,2,slope)*.82));
 if(enhanced)c.lerp(new THREE.Color('#73816e'),smooth(160,600,m)*(1-smooth(1000,1800,m))*.15);
 c.lerp(snow,smooth(enhanced?2050:2400,enhanced?2720:3200,m+Math.sin(px*2.3+pz*1.6)*120-slope*70));
 if(world.alpha(px,pz)<.95)c.lerp(new THREE.Color('#c2b995'),.75);
 const owner=world.faction(px,pz);if(owner)c.lerp(owner==='jade'?jade:gold,cover);
 c.multiplyScalar(1+variation);colors.push(c.r,c.g,c.b);
 if(x<g.width-1&&z<g.height-1){const i=z*g.width+x;indices.push(i,i+g.width,i+1,i+1,i+g.width,i+g.width+1);}
 }
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geom.setIndex(indices);geom.computeVertexNormals();
 const groundMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0});
 if(enhanced)groundMaterial.onBeforeCompile=shader=>{
 shader.vertexShader='varying float vMountain;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvMountain=smoothstep(.35,1.4,position.y);');
 shader.fragmentShader='varying float vMountain;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nvec3 rockFace=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));normal=normalize(mix(normal,rockFace,vMountain*.36));');
 };
 const mesh=new THREE.Mesh(geom,groundMaterial);
 mesh.receiveShadow=true;mesh.castShadow=enhanced;mesh.name=enhanced?'Sculpted continuous terrain':'Smoothed terrain comparison';
 stats.terrainTriangles=indices.length/3;return mesh;
}
function ocean(){
 const g=world.data.grid,d=new Float32Array(g.mask.length);for(let i=0;i<d.length;i++)d[i]=g.mask[i]>140?0:999;
 for(let z=1;z<g.height;z++)for(let x=1;x<g.width;x++){const i=z*g.width+x;d[i]=Math.min(d[i],d[i-1]+1,d[i-g.width]+1,d[i-g.width-1]+1.414);}
 for(let z=g.height-2;z>=0;z--)for(let x=g.width-2;x>=0;x--){const i=z*g.width+x;d[i]=Math.min(d[i],d[i+1]+1,d[i+g.width]+1,d[i+g.width+1]+1.414);}
 const pixels=new Uint8Array(d.length*4);for(let i=0;i<d.length;i++){pixels[i*4]=Math.round(255*Math.exp(-d[i]*g.step/1.25));pixels[i*4+3]=255;}
 const texture=new THREE.DataTexture(pixels,g.width,g.height);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
 const m=material('#2b5c75',{roughness:.82});m.onBeforeCompile=shader=>{
 shader.uniforms.shoreMap={value:texture};shader.uniforms.gridOrigin={value:new THREE.Vector2(...g.origin)};shader.uniforms.gridSize={value:new THREE.Vector2(g.width*g.step,g.height*g.step)};
 shader.vertexShader='varying vec2 vWater;\\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\\nvWater=(modelMatrix*vec4(position,1.0)).xz;');
 shader.fragmentShader='varying vec2 vWater;uniform sampler2D shoreMap;uniform vec2 gridOrigin,gridSize;\\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\\nvec2 uv=(vWater-gridOrigin)/gridSize;float shore=texture2D(shoreMap,clamp(uv,0.0,1.0)).r;float waves=sin(vWater.x*3.1+vWater.y*2.0)*sin(vWater.y*4.1-vWater.x*.3);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.20,.49,.47),shore*.86)*(1.0+waves*.035);');
 };
 // The shader source needs real newlines, rather than literal escaped text.
 const original=m.onBeforeCompile;m.onBeforeCompile=s=>{original(s);s.vertexShader=s.vertexShader.replaceAll('\\n','\n');s.fragmentShader=s.fragmentShader.replaceAll('\\n','\n');};
 const water=new THREE.Mesh(new THREE.PlaneGeometry(180,180),m);water.rotation.x=-Math.PI/2;water.position.y=0;water.receiveShadow=true;scene.add(water);
}
function ribbonGeometry(points,width,enhanced,lift=.038){
 const positions=[],indices=[];
 const pointsDense=[];
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.14));for(let k=0;k<n;k++){const t=k/n;pointsDense.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}
 pointsDense.push(points.at(-1));
 for(let i=0;i<pointsDense.length;i++){
 const p=pointsDense[i],a=pointsDense[Math.max(0,i-1)],b=pointsDense[Math.min(pointsDense.length-1,i+1)],length=Math.max(.001,Math.hypot(b[0]-a[0],b[1]-a[1]));
 const nx=-(b[1]-a[1])/length*width*.5,nz=(b[0]-a[0])/length*width*.5;
 for(const sign of [-1,1]){const x=p[0]+nx*sign,z=p[1]+nz*sign;positions.push(x,Math.max(.013,baseHeight(x,z,enhanced))+lift,z);}
 if(i){const n=i*2;indices.push(n-2,n,n-1,n-1,n,n+1);}
 }
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geom.setIndex(indices);geom.computeVertexNormals();return geom;
}
function createBorders(enhanced){
 const root=new THREE.Group();root.name='Ownership boundaries';
 for(const [owner,paths]of Object.entries(world.data.boundaries)){
 const isInternal=owner==='internal';const visiblePaths=paths.filter(p=>p.length>1);
 const add=(width,color,opacity,lift)=>{const geos=visiblePaths.map(p=>ribbonGeometry(p,width,enhanced,lift));const g=mergeGeometries(geos);for(const geo of geos)geo.dispose();if(!g)return;
 const m=new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2});const mesh=new THREE.Mesh(g,m);mesh.renderOrder=4;root.add(mesh);};
 if(isInternal)add(enhanced?.013:.031,'#e4e0c4',enhanced?.18:.70,.05);
 else if(enhanced){const color=owner==='jade'?'#85b49c':'#c9ab65';add(.19,color,.06,.064);add(.10,color,.17,.068);add(.052,color,1,.072);add(.021,'#ece3c5',.84,.077);}
 }
 return root;
}
function pathCurve(points){return new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],0,p[1])),false,'catmullrom',.1).getPoints(70).map(p=>[p.x,p.z]);}
function createSettlement(){
 const group=new THREE.Group(),bins=binsFor(group);
 const roads=[
 [[-5.3,-1.7],[-4.0,-.25],[-2.3,1.1],[0,1.18],[2.2,1.52],[4.7,2.0],[6.1,.4]],
 [[-.15,1.25],[-.2,2.8],[-1.15,3.55],[-2.1,3.8]],
 [[1.4,1.4],[2.8,-1.7],[4.8,-2.8],[7.3,-2.45]],
 [[-1.65,1.15],[-3.2,2.2],[-4.55,2.3]]
 ];
 for(const road of roads){const pts=pathCurve(road);bins.put(ribbonGeometry(pts,.20,true,.018),'#bbb394');bins.put(ribbonGeometry(pts,.115,true,.028),'#a49f84');}
 function box(x,y,z,w,h,d,color,rotation=0){const g=new THREE.BoxGeometry(w,h,d);g.rotateY(rotation);g.translate(x,y,z);bins.put(g,color);}
 function tree(x,z,size=.16){
 const y=baseHeight(x,z,true);
 const trunk=new THREE.CylinderGeometry(size*.11,size*.13,size*.7,5);trunk.translate(x,y+size*.35,z);bins.put(trunk,'#796245');
 const crown=new THREE.IcosahedronGeometry(size,1);crown.scale(1,1.5,1);crown.translate(x,y+size*1.45,z);bins.put(crown,'#597840');
 }
 for(const s of SITES){if(s.id==='port')continue;
 const positions=[s.x,baseHeight(s.x,s.z,true)+.018,s.z],indices=[];
 for(let i=0;i<=32;i++){const a=i/32*Math.PI*2,r=s.width*(.69+.04*Math.sin(a*5+.7)+.03*Math.cos(a*3));const x=s.x+Math.cos(a)*r,z=s.z+Math.sin(a)*r*.84;positions.push(x,baseHeight(x,z,true)+.018,z);if(i)indices.push(0,i+1,i);}
 const pad=new THREE.BufferGeometry();pad.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));pad.setIndex(indices);pad.computeVertexNormals();bins.put(pad,'#95a05e');
 // Small planted entrances avoid a repeated circular plinth around every model.
 for(let i=0;i<4;i++)tree(s.x+(i-1.5)*s.width*.26,s.z+s.width*.64,.11+(i%2)*.025);
 }
 // Small residential clusters frame the club's larger, more legible silhouettes.
 for(let i=0;i<165;i++){
 const x=-6+noise(i,31)*13,z=-2.7+noise(i,12)*6.0;
 if(world.lakeAt(x,z)||world.nearSite(x,z,.42)||world.raw(x,z)>520||world.alpha(x,z)<.95||Math.abs(z-1.3)<.35||Math.abs(x+.6)<.55&&z>2.5)continue;
 const y=baseHeight(x,z,true),scale=.15+noise(i,1)*.16,rot=noise(i,8)*.3-.15,h=scale*(1.0+noise(i,14));
 box(x,y+h*.5,z,scale*1.1,h,scale*.9,i%3?'#d3c59e':'#e1d4b1',rot);
 const roof=new THREE.CylinderGeometry(0,scale*.85,scale*.54,4);roof.rotateY(Math.PI/4+rot);roof.scale(1,1,.9);roof.translate(x,y+h+scale*.19,z);bins.put(roof,i%4?'#ac7052':'#718580');
 }
 // Distant plots follow the quiet, flat valley floor.
 for(let iz=-5;iz<6;iz++)for(let ix=-11;ix<12;ix++){
 const x=ix*.75+.15,z=iz*.61-.1;
 if(world.lakeAt(x,z)||world.nearSite(x,z,1)||world.raw(x,z)>360||world.alpha(x,z)<.97||noise(ix,iz)<.30)continue;
 const h=baseHeight(x,z,true),w=.52+noise(ix+4,iz)*.18,d=.39;
 if(Math.abs(baseHeight(x+.4,z,true)-h)>.08)continue;
 const g=new THREE.PlaneGeometry(w,d,2,2);g.rotateX(-Math.PI/2);g.rotateY(.13);g.translate(x,h+.025,z);bins.put(g,['#b2ae68','#979e58','#b6a471','#7e9655'][(ix+iz+60)%4]);
 for(let r=1;r<5;r++){const gz=z-d/2+r*d/5;bins.put(ribbonGeometry([[x-w*.44,gz],[x+w*.44,gz]],.009,true,.032),'#75894e');}
 }
 bins.finish();return group;
}
function treePrototype(kind){
 const geos=[],add=(g,c)=>{if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}const col=new THREE.Color(c),array=[];for(let i=0;i<g.attributes.position.count;i++)array.push(col.r,col.g,col.b);g.setAttribute('color',new THREE.Float32BufferAttribute(array,3));geos.push(g);};
 const trunk=new THREE.CylinderGeometry(.032,.043,.38,5);trunk.translate(0,.19,0);add(trunk,'#695941');
 if(kind==='pine'){for(const [r,h,y]of [[.20,.57,.50],[.16,.52,.70],[.10,.39,.90]]){const g=new THREE.ConeGeometry(r,h,6);g.translate(0,y,0);add(g,y>.8?'#64834d':'#496d3f');}}
 else for(const [x,y,z,r]of [[0,.43,0,.21],[-.12,.36,.07,.16],[.12,.36,-.06,.17]]){const g=new THREE.IcosahedronGeometry(r,1);g.scale(1,1.22,1);g.translate(x,y,z);add(g,kind==='round'?'#859353':'#638144');}
 const g=mergeGeometries(geos);geos.forEach(g=>g.dispose());return g;
}
function createForest(enhanced){
 const root=new THREE.Group(),sites={pine:[],leaf:[],round:[]},dummy=new THREE.Object3D();
 const forestNoise=(x,z)=>Math.sin(x*.66+Math.sin(z*.7))*Math.sin(z*.81-x*.2)*.5+.5;
 for(let row=-46;row<27;row++)for(let col=-42;col<42;col++){
 const x=(col+noise(col,row)*.70)*.35,z=(row+noise(row,col)*.70)*.35,m=world.raw(x,z);
 if(world.lakeAt(x,z)||world.alpha(x,z)<.96||world.nearSite(x,z,.65)||m>1850||m<250&&forestNoise(x,z)<.77)continue;
 if(noise(col+33,row-4)>(m>400?.68:.35)||forestNoise(x,z)<.32)continue;
 const slope=Math.hypot(baseHeight(x+.14,z,enhanced)-baseHeight(x-.14,z,enhanced),baseHeight(x,z+.14,enhanced)-baseHeight(x,z-.14,enhanced));
 if(slope>.5)continue;
 const kind=enhanced?(m>700?'pine':'leaf'):'round';sites[kind].push({x,z,scale:(enhanced?.56:.63)+noise(row+17,col)*.36,rot:noise(col,row+4)*6.28});
 }
 for(const [kind,list]of Object.entries(sites)){if(!list.length)continue;const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),mesh=new THREE.InstancedMesh(treePrototype(kind),m,list.length);
 list.forEach((p,i)=>{dummy.position.set(p.x,baseHeight(p.x,p.z,enhanced),p.z);dummy.rotation.set(0,p.rot,0);dummy.scale.setScalar(p.scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);const color=new THREE.Color().setScalar(.86+noise(i,11)*.28);mesh.setColorAt(i,color);});
 mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;root.add(mesh);
 }
 if(enhanced)stats.trees=Object.values(sites).reduce((n,s)=>n+s.length,0);return root;
}
function addLakes(){
 const root=new THREE.Group();
 for(const lake of world.lakes){
 const shape=new THREE.Shape(lake.rings[0].map(p=>new THREE.Vector2(p[0],-p[1])));
 for(const ring of lake.rings.slice(1))shape.holes.push(new THREE.Path(ring.map(p=>new THREE.Vector2(p[0],-p[1]))));
 const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);g.translate(0,lake.level+.01,0);
 const water=new THREE.Mesh(g,material('#458b93',{roughness:.7}));water.name='Lake '+lake.name;water.receiveShadow=true;root.add(water);
 }
 return root;
}
async function applyLevel(next){
 const requested=Number(next);if(!Number.isInteger(requested)||requested<1||requested>5)throw Error('Invalid facility level');
 const token=++loadToken;$('#facility-level').disabled=true;
 try{
 const entries=await Promise.all(SITES.map(async s=>{
 const id=s.id+'-lv'+requested;if(!modelCache.has(id))modelCache.set(id,loader.loadAsync('./assets/facilities/models/lod1/'+id+'.glb'));
 const [gltf,texture]=await Promise.all([modelCache.get(id),textures.loadAsync('./assets/facilities/icons/'+id+'.png')]);texture.colorSpace=THREE.SRGBColorSpace;return {site:s,source:gltf.scene,texture};
 }));
 if(token!==loadToken){for(const e of entries)e.texture.dispose();return;}
 level=requested;$('#facility-level').value=String(level);pickables.length=0;
 for(const {site:s,source,texture}of entries){
 const old=models.get(s.id);if(old)layers.models.remove(old);
 const wrapper=new THREE.Group();wrapper.userData.site=s;const model=source.clone(true);
 model.traverse(o=>{if(s.id==='port'&&(o.name==='foundation'||o.name==='wavelets'))o.visible=false;if(o.isMesh){o.castShadow=true;o.receiveShadow=true;pickables.push(o);o.userData.site=s;}});
 wrapper.add(model);model.scale.setScalar(s.width);model.rotation.y=s.rotation;model.position.y=-s.width*.055;
 wrapper.position.set(s.x,s.id==='port'?.055:baseHeight(s.x,s.z,true)+.025,s.z);layers.models.add(wrapper);models.set(s.id,wrapper);
 if(!labels.has(s.id)){const label=document.createElement('div');label.className='map-label';label.innerHTML='<i></i><span>'+s.name+'<small>LV'+level+'</small></span>';$('#labels').append(label);labels.set(s.id,label);}else labels.get(s.id).querySelector('small').textContent='LV'+level;
 const sprite=sprites.get(s.id);if(sprite){sprite.material.map?.dispose();sprite.material.dispose();layers.sprites.remove(sprite);}
 const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));spr.scale.setScalar(1.65);
 const i=SITES.indexOf(s),x=(i%3-1)*1.7,z=1+Math.floor(i/3)*1.45;spr.position.set(x,baseHeight(x,z,false)+.4,z);spr.userData.site=s;layers.sprites.add(spr);sprites.set(s.id,spr);
 }
 stats.models=models.size;if(selected)showCard(selected);invalidate();
 }catch(e){stats.errors.push(e.message);throw e;}finally{if(token===loadToken)$('#facility-level').disabled=false;}
}
function setMode(next){
 mode=next;const enhanced=mode==='enhanced';
 layers.enhanced.visible=enhanced;layers.legacy.visible=!enhanced;layers.models.visible=enhanced;layers.sprites.visible=!enhanced;
 layers.bordersEnhanced.visible=enhanced&&$('#show-borders').checked;layers.bordersLegacy.visible=!enhanced&&$('#show-borders').checked;
 $('#mode-note').textContent=enhanced?'实体设施 · 山脊层次 · 连片领土外缘':'相同区域的表达对照，非正式游戏截图';
 $('#scene-caption').textContent=enhanced?'让建筑成为风景的一部分。':'图标排列 · 整块归属色 · 平滑地形';
 for(const b of document.querySelectorAll('[data-mode]')){b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode);}
 hideCard();invalidate();
}
function showCard(id){
 selected=id;const s=SITES.find(s=>s.id===id);$('#building-card').hidden=false;$('#building-kind').textContent=s.id==='port'?'COASTAL FACILITY':'CLUB DISTRICT';
 $('#building-name').textContent=s.name;$('#building-description').textContent=s.description;$('#building-level').textContent='LV'+level+' · 外观预览';invalidate();
}
function hideCard(){selected=null;$('#building-card').hidden=true;invalidate();}
const raycaster=new THREE.Raycaster();let down=null;
canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
canvas.addEventListener('pointerup',e=>{
 if(!ready||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
 const b=canvas.getBoundingClientRect(),p=new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);raycaster.setFromCamera(p,camera);
 const objects=mode==='enhanced'?pickables:[...sprites.values()];const hit=raycaster.intersectObjects(objects,false)[0];hit?.object.userData.site?showCard(hit.object.userData.site.id):hideCard();
});
async function main(){
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene.background=new THREE.Color('#335e68');
 sun.position.set(-24,36,14);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0002;sun.shadow.normalBias=.035;sun.shadow.radius=3;sun.shadow.intensity=.58;Object.assign(sun.shadow.camera,{left:-25,right:25,top:25,bottom:-25,near:1,far:100});scene.add(sun);
 scene.add(new THREE.HemisphereLight('#e5f0e3','#72704e',1.65));
 const fill=new THREE.DirectionalLight('#bfd6e3',.30);fill.position.set(10,15,-20);scene.add(fill);
 controls=new OrbitControls(camera,canvas);controls.enableRotate=false;controls.enableDamping=false;controls.screenSpacePanning=false;controls.minZoom=.65;controls.maxZoom=3.6;controls.zoomSpeed=.68;controls.mouseButtons.LEFT=THREE.MOUSE.PAN;controls.addEventListener('change',()=>{const x=THREE.MathUtils.clamp(controls.target.x,-10,12),z=THREE.MathUtils.clamp(controls.target.z,-13,9);camera.position.x+=x-controls.target.x;camera.position.z+=z-controls.target.z;controls.target.x=x;controls.target.z=z;invalidate();});
 const res=await fetch('./assets/map-style-demo/north-italy.json?v=1');if(!res.ok)throw Error('地形切片读取失败');world=createWorld(await res.json());$('#load-note').textContent='塑造山脊、林地与领土边线';
 for(const name of ['enhanced','legacy','models','sprites']){layers[name]=new THREE.Group();scene.add(layers[name]);}
 ocean();
 for(const enhanced of [true,false]){const root=enhanced?layers.enhanced:layers.legacy;root.add(createGround(enhanced));root.add(createForest(enhanced));await new Promise(r=>setTimeout(r,0));}
 layers.enhanced.add(createSettlement(),addLakes());
 layers.bordersEnhanced=createBorders(true);layers.bordersLegacy=createBorders(false);scene.add(layers.bordersEnhanced,layers.bordersLegacy);
 $('#load-note').textContent='将七类设施放入地图';await applyLevel(3);
 setMode('enhanced');setView('overview');ready=true;$('#loading').hidden=true;
 new ResizeObserver(resize).observe(host);resize();invalidate();
 const api={getState:()=>({ready,mode,angle,level,view,selected,stats:{...stats},cameraZoom:camera.zoom,cameraTarget:[controls.target.x,controls.target.y,controls.target.z],bordersVisible:layers.bordersEnhanced.visible||layers.bordersLegacy.visible,labelsVisible:$('#show-labels').checked}),projectSite:id=>{const root=mode==='enhanced'?models.get(id):sprites.get(id),p=root.getWorldPosition(new THREE.Vector3());p.y+=.3;p.project(camera);return {x:(p.x*.5+.5)*host.clientWidth,y:(-p.y*.5+.5)*host.clientHeight};},setView,setMode,setAngle,applyLevel,render:()=>renderer.render(scene,camera)};
 window.mapStyleDemo=Object.freeze(api);
}
for(const b of document.querySelectorAll('[data-angle]'))b.addEventListener('click',()=>ready&&setAngle(b.dataset.angle));
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>ready&&setMode(b.dataset.mode));
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>ready&&setView(b.dataset.view));
$('#facility-level').addEventListener('change',e=>applyLevel(e.target.value).catch(fail));
$('#show-borders').addEventListener('change',()=>ready&&setMode(mode));$('#show-labels').addEventListener('change',invalidate);
$('#reset').addEventListener('click',()=>{if(!ready)return;setAngle(50);setView('overview');});
for(const [id,factor]of [['zoom-in',1.22],['zoom-out',1/1.22]])$('#'+id).addEventListener('click',()=>{camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,.65,3.6);camera.updateProjectionMatrix();invalidate();});
$('#close-card').addEventListener('click',hideCard);document.addEventListener('keydown',e=>{if(e.key==='Escape')hideCard();});
function fail(e){stats.errors.push(e.message);$('#loading').hidden=false;$('#loading strong').textContent='样板加载未完成';$('#load-note').textContent=e.message;$('#retry').hidden=false;console.error(e);}
$('#retry').addEventListener('click',()=>location.reload());
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();ready=false;fail(Error('图形上下文已中断，请重新加载'));});
main().catch(fail);
