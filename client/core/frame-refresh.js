export function createFrameRefresh({schedule=globalThis.requestAnimationFrame??(callback=>setTimeout(callback,0))}={}) {
 const painted=new Map(),pending=new Map();let scheduled=false;
 const flush=()=>{scheduled=false;const work=[...pending];pending.clear();for(const [name,item]of work){if(painted.get(name)===item.key)continue;if(item.run()!==false)painted.set(name,item.key);}};
 return {request(name,key,run){pending.set(name,{key,run});if(!scheduled){scheduled=true;schedule(flush);}},reset(){painted.clear();},flush};
}
