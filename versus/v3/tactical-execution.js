import {clamp,zonePoint,flipFlowZone} from './flow-state.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const role=player=>player.assignedRole??player.role;
export function prepareDefensiveAssignments(teams,flow) {
  const index=1-flow.owner,team=teams[index],ball=zonePoint(flipFlowZone(flow.zone));
  const positions=flow.shapes[index],players=team.players.filter(p=>p.active!==false&&role(p)!=='GK');
  const nearest=(point,excluded=[])=>players.filter(p=>!excluded.includes(p.id)).sort((a,b)=>distance(positions[a.id]??{x:50,y:70},point)-distance(positions[b.id]??{x:50,y:70},point)||String(a.id).localeCompare(String(b.id)))[0];
  const trigger=team.pressTrigger??'balanced';
  const triggered=trigger==='backPass'?flow.previousAction?.type==='recycle'&&flow.previousAction.teamIndex===flow.owner:
    trigger==='wide'?['farLeft','farRight'].includes(flow.zone.split(':')[1]):trigger==='ownHalf'?ball.y>=50:false;
  const assignments=[],pressers=[];
  if(triggered) {
    const first=nearest(ball);
    // A trigger is not a teleport: only a nearby player can start the press.
    if(first&&distance(positions[first.id]??ball,ball)<=30) {
      const screening=team.pressAssignment==='screen';
      assignments.push({playerId:first.id,target:{x:ball.x,y:clamp(ball.y+(screening?9:2),3,97)},role:screening?'screen':'press'});
      pressers.push(first.id);
      const cover=nearest({x:50,y:ball.y+14},pressers);
      if(cover)assignments.push({playerId:cover.id,target:{x:ball.x*.35+50*.65,y:clamp(ball.y+14,5,95)},role:'cover'});
    }
  }
  const focus=team.defensiveFocus??'balanced',opponent=teams[flow.owner];
  const targets=opponent.players.filter(p=>p.active!==false&&(
    focus==='creator'?['AM','CM','DM'].includes(role(p)):focus==='striker'?role(p)==='ST':focus==='wide'?['LW','RW','LM','RM'].includes(role(p)):false));
  const target=targets.sort((a,b)=>Number(b.attributes?.[focus==='creator'?'passing':'offBall']??0)-Number(a.attributes?.[focus==='creator'?'passing':'offBall']??0)||String(a.id).localeCompare(String(b.id)))[0];
  if(target) {
    const attackingPoint=flow.shapes[flow.owner][target.id];
    if(attackingPoint) {
      const point={x:100-attackingPoint.x,y:100-attackingPoint.y},marker=nearest(point,assignments.map(a=>a.playerId));
      if(marker&&distance(positions[marker.id]??point,point)<=30)assignments.push({playerId:marker.id,target:{x:point.x,y:clamp(point.y+3,3,97)},role:'mark',targetId:target.id});
    }
  }
  flow.defenseAssignments=[[],[]];flow.defenseAssignments[index]=assignments;
  return {teamIndex:index,trigger:pressers.length?trigger:null,pressers,mark:assignments.find(a=>a.role==='mark')??null};
}

export function buildUpPreference(team,target,zone,pressure) {
  const early=['defensiveThird','buildUp'].includes(zone.split(':')[0]);
  if(!early)return {bonus:0,receiverId:null,reasons:[]};
  const lane=target.split(':')[1],route=team.buildUpRoute??'balanced';
  const preferred=route==='left'?['farLeft','leftHalfSpace'].includes(lane):route==='right'?['farRight','rightHalfSpace'].includes(lane):route==='center'?lane==='center':false;
  const point=zonePoint(target),outlet=team.buildUpOutlet??'balanced';
  const receiver=team.players.filter(p=>(outlet==='pivot'?role(p)==='DM':outlet==='target'?role(p)==='ST':false)&&distance(p.localPosition??point,point)<=22)
    .sort((a,b)=>distance(a.localPosition??point,point)-distance(b.localPosition??point,point)||String(a.id).localeCompare(String(b.id)))[0];
  const reasons=[];
  if(preferred)reasons.push('preferredRoute');if(receiver)reasons.push('preferredOutlet');
  return {bonus:(preferred?.09:0)+(receiver?.07:0),receiverId:receiver?.id??null,reasons};
}

export function tacticalProcessSummary(match) {
  const teams=match.teams.map(team=>({name:team.name,press:{attempts:0,recoveries:0,playerSeconds:0},mark:{actions:0,turnovers:0},
    build:{preferredRoute:0,preferredOutlet:0,escape:0,successes:0,attempts:0},corners:{attempts:0,shots:0,secondBalls:0},rotations:0,blockedZones:{}}));
  for(const chain of match.chains??[])for(const action of chain.actions??[]) {
    const attack=teams[chain.attackingTeamIndex],defense=teams[1-chain.attackingTeamIndex];
    if(action.pressure?.trigger){defense.press.attempts++;defense.press.recoveries+=Number(action.turnover===true);defense.press.playerSeconds+=action.seconds*action.pressure.pressers.length;}
    if(action.pressure?.mark){defense.mark.actions++;defense.mark.turnovers+=Number(action.turnover===true);}
    if(action.reasons?.length){attack.build.attempts++;attack.build.successes+=Number(action.success);for(const reason of action.reasons)if(Object.hasOwn(attack.build,reason))attack.build[reason]++;}
    if(action.turnover)attack.blockedZones[action.to]=(attack.blockedZones[action.to]??0)+1;
  }
  for(const event of match.events??[]) {
    const team=teams[event.teamIndex];if(!team)continue;
    if(event.type==='cornerPlan')team.corners.attempts++;
    if(event.type==='secondBall'&&event.recovered)team.corners.secondBalls++;
    if(event.type==='substitution'&&event.reason==='conditional')team.rotations++;
  }
  for(const team of teams)team.press.playerSeconds=Math.round(team.press.playerSeconds);
  for(const event of match.events??[])if(['goal','save','miss','block'].includes(event.type)&&event.cornerRoutine) {
    const index=event.attackingTeamIndex??(event.type==='save'?1-event.teamIndex:event.teamIndex);teams[index].corners.shots++;
  }
  return {version:1,teams};
}
