import {advancedResearchTopic,advancedResearchLevel,ADVANCED_RESEARCH_WORK} from '../../shared/config/advanced-research.mjs';
import crypto from 'node:crypto';
import { FORMATION_RESEARCH_DIRECTIONS as directions, FORMATION_RESEARCH_POINTS as points, FORMATION_RESEARCH_WORK as work, FORMATION_RESEARCH_PERIOD_MS as period, normalizeFormationResearchSlots, formationResearchLevels, analyzeResearchFormation } from '../../shared/config/formation-research.mjs';
const copy=value=>structuredClone(value);
const conflict=message=>Object.assign(new Error(message),{statusCode:409});
export class FormationResearchService {
 constructor({campaign}){this.campaign=campaign;this.cadenceChangedAt=campaign.now();}
 data(account){return account.formationResearch??{schemaVersion:1,revision:0,slots:normalizeFormationResearchSlots().map(s=>({...s,confirmedAt:null,levels:formationResearchLevels()})),active:null};}
 publicState(account){
  const data=this.data(account),rate=this.campaign.world?.resourceEconomy?.rates?.[account.id]?.science??0;
  return {...copy(data),topicLevels:{...data.topicLevels},topicRequirements:ADVANCED_RESEARCH_WORK,serverNow:this.campaign.now(),sciencePerMinute:rate,requirements:work.map(n=>this.campaign.wonders.researchRequirement(account,'formation',n)),active:data.active?{...copy(data.active),sciencePerMinute:rate*period/(data.active.workPeriodMs??3600000)}:null};
 }
 mutate(account,action,body={}){
  if(!account.setupComplete)throw new Error('请先完成建队');
  this.campaign.save();
  const before=account.formationResearch,data=copy(this.data(account));
  if(body.revision!==data.revision)throw conflict('研究状态已更新，请重试');
  const slot=data.slots.find(s=>s.id===body.slotId);
  const now=this.campaign.now();
  if(action==='confirm'){
   if(!slot)throw new Error('阵型槽位无效');
   if(slot.confirmedAt!=null)throw conflict('阵型已确定，不能修改站位');
   const raw=body.formation;
   if(!raw||Object.keys(raw.positions??{}).length!==10||!points.every(id=>Number.isFinite(raw.positions?.[id]?.x)&&Number.isFinite(raw.positions?.[id]?.y)))throw new Error('阵型必须包含十个有效外场位置');
   const clean=normalizeFormationResearchSlots([raw])[0];
   if(!points.every(id=>raw.positions[id].x===clean.positions[id].x&&raw.positions[id].y===clean.positions[id].y)||!Object.keys(clean.lines).every(k=>raw.lines?.[k]===clean.lines[k]))throw new Error('阵型位置或参考线超出范围');
   const shape=analyzeResearchFormation(clean);
   if(shape.counts.GK!==1||[shape.counts.DEF,shape.counts.MID,shape.counts.ATT].some(n=>n<1))throw new Error('阵型需要保留前场、中场、后场');
   Object.assign(slot,clean,{id:slot.id,name:clean.name,configured:true,confirmedAt:now,levels:formationResearchLevels()});
  }else if(action==='rename'){
   if(!slot||slot.confirmedAt==null)throw new Error('请先确定阵型');
   const name=typeof body.name==='string'?body.name.trim():'';
   if(!name||name.length>24||/[\u0000-\u001f\u007f]/.test(name))throw new Error('阵型名称需为 1–24 个字符');
   slot.name=name;
  }else if(action==='start-topic'){
   const topic=advancedResearchTopic(body.topicId);if(!topic)throw new Error('研究对象无效或尚未开放');
   if(data.active)throw conflict('俱乐部同时只能研究一项');
   const level=advancedResearchLevel(account,topic.id)+1;if(level>topic.maxLevel)throw new Error('该方向已达最高等级');
   data.active={id:crypto.randomUUID(),topicId:topic.id,branch:topic.branch,level,required:ADVANCED_RESEARCH_WORK[topic.branch][level-1],completed:0,workPeriodMs:period,startedAt:now,updatedAt:now};
  }else if(action==='start'){
   if(!slot||slot.confirmedAt==null)throw new Error('请先确定阵型');
   if(data.active)throw conflict('俱乐部同时只能研究一项');
   if(!directions.some(d=>d.id===body.direction))throw new Error('研究方向无效');
   const level=(slot.levels[body.direction]??0)+1;if(level>5)throw new Error('该方向已达最高等级');
   data.active={id:crypto.randomUUID(),slotId:slot.id,direction:body.direction,level,required:this.campaign.wonders.researchRequirement(account,'formation',work[level-1]),completed:0,workPeriodMs:period,startedAt:now,updatedAt:now};
  }else if(action==='cancel'){
   if(data.active&&data.active.id!==body.jobId)throw conflict('研究项目已变化，请重试');
   data.active=null;
  }else throw new Error('研究操作无效');
  data.revision++;account.formationResearch=data;
  try{this.campaign.save();}catch(error){if(before===undefined)delete account.formationResearch;else account.formationResearch=before;throw error;}
  return this.publicState(account);
 }
 completeJob(data,job,at){
  if(job.topicId){data.topicLevels??={};data.topicLevels[job.topicId]=job.level;data.topicCompletedAt??={};data.topicCompletedAt[job.topicId]=at;}
  else {const slot=data.slots.find(s=>s.id===job.slotId);if(!slot)throw conflict('研究阵型不存在');slot.levels[job.direction]=job.level;slot.lastCompletedAt=at;}
  data.active=null;data.revision++;
 }
 assignReward(account,{rewardId,jobId}={}){
  if(!account.setupComplete)throw new Error('请先完成建队');
  this.campaign.save();
  const reward=(account.pendingNeutralRewards??[]).find(r=>r.id===rewardId&&r.kind==='research');
  if(!reward)throw conflict('待处理研究奖励不存在');
  if(typeof jobId==='string'&&Object.hasOwn(reward.researchApplications??{},jobId))return {reward:copy(reward),alreadyApplied:true};
  const active=this.data(account).active;
  if(!active||active.id!==jobId)throw conflict('研究项目已变化，请选择正在进行的研究');
  if(reward.status!=='pending'||!Number.isFinite(reward.amount)||reward.amount<=0)throw conflict('该研究奖励已使用');
  const previous=account.formationResearch,rewardsBefore=copy(account.pendingNeutralRewards);
  const data=copy(previous),job=data.active,at=this.campaign.now();
  const applied=Math.min(reward.amount,Math.max(0,job.required-job.completed));
  if(applied<=0)throw conflict('该研究已完成，请刷新');
  try{
   job.completed+=applied;job.updatedAt=at;
   reward.amount=Math.max(0,reward.amount-applied);reward.status=reward.amount>1e-9?'pending':'applied';
   reward.appliedResearch=(reward.appliedResearch??0)+applied;reward.appliedAt=at;
   reward.researchApplications??={};reward.researchApplications[jobId]={amount:applied,appliedAt:at};
   if(job.completed+1e-9>=job.required)this.completeJob(data,job,at);else data.revision++;
   account.formationResearch=data;this.campaign.save();
   return {reward:copy(reward),appliedResearch:applied,researchCompleted:!data.active};
  }catch(error){account.formationResearch=previous;account.pendingNeutralRewards=rewardsBefore;throw error;}
 }
 prepare(accounts,intervals,now){
  const before=new Map();
  const rollback=()=>{for(const [account,data] of before)account.formationResearch=data;};
  try{
   for(const account of accounts.values()){
    if(!account.formationResearch?.active)continue;
    before.set(account,account.formationResearch);account.formationResearch=copy(account.formationResearch);
    const data=account.formationResearch,job=data.active;
    // Existing hourly jobs settle their historical work at the old cadence. Only
    // time after this service started uses minutes; transaction boundaries may
    // precede that instant, so migration must not happen at an earlier boundary.
    const phases=(intervals?.[account.id]??[]).flatMap(phase=>{
     if(job.workPeriodMs)return [{...phase,period:job.workPeriodMs}];
     const cut=this.cadenceChangedAt;
     return [{...phase,to:Math.min(phase.to,cut),period:3600000},
       {...phase,from:Math.max(phase.from,cut),period}];
    });
    for(const phase of phases){
     const from=Math.max(job.updatedAt,job.startedAt,phase.from),to=Math.min(now,phase.to);if(to<=from)continue;
     const rate=Math.max(0,(phase.units?.science??0)/1000),earned=(to-from)*rate/phase.period;
     const missing=job.required-job.completed;
     if(earned+1e-9>=missing&&rate>0){this.completeJob(data,job,Math.ceil(from+missing/rate*phase.period));break;}
     job.completed+=earned;job.updatedAt=to;
    }
    if(data.active){job.updatedAt=Math.max(job.updatedAt,now);if(now>=this.cadenceChangedAt)job.workPeriodMs=period;}
   }
   return {rollback};
  }catch(error){rollback();throw error;}
 }
}
