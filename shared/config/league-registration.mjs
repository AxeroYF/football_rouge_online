import {repairSquadTactics,repairTacticsLineups} from './tactics-repair.mjs';
import {representativePlayers} from './representative-players.mjs';
export const LEAGUE_ROSTER_LIMIT=23;
export const LEAGUE_RECOVERY_PER_MINUTE=0.5;
export function leagueRoster(account,registration=account.leagueRegistration){
 const ids=new Set(registration?.playerIds??[]);
 return (account.draft?.roster??[]).filter(p=>ids.has(String(p.id)));
}
// Persist actual card IDs: enhancement retains the main card; consumed cards never remap.
export function normalizeLeagueRegistration(account,now=Date.now()){
 if(!account.setupComplete)return account.leagueRegistration??null;
 const all=account.draft?.roster??[],previous=account.leagueRegistration;
 if(!previous){
  const saved=repairTacticsLineups(account.tactics,all,account.playerSquads)?.squads?.garrison;
  const eligible=representativePlayers(all).filter(p=>account.playerSquads?.assignments?.[p.id]!=='expedition');
  const ids=new Set(eligible.map(p=>String(p.id)));
  const fallback=[],take=(pool,count)=>eligible.filter(p=>p.pool===pool&&!fallback.includes(p)).slice(0,count).forEach(p=>fallback.push(p));
  take('GK',1);take('DEF',4);take('MID',3);take('ATT',3);for(const p of eligible)if(p.pool!=='GK'&&!fallback.includes(p)&&fallback.length<11)fallback.push(p);
  const starters=(saved?.planSnapshots?.__s4V2?.starters??saved?.starters??fallback.map(p=>p.id)).filter(id=>ids.has(id)).slice(0,11);
  return {version:1,playerIds:starters,conditions:Object.fromEntries(starters.map(id=>[id,{state:{fitness:100},at:now}])),tactics:repairSquadTactics(saved??{},eligible.filter(p=>starters.includes(p.id)))};
 }
 const owned=new Set(all.map(p=>String(p.id)));
 const playerIds=[...new Set(previous.playerIds??[])].filter(id=>owned.has(id)).slice(0,LEAGUE_ROSTER_LIMIT);
 const conditions=Object.fromEntries(Object.entries(previous.conditions??{}).filter(([id])=>owned.has(id)));
 for(const id of playerIds)conditions[id]??={state:{fitness:100},at:now};
 return {...previous,playerIds,conditions,tactics:repairSquadTactics(previous.tactics??{},all.filter(p=>playerIds.includes(String(p.id))).map(p=>leaguePlayerView(p,conditions[p.id],now)))};
}

// League health is separate from expedition/garrison, training and loan availability.
export function leaguePlayerView(player,condition,now,{pauseAt=null,livePlayer=null}={}){
 const state=structuredClone(condition?.state??{fitness:100});
 const until=Math.min(now,pauseAt??now),elapsed=Math.max(0,until-(condition?.at??now));
 state.fitness=Math.min(100,Number(state.fitness??100)+elapsed/60000*LEAGUE_RECOVERY_PER_MINUTE);
 if(livePlayer)state.fitness=livePlayer.state?.fitness??state.fitness;
 return {...player,state,fitness:state.fitness,status:{},medical:null,training:null,coalitionLoan:null,injury:null,sentOff:false};
}
