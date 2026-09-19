import * as THREE from 'three';
import {airportIdentity,airportTerritoryIdentity} from '../../shared/config/airport-identity.mjs';
export function applyAirportIdentity(model,options={}) {
  const identity=options.world?airportTerritoryIdentity(options.world,options.territoryId,options.territoryName):airportIdentity(options),seen=new Set();
  model.traverse(o=>{if(o.isMesh)for(const material of Array.isArray(o.material)?o.material:[o.material]){
    if(seen.has(material))continue;seen.add(material);
    if(material.name==='airportTeam'){material.color.set(identity.color);material.userData.teamColorChannel='primary';}
  }});
  const board=model.getObjectByName('airport_nameplate');
  if(board&&globalThis.document){
    let text=board.getObjectByName('airport_identity_text');
    if(!text){
      const surface=board.children.find(o=>o.isMesh);surface.geometry.computeBoundingBox();const box=surface.geometry.boundingBox,size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=168;
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      text=new THREE.Mesh(new THREE.PlaneGeometry(size.x*.97,size.y*.88),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
      text.name='airport_identity_text';text.position.set(center.x,center.y,box.max.z+.003);board.add(text);
    }
    const canvas=text.material.map.image,ctx=canvas.getContext('2d');ctx.fillStyle='#163348';ctx.fillRect(0,0,1024,168);ctx.fillStyle=identity.color;ctx.fillRect(0,0,24,168);
    let size=66;ctx.font=`600 ${size}px "Microsoft YaHei",sans-serif`;while(ctx.measureText(identity.name).width>940&&size>25)ctx.font=`600 ${--size}px "Microsoft YaHei",sans-serif`;
    ctx.fillStyle='#fff8e5';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(identity.name,528,65);
    ctx.font='600 34px Arial,sans-serif';ctx.fillStyle='#ead397';ctx.fillText(`${identity.code}  /  CLUB AIRPORT`,528,130);text.material.map.needsUpdate=true;
  }
  model.userData.airportIdentity=identity;return identity;
}
