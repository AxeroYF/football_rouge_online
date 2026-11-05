import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardMotionState,advanceCardMotion,drawCardMotion,warpTrailLength} from '../client/player-card/card-motion-model.js';
import {createCardMotionController} from '../client/player-card/card-motion-controller.js';

function context(){return {lines:[],save(){},restore(){},setTransform(){},clearRect(){this.lines=[];},fillRect(){},createRadialGradient(){return {addColorStop(){}};},createLinearGradient(){return {addColorStop(){}};},beginPath(){},moveTo(x,y){this.start=[x,y];},lineTo(x,y){this.lines.push([...this.start,x,y]);},stroke(){},arc(){},fill(){}};}
test('meteor head motion and tail share a clear down-left diagonal',()=>{
 const state=createCardMotionState('meteor',73),p=state.particles[0];p.distance=p.exit*.3;
 const old={...p};advanceCardMotion(state,.04);
 assert.ok(p.distance>old.distance);assert.ok(p.dx<0&&p.dy>0&&Math.abs(p.dx)>p.dy);
 const ctx=context();drawCardMotion(ctx,state);
 assert.ok(ctx.lines.length>0);
 for(const [x0,y0,x1,y1] of ctx.lines){assert.ok(x1<x0&&y1>y0);assert.ok(Math.abs((x1-x0)/(y1-y0)+4/3)<1e-8);}
});
test('meteors and warp stars finish their entire trails before individual recycling',()=>{
 for(const mode of ['meteor','warp']){
  const s=createCardMotionState(mode,319);let recycles=0,maxBatch=0;
  for(let frame=0;frame<1800;frame++){
   const before=s.particles.map(p=>({...p}));advanceCardMotion(s,1/60);let batch=0;
   s.particles.forEach((p,i)=>{
    const old=before[i];assert.ok(Object.values(p).every(Number.isFinite));
    if(p.generation===old.generation)return;
    const next=mode==='meteor'?old.distance+old.speed/60:(old.radius+14)*Math.exp(old.rate/60)-14;
    const tail=mode==='meteor'?old.length:warpTrailLength(next);
    assert.ok(next-tail>old.exit+24,`${mode}: particle reset while its trail is still visible`);
    assert.equal(p.generation,old.generation+1);batch++;recycles++;
   });maxBatch=Math.max(maxBatch,batch);
  }
  assert.ok(recycles>s.particles.length*5);assert.ok(maxBatch<s.particles.length/2);assert.ok(s.elapsed>29.9);
 }
});
test('warp travel is faster and continues past the screen rather than fading on a timer',()=>{
 const s=createCardMotionState('warp',973);for(const p of s.particles)p.radius=3;
 let seconds=0;while(s.particles.some(p=>p.generation===0)&&seconds<4){advanceCardMotion(s,1/120);seconds+=1/120;}
 assert.ok(seconds<2.5,`Full travel took ${seconds}s`);
});

class Events{
 constructor(){this.events=new Map();}
 addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
 removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
 fire(type,event={}){for(const fn of this.events.get(type)||[])fn(event);}
}
function harness(){
 const observers={};function observer(name){return class{constructor(fn){this.fn=fn;this.targets=new Set();observers[name]=this;}observe(n){this.targets.add(n);}unobserve(n){this.targets.delete(n);}disconnect(){this.targets.clear();}};}
 const win=new Events(),doc=new Events(),media=new Events(),rafs=new Map();let id=0;
 media.matches=false;doc.hidden=false;doc.body={};doc.querySelectorAll=()=>[];win.devicePixelRatio=2;
 Object.assign(win,{IntersectionObserver:observer('intersection'),ResizeObserver:observer('resize'),MutationObserver:observer('mutation'),matchMedia:()=>media,requestAnimationFrame:fn=>{const n=++id;rafs.set(n,fn);assert.ok(rafs.size<=1,'duplicate RAF');return n;},cancelAnimationFrame:n=>rafs.delete(n)});
 const control=createCardMotionController({document:doc,window:win,random:()=>.2,cacheLimit:3});
 function canvas(key){const ctx=context();return {dataset:{cardMotion:key},isConnected:true,width:1,height:1,ctx,matches:s=>s==='canvas[data-card-motion]',querySelectorAll:()=>[],getContext:()=>ctx,getBoundingClientRect:()=>({width:260,height:350})};}
 function add(n){n.isConnected=true;observers.mutation.fn([{addedNodes:[n],removedNodes:[]}]);observers.intersection.fn([{target:n,isIntersecting:true}]);}
 function remove(n){n.isConnected=false;observers.mutation.fn([{addedNodes:[],removedNodes:[n]}]);}
 function frame(now){const entry=rafs.entries().next().value;if(!entry)return;rafs.delete(entry[0]);entry[1](now);}
 return {control,win,doc,media,rafs,observers,canvas,add,remove,frame};
}
test('DOM replacement and resize preserve particle phase instead of replaying the card background',()=>{
 const h=harness(),old=h.canvas('same-instance');h.add(old);h.frame(100);h.frame(140);
 const before=JSON.stringify(old.ctx.lines);assert.ok(old.ctx.lines.length);
 h.remove(old);assert.equal(h.rafs.size,0);assert.equal(old.width,1);
 const next=h.canvas('same-instance');h.add(next);assert.equal(JSON.stringify(next.ctx.lines),before);
 h.observers.resize.fn([{target:next,contentRect:{width:520,height:700}}]);assert.equal(JSON.stringify(next.ctx.lines),before);
 assert.equal(h.control.inspect().cached,1);h.control.destroy();
});
test('one RAF serves visible cards; hidden, detached and reduced-motion cards consume no animation loop',()=>{
 const h=harness(),a=h.canvas('a'),b=h.canvas('b');h.add(a);h.add(b);assert.equal(h.rafs.size,1);
 assert.equal(a.width,390);h.doc.hidden=true;h.doc.fire('visibilitychange');assert.equal(h.rafs.size,0);
 h.doc.hidden=false;h.doc.fire('visibilitychange');assert.equal(h.rafs.size,1);
 h.media.matches=true;h.media.fire('change');assert.equal(h.rafs.size,0);h.media.matches=false;h.media.fire('change');assert.equal(h.rafs.size,1);
 h.win.fire('pagehide');assert.equal(h.rafs.size,0);h.win.fire('pageshow');assert.equal(h.rafs.size,1);
 h.observers.intersection.fn([{target:a,isIntersecting:false},{target:b,isIntersecting:false}]);assert.equal(h.rafs.size,0);
 assert.equal(a.width,1);assert.equal(b.width,1);
 h.observers.resize.fn([{target:a,contentRect:{width:520,height:700}}]);assert.equal(a.width,1,'offscreen resize must not allocate a bitmap');
 const fresh=h.canvas('fresh-offscreen');h.observers.mutation.fn([{addedNodes:[fresh],removedNodes:[]}]);h.observers.resize.fn([{target:fresh,contentRect:{width:520,height:700}}]);assert.equal(fresh.width,1);h.remove(fresh);
 h.observers.intersection.fn([{target:a,isIntersecting:true}]);assert.equal(a.width,390);assert.equal(h.control.inspect().cached,2);assert.equal(h.rafs.size,1);
 h.remove(a);h.remove(b);assert.equal(h.control.inspect().cards,0);
 for(let i=0;i<20;i++){const c=h.canvas('extra-'+i);h.add(c);h.remove(c);}assert.ok(h.control.inspect().cached<=3);
 h.control.destroy();assert.equal(h.control.inspect().cached,0);assert.equal(h.rafs.size,0);
});
