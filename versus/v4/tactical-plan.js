const numeric={width:[.45,1.2],press:[0,1],directness:[0,1],lineHeight:[0,1],compactness:[0,1],tempo:[0,1],mentality:[0,1],counterAttack:[0,1]};
const enums={route:['balanced','left','leftHalf','center','rightHalf','right'],lossReaction:['balanced','counterPress','regroup'],restDefense:['balanced','conservative','adventurous'],clockManagement:['normal','slow','quick'],
  pressTrigger:['balanced','backPass','wide','ownHalf'],pressAssignment:['closeDown','screen'],buildUpRoute:['balanced','left','center','right'],buildUpOutlet:['balanced','pivot','target'],pressureEscape:['hold','switch','direct'],
  defensiveFocus:['balanced','creator','striker','wide'],setPieceRoutine:['balanced','near','far','short'],setPieceCommitment:['balanced','protect','attack'],
  chanceCreation:['patient','balanced','shootOnSight'],longShots:['reduce','balanced','increase'],crossing:['reduce','balanced','increase'],defensiveWidth:['protectCenter','balanced','forceWide'],defenseDirection:['left','center','right','balanced'],marking:['zonal','mixed','man'],lineStrategy:['drop','hold','offside'],duelIntensity:['cautious','balanced','roughPlay']};
function validated(partial={}){
  if(!partial||typeof partial!=='object'||Array.isArray(partial))throw new Error('V4 战术指令无效');
  const out={};
  for(const [key,value] of Object.entries(partial)){
    if(numeric[key]){const [lo,hi]=numeric[key];if(!Number.isFinite(value)||value<lo||value>hi)throw new Error(`V4 战术范围无效：${key}`);}
    else if(enums[key]){if(!enums[key].includes(value))throw new Error(`V4 战术选项无效：${key}`);}
    else if(key==='overlap'){if(typeof value!=='boolean')throw new Error('V4 套上指令无效');}
    else throw new Error(`V4 不支持的战术指令：${key}`);
    out[key]=value;
  }
  return out;
}
export function compileTacticalPlans(team,preset){
  team.instructions=validated(team.instructions);
  const plans=team.scorePlans??{};
  if(!plans||typeof plans!=='object'||Array.isArray(plans)||Object.keys(plans).some(key=>!['leading','trailing'].includes(key)))throw new Error('V4 比分预案无效');
  team.scorePlans=Object.fromEntries(Object.entries(plans).map(([key,value])=>[key,validated(value)]));
  const triggers=team.scoreTriggers??{};
  if(!triggers||typeof triggers!=='object'||Array.isArray(triggers)||Object.keys(triggers).some(k=>!['leading','trailing'].includes(k)))throw new Error('V4 预案触发无效');
  team.scoreTriggers=Object.fromEntries(['leading','trailing'].map(mode=>{
    const trigger=triggers[mode]??{},goalDifference=trigger.goalDifference??1,afterMinute=trigger.afterMinute??0;
    if(!trigger||typeof trigger!=='object'||Array.isArray(trigger))throw new Error('V4 预案触发结构无效');
    if(Object.keys(trigger).some(k=>!['goalDifference','afterMinute'].includes(k))||!Number.isInteger(goalDifference)||goalDifference<1||goalDifference>20||!Number.isFinite(afterMinute)||afterMinute<0||afterMinute>120)throw new Error('V4 预案触发范围无效');
    return [mode,{goalDifference,afterMinute}];
  }));
  const base={lineHeight:.45,compactness:.6,lossReaction:'balanced',restDefense:'balanced',clockManagement:'normal',tempo:.5,mentality:.5,counterAttack:.5,
    pressTrigger:'balanced',pressAssignment:'closeDown',buildUpRoute:'balanced',buildUpOutlet:'balanced',pressureEscape:'hold',defensiveFocus:'balanced',setPieceRoutine:'balanced',setPieceCommitment:'balanced',
    chanceCreation:'balanced',longShots:'balanced',crossing:'balanced',defensiveWidth:'balanced',defenseDirection:'balanced',marking:'mixed',lineStrategy:'hold',duelIntensity:'balanced',...preset,...team.instructions};
  team.tactics=base;
  team.compiledPlans={leading:{...base,...team.scorePlans.leading},trailing:{...base,...team.scorePlans.trailing}};
}
export function tacticalMode(state,side){
  const gap=state.score[side]-state.score[1-side],mode=gap>0?'leading':gap<0?'trailing':'normal';
  if(mode==='normal')return mode;
  const team=state.input.teams[side],trigger=team.scoreTriggers?.[mode]??{goalDifference:1,afterMinute:0};
  const minute=((state.clock.periodLengths?.slice(0,state.clock.period-1).reduce((a,b)=>a+b,0)??0)+state.clock.elapsed)/60;
  return Math.abs(gap)>=trigger.goalDifference&&minute>=trigger.afterMinute&&(Object.keys(team.scorePlans?.[mode]??{}).length||team.players.some(p=>p.anchorPlans?.[mode]))?mode:'normal';
}
export function effectiveTactics(state,side){const team=state.input.teams[side],mode=tacticalMode(state,side);return mode==='normal'?team.tactics:team.compiledPlans[mode];}
