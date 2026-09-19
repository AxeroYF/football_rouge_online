// CPU-side scene construction only. No WebGL context, browser, server or save.
import fs from "node:fs/promises";
import * as THREE from "three";
import { loadReliefFields } from "../client/map-three/relief-field.js";
import { AtlasTerrain } from "../client/map-three/atlas-terrain.js";
import { FogSpatialIndex } from "../shared/map/fog-spatial.mjs";
const read=async path=>JSON.parse(await fs.readFile(new URL("../"+path,import.meta.url),"utf8"));
const geo=await read("assets/data/campaign-territories.geojson"),natureData=await read("assets/data/map-nature.json");
const fields=await loadReliefFields({fetchImpl:async url=>{
  const bytes=await fs.readFile(new URL("../"+url.split("?")[0].replace(/^\.\//,""),import.meta.url));
  return {ok:true,json:async()=>JSON.parse(bytes.toString()),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}});
const spatial=new FogSpatialIndex(geo),plan=spatial.plan(["adm1:isl-705"]),report={};
for(const [name,isAreaVisible] of [["full",()=>true],["icelandFog",box=>spatial.touchesLand(plan,box)]]){
  const started=performance.now(),scene=new THREE.Scene(),terrain=new AtlasTerrain(scene,fields,{natureData,isAreaVisible});
  try {
    await terrain.build();
    report[name]={constructionMs:Math.round(performance.now()-started),...terrain.stats()};
    console.log(name,JSON.stringify(report[name]));
  }finally{terrain.dispose();}
}
report.scope="Offline CPU construction; includes base height/nature preparation. Meshes and instances are deferred; base geography, height buffers and nature JSON are still loaded globally.";
await fs.mkdir(new URL("../outputs/fog-review/",import.meta.url),{recursive:true});
await fs.writeFile(new URL("../outputs/fog-review/loading-report.json",import.meta.url),JSON.stringify(report,null,2)+"\n");
