import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSandboxJournal,openSandboxJournal} from '../v4-rollout/sandbox-journal.js';

const scope='canonical-shadow-only',copy=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const counters=['goals','assists','saves','tackles','interceptions','clearances','blocks','pressuresWon','penaltiesWon','yellowCards','redCards'];
function finite(value){if(typeof value==='number'&&!Number.isFinite(value))throw new Error('隔离结算存在非有限数值');if(value&&typeof value==='object')Object.values(value).forEach(finite);}
function randomFor(fingerprint){let state=parseInt(fingerprint.slice(0,8),16);return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}

export async function readCompletedShadowJob(directory){
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8'));
  if(metadata.format!=='yffm-v4-shadow-job-1'||metadata.scope!=='shadow-only')throw new Error('只能结算隔离影子任务');
  const document=await (await openSandboxJournal(path.join(directory,'journal'))).read(),pinned=document.fixtures[metadata.fixtureId],result=pinned?.result?.value;
  if(!pinned||!result||!['finished','settled'].includes(pinned.status)||pinned.selection.primary!=='legacy'||pinned.selection.shadow!==true||result.settlementAllowed!==false||hash(result)!==pinned.result.digest)throw new Error('影子任务未完整结束或结果损坏');
  for(const key of ['fixtureId','engineVersion','sourceDigest','inputFingerprint'])if(metadata[key]!==pinned[key]||result[key]!==pinned[key])throw new Error('影子赛果与版本锁定不一致');
  if(hash({engineVersion:pinned.engineVersion,input:pinned.input})!==pinned.inputFingerprint)throw new Error('影子输入指纹无效');
  const report=result.report;
  if(report?.schema!=='v4-legacy-player-report-1'||report.settlementAllowed!==false||report.fixtureId!==pinned.fixtureId||report.engineVersion!==pinned.engineVersion||report.inputFingerprint!==pinned.inputFingerprint||JSON.stringify(report.score)!==JSON.stringify(result.score)||report.teams?.length!==2)throw new Error('个人战报与影子赛果不一致');
  report.teams.forEach((team,side)=>{
    if(team.id!==pinned.input.teams[side].id||!Array.isArray(team.players)||new Set(team.players.map(p=>p.id)).size!==team.players.length)throw new Error('个人战报球队或出场名单无效');
    const eligible=new Set([...pinned.input.teams[side].players,...pinned.input.teams[side].bench].map(p=>p.id));
    for(const player of team.players){
      if(!eligible.has(player.id)||counters.some(key=>!Number.isSafeInteger(player.stats?.[key])||player.stats[key]<0)||!Number.isFinite(player.rating)||player.rating<4||player.rating>10||!Number.isFinite(player.fitness)||player.fitness<0||player.fitness>100)throw new Error('个人战报统计无效');
      // Penalty events identify the fouling team; the victim belongs to the
      // opposite side. IDs alone are insufficient when both teams own the card.
      const consumed=(report.importantEvents??[]).filter(e=>e.type==='penaltyAwarded'&&e.opponentId===player.id&&e.teamIndex===1-side).length;
      if(consumed!==player.stats.penaltiesWon)throw new Error('战报点球受益人与所属球队不一致');
    }
  });
  finite(result);return {pinned,result};
}

export async function createCanonicalShadowSettlement(directory,{initialState,...options}){
  const store=await createSandboxJournal(directory,{scope,league:copy(initialState),fixtures:{}});
  return coordinator(store,options);
}
export async function openCanonicalShadowSettlement(directory,options){
  return coordinator(await openSandboxJournal(directory),options);
}
async function coordinator(store,{createService,now=Date.now}={}){
  if(typeof createService!=='function'||(await store.read()).state.scope!==scope)throw new Error('需要隔离结算状态及内存服务工厂');
  return {
    read:store.read,
    recoverAbandonedLock:store.recoverAbandonedLock,
    async settleJob(directory,context){
      const {pinned,result}=await readCompletedShadowJob(directory);
      if(!['league','cup'].includes(context?.competition)||!Number.isSafeInteger(context.round)||context.round<1||context.round>10000)throw new Error('隔离结算赛事上下文无效');
      if(context.competition==='cup'&&(typeof context.event?.id!=='string'||!context.event.id||context.event.id.length>200||!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(context.event.stage)||context.event.round!==context.round||![1,2].includes(context.event.leg)))throw new Error('杯赛隔离结算上下文无效');
      const descriptor={competition:context.competition,round:context.round,event:context.competition==='cup'?copy(context.event):null};
      const settledAt=now();if(!Number.isSafeInteger(settledAt)||settledAt<0)throw new Error('隔离结算时钟无效');
      const locked=await store.pin({...pinned,selection:{fixtureId:pinned.fixtureId,primary:'legacy',shadow:true,canonicalContext:descriptor,settledAt}});
      if(JSON.stringify(locked.selection.canonicalContext)!==JSON.stringify(descriptor))throw new Error('比赛已锁定到不同结算上下文');
      await store.complete(pinned.fixtureId,{...result,canonicalContext:descriptor});
      return store.settle(pinned.fixtureId,state=>applyCanonicalShadowResult({state,pinned,result,descriptor,settledAt:locked.selection.settledAt,createService}));
    },
  };
}


