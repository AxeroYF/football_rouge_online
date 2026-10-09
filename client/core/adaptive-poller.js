// One request at a time; background tabs stop polling and failures back off.
export function createAdaptivePoller({run, isBusy=()=>false, document:doc=globalThis.document, now=Date.now, schedule=setTimeout, cancel=clearTimeout}) {
 let timer=null,running=false,stopped=false,lastActivity=now(),failures=0,refreshPending=false;
 const delay=()=>failures?Math.min(30000,5000*2**failures):!isBusy()&&now()-lastActivity>=60000?15000:5000;
 function queue(ms){cancel(timer);if(!stopped&&!doc.hidden)timer=schedule(tick,ms);}
 async function tick(){
  if(stopped||doc.hidden||running)return;
  running=true;refreshPending=false;
  try{const ok=await run();failures=ok===false?failures+1:0;}catch{failures++;}
  finally{running=false;queue(refreshPending?250:delay());}
 }
 function activity(){const idle=now()-lastActivity>=60000;lastActivity=now();if(idle&&!running&&!failures)queue(250);}
 function refresh(){lastActivity=now();if(running)refreshPending=true;else queue(250);}
 function visibility(){cancel(timer);if(!doc.hidden)refresh();}
 for(const event of ['pointerdown','keydown','wheel'])doc.addEventListener(event,activity,{passive:true});
 doc.addEventListener('visibilitychange',visibility);queue(5000);
 return {refresh,stop(){stopped=true;cancel(timer);for(const event of ['pointerdown','keydown','wheel'])doc.removeEventListener(event,activity);doc.removeEventListener('visibilitychange',visibility);}};
}
