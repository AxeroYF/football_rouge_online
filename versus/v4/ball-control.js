import {clamp,distance,localPoint,direction,round} from './world.js';
import {activePlayers,inPenaltyArea} from './rules.js';
import {positionExecution} from './execution.js';

export const keeperContactRadius=(player,penalty=false)=>penalty?.65+player.attributes.goalkeeping*.006:.9+player.attributes.goalkeeping*.014;

// Physical contact is checked by the engine before this quality model is used.
export function controlProfile(state,player,ball) {
  const speed=Math.hypot(ball.vx,ball.vy),relative=Math.hypot(ball.vx-player.vx,ball.vy-player.vy);
  const pressure=Math.min(...activePlayers(state).filter(p=>p.side!==player.side).map(p=>distance(p,player)));
  const incoming=Math.atan2(-ball.vy,-ball.vx),alignment=(1+Math.cos(player.facing-incoming))/2;
  const keeper=player.role==='GK'&&inPenaltyArea(player,player.side,state);
  const shot=ball.flight?.kind==='shot';
  const skill=clamp((keeper&&shot?player.attributes.goalkeeping:player.attributes.firstTouch)*positionExecution(player),1,100);
  let probability=.86+skill*.002-relative*.004-(1-alignment)*.07-(pressure<3?(3-pressure)*.025:0)-(100-player.fitness)*.0006;
  if(shot)probability=.50+skill*.005-relative*.009-(1-alignment)*.15-(pressure<3?(3-pressure)*.045:0)-(100-player.fitness)*.002;
  if(shot&&!keeper)probability-=.33;
  if(keeper&&shot)probability+=player.attributes.reflexes*.001;
  if(keeper&&ball.z>1)probability-=(ball.z-1)*.035;
  return {probability:clamp(probability,shot&&!keeper?.08:.22,.97),speed:round(speed),relativeSpeed:round(relative),
    pressureDistance:round(pressure),alignment:round(alignment),height:round(ball.z??0),skill,keeper,shot};
}

export function looseVelocity(ball,player,profile,roll,state) {
  const angle=(roll-.5)*1.2;
  if(profile.keeper&&profile.shot) {
    // Parry out into the pitch, with a lateral component. It is not assigned to a teammate.
    return {vx:direction(player.side,state)*clamp(profile.speed*.25,3,9),vy:(ball.y<34?-1:1)*clamp(profile.speed*.19,2,6)+(roll-.5)*2,kind:'parry'};
  }
  if(profile.shot) {
    const normal=player.facing+Math.PI/2+angle,speed=clamp(profile.speed*.28,3,8);
    return {vx:Math.cos(normal)*speed,vy:Math.sin(normal)*speed,kind:'block'};
  }
  const base=Math.atan2(ball.vy,ball.vx)+angle,speed=clamp(profile.relativeSpeed*.22+(100-profile.skill)*.025,1.5,6);
  return {vx:Math.cos(base)*speed,vy:Math.sin(base)*speed,kind:'miscontrol'};
}

export function boundaryCrossing(start,end) {
  let alpha=Infinity;
  if(end.x<=0&&end.x<start.x)alpha=Math.min(alpha,(0-start.x)/(end.x-start.x));
  if(end.x>=105&&end.x>start.x)alpha=Math.min(alpha,(105-start.x)/(end.x-start.x));
  if(end.y<=0&&end.y<start.y)alpha=Math.min(alpha,(0-start.y)/(end.y-start.y));
  if(end.y>=68&&end.y>start.y)alpha=Math.min(alpha,(68-start.y)/(end.y-start.y));
  return alpha;
}