// Pure business application shared by isolated journal and canonical storage adapters.
export function applyCanonicalShadowResult({state,pinned,result,descriptor,settledAt,createService,scheduledBinding=null}){
        const beforeMatchIds=new Set(state.league.matches.map(record=>record.id));
        const beforeStats=descriptor.competition==='league'?state.league.playerStats:state.league.cup.playerStats;
        const expected=result.report.teams.flatMap(team=>{
          const source=state.league.teams.find(t=>t.id===team.id);if(!source)throw new Error('隔离联赛缺少参赛球队');
          return team.players.map(player=>{const key=`${team.id}:${player.id}${source.ownerId?'':':ai'}`,prior=beforeStats[key]??{};
            return {key,appearances:Number(prior.appearances??0)+1,ratingTotal:Number(prior.ratingTotal??0)+player.rating,counters:Object.fromEntries(counters.map(name=>[name,Number(prior[name]??0)+player.stats[name]]))};});
        });
        const service=createService({statePath:null,backupDir:null,pagedInbox:false,now:()=>settledAt,rng:randomFor(pinned.inputFingerprint)});
        if(!service||service.then||service.statePath!==null||service.shardStore||service.pagedInbox===true)throw new Error('结算服务必须完全使用内存状态');
        service.state=state.league;service.roundNewUnavailable=new Set(descriptor.competition==='league'?scheduledBinding?.record.newUnavailable??[]:[]);service.cupNewUnavailable=new Set(descriptor.competition==='cup'?scheduledBinding?.record.newUnavailable??[]:[]);
        const refuse=()=>{throw new Error('隔离结算禁止事务外持久化');};service.save=refuse;service.scheduleLiveSettlementSave=refuse;service.backupFile=refuse;
        const fixture=scheduledBinding?.fixture??{id:pinned.fixtureId,homeId:result.report.teams[0].id,awayId:result.report.teams[1].id,matchId:null};
        if(fixture.homeId!==result.report.teams[0].id||fixture.awayId!==result.report.teams[1].id)throw new Error('绑定赛程与战报球队不一致');
        const match={report:copy(result.report),winnerIndex:result.report.winnerIndex,leagueAutoRotations:[[],[]]};
        if(scheduledBinding)match.report.v4ReviewArchive={roundKey:scheduledBinding.record.key,competition:descriptor.competition,sourceDigest:pinned.sourceDigest,
          cup:descriptor.competition==='cup'?{kind:'cup',stage:descriptor.event.stage,leg:descriptor.event.leg,aggregate:result.report.aggregateBaseScore}:null};
        if(descriptor.competition==='league')service.finalizeFixture(fixture,descriptor.round,match);else service.finalizeCupFixture(fixture,scheduledBinding?.event??descriptor.event,match);
        if(!fixture.matchId||beforeMatchIds.has(fixture.matchId)||service.state.matches.filter(record=>record.id===fixture.matchId).length!==1)throw new Error('结算未生成唯一新赛程记录');
        const afterStats=descriptor.competition==='league'?service.state.playerStats:service.state.cup.playerStats;
        for(const player of expected){const consumed=afterStats[player.key];if(!consumed||consumed.appearances!==player.appearances||consumed.ratingTotal!==player.ratingTotal||counters.some(name=>consumed[name]!==player.counters[name]))throw new Error('原结算消费与V4个人战报不一致');}
        if(scheduledBinding)scheduledBinding.record.newUnavailable=[...(descriptor.competition==='cup'?service.cupNewUnavailable:service.roundNewUnavailable)];
        state.league=service.state;Object.defineProperty(state.fixtures,pinned.fixtureId,{value:{...fixture,...copy(descriptor)},enumerable:true,writable:true,configurable:true});
        finite(state);return state;
}
