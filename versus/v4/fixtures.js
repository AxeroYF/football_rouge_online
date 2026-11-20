// Synthetic players only. IDs intentionally repeat across teams to exercise instance identity.
import {compileTacticalPlans} from './tactical-plan.js';
import {compileCompetition} from './competition.js';
import {DUTIES} from './execution.js';
const layout = [
  ['GK',5,34], ['LB',27,9], ['CB',23,26], ['CB',23,42], ['RB',27,59],
  ['DM',40,34], ['CM',51,23], ['CM',51,45], ['LW',69,9], ['ST',75,34], ['RW',69,59],
];
export const PRESETS = Object.freeze({
  balanced:{name:'均衡接应', width:0.75, press:0.45, directness:0.45, overlap:false, route:'balanced'},
  left:{name:'左侧套上', width:1, press:0.45, directness:0.4, overlap:true, route:'left'},
  press:{name:'高位压迫', width:0.7, press:0.95, directness:0.55, overlap:false, route:'balanced',lineHeight:.7,compactness:.75},
  counter:{name:'低位反击', width:0.8, press:0.18, directness:0.9, overlap:false, route:'balanced',lineHeight:.25,compactness:.8},
});
export function demoInput({seed='v4-first-match', home='left', away='press', duration=180,format=duration===5400?'full':'clip'}={}) {
  return {seed:String(seed), duration,format, teams:[home,away].map((preset,side)=>({
    id:side===0?'blue':'coral', name:side===0?'蓝队':'珊瑚队', preset,
    players:layout.map(([role,x,y],i)=>({id:`p${i+1}`,name:`${side===0?'蓝':'红'}${i+1}号`,number:i+1,role,
      anchor:{x,y},attributes:{pace:72+(i%3)*5,acceleration:76,passing:78,decisions:78,finishing:role==='ST'?86:72,
        tackling:role==='CB'?85:72,goalkeeping:role==='GK'?84:25,firstTouch:78,reflexes:role==='GK'?84:72,stamina:80},fitness:100})),
  }))};
}
export function compileInput(input) {
  if (!input || !Array.isArray(input.teams) || input.teams.length!==2) throw new Error('需要两支演示球队');
  if (!Number.isInteger(input.duration) || input.duration<10 || input.duration>5400) throw new Error('演示时长必须为10–5400个足球秒');
  if (typeof input.seed!=='string' || input.seed.length>120) throw new Error('种子须为不超过120字的文本');
  const out=structuredClone(input);
  out.passiveSubstitutions??=true;if(typeof out.passiveSubstitutions!=='boolean')throw new Error('被动换人配置无效');
  out.playerEffects??=false;if(typeof out.playerEffects!=='boolean')throw new Error('球员效果配置无效');
  out.format??=out.duration===5400?'full':'clip';
  if(!['full','clip'].includes(out.format)||out.format==='full'&&out.duration%2!==0)throw new Error('比赛赛制无效');
  compileCompetition(out);
  for (const team of out.teams) {
    if (!Object.hasOwn(PRESETS,team.preset)) throw new Error('未知战术');
    compileTacticalPlans(team,PRESETS[team.preset]);
    if(out.playerEffects&&(!team.sourcePlans||!['normal','leading','trailing'].every(mode=>team.sourcePlans[mode]&&typeof team.sourcePlans[mode]==='object')||!Array.isArray(team.sourceBondCatalog)))throw new Error('球员效果来源配置缺失');
    if(team.captainPlans){
      for(const [mode,value] of Object.entries(team.captainPlans)){
        if(!['level','leading','trailing'].includes(mode)||!value||typeof value!=='object'||!value.stage||Object.values(value.stage).some(n=>!Number.isFinite(n)||Math.abs(n)>.1)||['foulMultiplier','cardMultiplier','directRedMultiplier'].some(k=>!Number.isFinite(value[k])||value[k]<.5||value[k]>1.5))throw new Error('队长效果数据无效');
      }
    }
    if (team.players?.length!==11 || new Set(team.players.map(p=>p.id)).size!==11 || team.players.filter(p=>p.role==='GK').length!==1) throw new Error('每队需要11名不同球员及1名门将');
    team.bench??=[];
    if(!Array.isArray(team.bench)||team.bench.length>12||new Set([...team.players,...team.bench].map(p=>p.id)).size!==11+team.bench.length)throw new Error('替补名单无效或重复');
    for (const p of [...team.players,...team.bench]) {
      if(!p.attributes||typeof p.attributes!=='object')throw new Error('属性无效');
      p.heightCm??=180;p.attributes.heading??=p.attributes.firstTouch;p.attributes.jumping??=p.attributes.acceleration;
      p.attributes.crossing??=p.attributes.passing;p.attributes.longShots??=p.attributes.finishing;
      for(const key of ['dribbling','setPieces','marking','positioning','vision','composure','offBall','discipline','strength','agility','workRate','aggression'])p.attributes[key]??=75;
      if(!Number.isFinite(p.heightCm)||p.heightCm<140||p.heightCm>230)throw new Error('身高无效');
      if (!p.id || !['GK','LB','RB','CB','DM','CM','LW','RW','ST'].includes(p.role)) throw new Error('球员标识或位置无效');
      if (![p.anchor?.x,p.anchor?.y].every(Number.isFinite) || p.anchor.x<0||p.anchor.x>105||p.anchor.y<0||p.anchor.y>68) throw new Error('阵型坐标无效');
      if(p.anchorPlans){
        if(typeof p.anchorPlans!=='object'||Array.isArray(p.anchorPlans)||Object.keys(p.anchorPlans).some(k=>!['normal','leading','trailing'].includes(k)))throw new Error('预案阵型无效');
        for(const point of Object.values(p.anchorPlans))if(![point?.x,point?.y].every(Number.isFinite)||point.x<0||point.x>105||point.y<0||point.y>68)throw new Error('预案阵型坐标无效');
        p.anchorPlans.normal??={...p.anchor};
      }
      if(p.dutyPlans&&(!p.dutyPlans||typeof p.dutyPlans!=='object'||Array.isArray(p.dutyPlans)||Object.entries(p.dutyPlans).some(([mode,duty])=>!['normal','leading','trailing'].includes(mode)||duty!==null&&!DUTIES.includes(duty))))throw new Error('球员职责预案无效');
      if(p.rolePlans){
        if(typeof p.rolePlans!=='object'||Array.isArray(p.rolePlans)||Object.entries(p.rolePlans).some(([mode,role])=>!['normal','leading','trailing'].includes(mode)||!['GK','LB','RB','CB','DM','CM','LW','RW','ST'].includes(role)||(role==='GK')!==(p.role==='GK')))throw new Error('预案位置无效或改变门将身份');
        p.rolePlans.normal??=p.role;
      }
      if(p.positionFitByRole&&(typeof p.positionFitByRole!=='object'||Array.isArray(p.positionFitByRole)||Object.values(p.positionFitByRole).some(n=>!Number.isFinite(n)||n<.35||n>1.04)))throw new Error('位置适应数据无效');
      for (const key of ['pace','acceleration','passing','decisions','finishing','tackling','goalkeeping','firstTouch','reflexes','stamina','heading','jumping','crossing','longShots','dribbling','setPieces','marking','positioning','vision','composure','offBall','discipline','strength','agility','workRate','aggression'])
        if (!Number.isFinite(p.attributes?.[key]) || p.attributes[key]<1 || p.attributes[key]>100) throw new Error(`属性无效：${key}`);
      if(out.playerEffects){
        if(!p.baseAttributes||Object.keys(p.attributes).some(k=>!Number.isFinite(p.baseAttributes[k])||p.baseAttributes[k]<1||p.baseAttributes[k]>100)||!Number.isFinite(p.baseHeightCm)||p.baseHeightCm<140||p.baseHeightCm>230||!Array.isArray(p.traitDefinitions))throw new Error('球员基础效果数据无效');
        for(const trait of p.traitDefinitions){
          if(typeof trait.id!=='string'||!Array.isArray(trait.rules))throw new Error('球员特性定义无效');
          for(const rule of trait.rules){
            if(!rule||typeof rule.hook!=='string'||rule.when&&(typeof rule.when!=='object'||Array.isArray(rule.when)))throw new Error('球员特性条件无效');
            if(rule.simulationYellowChance!==undefined&&(!Number.isFinite(rule.simulationYellowChance)||rule.simulationYellowChance<0||rule.simulationYellowChance>1))throw new Error('假摔黄牌概率无效');
            for(const key of ['multiply','value','addCm','foulMultiplier','penaltyMultiplier'])if(rule[key]!==undefined&&!Number.isFinite(rule[key]))throw new Error('球员特性数值无效');
            if(rule.add&&Object.entries(rule.add).some(([key,n])=>!Object.hasOwn(p.attributes,key)||!Number.isFinite(n)))throw new Error('球员特性属性无效');
          }
        }
      }
      if (!Number.isFinite(p.fitness)||p.fitness<0||p.fitness>100) throw new Error('体能无效');
    }
  }
  return out;
}
