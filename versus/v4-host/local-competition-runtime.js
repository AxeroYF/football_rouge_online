import {openLocalCompetitionController} from './local-competition-controller.js';
import {openLocalReplayRetention} from './local-replay-retention.js';
import {openLocalReplayHost} from './local-replay-host.js';

// A local, opt-in composition boundary. It installs no production timer and
// exposes no HTTP switch: operator policy and retention calls remain private.
export async function openLocalCompetitionRuntime({enabled=false,root,rooms,service,createService,sourceCatalog,candidates=[],now=Date.now,publicWatch=false,allowedAccountIds=[],retentionPolicy={},pinnedMatchIds=[],readerLimit=16}={}){
  if(!enabled)return {enabled:false,handle:async()=>false,advance:async()=>({handled:false,engine:'legacy',reason:'disabled'}),close:async()=>{}};
  const controller=await openLocalCompetitionController({enabled:true,root,service,createService,sourceCatalog,candidates,now});let retention,replay,closed=false,active=null,abort=null,closing=null;const requests=new Set(),operations=new Set();
  const access={publicWatch,allowedAccountIds:structuredClone(allowedAccountIds)};
  async function registerStored(){const state=await controller.readLeague();for(const record of [...Object.values(state.v4LocalLeagueRounds?.rounds??{}),...Object.values(state.v4LocalCupEvents?.events??{})])replay.registerRound(record,access);}
  try{
    retention=await openLocalReplayRetention({root,readLeague:controller.readLeague,now,policy:retentionPolicy,pinnedMatchIds});
    replay=await openLocalReplayHost({enabled:true,root,rooms,league:service,lifecycle:retention.lifecycle,now,readerLimit});await registerStored();
  }catch(error){replay?.close();await retention?.close();throw error;}
  function available(){if(closed)throw new Error('本地比赛宿主已关闭');}
  function track(operation){const pending=operation.finally(()=>operations.delete(pending));operations.add(pending);return pending;}
  return {
    enabled:true,scope:'local-controlled-runtime-only',
    read:()=>controller.read(),
    get readerStats(){return replay.readerStats;},get registeredMatches(){return replay.registeredMatches;},
    async handle(request,response){if(closed)return false;const operation=replay.handle(request,response);requests.add(operation);try{return await operation;}finally{requests.delete(operation);}},
    setPolicy(value,options){available();return track(controller.setPolicy(value,options));},
    recover(){available();if(active)throw new Error('比赛推进中不能恢复锁');return track((async()=>{const result=await controller.recover();await registerStored();return result;})());},
    retry(id){available();return track(controller.retry(id));},
    advance(event,{signal,onStarted=()=>{}}={}){
      available();if(active)throw new Error('已有比赛正在推进');const current=new AbortController(),cancel=()=>current.abort();abort=current;
      if(signal?.aborted)current.abort();else signal?.addEventListener('abort',cancel,{once:true});
      active=controller.advance(event,{signal:current.signal,onStarted:async round=>{replay.registerRound(round,access);await onStarted(round);}}).finally(()=>{signal?.removeEventListener('abort',cancel);active=null;abort=null;});return active;
    },
    retentionPlan(){available();return track(retention.plan());},
    sweep(){available();return track(retention.sweep());},
    close(){if(closing)return closing;closed=true;abort?.abort();closing=(async()=>{await active?.catch(()=>{});await Promise.allSettled([...requests,...operations]);replay.close();await retention.close();})();return closing;},
  };
}
