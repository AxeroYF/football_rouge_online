import {createCardMotionState,advanceCardMotion,drawCardMotion,cardMotionSeed} from './card-motion-model.js?v=20260905-shield-v1';

// One observer set and one RAF for all card renderers and their transient windows.
export function createCardMotionController({document:doc,window:win=doc.defaultView,random=Math.random,cacheLimit=512}={}){
  const nodes=new Map(),cache=new Map(),motion=win.matchMedia('(prefers-reduced-motion: reduce)');
  let raf=null,lastTick=null,lastPaint=0,destroyed=false,pageHidden=false;
  const find=node=>node?.querySelectorAll?[...(node.matches?.('canvas[data-card-motion]')?[node]:[]),...node.querySelectorAll('canvas[data-card-motion]')]:[];
  function trimCache(){
    if(cache.size<=cacheLimit)return;
    const used=new Set([...nodes.values()].map(n=>n.key));
    for(const key of cache.keys()){if(cache.size<=cacheLimit)break;if(!used.has(key))cache.delete(key);}
  }
  function stateFor(key){
    let state=cache.get(key);
    if(!state){state=createCardMotionState(random()<.5?'meteor':'warp',cardMotionSeed(key)^Math.floor(random()*4294967296));cache.set(key,state);trimCache();}
    return state;
  }
  function paint(node){
    if(!node.width||!node.height)return;
    const ctx=node.ctx??(node.ctx=node.canvas.getContext('2d',{alpha:true}));if(!ctx)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,node.canvas.width,node.canvas.height);
    ctx.setTransform(node.canvas.width/520,0,0,node.canvas.height/700,0,0);
    drawCardMotion(ctx,stateFor(node.key),{stride:node.choiceStage||node.width<150?2:1});
  }
  function size(node,width,height){
    const dpr=Math.min(win.devicePixelRatio||1,node.choiceStage?1:1.5);
    node.width=width;node.height=height;
    if(!node.visible)return; // Offscreen resize notifications must not allocate bitmaps.
    const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));
    if(node.canvas.width!==w)node.canvas.width=w;if(node.canvas.height!==h)node.canvas.height=h;
    if(node.visible)paint(node);
  }
  function activeNodes(){return [...nodes.values()].filter(n=>n.visible&&n.width>0&&n.height>0&&n.canvas.isConnected);}
  function allowed(){return !destroyed&&!pageHidden&&!doc.hidden&&!motion.matches;}
  function tick(now){
    raf=null;if(!allowed())return;
    const active=activeNodes();if(!active.length){lastTick=null;return;}
    const delta=lastTick===null?0:Math.min(.08,(now-lastTick)/1000);lastTick=now;
    for(const key of new Set(active.map(n=>n.key)))advanceCardMotion(stateFor(key),delta);
    if(now-lastPaint>=1000/(active.some(n=>n.choiceStage)?30:active.length>16?24:40)){for(const node of active)paint(node);lastPaint=now;}
    raf=win.requestAnimationFrame(tick);
  }
  function sync(){
    if(!allowed()||!activeNodes().length){if(raf!==null)win.cancelAnimationFrame(raf);raf=null;lastTick=null;return;}
    if(raf===null){lastTick=null;raf=win.requestAnimationFrame(tick);}
  }
  const intersection=new win.IntersectionObserver(entries=>{
    for(const e of entries){const n=nodes.get(e.target);if(n){n.visible=e.isIntersecting;if(n.visible){const rect=n.canvas.getBoundingClientRect();size(n,rect.width,rect.height);}else{n.canvas.width=1;n.canvas.height=1;n.ctx=null;}}}sync();
  },{threshold:0});
  const resize=new win.ResizeObserver(entries=>{for(const e of entries){const n=nodes.get(e.target);if(n)size(n,e.contentRect.width,e.contentRect.height);}sync();});
  function add(canvas){
    if(nodes.has(canvas))return;
    const key=canvas.dataset.cardMotion;if(!key)return;
    nodes.set(canvas,{canvas,key,choiceStage:Boolean(canvas.closest?.('.inventory-opening-stage-root')),visible:false,width:0,height:0,ctx:null});intersection.observe(canvas);resize.observe(canvas);
  }
  function remove(canvas){
    if(!nodes.has(canvas)||canvas.isConnected)return;
    intersection.unobserve(canvas);resize.unobserve(canvas);nodes.delete(canvas);
    // Release the bitmap immediately; the small simulation survives DOM replacement.
    canvas.width=1;canvas.height=1;trimCache();
  }
  const observer=new win.MutationObserver(records=>{
    for(const r of records){for(const n of r.removedNodes)for(const c of find(n))remove(c);for(const n of r.addedNodes)for(const c of find(n))add(c);}sync();
  });
  function imagesFailed(event){const img=event.target;if(img?.matches?.('[data-card-identity-image]')){img.hidden=true;img.parentElement?.classList.add('is-missing');}}
  function changedMotion(){for(const node of activeNodes())paint(node);sync();}
  function hide(){pageHidden=true;sync();}
  function show(){pageHidden=false;sync();}
  for(const c of find(doc))add(c);
  observer.observe(doc.body??doc.documentElement,{childList:true,subtree:true});
  doc.addEventListener('visibilitychange',sync);doc.addEventListener('error',imagesFailed,true);motion.addEventListener('change',changedMotion);
  win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
  return {
    destroy(){destroyed=true;sync();observer.disconnect();intersection.disconnect();resize.disconnect();doc.removeEventListener('visibilitychange',sync);doc.removeEventListener('error',imagesFailed,true);motion.removeEventListener('change',changedMotion);win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);nodes.clear();cache.clear();},
    inspect(){return {cards:nodes.size,cached:cache.size,active:activeNodes().length,running:raf!==null};},
  };
}

export function installCardMotionController(doc=globalThis.document){
  const win=doc?.defaultView;
  if(!win?.MutationObserver||!win.IntersectionObserver||!win.ResizeObserver)return null;
  const key=Symbol.for('yellowdogs.card-motion-controller');
  if(doc[key])return doc[key];
  if(!doc.body){doc.addEventListener('DOMContentLoaded',()=>installCardMotionController(doc),{once:true});return null;}
  doc[key]=createCardMotionController({document:doc,window:win});return doc[key];
}
