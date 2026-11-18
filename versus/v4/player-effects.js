import {evaluateS4LineupBonds,applyS4BondBonuses} from '../public/bond-rules.js';
import {clamp,clockSnapshot,distance} from './world.js';

export const SUPPORTED_TRAIT_HOOKS=['attribute','allAttributes','fixedFitness','height','position','chemistry','affinityWildcard','injury','penaltyDraw','redCardImmune','teamInjuryTransfer'];
export const TRAIT_CONDITIONS=['weather','teamStyle','teamTactic','minuteGte','minuteLte','scoreState','activeRole','activeRoleNot','precipitationGte','roleIsWide'];
const group=role=>role==='GK'?'GK':['CB','LB','RB','LWB','RWB'].includes(role)?'DEF':['ST','LW','RW'].includes(role)?'ATT':'MID';
const includes=(values,value)=>(Array.isArray(values)?values:[values]).includes(value);
function matches(when,context,p){
  if(!when)return true;
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
export function refreshPlayerEffects(state){
  if(!state.input.playerEffects)return [];
  const clock=clockSnapshot(state),minute=(clock.baseSeconds+clock.elapsed)/60,changes=[];
  for(const side of [0,1]){
    const team=state.input.teams[side],mode=state.activePlans[side],players=state.players.filter(p=>p.side===side),active=players.filter(p=>p.active);
    const context={minute,plan:team.sourcePlans[mode],scoreState:state.score[side]>state.score[1-side]?'leading':state.score[side]<state.score[1-side]?'trailing':'level',weather:state.input.environment?.weather??'sunny',precipitation:state.input.environment?.precipitation??0};
    const rules=players.map(p=>(p.traitDefinitions??[]).flatMap(t=>(t.rules??[]).filter(r=>matches(r.when,context,p)).map(r=>({traitId:t.id,...r}))));
    // Cache only stable effect inputs. Nearby chemistry depends on formation
    // anchors, not current positions, so refresh does not grant moving bonuses.
    const key=JSON.stringify([mode,context.scoreState,players.map((p,i)=>[p.key,p.active,p.sourceRole,p.anchor,rules[i]])]);
    state.effectKeys??=[null,null];if(state.effectKeys[side]===key)continue;state.effectKeys[side]=key;
    players.forEach((p,i)=>{
      p.attributes={...p.baseAttributes};p.heightCm=p.baseHeightCm??p.heightCm;
      p.fixedFitness=null;p.injuryImmune=false;p.redCardImmune=false;p.injuryTransfer=false;p.penaltyDraw=null;p.effectPositionRoles=[];p.utilityPlayer=false;
      for(const rule of rules[i]){
        if(rule.hook==='attribute')for(const [name,n] of Object.entries(rule.add??{}))p.attributes[name]=clamp((p.attributes[name]??50)+Number(n),1,99);
        if(rule.hook==='allAttributes')for(const name of Object.keys(p.attributes))p.attributes[name]=clamp(p.attributes[name]*Number(rule.multiply??1),1,99);
        if(rule.hook==='height')p.heightCm=clamp(p.heightCm+Number(rule.addCm??0),140,260);
        if(rule.hook==='fixedFitness')p.fixedFitness=clamp(Number(rule.value),0,100);
        if(rule.hook==='injury'&&rule.immune)p.injuryImmune=true;
        if(rule.hook==='redCardImmune'&&rule.immune)p.redCardImmune=true;
        if(rule.hook==='teamInjuryTransfer'&&rule.transferToSelf)p.injuryTransfer=true;
        if(rule.hook==='penaltyDraw')p.penaltyDraw={foulMultiplier:Number(rule.foulMultiplier??1),penaltyMultiplier:Number(rule.penaltyMultiplier??1)};
        if(rule.hook==='position'){p.effectPositionRoles.push(...(rule.familiarRoles??[]));if(rule.ignoreOutOfPositionPenalty&&rule.eligibleRoleGroups?.includes(group(p.sourceRole??p.role)))p.utilityPlayer=true;}
      }
      if(p.fixedFitness!==null)p.fitness=p.fixedFitness;
      p.appliedTraitIds=[...new Set(rules[i].map(r=>r.traitId))];
    });
    for(const carrier of active){
      const rule=rules[players.indexOf(carrier)].find(r=>r.hook==='chemistry'&&r.linkNearby);if(!rule)continue;
      for(const p of active)if(distance({x:p.anchor.y/68*100,y:100-p.anchor.x/105*100},{x:carrier.anchor.y/68*100,y:100-carrier.anchor.x/105*100})<=28){
        const bonus=Math.min(.06,Math.max(0,Number(rule.value??100))/100*.06);for(const name of Object.keys(p.attributes))p.attributes[name]=clamp(p.attributes[name]*(1+bonus),1,99);
      }
    }
    const forBonds=active.map(p=>({...p,heightCm:p.baseHeightCm,assignedRole:p.sourceRole??p.role,traits:p.appliedTraitIds}));
    const bonds=evaluateS4LineupBonds(forBonds,team.sourceBondCatalog,{roles:Object.fromEntries(forBonds.map(p=>[p.id,p.assignedRole]))});
    const adjusted=applyS4BondBonuses(forBonds,bonds);for(const p of active){p.attributes={...adjusted.find(q=>q.id===p.id).attributes};}
    state.activeBonds??=[[],[]];state.activeBonds[side]=bonds;
    changes.push({side,plan:mode,players:players.map(p=>({key:p.key,traitIds:p.appliedTraitIds})),bonds:bonds.map(b=>({id:b.id,count:b.count,bonus:b.bonus,memberIds:b.memberIds}))});
  }
  return changes;
}
