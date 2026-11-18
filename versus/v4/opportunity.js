import {clamp,coordinates,distance,round} from './world.js';
import {keeperContactRadius} from './ball-control.js';

// Geometric decision evidence, not xG or a preselected outcome. The kick and contacts still resolve physically.
export function shotOpportunity(state,carrier){
  const {worldPoint,localPoint}=coordinates(state),p=localPoint(carrier,carrier.side);
  const opponents=state.players.filter(q=>q.active!==false&&q.side!==carrier.side);
  const keeper=opponents.find(q=>q.role==='GK');
  const pressure=Math.min(...opponents.map(q=>distance(q,carrier)));
  const goal=worldPoint({x:105,y:34},carrier.side),d=distance(carrier,goal);
  const angle=Math.abs(Math.atan2(7.32*(105-p.x),(105-p.x)**2+(30.34-p.y)*(37.66-p.y)));
  const speed=24+carrier.attributes.finishing*.06;
  const aims=(state.pendingPenalty||state.shootout?.current?[-2.5,0,2.5]:[-3,0,3]).map(offset=>{
    const target=worldPoint({x:105,y:34+offset},carrier.side),dx=target.x-carrier.x,dy=target.y-carrier.y,length=Math.hypot(dx,dy);
    const blockers=[];
    for(const q of opponents.filter(q=>q.role!=='GK')){
      const u=((q.x-carrier.x)*dx+(q.y-carrier.y)*dy)/(length*length);
      if(u<=0||u>=1)continue;
      const at=length*u/speed;
      const predicted={x:q.x+q.vx*Math.min(at,.35),y:q.y+q.vy*Math.min(at,.35)};
      const crossing={x:carrier.x+dx*u,y:carrier.y+dy*u},gap=distance(predicted,crossing);
      if(gap<1.5)blockers.push({key:q.key,gap:round(gap),ballArrival:round(at)});
    }
    const keeperU=keeper?clamp(((keeper.x-carrier.x)*dx+(keeper.y-carrier.y)*dy)/(length*length),0,1):1;
    const keeperCrossing={x:carrier.x+dx*keeperU,y:carrier.y+dy*keeperU};
    const keeperGap=keeper?distance(keeper,keeperCrossing):12;
    const keeperReach=keeper?keeperContactRadius(keeper,Boolean(state.pendingPenalty||state.shootout?.current))+Math.max(0,length*keeperU/speed-.18)*(3.4+keeper.attributes.pace*.043)*.4:0;
    const keeperCoverage=clamp((keeperReach-keeperGap+2)/4,0,1);
    const obstruction=blockers.reduce((sum,b)=>sum+(1.5-b.gap)/1.5,0);
    return {target,offset,blockers,obstruction,keeperGap,keeperCoverage,aimValue:-obstruction*1.3-keeperCoverage*1.35-Math.abs(offset)*.025};
  }).sort((a,b)=>round(b.aimValue)-round(a.aimValue)||a.offset-b.offset);
  const best=aims[0];
  const factors={distance:3.0*clamp((33-d)/22,0,1),angle:1.0*clamp(angle/.55,0,1.2),
    space:.35*clamp((pressure-1)/5,0,1),pressure:-1.2*clamp((3-pressure)/3,0,1),finishing:carrier.attributes.finishing*.006,
    obstruction:-best.obstruction*1.3,keeper:-best.keeperCoverage*1.35};
  const utility=Object.values(factors).reduce((sum,n)=>sum+n,0);
  return {target:best.target,utility,reason:best.blockers.length?'射门线路仍有封堵，比较横传或回做后的空间':'比较球门张角、距离、压力与门将覆盖，选择可用射门线路',
    evidence:{distance:round(d),angleDegrees:round(angle*180/Math.PI),pressureDistance:round(pressure),
      aimOffset:best.offset,blockers:best.blockers,keeper:keeper?.key??null,keeperGap:round(best.keeperGap),keeperCoverage:round(best.keeperCoverage),
      factors:Object.fromEntries(Object.entries(factors).map(([key,value])=>[key,round(value)||0]))}};
}

export function candidateSummary(c){
  return {type:c.type,to:c.to??null,utility:round(c.utility),reason:c.reason,trajectory:c.trajectory??'ground',
    ...(Number.isFinite(c.tacticalBias)?{tacticalBias:round(c.tacticalBias)}:{}),
    ...(Number.isFinite(c.progressUrgency)?{progressUrgency:round(c.progressUrgency)}:{}),
    ...(Number.isFinite(c.leadSeconds)?{receiverLeadSeconds:round(c.leadSeconds)}:{}),
    ...(c.intent?{intent:c.intent}:{}),...(Number.isFinite(c.margin)?{arrivalMargin:round(c.margin)}:{}),
    ...(c.opportunity?{opportunity:structuredClone(c.opportunity)}:{})};
}

// Keep the chosen action and a competing shot visible even if several passes rank above it.
export function decisionTrace(choice,candidates){
  const alternatives=candidates.filter(c=>c.type!==choice.type||(c.to??null)!==(choice.to??null)||(c.trajectory??'ground')!==(choice.trajectory??'ground'));
  const considered=[choice,...alternatives.slice(0,2)];
  const shot=candidates.find(c=>c.type==='shot');
  if(shot&&!considered.includes(shot))considered[considered.length-1]=shot;
  const alternative=alternatives[0];
  return {selected:choice.type,utility:round(choice.utility),candidates:considered.map(candidateSummary),
    considered:{shot:Boolean(shot),weakSide:candidates.some(c=>c.intent==='switch'&&c.onside!==false),cutback:candidates.some(c=>c.intent==='cutback'&&c.onside!==false),
      forwardOptions:candidates.filter(c=>c.intent==='forward'&&c.onside!==false).length},
    alternative:alternative?candidateSummary(alternative):null,
    comparison:alternative?`${choice.reason}；同时考虑${alternative.type==='shot'?'射门':alternative.type==='carry'?'带球':alternative.intent==='layoff'?'回做':alternative.intent==='square'?'横传':'传球'}（比较分 ${round(alternative.utility)}）`:choice.reason};
}
