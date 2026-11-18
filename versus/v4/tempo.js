import {distance,round,coordinates} from './world.js';
import {activePlayers} from './rules.js';
import {effectiveTactics} from './tactical-plan.js';

export function controlPlan(state,player,time){
  const nearest=Math.min(...activePlayers(state).filter(p=>p.side!==player.side).map(p=>distance(p,player)));
  const tactics=effectiveTactics(state,player.side);
  const duration=(nearest<3?1.0:2.0+(1-tactics.directness)*1.8)*(tactics.clockManagement==='quick'?.8:tactics.clockManagement==='slow'?1.25:1)*(1+(.5-tactics.tempo)*.8);
  const {worldPoint,localPoint}=coordinates(state),local=localPoint(player,player.side);
  return {at:round(time),until:round(time+duration),duration:round(duration),pressureDistance:round(nearest),
    target:worldPoint({x:Math.min(101,local.x+.8),y:local.y},player.side)};
}
export function readyToDecide(state,player){
  if(player.nextDecision<=state.time)return true;
  // Pressure permits a quick outlet after a real first touch, not instantaneous repeated passing.
  if(!player.control||state.time<player.control.at+.8)return false;
  return activePlayers(state).some(p=>p.side!==player.side&&distance(p,player)<2);
}
export function updateProgress(state){
  const holder=state.players.find(p=>p.key===state.ball.holder);if(!holder)return;
  const x=coordinates(state).localPoint(holder,holder.side).x,old=state.progress;
  if(!old||old.side!==holder.side||old.restartSerial!==state.restartSerial)state.progress={side:holder.side,maxX:x,at:state.time,restartSerial:state.restartSerial};
  else if(x>old.maxX+3){old.maxX=x;old.at=state.time;}
}
export function progressUrgency(state,side){
  const p=state.progress;if(!p||p.side!==side)return 0;
  const tactics=effectiveTactics(state,side),patience=tactics.clockManagement==='slow'?1.5:tactics.clockManagement==='quick'?.7:1;
  return Math.max(0,Math.min(1,(state.time-p.at-3*patience)/(6*patience)))*.18;
}
