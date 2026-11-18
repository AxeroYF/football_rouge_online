import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {LeagueShardStore,unwrapTracked} from '../versus/league-shard-store.js';
import {openLocalLeagueScheduler} from '../versus/v4-host/local-league-scheduler.js';
import {openScheduledPreviewHost} from '../versus/v4-host/scheduled-preview-host.js';

await new Promise(resolve=>process.once('message',resolve));
const root=fs.realpathSync(process.env.V4_MIXED_ROOT??'');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'v4-local-storage.json'),'utf8')).format,'yffm-v4-canonical-local-settlement-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){
  const relative=path.relative(root,path.resolve(process.env[key]??''));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
}
const resolved=resolveSourceCatalog({content:JSON.parse(fs.readFileSync(process.env.YDL_CONTENT_OVERRIDES_PATH,'utf8')),studio:JSON.parse(fs.readFileSync(process.env.YDL_PLAYER_CARD_STUDIO_PATH,'utf8'))}),sourceCatalog={catalog:resolved.players,traitCatalog:resolved.traits,bondCatalog:createS4BondCatalog(resolved.players)};
await import('../versus/ydl-content-store.js');
const {yellowDogsLeague:service,YellowDogsLeagueService}=await import('../versus/league-service.js');
const {versusRooms:rooms}=await import('../versus/room-service.js');
const {handleVersusApi}=await import('../versus/api.js');
service.backupDir=null;service.pagedInbox=true;
const accounts=[];
for(const team of service.state.teams.filter(team=>team.ownerId))accounts.push(rooms.bindAccount(team.ownerId));
assert.ok(accounts.length<=10);
while(accounts.length<10){
  const login=rooms.bindAccount(`v4-mixed-${accounts.length}`),account=rooms.account(login.profile.id,login.accountToken);
  service.beginDraft(account,`本地容量队${accounts.length}`);service.autoDraft(account);service.finishDraft(account);accounts.push(login);
}
for(const [index,login] of accounts.entries()){
  const team=service.accountTeam(login.profile.id);assert.ok(team);
  for(let i=0;i<64;i++)service.pushInbox(team,{id:`mixed-${index}-${i}`,type:'notice',title:'本地容量测试',summary:'独立测试副本',body:'收件箱读写验证。'.repeat(100)});
}
if(service.state.cup.status==='waiting')service.startCup();
// The copied save can retain an old firstRoundAt. This isolated workload needs
// an actually future market so the original background job can publish normally.
service.state.cup.nextRoundAt=Date.now()+3600000;
const forecast=service.nextPredictionFixtures().find(entry=>entry.competition==='cup'&&!service.state.matchPredictions.bets.some(bet=>bet.marketId===entry.id));assert.ok(forecast,'需要未来且无投注的杯赛市场进行并行预测');
// Remove only this isolated no-bet cache so the original generator must produce
// and publish a new 24-sample market, rather than discard a job for an open one.
delete service.state.matchPredictions.markets[forecast.id];service.ensurePredictionMarkets(0);
assert.equal(service.state.matchPredictions.markets[forecast.id].status,'preparing');
const state=structuredClone(unwrapTracked(service.state));service.statePath=path.join(root,'league-shards');service.shardStore=new LeagueShardStore(service.statePath,{backupDir:null});service.adoptState(state,true);service.save({forceFull:true,skipDailyBackup:true});
const reopened=new YellowDogsLeagueService({statePath:service.statePath,backupDir:null,pagedInbox:true});service.shardStore=reopened.shardStore;service.adoptState(unwrapTracked(reopened.state),false);service.save({skipDailyBackup:true});
const createService=options=>new YellowDogsLeagueService(options),bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine'),bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8'));
const scheduler=await openLocalLeagueScheduler({root,service,createService,sourceCatalog,candidate:{accepted:true,bundleDirectory,engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest},enabled:true});
const preview=await openScheduledPreviewHost({root,rooms,league:service,enabled:true});
const settle=scheduler.settlement.settleJob.bind(scheduler.settlement),settlementCalls=[];
scheduler.settlement.settleJob=async(...args)=>{const began=performance.now();try{return await settle(...args);}finally{settlementCalls.push(performance.now()-began);}};
const send=(response,status,value)=>{const data=Buffer.from(JSON.stringify(value));response.writeHead(status,{'Content-Type':'application/json','Content-Length':data.length});response.end(data);};
async function readJson(request){let data='';for await(const bytes of request){data+=bytes;if(data.length>65536)throw new Error('请求过大');}return JSON.parse(data||'{}');}
const server=http.createServer(async(request,response)=>{
  try{if(await preview.handle(request,response))return;const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname.startsWith('/api/versus/league'))return await handleVersusApi(request,response,pathname,readJson,send);
    send(response,404,{error:'not found'});
  }catch(error){send(response,error.statusCode??500,{error:error.message});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const controller=new AbortController(),lag=monitorEventLoopDelay({resolution:10});lag.enable();
let rss=0,heap=0,started=0,outcome=null,failure=null,finishedMs=null,predictionStarted=false,predictionFinished=null,predictionError=null;
const timer=setInterval(()=>{const m=process.memoryUsage();rss=Math.max(rss,m.rss);heap=Math.max(heap,m.heapUsed);},100);
const request={seasonId:service.state.season.id,roundNumber:service.state.season.currentRound+1,releaseRate:64};
const work=scheduler.advance(request,{signal:controller.signal,onRoundStarted:round=>{
  started=performance.now();preview.registerRound(round,{publicWatch:true});
  predictionStarted=service.startPredictionMarketGeneration(forecast);
  service.predictionGenerationJob?.promise.then(result=>{predictionFinished=result;},error=>{predictionError=error.message;});
  process.send({type:'ready',url:`http://127.0.0.1:${server.address().port}`,accounts,matchIds:round.tasks.map(task=>task.fixture.id)});
}}).then(result=>{outcome=result;finishedMs=performance.now()-started;},error=>{failure=error.message;process.send({type:'failure',message:failure});});
process.once('message',async message=>{
  if(message.type!=='finish')return;controller.abort();await work;clearInterval(timer);lag.disable();
  let flushError=null;try{service.flushInboxReadPersist?.();}catch(error){flushError=error.message;}
  await service.predictionGenerationJob?.promise.catch(error=>{predictionError=error.message;});await rooms.accountRepository.flush?.();
  process.send({type:'metrics',outcome,failure,finishedMs,predictionStarted,predictionFinished,predictionSamples:service.state.matchPredictions.markets[forecast.id]?.simulation?.samples??null,predictionError,flushError,mainRss:rss,mainHeap:heap,eventLoopP95Ms:lag.percentile(95)/1e6,eventLoopMaxMs:lag.max/1e6,settlementCalls,
    round:service.state.season.currentRound,matchCount:service.state.matches.length,receipts:Object.keys(service.state.v4LocalSettlements?.receipts??{}).length,accounts:accounts.length});
  server.closeAllConnections();server.close(()=>process.exit(0));
});
