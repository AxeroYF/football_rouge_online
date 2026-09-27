import {monitorEventLoopDelay} from 'node:perf_hooks';
import {maintainCampaignHistory} from '../application/history-maintenance.mjs';
export function runtimeSample(c,memory=process.memoryUsage()) {
 const d=c.world?.diplomacy??{},receipts={};
 for(const key of ['airportRequests','coalitionRequests','raidRequests','facilityUpgradeRequests'])receipts[key]=0;
 let eliteReceipts=0;for(const a of c.accounts.values()){for(const key of Object.keys(receipts))receipts[key]+=Object.keys(a[key]??{}).length;eliteReceipts+=Object.keys(a.elite?.requests??{}).length;}
 return {at:new Date().toISOString(),memory,accounts:c.accounts.size,receipts:{...receipts,elite:eliteReceipts,diplomacy:Object.keys(d.receipts??{}).length},diplomacyRequests:Object.keys(d.requests??{}).length,friendlyMatches:Object.keys(d.matches??{}).length,activeMatches:Object.keys(c.world?.activeChallenges??{}).length+Object.keys(c.world?.eliteChallenges??{}).length+Object.values(d.matches??{}).filter(m=>!m.battle).length,save:c.repository?.lastSave??null};
}
export function observeRuntime(c,{intervalMs=60000,log=console.log,warn=console.warn}={}) {
 const delay=monitorEventLoopDelay({resolution:20});delay.enable();let previous=null,growing=0;
 const tick=()=>{try{maintainCampaignHistory(c);}catch(error){warn('[campaign-maintenance]',error.message);}
  const sample=runtimeSample(c);sample.eventLoopMs={p95:delay.percentile(95)/1e6,max:delay.max/1e6};delay.reset();
  growing=previous&&sample.memory.heapUsed>previous.heapUsed+8*1048576?growing+1:0;
  if(sample.memory.rss>Number(process.env.CAMPAIGN_RSS_WARN_MB??900)*1048576||growing>=3)warn('[campaign-memory-warning]',JSON.stringify(sample));
  else log('[campaign-runtime]',JSON.stringify(sample));previous=sample.memory;
 };
 const timer=setInterval(tick,intervalMs);timer.unref?.();
 return {tick,stop(){clearInterval(timer);delay.disable();}};
}
