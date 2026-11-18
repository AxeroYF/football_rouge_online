import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import inspector from 'node:inspector';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {createTrackedState,LeagueShardStore,unwrapTracked} from '../versus/league-shard-store.js';

const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const storage=args.storage??'memory',existing=Number(args.existing??0),transactions=Number(args.transactions??0),opened=Number(args.opened??0);
const name=`${storage}-cards${existing}-tx${transactions}-history${opened}`;
const out=process.argv.includes('--after')?'outputs/pack-batch-100-after-20261117':'outputs/pack-batch-100-audit-20261117';fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'yffm1-pack-audit-'));
const session=new inspector.Session();session.connect();
const profile=method=>new Promise((resolve,reject)=>session.post(method,(e,r)=>e?reject(e):resolve(r)));
try{
  let random=173;const rng=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};
  const s=new YellowDogsLeagueService({statePath:null,rng});
  const user={id:'pack-audit',nickname:'开包评估'};s.beginDraft(user,'开包评估队');s.autoDraft(user);s.finishDraft(user);
  const team=s.accountTeam(user.id),sample=Object.values(s.state.s4Assets.cards)[0];
  for(let i=0;i<existing;i++){const id=`audit-card-${i}`;s.state.s4Assets.cards[id]={...structuredClone(sample),id,playerId:team.rosterIds[i%team.rosterIds.length]};}
  for(let i=s.state.s4Assets.transactions.length;i<transactions;i++)s.state.s4Assets.transactions.push({id:`audit-tx-${i}`,type:'card-created',playerId:sample.playerId,cardIds:[sample.id],toOwnerId:user.id,metadata:{acquisitionSource:'audit-existing'},createdAt:s.now()});
  for(let i=0;i<opened;i++)s.s4PackInventory(user.id).push({id:`audit-old-${i}`,packType:'private-mixed',status:'opened',openedAt:s.now()});
  const packs=s.grantS4Pack(user.id,'private-mixed',100,{source:'isolated-audit'});
  if(storage==='shard'){
    s.statePath=path.join(temp,'shards');s.shardStore=new LeagueShardStore(s.statePath,{backupDir:null});
    s.adoptState(s.state);s.save({forceFull:true,skipDailyBackup:true});
  }else if(storage==='json'){
    s.statePath=path.join(temp,'league.json');s.save({skipDailyBackup:true});
  }else if(storage==='tracked')s.state=createTrackedState(s.state,()=>{});
  const cardCountBefore=Object.keys(s.state.s4Assets.cards).length;
  const measurements={};
  for(const method of ['privatePackCandidates','openDirectS4Pack','grantS4Card','publicDirectS4PackResult','save','s4PlayerAssetDelta','compactMutationView']){
    const original=s[method].bind(s);s[method]=(...args)=>{const start=performance.now();try{return original(...args);}finally{const m=measurements[method]??={count:0,ms:0};m.count++;m.ms+=performance.now()-start;}};
  }
  if(s.shardStore){const original=s.shardStore.save.bind(s.shardStore);s.shardStore.save=(...args)=>{const start=performance.now();try{return original(...args);}finally{measurements.diskWrite={count:1,ms:performance.now()-start};}};}
  const delayStart=performance.now();const timer=new Promise(resolve=>setTimeout(()=>resolve(performance.now()-delayStart),0));
  await profile('Profiler.enable');await profile('Profiler.start');
  const start=performance.now();const result=s.openS4PacksBatch(user,packs.map(p=>p.id),{compact:true});const operationMs=performance.now()-start;
  const serializationStart=performance.now(),json=JSON.stringify(result),serializationMs=performance.now()-serializationStart;
  const {profile:cpu}=await profile('Profiler.stop');fs.writeFileSync(`${out}/${name}.cpuprofile`,JSON.stringify(cpu));
  assert.equal(result.packBatchOpening.results.length,100);assert.equal(Object.keys(s.state.s4Assets.cards).length,cardCountBefore+100);
  assert.equal(s.s4PackInventory(user.id).filter(p=>packs.some(x=>x.id===p.id)&&p.status==='opened').length,100);
  const report={name,storage,syntheticExistingCards:existing,syntheticTransactions:transactions,syntheticOpenedPacks:opened,requested:100,awarded:100,operationMs,serializationMs,responseBytes:Buffer.byteLength(json),eventLoopTimerDelayMs:await timer,measurements,rssMiB:process.memoryUsage().rss/1024**2};
  fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(report,null,2));
  // A reusable response fixture for isolated browser render checks, with no account secrets.
  fs.writeFileSync(`${out}/${name}-response.json`,json);
  console.log(JSON.stringify(report,null,2));
}finally{session.disconnect();assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'yffm1-pack-audit-'));fs.rmSync(temp,{recursive:true,force:true});}
