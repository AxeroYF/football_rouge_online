import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const SOURCE = '20260918-r9-1789672415684';
const BOOT = '2026-09-17T19:13:25.';
export function planRecovery(report) {
 const history = report.snapshots?.find(s=>s.label===SOURCE), current = report.snapshots?.find(s=>s.label==='current');
 if(!history || !current || report.errors?.length)throw Error('审计缺少R9备份或包含读取错误');
 const currentById=new Map(current.players.map(p=>[p.accountId,p]));
 const players=history.players.map(p=>{
  const recent=currentById.get(p.accountId);if(!recent)throw Error('当前快照缺少玩家 '+p.accountId);
  const entries=p.nearbyEconomicLedger.filter(e=>e.at.startsWith(BOOT));
  if(!entries.length)throw Error('缺少开服补结算流水 '+p.accountId);
  const totals={territory:0,sponsor:0,wages:0,maintenance:0};
  for(const e of entries){const category=e.reason==='territory-production'?'territory':e.reason==='club-wages'?'wages':e.reason==='club-maintenance'?'maintenance':e.reason.startsWith('sponsor-income:')?'sponsor':null;if(!category)throw Error('未知流水');totals[category]+=e.delta;}
  const goldNet=Object.values(totals).reduce((a,b)=>a+b,0),oilRate=p.oil.hourlyProduction-p.oil.factoryDemand,fanRate=p.fans.cycleGrowth;
  if(![goldNet,oilRate,fanRate].every(Number.isSafeInteger)||fanRate<0)throw Error('时速或净收益无效');
  const balances={gold:recent.goldAtSnapshot,oil:recent.oil.balance,fans:recent.fans.balance};
  const proposed={gold:Math.floor(Math.max(0,goldNet)/2),oil:Math.floor(Math.max(0,oilRate)*83/2),fans:Math.floor(fanRate*83/2)};
  if(!Object.values(balances).every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('当前资源余额无效');
  const deduction=Object.fromEntries(Object.entries(proposed).map(([key,value])=>[key,Math.min(value,balances[key])]));
  return {accountId:p.accountId,teamName:p.teamName,goldEvidence:{...totals,net:goldNet,entryIds:entries.map(e=>e.id)},
    rates:{oilProduction:p.oil.hourlyProduction,oilConsumption:p.oil.factoryDemand,oilNet:oilRate,fans:fanRate},
    proposed,deductionAtSnapshot:deduction,balanceAtSnapshot:balances,afterDeductionAtSnapshot:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v-deduction[k]]))};
 });
 return {schemaVersion:1,planId:'downtime-20260914-20260918-half-v1',applied:false,sourceSnapshot:SOURCE,referenceSnapshotAt:current.resourceSettledAt,
  downtime:{from:'2026-09-14T15:58:17.140+08:00',to:'2026-09-18T03:13:25.099+08:00'},
  policy:{fraction:0.5,rounding:'floor',oilAndFanHours:83,ratesAssumption:'用户确认停服期间增长速度不变；采用R9备份速率，基础设施时间未见停服内变化',goldBasis:'开服实际补结算流水净值，已减去实际工资养护',balanceFloor:0},players,
  totals:Object.fromEntries(['gold','oil','fans'].map(k=>[k,players.reduce((sum,p)=>sum+p.proposed[k],0)]))};
}
export function recoveryText(plan){
 const lines=['停服收益扣除清单（拟定，未执行）','','停服区间：2026-09-14 15:58:17 至 2026-09-18 03:13:25，北京时间。','金币按开服实际补结算净收益扣回50%；已计入停服期间实际扣除的工资和养护费。','石油、球迷按83个完整小时乘停服时速再扣回50%，不足整小时部分留给玩家。','石油使用净产量，扣除工厂供油；奇观代采已包含在产量里。所有扣除向下取整。','保留正常奖励、交易、开服后收益及停服前库存，不对当前总库存减半。','按玩家ID匹配；执行时从当时余额扣除，不覆盖为下表快照余额。余额不足扣至0，不产生欠款。','','球队 | 扣金币 | 扣石油 | 扣球迷'];
 for(const p of plan.players)lines.push(`${p.teamName} | ${p.proposed.gold.toLocaleString('en-US')} | ${p.proposed.oil.toLocaleString('en-US')} | ${p.proposed.fans.toLocaleString('en-US')}`);
 lines.push(`合计 | ${plan.totals.gold.toLocaleString('en-US')} | ${plan.totals.oil.toLocaleString('en-US')} | ${plan.totals.fans.toLocaleString('en-US')}`,'','各玩家计算与快照参考（快照为北京时间2026-09-18 04:12:31，当前余额会继续变化）：');
 for(const p of plan.players){const g=p.goldEvidence;lines.push('',p.teamName+' / '+p.accountId,`金币：领地${g.territory} + 赞助${g.sponsor} + 工资变动${g.wages} + 养护变动${g.maintenance} = 净变化${g.net}，回收${p.proposed.gold}。`,`石油：(${p.rates.oilProduction}产量 - ${p.rates.oilConsumption}消耗)/小时 × 83 × 50%，回收${p.proposed.oil}。`,`球迷：${p.rates.fans}/小时 × 83 × 50%，回收${p.proposed.fans}。`,`快照资源（金币/石油/球迷）：${Object.values(p.balanceAtSnapshot).join(' / ')}。`,`按快照余额扣后参考：${Object.values(p.afterDeductionAtSnapshot).join(' / ')}。`);}
 lines.push('','冠军教父停服金币净变化为负，因此不回收金币；球迷仍按其自动增长回收一半。','此文件只是清单，没有执行扣款。正式执行需先备份、以planId记录完成状态防止重复扣除，并刷新球迷分配和经济计划。');return lines.join('\n')+'\n';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [audit,prefix]=process.argv.slice(2);if(!audit||!prefix)throw Error('用法：node scripts/plan-downtime-recovery.mjs 审计.json 输出路径前缀');
 const bytes=fs.readFileSync(audit),plan=planRecovery(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));plan.sourceSha256=crypto.createHash('sha256').update(bytes).digest('hex');
 fs.mkdirSync(path.dirname(prefix),{recursive:true});fs.writeFileSync(prefix+'.json',JSON.stringify(plan,null,2)+'\n');fs.writeFileSync(prefix+'.txt','\ufeff'+recoveryText(plan));console.log(JSON.stringify(plan.totals));
}
