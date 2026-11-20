import {clamp,random,seedState} from './world.js';
import {activePlayers} from './rules.js';

// Schedule once in football minutes. The plan and its RNG cursor are part of the checkpoint.
export function planMatchIncidents(state) {
  const rules=state.input.matchIncidents, env=state.input.environment;
  if(!rules)return null;
  state.random.incidents={value:seedState(state.input.seed+':incidents'),draws:0};
  const roll=()=>random(state,'incidents');
  const due=[];
  const minute=(min,max)=>min+Math.floor(roll()*(max-min+1));
  if(env.weather==='superStorm')due.push({type:'stormStop',at:minute(rules.stormStop.minimum,rules.stormStop.maximum)});
  if(env.weather!=='sunny'&&roll()<rules.weatherNotice)due.push({type:'weather',at:0});
  if(roll()<rules.ownGoal)due.push({type:'backpass',at:minute(8,80)});
  if(roll()<rules.blackWhistle)due.push({type:'blackWhistle',at:minute(1,89)});
  due.push({type:'brawl',at:minute(rules.brawl.minimumMinute,rules.brawl.maximumMinute)});
  // Legacy rates are per 30 football seconds. Lightning is limited to one strike.
  let lightning=false;
  for(let slot=1;slot<=180;slot++){
    if(!lightning&&roll()<env.weatherEvent){
      lightning=['storm','superStorm'].includes(env.weather);
      due.push({type:lightning?'lightning':'weatherInjury',at:slot/2});
    }
    if(roll()<rules.injury*rules.highPress.maximumMultiplier)due.push({type:'matchInjury',at:slot/2});
  }
  return {due:due.sort((a,b)=>a.at-b.at),cursor:0,backpass:false};
}

export function runMatchIncidents(match,actions) {
  const s=match.state,plan=s.incidents;
  if(!plan||s.clock.period>2||s.shootout||!['playing','restart'].includes(s.phase))return;
  const minute=(s.clock.period-1)*45+45*Math.min(1,s.clock.elapsed/s.clock.halfLength);
  while(plan.cursor<plan.due.length&&plan.due[plan.cursor].at<=minute){
    const {type}=plan.due[plan.cursor++];
    const rules=s.input.matchIncidents,env=s.input.environment;
    const roll=()=>random(s,'incidents');
    const pick=list=>list.length?list[Math.floor(roll()*list.length)]:null;
    const players=activePlayers(s),teams=[0,1].map(side=>players.filter(p=>p.side===side));
    const teamPlan=side=>s.input.teams[side].sourcePlans?.[s.activePlans[side]]??{};
    const {emit,awardRestart,injurePlayer,dismiss,finishWeather}=actions;
    if(type==='stormStop'){finishWeather(match);return;}
    if(type==='weather'){emit(match,'weather',null,{text:env.name+'影响传球、接球和跑动体能。'});continue;}
    if(type==='backpass'){plan.backpass=true;continue;}
    if(type==='blackWhistle'){
      const counts=teams.map(team=>Math.max(team.filter(p=>['阿根廷','Argentina'].includes(p.nationality)).length,...team.map(p=>p.argentinaMinimum??0)));
      if(counts[0]===counts[1])continue;
      const side=counts[0]>counts[1]?0:1,eligible=teams[1-side].filter(p=>!p.redCardImmune);
      const offender=pick(eligible.filter(p=>p.role!=='GK'))??pick(eligible);
      emit(match,'blackWhistle',null,{side,text:s.input.teams[side].name+'获得争议点球判罚。'});
      if(offender&&teams[1-side].length>7)dismiss(match,offender,'争议判罚直接红牌');
      awardRestart(match,'penalty',side,s.ball,'争议判罚');
      continue;
    }
    if(type==='brawl'){
      const cfg=rules.brawl,field=players.filter(p=>p.role!=='GK');
      const rough=teams.map((_,side)=>[teamPlan(side).style,teamPlan(side).duelIntensity].includes('roughPlay'));
      const aggression=field.reduce((n,p)=>n+p.attributes.aggression,0)/Math.max(1,field.length);
      const multiplier=rough.every(Boolean)?cfg.bothSidesRoughPlayMultiplier:rough.some(Boolean)?cfg.oneSideRoughPlayMultiplier:1;
      const chance=cfg.basePerEligibleMatch*clamp(1+Math.max(0,aggression-cfg.aggressionBaseline)/15,1,cfg.aggressionMultiplierMaximum)*multiplier*(cfg.refereeMultiplier[env.referee]??1);
      if(Math.abs(s.score[0]-s.score[1])>cfg.maximumGoalDifference||roll()>=chance)continue;
      const count=cfg.dismissalsPerTeamMinimum+Math.floor(roll()*(cfg.dismissalsPerTeamMaximum-cfg.dismissalsPerTeamMinimum+1));
      const counts=rough.map(r=>count+Number(r&&!rough.every(Boolean)));
      if(teams.some((team,i)=>team.length-counts[i]<7))continue;
      emit(match,'brawl',null,{text:'双方爆发群体冲突，裁判出示红牌。'});
      awardRestart(match,'directFreeKick',s.lastOwner,s.ball,'群体冲突中断比赛');
      teams.forEach((team,side)=>{
        const eligible=team.filter(p=>p.role!=='GK'&&!p.redCardImmune);
        for(let i=0;i<counts[side]&&eligible.length;i++)dismiss(match,eligible.splice(Math.floor(roll()*eligible.length),1)[0],'参与群体冲突');
      });
      continue;
    }
    let candidates=players;
    if(type==='lightning'){
      const team=pick(teams),protectedBy=team.find(p=>p.lightningProtection);
      if(protectedBy){emit(match,'lightning',protectedBy,{text:protectedBy.name+'的避雷特性保护了全队。'});continue;}
      candidates=team;
    }
    if(type==='matchInjury'){
      const cfg=rules.highPress;
      const pressures=teams.map((_,i)=>{const p=teamPlan(i),dims=p.tacticalDimensions??{};
        if(![p.style,p.defensiveBlock].includes('highPress'))return 0;
        return clamp((dims.pressing-cfg.pressingThreshold)/(100-cfg.pressingThreshold)||0,0,1)*cfg.pressingWeight+
          clamp((dims.defensiveLine-cfg.defensiveLineThreshold)/(100-cfg.defensiveLineThreshold)||0,0,1)*cfg.lineWeight;});
      const high=Math.max(...pressures);
      if(roll()>=(high?cfg.minimumMultiplier+high*(cfg.maximumMultiplier-cfg.minimumMultiplier):1)/cfg.maximumMultiplier)continue;
    }
    const victim=pick(candidates.filter(p=>!p.injuryImmune));
    if(!victim){if(type==='lightning')emit(match,'lightning',null,{text:'球场遭遇雷击，场上球员无人受伤。'});continue;}
    const message=type==='lightning'?'被雷电击中':type==='weatherInjury'?'受'+env.name+'影响受伤':'在无对抗跑动中受伤';
    emit(match,type==='matchInjury'?'matchInjury':type,victim,{text:victim.name+message+'，比赛暂停。'});
    if(s.phase==='playing')awardRestart(match,'indirectFreeKick',s.lastOwner,s.ball,'比赛因伤暂停');
    injurePlayer(match,victim,{cause:type,injuryRounds:type==='lightning'?2:1});
    if(s.phase==='finished')return;
  }
}
