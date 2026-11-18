import {clamp} from './world.js';

// Read-only sampling. It never imports or advances the match engine.
export function sampleReplay(frames,time) {
  if(!frames.length)return null;
  const target=clamp(time,frames[0].time,frames.at(-1).time);
  let lo=0,hi=frames.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(frames[mid].time<=target)lo=mid;else hi=mid-1;}
  const a=frames[lo],b=frames[Math.min(lo+1,frames.length-1)];
  const t=b.time>a.time?(target-a.time)/(b.time-a.time):0;
  // Restarts are explicit discontinuities. Do not invent a flight across a dead ball.
  const blend=a.restartSerial===b.restartSerial?t:0;
  const mix=(x,y)=>x+(y-x)*blend;
  const value=structuredClone(a);value.time=target;
  value.players=value.players.map((p,i)=>({...p,x:mix(p.x,b.players[i].x),y:mix(p.y,b.players[i].y)}));
  value.ball.x=mix(a.ball.x,b.ball.x);value.ball.y=mix(a.ball.y,b.ball.y);
  value.ball.z=mix(a.ball.z??0,b.ball.z??0);
  if(value.clock){
    if(a.phase==='halftime')value.clock.intervalRemaining=Math.max(0,a.clock.intervalRemaining-(target-a.time));
    else if(a.phase!=='finished'&&!a.shootout)value.clock.elapsed=a.clock.elapsed+(target-a.time);
  }
  return value;
}
export const eventsAt=(events,time)=>events.filter(e=>e.time<=time+1e-7);
export function playbackRate(events,time,baseRate,slowMotion=true) {
  // Start slowing at the shot event, never reveal an outcome before its timestamp.
  const last=eventsAt(events,time).findLast(e=>['shot','shootoutShot','parry','deflection','woodwork'].includes(e.type));
  return slowMotion&&last&&time-last.time<(last.type==='shot'?2:3)?Math.min(baseRate,.6):baseRate;
}
