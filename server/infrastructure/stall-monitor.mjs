import {Worker,isMainThread,workerData} from 'node:worker_threads';
const PHASES=['idle','state','save','persist','matches','raid','coalition','friendly','elite'];
if(!isMainThread&&workerData?.campaignStallMonitor){
 const shared=new BigInt64Array(workerData.buffer);let reported=0;
 setInterval(()=>{const now=Date.now(),lag=now-Number(Atomics.load(shared,0));
  if(lag>=workerData.thresholdMs&&now-reported>=workerData.thresholdMs){reported=now;console.warn('[campaign-stall]',JSON.stringify({at:new Date(now).toISOString(),blockedMs:lag,phase:PHASES[Number(Atomics.load(shared,1))]??'unknown',rss:process.memoryUsage.rss()}));}
 },workerData.checkMs);
}
// Separate thread can report when the main thread cannot run its own diagnostic timer.
export function startStallMonitor(c,{thresholdMs=15000,checkMs=5000}={}) {
 const buffer=new SharedArrayBuffer(16),shared=new BigInt64Array(buffer);Atomics.store(shared,0,BigInt(Date.now()));
 const worker=new Worker(new URL(import.meta.url),{workerData:{campaignStallMonitor:true,buffer,thresholdMs,checkMs},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:16,stackSizeMb:2}});
 worker.on('error',error=>console.warn('[campaign-stall-monitor]',error.message));worker.unref();
 const timer=setInterval(()=>Atomics.store(shared,0,BigInt(Date.now())),1000);timer.unref();const undo=[];
 const wrap=(owner,key,phase)=>{if(typeof owner?.[key]!=='function')return;const original=owner[key];owner[key]=function(...args){const before=Atomics.exchange(shared,1,BigInt(PHASES.indexOf(phase)));try{return original.apply(this,args);}finally{Atomics.store(shared,1,before);}};undo.push(()=>owner[key]=original);};
 for(const key of ['state','save','persist'])wrap(c,key,key);
 wrap(c,'advanceActiveChallenges','matches');
 for(const [key,phase]of [['eliteRaids','raid'],['coalitions','coalition'],['diplomacy','friendly'],['eliteChallenges','elite']])wrap(c[key],'advance',phase);
 return {stop(){clearInterval(timer);for(const fn of undo)fn();return worker.terminate();}};
}
