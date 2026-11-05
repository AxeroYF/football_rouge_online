// Persistent particles in the shield's 520 x 700 design space.
// A particle is recycled only after its entire trail has left the card.
export const CARD_MOTION_SIZE = Object.freeze({ width:520, height:700 });
const W=520,H=700,DX=-.8,DY=.6;
function randomGenerator(seed){return()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);}
export function cardMotionSeed(key){let hash=2166136261;for(const c of String(key))hash=Math.imul(hash^c.charCodeAt(0),16777619);return hash>>>0;}
function meteor(state,initial=false){
  const r=state.random,offset=r()*(W*.6+H*.8),x=offset<=W*.6?offset/.6:W,y=offset<=W*.6?0:(offset-W*.6)/.8;
  const exit=Math.min(x/-DX,(H-y)/DY),length=58+r()*94;
  return {x,y,dx:DX,dy:DY,exit,length,distance:initial?-30+r()*(exit+length+60):-30,speed:245+r()*135,alpha:.5+r()*.4,width:.8+r()*1.2,generation:0};
}
function rayExit(x,y,dx,dy){return Math.min(dx>0?(W-x)/dx:dx<0?-x/dx:Infinity,dy>0?(H-y)/dy:dy<0?-y/dy:Infinity);}
export function warpTrailLength(radius){return Math.min(128,2+radius*.22+radius*radius*.00012);}
function star(state,initial=false){
  const r=state.random,angle=r()*Math.PI*2,dx=Math.cos(angle),dy=Math.sin(angle),x=W*.70,y=H*.23,exit=rayExit(x,y,dx,dy);
  return {x,y,dx,dy,exit,radius:initial?3+r()*(exit+75):3+r()*5,rate:2.1+r()*1.15,width:.6+r()*.8,tint:r(),generation:0};
}
export function createCardMotionState(mode,seed=9137){
  const state={mode:mode==='meteor'?'meteor':'warp',random:randomGenerator(seed>>>0),elapsed:0,particles:[]};
  state.particles=Array.from({length:state.mode==='meteor'?34:112},()=>state.mode==='meteor'?meteor(state,true):star(state,true));
  return state;
}
export function advanceCardMotion(state,seconds){
  const dt=Math.max(0,Math.min(.08,Number(seconds)||0));state.elapsed+=dt;
  for(let i=0;i<state.particles.length;i++){
    const p=state.particles[i];
    if(state.mode==='meteor'){
      p.distance+=p.speed*dt;
      if(p.distance-p.length>p.exit+24){const next=meteor(state);next.generation=p.generation+1;state.particles[i]=next;}
    }else{
      p.radius=(p.radius+14)*Math.exp(p.rate*dt)-14;
      if(p.radius-warpTrailLength(p.radius)>p.exit+24){const next=star(state);next.generation=p.generation+1;state.particles[i]=next;}
    }
  }
}
export function drawCardMotion(ctx,state,{stride=1}={}){
  ctx.save();ctx.lineCap='round';
  if(state.mode==='warp'){
    const haze=ctx.createRadialGradient(W*.7,H*.23,0,W*.7,H*.23,W*.54);
    haze.addColorStop(0,'rgba(164,210,255,.14)');haze.addColorStop(1,'rgba(39,78,210,0)');ctx.fillStyle=haze;ctx.fillRect(0,0,W,H);
  }
  for(let i=0;i<state.particles.length;i+=stride){
    const p=state.particles[i],isMeteor=state.mode==='meteor';
    const distance=isMeteor?p.distance:p.radius,length=isMeteor?p.length:warpTrailLength(p.radius);
    const x=p.x+p.dx*distance,y=p.y+p.dy*distance,tx=x-p.dx*length,ty=y-p.dy*length;
    if((x<-10&&tx<-10)||(x>W+10&&tx>W+10)||(y<-10&&ty<-10)||(y>H+10&&ty>H+10))continue;
    const gradient=ctx.createLinearGradient(tx,ty,x+.001,y+.001);
    const color=isMeteor?'193,255,240':p.tint>.82?'244,225,171':p.tint>.4?'215,238,255':'158,199,255';
    const alpha=isMeteor?p.alpha:Math.min(1,p.radius/22)*Math.min(.95,.35+p.radius/420);
    gradient.addColorStop(0,`rgba(${color},0)`);gradient.addColorStop(.75,`rgba(${color},${alpha*.58})`);gradient.addColorStop(1,`rgba(${color},${alpha})`);
    ctx.strokeStyle=gradient;ctx.lineWidth=isMeteor?p.width:(.8+Math.min(2.8,p.radius/150))*p.width;
    ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(x,y);ctx.stroke();
    ctx.fillStyle=isMeteor?`rgba(244,255,249,${alpha})`:`rgba(${color},${alpha})`;
    ctx.beginPath();ctx.arc(x,y,Math.max(.45,ctx.lineWidth*.56),0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
