import {s4EnhancementChanceForLevels} from './enhancement.mjs';
export const BIOLOGY_TOPIC='biology:match-endurance';
export const BIOLOGY_REDUCTION=[3,6,9,12,15];
export const ADVANCED_RESEARCH_WORK=Object.freeze({biology:[200,400,800,1600,3200],enhancement:[100,200,400,800,1200,1800,2600,3600,4800,6400]});
export function advancedResearchTopic(id){
 if(id===BIOLOGY_TOPIC)return {id,branch:'biology',label:'比赛耐力',maxLevel:5};
 const m=/^enhancement:([0-7]):([0-7])$/.exec(String(id));if(!m)return null;
 const main=Number(m[1]),material=Number(m[2]);if(material>main||s4EnhancementChanceForLevels(main,material)>=100)return null;
 return {id,branch:'enhancement',label:`主卡 +${main} / 材料 +${material}`,main,material,maxLevel:10};
}
export function advancedResearchLevel(account,id){const topic=advancedResearchTopic(id),level=account?.formationResearch?.topicLevels?.[id];return topic&&Number.isInteger(level)?Math.max(0,Math.min(topic.maxLevel,level)):0;}
export const biologyReduction=account=>BIOLOGY_REDUCTION[advancedResearchLevel(account,BIOLOGY_TOPIC)-1]??0;
export const enhancementResearchBonus=(account,main,material)=>advancedResearchLevel(account,`enhancement:${main}:${material}`)*.5;
export const researchedEnhancementChance=(account,main,material)=>Math.min(100,s4EnhancementChanceForLevels(main,material)+enhancementResearchBonus(account,main,material));
