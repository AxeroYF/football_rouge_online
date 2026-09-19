import * as THREE from 'three';
import { OrbitControls } from '../../assets/vendor/three/OrbitControls.js';
import { GLTFLoader } from '../../assets/vendor/three/GLTFLoader.js';
import { RoomEnvironment } from '../../assets/vendor/three/RoomEnvironment.js';

export function createWonderModelViewer(host){
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
 renderer.domElement.setAttribute('aria-label','奇观三维模型，可拖动旋转和滚轮缩放');host.append(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,100);
 const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
 scene.add(new THREE.HemisphereLight('#f5f9ff','#889271',1.05));
 const sun=new THREE.DirectionalLight('#fff3de',2.65);sun.position.set(-3,5,4);scene.add(sun);
 const fill=new THREE.DirectionalLight('#d1e4ff',.55);fill.position.set(4,2,-3);scene.add(fill);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=false;controls.minZoom=.5;controls.maxZoom=4;controls.maxPolarAngle=Math.PI*.85;
 const loader=new GLTFLoader();let current=null,request=0,disposed=false,size=new THREE.Vector3(1,1,1);
 const render=()=>{if(!disposed)renderer.render(scene,camera);};controls.addEventListener('change',render);
 function release(model){const materials=new Set();model.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const m of materials)m.dispose();}
 function resize(){if(disposed)return;const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight),aspect=width/height;
  renderer.setSize(width,height,false);const extent=Math.max(size.y*.8,Math.hypot(size.x,size.z)*.65,Math.hypot(size.x,size.z)*.7/aspect,.5);
  camera.left=-extent*aspect;camera.right=extent*aspect;camera.top=extent;camera.bottom=-extent;camera.updateProjectionMatrix();render();
 }
 function reset(){camera.zoom=1;camera.position.set(4,4.5,5);controls.target.set(0,0,0);camera.lookAt(0,0,0);controls.update();resize();}
 async function select(url){const version=++request;host.dataset.loading='true';delete host.dataset.model;
  if(current){scene.remove(current);release(current);current=null;render();}
  try{const gltf=await loader.loadAsync(url);if(disposed||version!==request){release(gltf.scene);return;}
   current=gltf.scene;const box=new THREE.Box3().setFromObject(current),center=box.getCenter(new THREE.Vector3());box.getSize(size);current.position.sub(center);scene.add(current);reset();host.dataset.model=url;delete host.dataset.loading;
  }catch(error){if(!disposed&&version===request){delete host.dataset.loading;throw error;}}
 }
 const observer=new ResizeObserver(resize);observer.observe(host);reset();
 function dispose(){disposed=true;request++;observer.disconnect();controls.dispose();if(current)release(current);env.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();delete host.dataset.model;delete host.dataset.loading;}
 return {select,reset,dispose};
}
