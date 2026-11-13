import {clamp,rounded} from './flow-state.js';
import {chooseBounded} from './action-policy.js';

// This owns only non-default V3.3 corner routines. Penalties and free kicks keep
// their existing taker, trait and shot-resolution rules.
export function resolveCornerRoutine(match,index,sourceZone,helpers) {
  const {reserve,event,metric,roll,shot,taker}=helpers,team=match.teams[index],other=match.teams[1-index];
  if(!taker||!reserve(18,'cornerSetup'))return {outcome:'timeExpired',xg:0};
  const roster=team.players.filter(p=>p.active&&(p.assignedRole??p.role)!=='GK'&&p.id!==taker.id);
  const routine=team.setPieceRoutine,commitment=team.setPieceCommitment;
  const protectedCount=({protect:4,balanced:3,attack:2})[commitment]??3;
  const ordered=[...roster].sort((a,b)=>(team.positions[b.id]?.y??0)-(team.positions[a.id]?.y??0)||String(a.id).localeCompare(String(b.id)));
  const protection=ordered.slice(0,protectedCount),remaining=ordered.slice(protectedCount);
  const second=[...remaining].sort((a,b)=>metric(index,b,{passing:.5,offBall:.5})-metric(index,a,{passing:.5,offBall:.5})||String(a.id).localeCompare(String(b.id)))[0];
  const targets=remaining.filter(p=>p.id!==second?.id);
  const lane=String(sourceZone??'box:farLeft').split(':')[1];
  const left=!['farRight','rightHalfSpace'].includes(lane),nearX=left?35:65,farX=100-nearX;
  const x=routine==='far'?farX:routine==='near'?nearX:50;
  for(const player of roster) {
    const old=match.flowState.shapes[index][player.id]??team.positions[player.id]??{x:50,y:60};
    const destination=protection.includes(player)?{x:old.x,y:62}:player===second?{x:50,y:32}:{x,y:12};
    const distance=Math.hypot(destination.x-old.x,destination.y-old.y);
    const speed=match.parameters.v32.movementUnitsPerSecond*(.65+Number(player.attributes?.pace??70)/180)*(.7+player.state.fitness*.003);
    const f=distance?Math.min(1,18*speed/distance):0;
    match.flowState.shapes[index][player.id]={x:rounded(old.x+(destination.x-old.x)*f),y:rounded(old.y+(destination.y-old.y)*f)};
  }
  event('cornerPlan',index,`${team.name}组织${({near:'近点',far:'远点',short:'短角球',balanced:'均衡'})[routine]}配合，${targets.length}人抢点、${second?1:0}人争二点、${protection.length}人留守。`,
    {cornerRoutine:routine,commitment,targetIds:targets.map(p=>p.id),secondBallId:second?.id??null,protectedIds:protection.map(p=>p.id)});
  const restart=()=>{
    if(match.activeFlowChain)match.activeFlowChain.setPieceRestart={owner:1-index,zone:'buildUp:center',phase:'progression',lostTeam:index};
    return {outcome:'cleared',xg:0};
  };
  const defenders=other.players.filter(p=>p.active&&(p.assignedRole??p.role)!=='GK');
  const target=chooseBounded(targets,p=>metric(index,p,routine==='near'?{offBall:.5,acceleration:.3,heading:.2}:{heading:.45,jumping:.3,offBall:.25}),()=>roll('decision'));
  const marker=chooseBounded(defenders,p=>metric(1-index,p,{marking:.4,heading:.3,jumping:.3}),()=>roll('decision'));
  if(!target)return restart();
  const delivery=metric(index,taker,{setPieces:.5,crossing:.3,passing:.2});
  const opposition=marker?metric(1-index,marker,{marking:.4,heading:.3,jumping:.3}):50;
  if(routine==='short') {
    if(!second||!reserve(5,'shortCornerPass'))return restart();
    const probability=clamp(.72+(metric(index,second,{passing:.5,composure:.5})-opposition)/250,.35,.9);
    const success=roll('execution')<probability;
    event('cornerPass',index,`${taker.name}与${second.name}进行短角球配合，${success?'完成接应':'传递被破坏'}。`,{cornerRoutine:routine,actorId:taker.id,targetId:second.id,probability,success});
    if(!success)return restart();
  }
  const deliveryProbability=clamp(.62+(delivery-opposition)/240,.25,.9);
  const duelProbability=clamp(.48+(metric(index,target,{heading:.4,jumping:.3,offBall:.3})-opposition)/230,.18,.82);
  const firstWon=roll('execution')<deliveryProbability&&roll('execution')<duelProbability;
  let shooter=target,creator=routine==='short'?second:taker,xg=routine==='far'?.14:routine==='near'?.11:.12,type=routine==='short'?'cutback':'setPiece';
  if(!firstWon) {
    if(!second||!reserve(4,'cornerSecondBall'))return restart();
    const probability=clamp(.28+(metric(index,second,{offBall:.5,passing:.5})-opposition)/250,.1,.55);
    const recovered=roll('execution')<probability;
    event('secondBall',index,`${second.name}争抢角球二点，${recovered?'控制落点继续进攻':'对手解围并获得球权'}。`,{cornerRoutine:routine,actorId:second.id,recovered,probability});
    if(!recovered)return restart();
    shooter=second;creator=taker;xg=.055;type='longShot';
  }
  const before=match.events.length;
  const result=shot(shooter,creator,xg,type,`box:${x<45?'leftHalfSpace':x>55?'rightHalfSpace':'center'}`);
  for(const entry of match.events.slice(before))if(['goal','miss','save','block'].includes(entry.type))entry.cornerRoutine=routine;
  return result;
}
