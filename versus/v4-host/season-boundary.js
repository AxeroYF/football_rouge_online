import {createHash} from 'node:crypto';
import {LEAGUE_ROUNDS,LEAGUE_TEAM_COUNT,SEASON_FINAL_ENABLED} from '../league-format.js';

export const seasonBoundaryField='v4LocalSeasonBoundaries';
const format='yffm-v4-local-season-boundaries-1',copy=value=>structuredClone(value),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const seasonBoundaryKey=(seasonId,phase)=>hash({seasonId,phase});
function metadata(league){const meta=league[seasonBoundaryField];if(meta&&(meta.format!==format||!meta.receipts||!Number.isSafeInteger(meta.revision)))throw new Error('本地赛季边界回执无效');return meta;}
function assertFinished(league,seasonId){
  if(SEASON_FINAL_ENABLED)throw new Error('本地赛季边界只适配当前停用总决赛的赛制');
  if(league.season.id!==seasonId||league.season.status!=='completed'||league.season.currentRound!==LEAGUE_ROUNDS||league.season.totalRounds!==LEAGUE_ROUNDS||league.rounds.length!==LEAGUE_ROUNDS||league.rounds.some((round,index)=>round.number!==index+1)||league.teams.length!==LEAGUE_TEAM_COUNT||league.teams.some(team=>team.table.played!==LEAGUE_ROUNDS))throw new Error('联赛赛季尚未完整结束');
  if(league.v4LocalLeagueRounds?.active||league.v4LocalCupEvents?.active||league.liveRound||league.liveCupRound||league.liveSeasonFinalRound||league.liveWorldCupRound||(league.liveFriendlies??[]).some(live=>!live.completed))throw new Error('存在未完成赛事，禁止跨越赛季边界');
  const matches=new Map(league.matches.map(match=>[match.id,match]));if(matches.size!==league.matches.length)throw new Error('赛季比赛记录重复');
  for(const round of league.rounds){
    if(round.status!=='complete'||round.fixtures.length!==LEAGUE_TEAM_COUNT/2)throw new Error('联赛轮次尚未完整结算');
    for(const fixture of round.fixtures){const match=matches.get(fixture.matchId);if(!match||match.competition&&match.competition!=='league'||match.round!==round.number||match.homeId!==fixture.homeId||match.awayId!==fixture.awayId)throw new Error('联赛赛程与结果不一致');}
  }
  if(league.cup?.status!=='completed'||!league.cup.championId||league.cup.events.length!==7||league.cup.events.some(event=>event.status!=='complete')||league.matches.filter(match=>match.competition==='cup').length!==29)throw new Error('当前淘汰杯赛尚未完整结束');
}

// Pure local-copy transitions. All original rewards, honors, archive and
// movement effects are returned together for one durable state+receipt commit.
export function applySeasonBoundary({league:original,seasonId,phase,at,createService}){
  if(typeof seasonId!=='string'||!seasonId||!['rewards','reset'].includes(phase)||!Number.isSafeInteger(at)||at<0)throw new Error('赛季边界请求无效');
  const league=copy(original),key=seasonBoundaryKey(seasonId,phase),prior=metadata(league)?.receipts[key];
  if(prior)return {league,receipt:copy(prior),duplicate:true};
  assertFinished(league,seasonId);
  if(phase==='reset'&&(!metadata(league)?.receipts[seasonBoundaryKey(seasonId,'rewards')]||league.dailyAutomation.lastRewardedSeasonId!==seasonId))throw new Error('需要先提交本地赛季奖励回执');
  let random=parseInt(key.slice(0,8),16);const service=createService({statePath:null,backupDir:null,pagedInbox:false,now:()=>at,rng:()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;}});
  if(!service||service.then||service.statePath!==null||service.shardStore||service.pagedInbox)throw new Error('赛季边界服务必须完全使用内存状态');
  service.state=league;service.save=()=>{};const refuse=()=>{throw new Error('赛季边界禁止事务外持久化');};service.backupFile=refuse;service.scheduleLiveSettlementSave=refuse;
  let result;
  if(phase==='rewards'){
    result=service.settleDailySeason({manual:true});if(!result||result.status!=='completed'||league.dailyAutomation.lastRewardedSeasonId!==seasonId)throw new Error('原赛季奖励未完整结束');
  }else{
    result=service.resetDailyCompetitions({manual:true,skipBackup:true,skipSave:true,skipView:true,reason:'v4-local-completed-season'});
    if(result!==true||league.season.id===seasonId||league.season.currentRound!==0||league.season.status!=='active'||league.cup.status!=='waiting'||league.matches.length||league.seasonFinalTournament!==null||!league.archives.some(archive=>archive.season.id===seasonId)||!league.competitionFormat.movements.some(movement=>movement.seasonId===seasonId))throw new Error('原赛季归档或重置未完整结束');
  }
  const meta=league[seasonBoundaryField]??={format,revision:0,receipts:{}};
  if(Object.keys(meta.receipts).length>=512)throw new Error('本地赛季边界回执需要归档');
  const receipt={key,seasonId,phase,completedAt:at,resultingSeasonId:league.season.id,localOnly:true,...(phase==='rewards'?{settlementId:result.id}:{} )};
  meta.receipts[key]=receipt;meta.revision++;
  return {league:service.state,receipt:copy(receipt),duplicate:false};
}
