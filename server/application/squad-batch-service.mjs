import { createHash } from 'node:crypto';
import { representativePlayers } from '../../shared/config/representative-players.mjs';
import { normalizePlayerSquads, assertExpeditionCapacity, isPlayerSquadId } from '../../shared/config/player-squads.mjs';
import { repairTacticsLineups } from '../../shared/config/tactics-repair.mjs';
import { activeExpeditionPlayerIds } from './expedition-fitness-service.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
const idOf=p=>String(p.id??p.playerId);
export function squadBatchSnapshot(account,world){
 const roster=account.draft?.roster??[],players=representativePlayers(roster);
 const assignments=normalizePlayerSquads(account.playerSquads,roster).assignments;
 const active=activeExpeditionPlayerIds(world,account.id);
 const locks=Object.fromEntries(players.flatMap(p=>{const reason=p.coalitionLoan?'联军借调':p.medical?'治疗中':p.training?'训练中':active.has(p.id)?'比赛进行中':'';return reason?[[idOf(p),reason]]:[];}));
 // Fitness ticks and income must not invalidate a draft; roster/lineup changes must.
 const version=digest({assignments,tactics:account.tactics??null,roster:roster.map(p=>[idOf(p),p.cardDefinitionId,p.upgradeLevel,p.trainingBonuses,p.role,p.secondaryRole,p.pool,p.overall,p.effectiveOverall,p.training,p.medical,p.coalitionLoan,p.state?.injury,p.state?.injuryMatches,p.state?.injuryRounds,p.state?.suspension,p.state?.suspensionMatches,p.status])});
 return {players,assignments,tactics:account.tactics??null,locks,version};
}
function prepare(account,world,body){
 if(!account.setupComplete||!account.draft?.roster?.length)fail('请先完成初始建队',400);
 const snapshot=squadBatchSnapshot(account,world);
 if(body?.version!==snapshot.version)fail('编队或球员状态已变化，请刷新并保留草稿后重新检查');
 if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>snapshot.players.length)fail('请选择需要调整的球员',400);
 const allowed=new Map(snapshot.players.map(p=>[idOf(p),p])),seen=new Set(),assignments={...snapshot.assignments};
 for(const change of body.changes){
  if(!change||typeof change.playerId!=='string'||!allowed.has(change.playerId)||seen.has(change.playerId))fail('球员不存在、代表卡已变化或重复提交',400);
  seen.add(change.playerId);
  if(!isPlayerSquadId(change.squadId))fail('编队不存在',400);
  if(snapshot.locks[change.playerId])fail(`${allowed.get(change.playerId).name}：${snapshot.locks[change.playerId]}，暂时不能调动`);
  assignments[change.playerId]=change.squadId;
 }
 const playerSquads=normalizePlayerSquads({assignments},account.draft.roster);
 assertExpeditionCapacity(playerSquads,account.draft.roster);
 const tactics=repairTacticsLineups(account.tactics,account.draft.roster,playerSquads);
 const starters=(value,squad)=>{const t=value?.squads?.[squad]??(squad==='expedition'?value:null);return t?.planSnapshots?.__s4V2?.starters??t?.starters??[];};
 const lineupChanges=['expedition','garrison'].map(squad=>{const before=starters(account.tactics,squad),after=starters(tactics,squad);return {squad,removed:before.filter(id=>!after.includes(id)),added:after.filter(id=>!before.includes(id)),remaining:after.length};});
 return {snapshot,playerSquads,tactics,lineupChanges};
}
export function previewSquadBatch(account,world,body){const p=prepare(account,world,body);return {version:p.snapshot.version,lineupChanges:p.lineupChanges};}
export function saveSquadBatch(service,account,body){
 if(typeof body?.requestId!=='string'||!/^[a-zA-Z0-9:_-]{8,100}$/.test(body.requestId))fail('无效的请求编号',400);
 const signature=digest({version:body.version,changes:body.changes});
 if(account.squadBatchReceipt?.requestId===body.requestId){
  if(account.squadBatchReceipt.signature!==signature)fail('该请求编号已用于其他编队调整');
  return {snapshot:squadBatchSnapshot(account,service.world),statePatch:service.actionState(account)};
 }
 const p=prepare(account,service.world,body);
 const previous={playerSquads:account.playerSquads,tactics:account.tactics,squadBatchReceipt:account.squadBatchReceipt};
 try{account.playerSquads=p.playerSquads;account.tactics=p.tactics;account.squadBatchReceipt={requestId:body.requestId,signature};service.save();}
 catch(error){for(const [key,value]of Object.entries(previous)){if(value===undefined)delete account[key];else account[key]=value;}throw error;}
 return {snapshot:squadBatchSnapshot(account,service.world),statePatch:service.actionState(account),lineupChanges:p.lineupChanges};
}
