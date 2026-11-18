import {clamp} from './world.js';
export const GRAVITY=9.81;
export const GOAL_HEIGHT=2.44;
const FRAME_RADIUS=.17; // Approximate ball + round goal-frame radii.

export function verticalAt(ball,seconds){
  if(!ball.airborne)return {z:ball.z??0,vz:0};
  const z=(ball.z??0)+(ball.vz??0)*seconds-GRAVITY*seconds*seconds/2;
  return z>0?{z,vz:(ball.vz??0)-GRAVITY*seconds}:{z:0,vz:0};
}
export function launchVertical(z,targetZ,duration){
  return {z,vz:(targetZ-z+GRAVITY*duration*duration/2)/duration,airborne:true};
}
export function aerialReach(player,keeper=false){
  return (player.heightCm??180)/100+(keeper?.45+player.attributes.goalkeeping*.006:.15+(player.attributes.jumping??70)*.006);
}

// Intersect the complete planar contact interval with the reachable height
// interval, rather than testing height only at the first 2D intersection.
export function sweptAerialContact(start,end,from,to,radius,ball,duration,reach){
  const x=start.x-from.x,y=start.y-from.y,dx=end.x-start.x-(to.x-from.x),dy=end.y-start.y-(to.y-from.y);
  const a=dx*dx+dy*dy,b=2*(x*dx+y*dy),c=x*x+y*y-radius*radius;
  let enter=0,leave=1;
  if(a<1e-12){if(c>0)return null;}
  else {const disc=b*b-4*a*c;if(disc<0)return null;const root=Math.sqrt(disc);enter=Math.max(0,(-b-root)/(2*a));leave=Math.min(1,(-b+root)/(2*a));if(enter>leave)return null;}
  if(verticalAt(ball,enter*duration).z<=reach+1e-8)return enter;
  if(!ball.airborne)return null;
  const disc=(ball.vz??0)**2+2*GRAVITY*((ball.z??0)-reach);
  if(disc<0)return null;
  const descending=((ball.vz??0)+Math.sqrt(disc))/GRAVITY/duration;
  return descending>=enter-1e-8&&descending<=leave+1e-8?clamp(descending,enter,leave):null;
}

// Conservative advancement against 3D capsules prevents fast balls tunnelling
// through posts between simulation ticks. Only evaluated near either goal.
export function goalFrameContact(ball,duration){
  if(Math.min(ball.x,ball.x+ball.vx*duration)>.3&&Math.max(ball.x,ball.x+ball.vx*duration)<104.7)return null;
  const speed=Math.hypot(ball.vx,ball.vy,ball.airborne?Math.max(Math.abs(ball.vz??0),Math.abs((ball.vz??0)-GRAVITY*duration)):0);
  if(speed<1e-9)return null;
  let best=null;
  for(const x of [0,105])for(const kind of ['nearPost','farPost','crossbar']){
    const nearest=point=>kind==='crossbar'?{x,y:clamp(point.y,30.34,37.66),z:GOAL_HEIGHT}:{x,y:kind==='nearPost'?30.34:37.66,z:clamp(point.z,0,GOAL_HEIGHT)};
    let t=0;
    for(let i=0;i<128&&t<=duration+1e-9;i++){
      const vertical=verticalAt(ball,t),point={x:ball.x+ball.vx*t,y:ball.y+ball.vy*t,z:vertical.z},q=nearest(point);
      const v={x:point.x-q.x,y:point.y-q.y,z:point.z-q.z},d=Math.hypot(v.x,v.y,v.z),gap=d-FRAME_RADIUS;
      const n=d>1e-10?{x:v.x/d,y:v.y/d,z:v.z/d}:{x:ball.vx>0?-1:1,y:0,z:0};
      const approach=ball.vx*n.x+ball.vy*n.y+vertical.vz*n.z;
      if(t===0&&gap<1e-5&&approach>=0)break;
      if(gap<=1e-6){if(!best||t<best.time)best={time:t,alpha:t/duration,point,normal:n,kind,vz:vertical.vz};break;}
      t+=Math.max(1e-8,gap/speed*.95);
    }
  }
  return best;
}
export function frameRebound(ball,hit){
  const normal=hit.normal,dot=ball.vx*normal.x+ball.vy*normal.y+hit.vz*normal.z;
  return {vx:ball.vx-1.65*dot*normal.x,vy:ball.vy-1.65*dot*normal.y,vz:hit.vz-1.65*dot*normal.z};
}
