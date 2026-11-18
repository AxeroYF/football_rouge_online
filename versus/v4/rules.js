import {clamp,distance,localPoint,coordinates,scoringSideAt,direction,round} from './world.js';
import {effectiveTactics} from './tactical-plan.js';

export const RESTART_NAMES=Object.freeze({kickoff:'中圈开球',throwIn:'界外球',goalKick:'球门球',corner:'角球',directFreeKick:'直接任意球',indirectFreeKick:'间接任意球',penalty:'点球'});
export const activePlayers=state=>state.players.filter(p=>p.active!==false);
export const inPenaltyArea=(point,defendingSide,state)=>{const p=localPoint(point,defendingSide,state);return p.x<=16.5&&Math.abs(p.y-34)<=20.16;};

// Point-player representation: equal is onside; all opponents, not just defenders, count.
export function offsideSnapshot(state,kicker,time=state.time,restartType=null) {
  const {localPoint}=coordinates(state);
  if(['throwIn','goalKick','corner'].includes(restartType))return null;
  const opponents=activePlayers(state).filter(p=>p.side!==kicker.side).map(p=>localPoint(p,kicker.side).x).sort((a,b)=>b-a);
  const line=Math.max(52.5,localPoint(state.ball,kicker.side).x,opponents[1]??105);
  return {side:kicker.side,attackDirection:direction(kicker.side,state),kicker:kicker.key,at:round(time),line,ballX:localPoint(state.ball,kicker.side).x,
    secondLastX:opponents[1]??105,candidates:activePlayers(state).filter(p=>p.side===kicker.side&&p.key!==kicker.key&&localPoint(p,kicker.side).x>line+1e-7).map(p=>p.key)};
}
export function offsideInvolvement(state,contactPlayer,point) {
  const offside=state.rules.offside;if(!offside)return null;
  if(offside.candidates.includes(contactPlayer.key))return {player:contactPlayer,kind:'touch',snapshot:offside};
  if(contactPlayer.side!==offside.side){
    const challenger=activePlayers(state).find(p=>offside.candidates.includes(p.key)&&distance(p,point)<1.2&&distance(p,contactPlayer)<1.5);
    if(challenger)return {player:challenger,kind:'challenge',snapshot:offside};
  }
  return null;
}
export function opponentDeliberatePlay(profile,controlled) {
  // A save is never a new offside phase. A failed but controlled opportunity to play a pass can be.
  return !profile.shot&&(controlled||profile.relativeSpeed<24&&profile.alignment>.6&&profile.pressureDistance>1);
}
export function outRestart(point,lastSide,state) {
  const {worldPoint}=coordinates(state);
  if(point.y<=1e-7||point.y>=68-1e-7)return {type:'throwIn',side:1-lastSide,spot:{x:clamp(point.x,.1,104.9),y:point.y<34?0:68}};
  const defendingSide=1-scoringSideAt(state,point.x);
  return lastSide===defendingSide
    ?{type:'corner',side:1-defendingSide,spot:{x:point.x<52.5?.1:104.9,y:point.y<34?.1:67.9}}
    :{type:'goalKick',side:defendingSide,spot:worldPoint({x:5.5,y:34},defendingSide)};
}
export function freeKickSpot(point,side,type,state) {
  const {localPoint,worldPoint}=coordinates(state);
  if(type==='penalty')return worldPoint({x:94,y:34},side);
  const own=localPoint(point,side),other=localPoint(point,1-side);
  if(own.x<5.5&&Math.abs(own.y-34)<9.16)return worldPoint({x:5.5,y:clamp(own.y,24.84,43.16)},side);
  if(type==='indirectFreeKick'&&other.x<5.5&&Math.abs(other.y-34)<9.16)return worldPoint({x:5.5,y:clamp(other.y,24.84,43.16)},1-side);
  return {x:clamp(point.x,.1,104.9),y:clamp(point.y,.1,67.9)};
}
export function foulProfile(state,defender,carrier) {
  const {localPoint,worldPoint,direction}=coordinates(state);
  const speed=Math.hypot(defender.vx-carrier.vx,defender.vy-carrier.vy);
  const approach=Math.atan2(defender.y-carrier.y,defender.x-carrier.x);
  const behind=Math.cos(approach-carrier.facing)<-.4;
  const probability=clamp((.025+(100-defender.attributes.tackling)*.001+speed*.008+(behind?.055:0))*(1+(75-defender.attributes.discipline)*.006),.02,.25);
  const goal=worldPoint({x:105,y:34},carrier.side),local=localPoint(carrier,carrier.side);
  const covering=activePlayers(state).filter(p=>p.side===defender.side&&p.key!==defender.key&&p.role!=='GK'&&
    (localPoint(p,carrier.side).x>local.x&&Math.abs(p.y-carrier.y)<12||distance(p,carrier)<9));
  const dogso=distance(carrier,goal)<22&&Math.abs(local.y-34)<10&&covering.length===0&&Math.cos(carrier.facing-(direction(carrier.side)===1?0:Math.PI))>.7;
  return {probability,speed:round(speed),behind,dogso,penalty:inPenaltyArea(carrier,defender.side,state)};
}
export function foulSanction(profile,severityRoll) {
  // Severity is independent from the foul/no-foul draw. All generated challenges attempt the ball.
  const severity=profile.speed>11.5&&severityRoll<.01*(profile.directRedMultiplier??1)?'excessive':severityRoll<(.09+Math.min(14,profile.speed)*.006+(profile.behind?.04:0))*(profile.cardMultiplier??1)?'reckless':'careless';
  const card=severity==='excessive'?'red':profile.dogso?(profile.penalty?'yellow':'red'):severity==='reckless'?'yellow':null;
  return {severity,card};
}

