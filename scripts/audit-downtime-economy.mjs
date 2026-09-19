/** Read-only downtime audit. Never instantiate CampaignService: startup settles income. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HOUR = 3600000;
const time = n => Number.isFinite(n) ? new Date(n).toISOString() : null;
const overlaps = (a,b,from,to) => Number.isFinite(a) && Number.isFinite(b) && a < to && b > from;
const economyReason = reason => ['territory-production','club-wages','club-maintenance'].includes(reason) || String(reason).startsWith('sponsor-income:');

export function halfRecovery(verifiedNetGain) {
  if(!Number.isSafeInteger(verifiedNetGain))throw Error('必须先核实整数净收益');
  const gain=Math.max(0,verifiedNetGain),recover=Math.floor(gain/2);
  return {netGain:gain,recover,retained:gain-recover};
}
function oilEvidence(a,id,world) {
  const saved=a.oil;
  const infrastructure=Object.entries(world?.territories??{}).filter(([,t])=>t.ownerType==='player'&&t.ownerId===id).flatMap(([territoryId,t])=>(t.buildings??[]).filter(b=>['oil-well','factory','club-headquarters'].includes(b.type)||b.wonderId).map(b=>({territoryId,id:b.id,type:b.type,wonderId:b.wonderId??null,level:b.level,status:b.status,raidSuppressed:b.raidSuppressed??null,builtAt:time(b.builtAt),constructionStartedAt:time(b.constructionStartedAt),completesAt:time(b.completesAt),upgradeTo:b.upgradeTo??null,upgradeStartedAt:time(b.upgradeStartedAt),upgradeCompletedAt:time(b.upgradeCompletedAt)})));
  const orders=Object.values(world?.oilMarket?.orders??{}).filter(o=>o.sellerId===id&&o.remaining>0)
    .map(o=>({id:o.id,remaining:o.remaining,quantity:o.quantity,unitPrice:o.unitPrice,createdAt:time(o.createdAt)}));
  const shopPurchases=Object.entries(a.shopReceipts??{}).filter(([,r])=>r.result?.currency==='oil')
    .map(([id,r])=>({receiptId:id,price:r.result.price,playerId:r.result.playerId,signature:r.signature,timeUnknown:true}));
  const marketReceipts=Object.entries(a.oilRequests??{}).map(([id,r])=>({receiptId:id,signature:r.signature,
    result:Object.fromEntries(['orderId','quantity','gold','fee','returned','targetId'].filter(k=>r.result?.[k]!==undefined).map(k=>[k,r.result[k]])),timeUnknown:true}));
  const coalitionCharges=Object.values(world?.coalitions??{}).flatMap(army=>(army.ledger??[])
    .filter(e=>e.shares?.some(s=>s.ownerId===id)).map(e=>({armyId:army.id,at:time(e.at),kind:e.kind,amount:e.shares.filter(s=>s.ownerId===id).reduce((n,s)=>n+s.amount,0)})));
  return {balance:saved?.balance??null,settledAt:time(saved?.settledAt),hourlyProduction:saved?.hourly??null,
    factoryDemand:saved?.factoryDemand??null,periodStartedAt:time(saved?.periodStartedAt),remainder:saved?.remainder??null,pendingWork:saved?.pendingWork??null,
    infrastructure,escrowOil:orders.reduce((n,o)=>n+o.remaining,0),openOrders:orders,shopPurchases,marketReceipts,coalitionCharges,
    recoveryAmount:null,note:'石油没有完整历史产销流水。当前产速不可直接乘停服小时；挂单石油已离开库存，消费凭证可能无时间，需跨备份核对。'};
}

function fanEvidence(a,id,world) {
  const plan=world?.resourceEconomy?.fanPlans?.[id],economy=a.fanEconomy;
  const rewardEvidence=[];
  for(const r of Object.values(world?.neutralRewards?.offers??{}))if(r.kind==='fans'&&r.claimedBy===id)
    rewardEvidence.push({source:'neutral-conquest',id:r.id,amount:r.amount,at:time(r.claimedAt),migrated:Boolean(r.migrated)});
  const battles=new Map([...(a.elite?.history??[]),a.elite?.lastBattle].filter(Boolean).map(b=>[b.id,b]));
  for(const b of battles.values())if(b.rewards?.fans)
    rewardEvidence.push({source:'elite-challenge',id:b.id,amount:b.rewards.fans,at:time(b.settledAt)});
  if(a.wonderPackFans)rewardEvidence.push({source:'wonder-pack',day:a.wonderPackFans.day,amount:a.wonderPackFans.total,events:[...(a.wonderPackFans.events??[])]});
  for(const [id,e]of Object.entries(a.wonderHomeEvents??{}))rewardEvidence.push({source:'wonder-home-match',id,day:e.day,amount:null});
  const growthBuildings=Object.entries(world?.territories??{}).filter(([,t])=>t.ownerType==='player'&&t.ownerId===id)
    .flatMap(([territoryId,t])=>(t.buildings??[]).filter(b=>b.type==='club-headquarters'||b.wonderId)
      .map(b=>({territoryId,id:b.id,type:b.type,wonderId:b.wonderId??null,level:b.level,status:b.status,
        builtAt:time(b.builtAt),upgradeTo:b.upgradeTo??null,upgradeStartedAt:time(b.upgradeStartedAt),upgradeCompletedAt:time(b.upgradeCompletedAt)})));
  return {balance:a.resources?.fans??null,growthAt:time(economy?.growthAt),cycleGrowth:economy?.cycleGrowth??null,
    preference:economy?.preference??null,
    savedPlan:plan?{fans:plan.fans,hourlyGrowth:plan.hourlyGrowth,firstGrowth:plan.firstGrowth,growthAt:time(plan.growthAt),
      territories:(plan.territories??[]).map(t=>({territoryId:t.territoryId,fanRequirement:t.fanRequirement??1000,virtual:Boolean(t.virtual),
        yields:{gold:t.yields?.gold??0,production:t.yields?.production??0,science:t.yields?.science??0}}))}:null,
    growthBuildings,rewardEvidence,recoveryAmount:null,
    note:'只核查停服期间自动增长的球迷，保留正常奖励。当前增长速度不能代替历史增长计划；球迷覆盖提高带来的金币已包含在领地产出中，不能重复回收。'};
}

export function auditSnapshot(saved, {from,to,label='snapshot'} = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw Error('停服时间范围无效');
  if (!saved.accounts || typeof saved.accounts !== 'object') throw Error('不是有效的 campaign-accounts.json 存档');
  const players = Object.entries(saved.accounts).filter(([,a])=>a?.setupComplete).map(([id,a])=>{
    const territory = (a.resourceLedger??[]).filter(e=>overlaps(e.from,e.to,from,to)).map(e=>({
      from:time(e.from),to:time(e.to),gold:e.earned?.gold??0,
      fullyInsideWindow:e.from>=from&&e.to<=to,
      overlapHours:(Math.min(to,e.to)-Math.max(from,e.from))/HOUR,
      // Partial intervals cannot be prorated: fans and facilities can change the rate.
      goldInsideWindow:e.from>=from&&e.to<=to ? e.earned?.gold??0 : null,
    }));
    const contracts = new Map((a.sponsorship?.contracts??[]).map(c=>[c.id,c]));
    const sponsor = (a.sponsorship?.payments??[]).flatMap(p=>{
      const c=contracts.get(p.contractId);
      if (!c || !Number.isFinite(c.signedAt)) return p.paidAt>=from&&p.paidAt<=to+6*HOUR ? [{amount:p.amount,paidAt:time(p.paidAt),periodUnknown:true}] : [];
      const start=c.signedAt+p.fromHour*HOUR,end=c.signedAt+p.toHour*HOUR;
      return overlaps(start,end,from,to) ? [{contractId:p.contractId,from:time(start),to:time(end),amount:p.amount,paidAt:time(p.paidAt),fullyInsideWindow:start>=from&&end<=to}] : [];
    });
    const e=a.operatingCosts?.lastSettlement;
    const costs=e&&overlaps(e.from,e.to,from,to) ? {from:time(e.from),to:time(e.to),paid:e.paid,waived:e.waived,fullyInsideWindow:e.from>=from&&e.to<=to} : null;
    const ledger=(a.goldLedger??[]).filter(e=>economyReason(e.reason)&&e.createdAt>=from&&e.createdAt<=to+6*HOUR)
      .map(e=>({id:e.id,at:time(e.createdAt),reason:e.reason,delta:e.delta,balance:e.balance}));
    return {accountId:id,teamName:a.draft?.teamName??a.nickname??id,goldAtSnapshot:a.gold,
      territorySettlements:territory,sponsorPayments:sponsor,operatingSettlement:costs,oil:oilEvidence(a,id,saved.world),fans:fanEvidence(a,id,saved.world),
      nearbyEconomicLedger:ledger,
      retainedLedger:{goldCount:a.goldLedger?.length??0,resourceCount:a.resourceLedger?.length??0,
        earliestGoldAt:time(a.goldLedger?.[0]?.createdAt),earliestResourceFrom:time(a.resourceLedger?.[0]?.from)},
      recoveryAmount:null,
      note:'仅收集证据。记录缺失不代表零收益；跨边界结算不能按比例扣回；流水时间是入账时间，不等于收益所属时间。'};
  });
  return {label,resourceSettledAt:time(saved.world?.resourceEconomy?.settledAt),players};
}

export function discoverBackups(root,from,to) {
  if (!fs.existsSync(root)) return [];
  const candidates=[];
  for(const item of fs.readdirSync(root,{withFileTypes:true})) {
    if(!item.isDirectory()||item.isSymbolicLink())continue;
    const match=item.name.match(/^(\d{8}-r\d+)-(\d{13})$/);if(!match)continue;
    const dir=path.join(root,item.name),file=path.join(dir,'data','campaign-accounts.json'),meta=path.join(dir,'BACKUP.json');
    if(!fs.existsSync(file)||!fs.existsSync(meta))continue;
    try{const m=JSON.parse(fs.readFileSync(meta,'utf8'));if(m.ready!==true)continue;}catch{continue;}
    candidates.push({file,label:item.name,at:Number(match[2])});
  }
  // A pre-stop snapshot plus early post-stop snapshots can retain overwritten ledgers.
  const before=candidates.filter(x=>x.at<=from).sort((a,b)=>b.at-a.at).slice(0,1);
  const after=candidates.filter(x=>x.at>from).sort((a,b)=>a.at-b.at).slice(0,4);
  const r9=candidates.filter(x=>x.label.startsWith('20260918-r9-')).sort((a,b)=>a.at-b.at).slice(0,2);
  return [...new Map([...before,...after,...r9].map(x=>[x.file,x])).values()];
}

export function runAudit(argv) {
  const args={};
  for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--help')return {help:true};if(!['--save','--backups','--from','--to'].includes(key)||!argv[i+1])throw Error('用法：--save 存档 --backups 热更新备份目录 --from 含时区开始时间 --to 含时区结束时间');args[key.slice(2)]=argv[++i];}
  for(const key of ['from','to'])if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(args[key]??''))throw Error('时间必须显式包含时区，如 2026-09-14T12:00:00+08:00');
  const from=Date.parse(args.from),to=Date.parse(args.to);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||!args.save)throw Error('缺少存档或时间范围无效');
  const files=[{file:path.resolve(args.save),label:'current'},...(args.backups?discoverBackups(path.resolve(args.backups),from,to):[])];
  const errors=[],snapshots=[];
  for(const source of files){try{const bytes=fs.readFileSync(source.file),saved=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));snapshots.push({...auditSnapshot(saved,{from,to,label:source.label}),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}catch(error){if(source.label==='current')throw error;errors.push({label:source.label,error:error.message});}}
  return {auditVersion:3,readOnly:true,provisionalWindow:true,recoveryPolicy:{goldPercent:50,oilPercent:50,fansPercent:50,basis:'verified downtime net gold/oil gains and automatic fan growth only',rounding:'floor, remainder retained by player',apply:false},window:{from:args.from,to:args.to,hours:(to-from)/HOUR},
    generatedAt:new Date().toISOString(),snapshots,errors,
    guidance:['本工具只读取存档与备份，不连接游戏，不修改金币、石油或球迷，不触发离线结算。','范围按用户的大致时间暂定，需要结合真实停服日志确认。','快照之间可能含同一笔流水，不可相加。','R9 备份可能发生在开服补发之后；优先寻找其中保留的历史结算。','未输出密码、令牌、登录信息或完整球员存档。']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=runAudit(process.argv.slice(2));if(result.help)console.log('Read-only: node audit-downtime-economy.mjs --save campaign-accounts.json --backups /var/backups/yellowdogs-rougelite/hot-updates --from 2026-09-14T12:00:00+08:00 --to 2026-09-18T03:00:00+08:00');else console.log(JSON.stringify(result,null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
