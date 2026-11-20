import {evaluateTacticalBonds,applyTacticalBondBonuses} from '../public/tactical-bonds.js';
import {clamp,clockSnapshot,distance} from './world.js';

export const SUPPORTED_TRAIT_HOOKS=['attribute','allAttributes','fixedFitness','height','position','chemistry','affinityWildcard','injury','penaltyDraw','firstPenaltySave','redCardImmune','teamInjuryTransfer','teamLightningProtection','argentinaCount','spiritPossession','sponsorEntry','allInGamble','extraTimeRecovery','captainAmplify','nineDragonsCoffin'];
export const TRAIT_CONDITIONS=['weather','teamStyle','teamTactic','minuteGte','minuteLte','scoreState','activeRole','activeRoleNot','precipitationGte','roleIsWide','inExtraOrShootout'];
const group=role=>role==='GK'?'GK':['CB','LB','RB','LWB','RWB'].includes(role)?'DEF':['ST','LW','RW'].includes(role)?'ATT':'MID';
const includes=(values,value)=>(Array.isArray(values)?values:[values]).includes(value);
function matches(when,context,p){
  if(!when)return true;
  if(when.inExtraOrShootout && !context.decidingPeriod)return false;
  if(when.weather&&!includes(when.weather,context.weather))return false;
  if(when.teamStyle&&![context.plan.style,context.plan.possessionStyle,context.plan.defensiveBlock,context.plan.transitionStyle,context.plan.duelIntensity].some(style=>includes(when.teamStyle,style)))return false;
  if(when.teamTactic&&!includes(when.teamTactic,context.plan.tactic))return false;
  if(when.minuteGte!=null&&context.minute<when.minuteGte||when.minuteLte!=null&&context.minute>when.minuteLte)return false;
  if(when.scoreState&&!includes(when.scoreState,context.scoreState))return false;
  const role=p.sourceRole??p.role,roleGroup=group(role);
  if(when.activeRole&&when.activeRole!==role&&when.activeRole!==roleGroup)return false;
  if(when.activeRoleNot&&(when.activeRoleNot===role||when.activeRoleNot===roleGroup))return false;
  if(when.precipitationGte!=null&&context.precipitation<when.precipitationGte)return false;
  if(when.roleIsWide&&!['LB','RB','LWB','RWB','LM','RM','LW','RW'].includes(role))return false;
  return true;
}
export function refreshPlayerEffects(state,announce){
  if(!state.input.playerEffects)return [];
  const clock=clockSnapshot(state),minute=(clock.baseSeconds+clock.elapsed)/60,changes=[];
  for(const side of [0,1]){
    const team=state.input.teams[side],mode=state.activePlans[side],players=state.players.filter(p=>p.side===side),active=players.filter(p=>p.active);
    const context={minute,decidingPeriod:state.clock.period>2 || state.phase==='shootout' || Boolean(state.shootout),plan:team.sourcePlans[mode],scoreState:state.score[side]>state.score[1-side]?'leading':state.score[side]<state.score[1-side]?'trailing':'level',weather:state.input.environment?.weather??'sunny',precipitation:state.input.environment?.precipitation??0};
    const rules=players.map(p=>(p.traitDefinitions??[]).flatMap(t=>(t.rules??[]).filter(r=>(r.hook!=='sponsorEntry'||p.sponsorEntry)&&matches(r.when,context,p)).map(r=>({traitId:t.id,...r}))));
    // Cache only stable effect inputs. Nearby chemistry depends on formation
    // anchors, not current positions, so refresh does not grant moving bonuses.
    const plan=context.plan;
    const key=JSON.stringify([mode,context.scoreState,plan.style,plan.possessionStyle,plan.defensiveBlock,plan.transitionStyle,plan.duelIntensity,players.map((p,i)=>[p.key,p.active,p.sourceRole,p.anchor,rules[i]])]);
    state.effectKeys??=[null,null];if(state.effectKeys[side]===key)continue;state.effectKeys[side]=key;
    if (!players.some(p=>p.nineDragonsActive)) {
      const candidates=players.filter((p,i)=>p.active && rules[i].some(r=>r.hook==='nineDragonsCoffin'));
      const rating=p=>p.carrierBaseOverall ?? p.overall ?? 0;
      const chosen=candidates.sort((a,b)=>rating(b)-rating(a)||a.id.localeCompare(b.id,'en'))[0];
      if (chosen) {
        chosen.nineDragonsActive=true;
        const formal=['league','cup'].includes(state.input.competitionMode);
        announce?.(chosen,`九龙拉棺启动！${team.name}的 ${chosen.name}燃烧职业生涯拼死一战，本场满体且全属性 +5%${formal?'，赛后基础总评永久损耗1点（最低50）':'！'}`, 'critical');
      }
    }
    players.forEach((p,i)=>{
      p.attributes={...p.baseAttributes};p.heightCm=p.baseHeightCm??p.heightCm;
      p.fixedFitness=null;p.injuryImmune=false;p.redCardImmune=false;p.injuryTransfer=false;p.lightningProtection=false;p.argentinaMinimum=0;p.penaltyDraw=null;p.firstPenaltySave=false;p.effectPositionRoles=[];p.utilityPlayer=false;
      for(const rule of rules[i]){
        if(rule.hook==='attribute')for(const [name,n] of Object.entries(rule.add??{}))p.attributes[name]=clamp((p.attributes[name]??50)+Number(n),1,99);
        if(rule.hook==='allAttributes')for(const name of Object.keys(p.attributes))p.attributes[name]=clamp(p.attributes[name]*Number(rule.multiply??1),1,99);
        if(rule.hook==='nineDragonsCoffin' && p.nineDragonsActive)
          for(const name of Object.keys(p.attributes))p.attributes[name]=clamp(p.attributes[name]*rule.multiply,1,99);
        if(rule.hook==='extraTimeRecovery' && p.active && !p.extraTimeRecovered){
          p.fitness=100;p.extraTimeRecovered=true;
          announce?.(p,`卷王来了！${state.phase==='shootout'?'点球大战决胜时刻':'比赛拖入加时赛'}，${team.name}的 ${p.name}瞬间满血，决胜属性全面拉满！`,'critical');
        }
        if(rule.hook==='height')p.heightCm=clamp(p.heightCm+Number(rule.addCm??0),140,260);
        if(rule.hook==='fixedFitness')p.fixedFitness=clamp(Number(rule.value),0,100);
        if(rule.hook==='injury'&&rule.immune)p.injuryImmune=true;
        if(rule.hook==='redCardImmune'&&rule.immune)p.redCardImmune=true;
        if(rule.hook==='teamInjuryTransfer'&&rule.transferToSelf)p.injuryTransfer=true;
        if(rule.hook==='teamLightningProtection'&&rule.immune)p.lightningProtection=true;
        if(rule.hook==='argentinaCount')p.argentinaMinimum=Math.max(p.argentinaMinimum,Number(rule.minimum??0));
        if(rule.hook==='firstPenaltySave'&&rule.guaranteed)p.firstPenaltySave=true;
        if(rule.hook==='penaltyDraw')p.penaltyDraw={foulMultiplier:Number(rule.foulMultiplier??1),penaltyMultiplier:Number(rule.penaltyMultiplier??1),simulationYellowChance:Number(rule.simulationYellowChance??0)};
        if(rule.hook==='position'){p.effectPositionRoles.push(...(rule.familiarRoles??[]));if(rule.ignoreOutOfPositionPenalty&&rule.eligibleRoleGroups?.includes(group(p.sourceRole??p.role)))p.utilityPlayer=true;}
      }
      if(p.nineDragonsActive)p.fixedFitness=100;
      const hound=p.active && rules[i].some(r=>r.traitId==='high-press-hound');
      if(hound && !p.highPressHoundActive)announce?.(p,`疯狗来了！${p.name}在高位压迫体系下彻底释放，全场疯抢压得对手喘不过气！`,'highlight');
      if(hound || p.highPressHoundActive)p.highPressHoundActive=hound;
      if(p.active && p.id===team.captainId && rules[i].some(r=>r.hook==='captainAmplify')){
        if(!p.captainBossAnnounced)announce?.(p,`队霸来了！${team.name}队长 ${p.name}气场全开，本场队长风格加成直接翻倍！`,'highlight');
        else if(context.scoreState==='trailing' && p.captainBossScoreState!=='trailing')
          announce?.(p,`队霸坐镇！逆境之下队长 ${p.name}凭借「队霸来了」双倍气场稳住全队军心！`,'highlight');
        p.captainBossAnnounced=true;p.captainBossScoreState=context.scoreState;
      }
      if(p.fixedFitness!==null)p.fitness=p.fixedFitness;
      p.appliedTraitIds=[...new Set(rules[i].filter(r=>r.hook!=='nineDragonsCoffin'||p.nineDragonsActive).map(r=>r.traitId))];
    });
    for(const carrier of active){
      const rule=rules[players.indexOf(carrier)].find(r=>r.hook==='chemistry'&&r.linkNearby);if(!rule)continue;
      for(const p of active)if(distance({x:p.anchor.y/68*100,y:100-p.anchor.x/105*100},{x:carrier.anchor.y/68*100,y:100-carrier.anchor.x/105*100})<=28){
        const bonus=Math.min(.06,Math.max(0,Number(rule.value??100))/100*.06);for(const name of Object.keys(p.attributes))p.attributes[name]=clamp(p.attributes[name]*(1+bonus),1,99);
      }
    }
    const forBonds=active.map(p=>({...p,effectiveHeightCm:p.heightCm,assignedRole:p.sourceRole??p.role,traits:p.appliedTraitIds}));
    const bonds=evaluateTacticalBonds(forBonds,team.sourceBondCatalog,plan).filter(b=>b.active);
    const adjusted=applyTacticalBondBonuses(forBonds,bonds);
    active.forEach((p,index)=>{p.attributes=adjusted[index].attributes;});
    state.activeBonds??=[[],[]];state.activeBonds[side]=bonds;
    changes.push({side,plan:mode,players:players.map(p=>({key:p.key,traitIds:p.appliedTraitIds})),bonds:bonds.map(b=>({id:b.id,count:b.count,tier:b.tier,add:b.add,memberIds:b.memberIds}))});
  }
  return changes;
}
