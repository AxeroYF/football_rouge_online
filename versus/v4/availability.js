// V4 representation of the established passive-only policy: five substitutions,
// fitness >=45, position match first. No tired/booked-player substitution path.
const group=role=>role==='GK'?'GK':['CB','LB','RB'].includes(role)?'DEF':['DM','CM'].includes(role)?'MID':'ATT';
export function replacementRank(role,p){
  if(p.role===role)return 3;if(p.secondaryRole===role)return 2;
  if(group(p.role)===group(role)||p.secondaryRole&&group(p.secondaryRole)===group(role))return 1;
  return p.utilityPlayer&&role!=='GK'&&p.role!=='GK'?.5:0;
}
const effective=p=>(p.overall??Object.values(p.attributes).reduce((a,b)=>a+b,0)/Object.keys(p.attributes).length)*(.55+.45*p.fitness/100);
const active=(s,side)=>s.players.filter(p=>p.side===side&&p.active);
function choose(s,departed){
  if(s.input.passiveSubstitutions===false)return {failure:'disabled'};
  if(s.stats[departed.side].substitutions>=5)return {failure:'limit'};
  const bench=s.players.filter(p=>p.side===departed.side&&!p.active&&p.status==='bench'&&!p.injury);
  if(!bench.length)return {failure:'noEligibleSubstitute'};
  const matching=bench.filter(p=>replacementRank(departed.role,p)>0);if(!matching.length)return {failure:'noPositionMatch'};
  const ready=matching.filter(p=>p.fitness>=45);if(!ready.length)return {failure:'lowFitness'};
  return {incoming:ready.sort((a,b)=>replacementRank(departed.role,b)-replacementRank(departed.role,a)||effective(b)-effective(a)||b.fitness-a.fitness||a.key.localeCompare(b.key))[0]};
}
function transfer(source,to){
  to.originalRole??=to.role;to.role=source.role;to.anchor={...source.anchor};
  if(source.sourceRole)to.sourceRole=source.sourceRole;
  if(source.anchorPlans)to.anchorPlans=structuredClone(source.anchorPlans);
  if(source.dutyPlans)to.dutyPlans=structuredClone(source.dutyPlans);
  if(source.rolePlans)to.rolePlans=structuredClone(source.rolePlans);
  if(source.sourceRolePlans)to.sourceRolePlans=structuredClone(source.sourceRolePlans);
  to.x=source.x;to.y=source.y;to.vx=0;to.vy=0;to.task=null;to.control=null;
}
export function applyPassiveExit(state,departed,cause){
  if(!departed||departed.active||departed.exitResolution||!['injury','red'].includes(cause)||
    cause==='injury'&&!departed.injury||cause==='red'&&departed.status!=='sentOff')return {status:'ignored'};
  const keeper=departed.role==='GK';let result={status:'shortHanded',cause};
  if(cause==='injury'||keeper){
    const choice=choose(state,departed),outfield=active(state,departed.side).filter(p=>p.role!=='GK');
    const centreBacks=outfield.filter(p=>p.role==='CB'),pool=centreBacks.length>2?centreBacks:outfield.filter(p=>p.role!=='CB');
    const outgoing=cause==='red'?[...(pool.length?pool:outfield)].sort((a,b)=>effective(a)-effective(b)||a.key.localeCompare(b.key))[0]:departed;
    if(choice.incoming&&outgoing){
      const incoming=choice.incoming;transfer(departed,incoming);outgoing.active=false;outgoing.vx=0;outgoing.vy=0;
      if(outgoing!==departed)outgoing.status='substituted';
      incoming.active=true;incoming.status='playing';incoming.enteredAt=state.time;incoming.substitutedFor=outgoing.key;
      incoming.nextTouch=state.time;incoming.nextDecision=state.time+.6;incoming.nextTackle=state.time+.5;
      state.stats[departed.side].substitutions++;result={status:'substituted',cause,incoming:incoming.key,outgoing:outgoing.key};
    }else{
      result.failure=choice.failure??'noOutfieldPlayer';
      if(keeper){
        const emergency=active(state,departed.side).sort((a,b)=>(b.attributes.goalkeeping*.65+b.attributes.reflexes*.35)*(.55+.45*b.fitness/100)-(a.attributes.goalkeeping*.65+a.attributes.reflexes*.35)*(.55+.45*a.fitness/100)||a.key.localeCompare(b.key))[0];
        if(emergency){transfer(departed,emergency);result.status='emergencyKeeper';result.incoming=emergency.key;}
      }
    }
  }
  departed.exitResolution={...result};state.coordination=[{},{}];state.restartSerial++;
  return result;
}
