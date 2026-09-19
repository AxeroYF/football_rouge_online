import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import crypto from 'node:crypto';
import {facilityEffects} from '../../shared/config/facility-levels.mjs';
import {absenceMatches,setAbsence} from '../../shared/football/match-availability.mjs';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const restore=(target,value)=>{for(const k of Object.keys(target))delete target[k];Object.assign(target,value);};
export class MedicalService{
 constructor({world,accounts,buildings,economy,now=Date.now,save=()=>{},wonders}){Object.assign(this,{world,accounts,buildings,economy,now,save,wonders});}
 tasks(a){return Object.values(a.medicalTasks??{});}
 due(at=this.now()){return [...this.accounts.values()].some(a=>this.tasks(a).some(t=>!t.closedAt&&t.completesAt<=at));}
 locked(a){return Boolean(raidMatchForAccount(this.world,a.id))||Boolean(this.world.eliteChallenges?.[a.id])||Object.values(this.world.activeChallenges??{}).some(c=>c.attackerId===a.id||c.defenderId===a.id);}
 prepare(at=this.now()){
  const snapshots=[];
  const rewind=()=>{for(const [a,b]of snapshots){if(b.tasks===undefined)delete a.medicalTasks;else a.medicalTasks=b.tasks;a.gold=b.gold;a.goldLedger=b.goldLedger;for(const [p,state,medical]of b.players){if(state===undefined)delete p.state;else p.state=state;if(medical===undefined)delete p.medical;else p.medical=medical;}}};
  try{for(const a of this.accounts.values()){
   if(!this.tasks(a).some(t=>!t.closedAt))continue;
   snapshots.push([a,{tasks:structuredClone(a.medicalTasks),gold:a.gold,goldLedger:structuredClone(a.goldLedger),players:(a.draft?.roster??[]).map(p=>[p,structuredClone(p.state),structuredClone(p.medical)])}]);
   for(const t of this.tasks(a).filter(t=>!t.closedAt)){
    const p=a.draft?.roster?.find(p=>p.id===t.playerId),territory=this.world.territories[t.territoryId];
    const available=territory?.ownerId===a.id&&territory.buildings?.some(b=>b.id===t.buildingId&&b.status==='active');
    if(t.raidPause&&territory?.buildings?.some(b=>b.id===t.buildingId&&b.raidSuppressed))continue;
    const source=p?.state?.injury?.sourceLegId;
    if(!available){this.economy.adjust(a,t.costGold,'medical-facility-lost-refund');t.closedAt=at;t.status='cancelled';}
    else if(!p||source!==t.sourceLegId||absenceMatches(p,'injury')===0){t.closedAt=at;t.status='obsolete';}
    else if(t.completesAt<=at){setAbsence(p,'injury',Math.max(0,absenceMatches(p,'injury')-1),{treatedSourceLegId:t.sourceLegId});t.closedAt=t.completesAt;t.status='completed';}
    if(t.closedAt&&p?.medical?.taskId===t.id)delete p.medical;
   }
  }}catch(error){rewind();throw error;}
  return {rollback:rewind};
 }
 view(account,territoryId,buildingId){
  const territory=this.world.territories[territoryId],building=territory?.buildings?.find(b=>b.id===buildingId&&b.type==='medical-center');
  if(territory?.ownerId!==account.id||!building)fail('医疗中心不存在',404);
  const rules=facilityEffects('medical-center',building.level);rules.costGold=Math.ceil(rules.costGold*(this.wonders?.modifiers(account).recurringExpenseMultiplier??1));
  const tasks=this.tasks(account).filter(t=>t.buildingId===buildingId&&!t.closedAt);
  return {rules,tasks,canTreat:building.status==='active'&&!this.locked(account)&&tasks.length<rules.capacity,
   players:(account.draft?.roster??[]).filter(p=>absenceMatches(p,'injury')>0).map(p=>({id:p.id,name:p.name,injury:absenceMatches(p,'injury'),eligible:!p.coalitionLoan&&!p.training&&!p.medical&&(!p.state?.injury?.sourceLegId||p.state.injury.treatedSourceLegId!==p.state.injury.sourceLegId)}))};
 }
 start(account,{territoryId,buildingId,playerId,requestId}={}){
  if(typeof requestId!=='string'||!/^[A-Za-z0-9:_-]{8,128}$/.test(requestId))fail('治疗请求编号无效');
  const prior=this.tasks(account).find(t=>t.requestId===requestId);
  if(prior){if(prior.playerId!==playerId||prior.buildingId!==buildingId||prior.territoryId!==territoryId)fail('请求编号已用于其他治疗',409);return prior;}
  const view=this.view(account,territoryId,buildingId),p=account.draft.roster.find(p=>p.id===playerId);
  if(!view.canTreat)fail('比赛期间或床位已满时不能开始治疗',409);
  if(!view.players.some(p=>p.id===playerId&&p.eligible))fail('该球员不满足治疗条件或本次受伤已经治疗',409);
  const before=structuredClone(account);
  try{
   const sourceLegId=p.state?.injury?.sourceLegId??`legacy-injury:${crypto.randomUUID()}`;
   setAbsence(p,'injury',absenceMatches(p,'injury'),{sourceLegId});
   this.economy.spend(account,view.rules.costGold,'medical-treatment');
   const task={id:`medical:${crypto.randomUUID()}`,requestId,territoryId,buildingId,playerId,playerName:p.name,sourceLegId,costGold:view.rules.costGold,startedAt:this.now(),completesAt:this.now()+view.rules.durationMs,status:'treating',closedAt:null};
   account.medicalTasks??={};account.medicalTasks[task.id]=task;p.medical={taskId:task.id,completesAt:task.completesAt};this.save();return task;
  }catch(error){restore(account,before);throw error;}
 }
 cancel(account,taskId){const task=this.tasks(account).find(t=>t.id===taskId);if(!task)fail('治疗任务不存在',404);if(task.closedAt)return task;const before=structuredClone(account);try{task.closedAt=this.now();task.status='cancelled';const p=account.draft.roster.find(p=>p.id===task.playerId);if(p?.medical?.taskId===task.id)delete p.medical;this.save();return task;}catch(error){restore(account,before);throw error;}}
}