export function challengeIntent(defender,profile){
  return profile.penalty?clamp(.45+(defender.attributes.tackling-70)*.004+((defender.attributes.aggression??75)-75)*.002-(profile.behind?.18:0)-Math.max(0,profile.speed-4)*.015,.15,.6):1;
}

// Explicit dead-ball arrangement, never interpolated as normal running. The actual kick uses normal ball physics.
export function arrangeRestart(state,restart) {
  const {localPoint,worldPoint,direction}=coordinates(state);
  const players=activePlayers(state),own=players.filter(p=>p.side===restart.side);
  const spot=restart.spot,side=restart.side;
  const taker=restart.type==='goalKick'?own.find(p=>p.role==='GK'):
    [...own].filter(p=>p.role!=='GK').sort((a,b)=>restart.type==='penalty'?b.attributes.finishing-a.attributes.finishing:distance(a,spot)-distance(b,spot)||a.key.localeCompare(b.key))[0];
  for(const p of players){p.vx=0;p.vy=0;p.task=null;p.nextTouch=state.time;p.nextTackle=state.time+.5;}
  if(restart.type==='kickoff')for(const p of players){Object.assign(p,worldPoint({...p.anchor,x:Math.min(p.anchor.x,49)},p.side));}
  if(restart.type==='penalty') {
    let i=0;
    for(const p of players){
      if(p.key===taker.key)continue;
      if(p.side!==side&&p.role==='GK')Object.assign(p,worldPoint({x:105,y:34},side));
      else if(p.side===side&&p.role==='GK')Object.assign(p,worldPoint({x:5,y:34},side));
      else {Object.assign(p,worldPoint({x:82-(i%3)*2,y:12+Math.floor(i/3)*7},side));i++;}
    }
  }
  // Provide short options for ground-only restarts (no invented aerial corner outcome).
  const receivers=own.filter(p=>p.key!==taker.key&&p.role!=='GK').sort((a,b)=>distance(a,spot)-distance(b,spot)).slice(0,2);
  if(restart.type!=='penalty')receivers.forEach((p,i)=>{
    const local=localPoint(spot,side);Object.assign(p,worldPoint({x:restart.type==='kickoff'?42+i*5:clamp(local.x+(local.x>82?-10:10+i*5),5,100),y:clamp(local.y+(local.y<34?1:-1)*(6+i*7),4,64)},side));
  });
  if(restart.type==='corner'){
    const tactics=effectiveTactics(state,side);
    if(['near','far'].includes(tactics.setPieceRoutine)||tactics.setPieceCommitment!=='balanced'){
      const count=tactics.setPieceCommitment==='protect'?2:tactics.setPieceCommitment==='attack'?5:3;
      const runners=own.filter(p=>p.role!=='GK'&&p.key!==taker.key).sort((a,b)=>b.attributes.heading+b.attributes.jumping-a.attributes.heading-a.attributes.jumping||a.key.localeCompare(b.key)).slice(0,count);
      const corner=localPoint(spot,side),near=corner.y<34?29:39,far=corner.y<34?39:29;
      runners.forEach((p,i)=>Object.assign(p,worldPoint({x:98-(i%3)*3,y:i===0?(tactics.setPieceRoutine==='far'?far:near):27+i*3},side)));
      if(['near','far'].includes(tactics.setPieceRoutine))restart.cornerTarget=runners[0]?.key;
      const protect=own.filter(p=>p.role!=='GK'&&p.key!==taker.key&&!runners.includes(p)&&!receivers.includes(p)).sort((a,b)=>a.anchor.x-b.anchor.x);
      protect.forEach((p,i)=>Object.assign(p,worldPoint({x:i<2?55:70,y:clamp(12+i*8,4,64)},side)));
    }
  }
  const clearance=restart.type==='throwIn'?2:9.15;
  for(const p of players.filter(p=>p.side!==side)){
    if(restart.type==='penalty')continue;
    if((restart.type==='goalKick'||inPenaltyArea(spot,side,state))&&inPenaltyArea(p,side,state)){
      const local=localPoint(p,side);Object.assign(p,worldPoint({x:18,y:local.y},side));
    }
    if(restart.type==='kickoff'){const local=localPoint(p,p.side);if(local.x>52.5)Object.assign(p,worldPoint({x:48,y:local.y},p.side));}
    if(distance(p,spot)<clearance+.05){
      let dx=p.x-spot.x,dy=p.y-spot.y;if(Math.hypot(dx,dy)<.01){dx=direction(side);dy=.1;}
      const d=Math.hypot(dx,dy);let target={x:clamp(spot.x+dx/d*(clearance+.2),.1,104.9),y:clamp(spot.y+dy/d*(clearance+.2),.1,67.9)};
      // If clipped at a boundary, use a legal inward offset instead.
      if(distance(target,spot)<clearance)target={x:clamp(spot.x+(spot.x<52.5?1:-1)*(clearance+.2),.1,104.9),y:spot.y};
      Object.assign(p,target);
    }
  }
  Object.assign(taker,spot);
  for(const p of players)p.task={type:'setPiece',target:{x:p.x,y:p.y},partners:[],source:state.input.teams[p.side].preset,
    reason:p.key===taker.key?`主罚${RESTART_NAMES[restart.type]}`:p.role==='GK'?'定位球守门站位':'遵守定位球距离，等待球进入比赛',since:state.time,until:state.time};
  return taker;
}
