import {BIOLOGY_TOPIC,BIOLOGY_REDUCTION} from './advanced-research.mjs';
import { TACTIC_LABELS, PLAY_STYLE_LABELS } from '../football/labels.js';
import { S4_ENHANCEMENT, s4EnhancementChanceForLevels } from './enhancement.mjs';
// Tactics remain a preview; formation, enhancement and biology research are live.
export const RESEARCH_BRANCHES = Object.freeze([
 {id:'formation',label:'阵型研究',example:{branch:'formation',label:'4-3-3'}},
 {id:'tactic',label:'战术研究',example:{branch:'tactic',id:'style:possession'}},
 {id:'enhancement',label:'强化研究',example:{branch:'enhancement',target:3}},
 {id:'biology',label:'生物研究',example:{branch:'biology'}},
]);
export const RESEARCH_LEVELS=Object.freeze([1,2,3,4,5]);
export const ENHANCEMENT_RESEARCH_POINTS=Object.freeze(Array.from({length:10},(_,i)=>(i+1)*.5));
export const researchLevelsFor=topic=>topic?.branch==='enhancement'?ENHANCEMENT_RESEARCH_POINTS.map((_,i)=>i+1):RESEARCH_LEVELS;

export const RESEARCH_TOPICS=Object.freeze([
 {id:BIOLOGY_TOPIC,branch:'biology',label:'比赛耐力',kind:'远征队体能'},
 ...Object.entries(TACTIC_LABELS).map(([id,label])=>({id:'tactic:'+id,branch:'tactic',label,kind:'攻防倾向'})),
 ...Object.entries(PLAY_STYLE_LABELS).map(([id,label])=>({id:'style:'+id,branch:'tactic',label,kind:'比赛风格'})),
 ...Array.from({length:S4_ENHANCEMENT.maxLevel},(_,main)=>Array.from({length:S4_ENHANCEMENT.maxLevel+1},(_,material)=>({id:`enhancement:${main}:${material}`,branch:'enhancement',label:`${main}+${material}`,kind:'强化组合',main,material,target:main+1,baseChance:s4EnhancementChanceForLevels(main,material)}))).flat().filter(t=>t.baseChance<100&&t.material<=t.main),
]);
export function researchLevelPreview(topic,level){
 if(!topic||!researchLevelsFor(topic).includes(level))throw new Error('无效研究对象或等级');
 if(topic.branch==='biology')return {level,bonus:BIOLOGY_REDUCTION[level-1],unit:'%',result:BIOLOGY_REDUCTION[level-1],draft:false};
 if(topic.branch==='enhancement'){const bonus=ENHANCEMENT_RESEARCH_POINTS[level-1];return {level,bonus,unit:'个百分点',base:topic.baseChance,result:Math.min(100,topic.baseChance+bonus),draft:false};}
 return {level,bonus:level,unit:'%',result:level,draft:false};
}
export function normalizeResearchSelection(value={}){return Object.fromEntries(['formation','tactic','enhancement','biology'].map(branch=>[branch,RESEARCH_TOPICS.find(t=>t.branch===branch&&t.id===value?.[branch])?.id??null]));}
