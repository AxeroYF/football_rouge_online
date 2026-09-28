import {normalizeLeagueRegistration,LEAGUE_ROSTER_LIMIT,leagueRoster,leaguePlayerView} from '../../shared/config/league-registration.mjs';
import {enhancementFamily} from '../../shared/config/enhancement.mjs';
import {archiveFields,restoreArchivedFields} from '../infrastructure/history-archive.mjs';
import {DAILY_LEAGUE,LEAGUE_REWARDS,leagueDate,leagueDayStart,leagueSchedule,leagueStandings,leagueTicket} from '../../shared/config/daily-league.mjs';
import {ELITE_CLUB_BY_ID} from '../../shared/config/elite-clubs.mjs';
import {PLAYER_PACK_TYPES} from '../../shared/config/player-packs.mjs';
import {buildAccountMatchSeat} from '../../shared/football/account-match-seat.mjs';
import {campaignBondCatalog} from '../../shared/football/campaign-bonds.mjs';
import {setFitness,effectiveFitness} from '../../shared/football/fitness-lineup.mjs';
import {applyLegConsequences} from './match-consequences.mjs';
import {createCampaignLiveLeg,advanceCampaignLiveLeg,restoreCampaignLiveLeg,publicCampaignLiveLeg} from '../../engine/campaign-match-engine.mjs';

const LEAGUE_USERNAMES=Object.freeze(['皇马','小黄','AuI','ZH','Axero','罗哥']);
const copy=value=>JSON.parse(JSON.stringify(value));
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
const accountFields=['gold','goldLedger','inventory','resources','wonderHomeEvents','leagueNotices','leagueRewardDay','fitnessRecovery','leagueRegistration'];
export function leagueLiveForAccount(world,id){return Object.values(world?.dailyLeague?.live??{}).find(f=>f.leg.home.id===id||f.leg.away.id===id)??null;}
export function leaguePlayerLocked(world,id,playerId){const live=leagueLiveForAccount(world,id);return Boolean(live?.leg.match.teams.find(t=>t.id===id)?.players.some(p=>p.id===playerId));}

export class DailyLeagueService {
 constructor(campaign,{rules=DAILY_LEAGUE}={}){this.c=campaign;this.viewers=new Map();this.rules={...rules,usernames:rules.usernames??LEAGUE_USERNAMES};this.cursor=0;this.nextCheck=0;this.lastCheckpoint=this.c.now();this.restore();}
 get day(){return this.c.world?.dailyLeague??null;}
 liveFor(account){return leagueLiveForAccount(this.c.world,account.id);}
 registrationLocked(now=this.c.now()){
  const day=this.day;
  return Boolean(day&&!day.rewarded&&day.fixtures?.some(f=>f.status!=='completed')&&now>=Math.min(...day.fixtures.map(f=>f.startsAt)));
 }
 registrationView(account){
  const now=this.c.now(),value=account.leagueRegistration??normalizeLeagueRegistration(account,now);if(!value)return null;
  const live=this.liveFor(account),current=new Map((live?.leg.match.teams.find(t=>t.id===account.id)?.players??[]).map(p=>[p.id,p]));
  const conditions=Object.fromEntries(leagueRoster(account,value).map(p=>{const inMatch=current.has(p.id),view=leaguePlayerView(p,value.conditions?.[p.id],now,{pauseAt:inMatch?live.leg.startedAt??this.day.fixtures.find(f=>this.day.live[f.id]===live)?.actualStartedAt:null,livePlayer:current.get(p.id)});setFitness(view,effectiveFitness(view));const fixed=effectiveFitness({...view,state:{...view.state,fitness:0}})===effectiveFitness({...view,state:{...view.state,fitness:100}});return [p.id,{state:view.state,fixed,recoveryPerMinute:inMatch||fixed?0:0.5}];}));
  return {...value,conditions,limit:LEAGUE_ROSTER_LIMIT,locked:this.registrationLocked(),inMatch:Boolean(live)};
 }
 saveRegistration(account,{playerIds,version}={}){
  if(!account.setupComplete)fail('请先完成建队',400);
  if(this.registrationLocked())fail('联赛进行期间不能修改注册名单');
  const current=normalizeLeagueRegistration(account,this.c.now());
  if(!Array.isArray(playerIds)||playerIds.length>LEAGUE_ROSTER_LIMIT||new Set(playerIds).size!==playerIds.length)fail('联赛最多注册23名球员，名单不能重复',400);
  const all=new Map(account.draft.roster.map(p=>[String(p.id),p]));
  if(playerIds.some(id=>typeof id!=='string'||!all.has(id)))fail('名单包含已离队球员，请刷新后重试');
  if(new Set(playerIds.map(id=>enhancementFamily(all.get(id)))).size!==playerIds.length)fail('同名球员只能注册一张卡',400);
  if(JSON.stringify(current.playerIds)===JSON.stringify(playerIds))return this.registrationView(account);
  if(version!==JSON.stringify(current.playerIds))fail('注册名单已变化，请刷新后重试');
  const previous=account.leagueRegistration;
  account.leagueRegistration={...current,playerIds:[...playerIds]};
  try{this.c.persist();}catch(error){account.leagueRegistration=previous;throw error;}
  return this.registrationView(account);
 }

 restore(){for(const live of Object.values(this.day?.live??{}))restoreCampaignLiveLeg(live.leg);}
 participants(){
  const accounts=[...this.c.accounts.values()],teams=[],missing=[];
  for(const name of this.rules.usernames){const found=accounts.filter(a=>a.nickname===name&&a.setupComplete);if(found.length!==1){missing.push(name);continue;}const a=found[0];teams.push({id:a.id,accountId:a.id,name:a.draft?.teamName??a.nickname,username:a.nickname,kind:'player'});}
  for(const clubId of this.rules.clubIds){const club=ELITE_CLUB_BY_ID[clubId];if(!club)throw Error('未知联赛豪门');teams.push({id:'league-npc:'+clubId,clubId,name:club.name+'〔豪门〕',kind:'elite'});}
  return {teams,missing};
 }
 // Snapshot only the league's compact metadata, changed live entry and affected account fields.
 transaction(accounts,action,{liveId=null}={}){
  const previous=this.day,meta=previous?copy({...previous,live:undefined}):null,live=previous?{...previous.live}:null;
  if(liveId&&live?.[liveId])live[liveId]=copy(live[liveId]);
  const snapshots=accounts.map(a=>[a,Object.fromEntries(accountFields.map(k=>[k,a[k]===undefined?undefined:structuredClone(a[k])])),(a.draft?.roster??[]).map(p=>[p,structuredClone(p.state),p.fitness])]);
  try{const result=action();this.c.persist();return result;}catch(error){
   if(meta)this.c.world.dailyLeague={...meta,live};else if(previous)this.c.world.dailyLeague=previous;else delete this.c.world.dailyLeague;
   for(const [a,fields,players]of snapshots){for(const [k,v]of Object.entries(fields)){if(v===undefined)delete a[k];else a[k]=v;}for(const [p,state,fitness]of players){if(state===undefined)delete p.state;else p.state=state;if(fitness===undefined)delete p.fitness;else p.fitness=fitness;}}
   this.restore();throw error;
  }
 }
 ensureDay(now=this.c.now()){
  const id=leagueDate(now);if(this.day?.id===id)return false;
  if(now<leagueDayStart(id)+this.rules.resetMinutes*60_000)return false;
  if(this.day&&!this.day.rewarded)return false;
  const {teams,missing}=this.participants();if(missing.length)return false;
  // Replacing this one bounded object removes all prior schedules, statistics and full broadcasts.
  return this.transaction(teams.filter(t=>t.kind==='player').map(t=>this.c.accounts.get(t.id)),()=>{for(const team of teams){const a=this.c.accounts.get(team.id);if(a?.wonderHomeEvents)a.wonderHomeEvents=Object.fromEntries(Object.entries(a.wonderHomeEvents).filter(([,v])=>v.day===id));}this.c.world.dailyLeague={id,teams,fixtures:leagueSchedule(teams.map(t=>t.id),id,this.rules),live:{},stats:{},rewarded:false,createdAt:now};return true;});
 }
 notify(account,notice){account.leagueNotices=[...(account.leagueNotices??[]).filter(n=>n.id!==notice.id),notice].slice(-24);}
 seat(team,now){
  if(team.kind==='elite'){const seat=structuredClone(this.c.eliteChallenges.team(team.clubId).seat);seat.id=team.id;seat.name=team.name;return seat;}
  const account=this.c.accounts.get(team.id);
  if(!account?.setupComplete)fail('参赛账号尚未建队');
  const seat=buildAccountMatchSeat(account,'league',now,{fitness:true,fullFitness:false,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.c.playerDatabase)});
  if(seat.players.filter(p=>p.active!==false).length<7||!seat.players.some(p=>p.active!==false&&p.pool==='GK'))fail('可用首发不足7人或缺少门将');
  return seat;
 }
 begin(fixture,now){
  const day=this.day,home=day.teams.find(t=>t.id===fixture.homeId),away=day.teams.find(t=>t.id===fixture.awayId);
  const seats=[],errors=[];
  for(const t of [home,away]){try{seats.push(this.seat(t,now));errors.push(null);}catch(error){if(!/阵容|首发|球员|体力|门将|建队|替补/.test(error.message))throw error;seats.push(null);errors.push(error.message);}}
  const accounts=[home,away].filter(t=>t.kind==='player').map(t=>this.c.accounts.get(t.id)).filter(Boolean);
  return this.transaction(accounts,()=>{
   if(errors.some(Boolean)){fixture.status='completed';fixture.score=errors[0]&&errors[1]?[0,0]:errors[0]?[0,3]:[3,0];fixture.forfeit=true;fixture.reason=errors.filter(Boolean).join('；');fixture.settledAt=now;this.resultNotices(fixture,null);return true;}
   const account=this.c.accounts.get(home.id),venue=account?this.c.sponsorMatchVenue?.(account,now):null;
   const tickets=account?leagueTicket(account.resources?.fans??0,venue?.seatingCapacity??0,this.rules):null;
   if(tickets)tickets.gold=this.c.wonders?.ticketIncome(account,{kind:'league',homeAccountId:account.id},tickets.gold)??tickets.gold;
   const leg=createCampaignLiveLeg({home:seats[0],away:seats[1],seed:fixture.id,legNumber:1,startedAt:now,knockout:false,venue});
   fixture.status='live';fixture.actualStartedAt=now;day.live[fixture.id]={leg,tickets};
   for(const a of accounts)this.c.fitness?.refreshPlans(a,now);
   return true;
  });
 }
 resultNotices(fixture,tickets){
  const day=this.day,home=day.teams.find(t=>t.id===fixture.homeId),away=day.teams.find(t=>t.id===fixture.awayId);
  for(const team of [home,away]){const account=this.c.accounts.get(team.id);if(!account)continue;
   this.notify(account,{id:fixture.id,day:day.id,kind:'match',title:`联赛第${fixture.round}轮 · ${home.name} ${fixture.score.join(' : ')} ${away.name}`,text:fixture.forfeit?`未正常开赛：${fixture.reason}。无门票收入。`:team.id===home.id?`主场观众 ${tickets?.attendance??0} 人，门票收入 ${tickets?.gold??0} 金币。`:'客场比赛已结束。',createdAt:fixture.settledAt,matchId:fixture.id});
  }
 }
 settle(fixture,now){
  const live=this.day.live[fixture.id];if(!live?.leg.match.finished)return false;
  const accounts=[fixture.homeId,fixture.awayId].map(id=>this.c.accounts.get(id)).filter(Boolean);
  return this.transaction(accounts,()=>{
   const {leg,tickets}=live;
   const projections=new Map(accounts.map(a=>{
    const registration=normalizeLeagueRegistration(a,now),roster=leagueRoster(a,registration).map(p=>leaguePlayerView(p,registration.conditions?.[p.id],now));
    const team=leg.match.teams.find(t=>t.id===a.id),byId=new Map(roster.map(p=>[p.id,p]));
    for(const result of team?.players??[]){const p=byId.get(result.id);if(p){setFitness(p,result.state?.fitness);setFitness(p,effectiveFitness(p));}}
    return [a.id,{draft:{roster}}];
   }));
   applyLegConsequences(projections,{id:fixture.id,live:{attacker:leg.home,defender:leg.away}},leg);
   for(const a of accounts){const registration=normalizeLeagueRegistration(a,now);for(const p of projections.get(a.id).draft.roster)registration.conditions[p.id]={state:structuredClone(p.state),at:now};a.leagueRegistration=registration;}
   fixture.status='completed';fixture.score=[...leg.match.score];fixture.settledAt=now;
   const broadcast=publicCampaignLiveLeg(leg),ratings=new Map(broadcast.teams.flatMap((t,index)=>t.players.map(p=>[JSON.stringify([leg.match.teams[index].id,p.id]),p.rating])));
   Object.assign(fixture,archiveFields({broadcast},['broadcast']));fixture.tickets=tickets;
   for(const team of leg.match.teams){for(const p of team.players){if(!p.startedMatch&&!p.enteredAsSubstitute&&!p.active)continue;
    const key=JSON.stringify([team.id,p.id]),row=this.day.stats[key]??={playerId:p.id,teamId:team.id,name:p.name,teamName:this.day.teams.find(t=>t.id===team.id)?.name??team.name,appearances:0,goals:0,assists:0,ratingTotal:0};
    row.appearances++;row.goals+=Number(p.matchStats?.goals??0);row.assists+=Number(p.matchStats?.assists??0);row.ratingTotal+=Number(ratings.get(key)??0);
   }}
   const home=this.c.accounts.get(fixture.homeId);if(home){if(tickets?.gold)this.c.economy.adjust(home,tickets.gold,'league-tickets');this.c.wonders?.homeMatchCompleted(home,{id:fixture.id,kind:'league',homeAccountId:home.id,result:fixture.score[0]>fixture.score[1]?'win':fixture.score[0]===fixture.score[1]?'draw':'loss',settledAt:fixture.startsAt});}
   this.resultNotices(fixture,tickets);delete this.day.live[fixture.id];for(const a of accounts)this.c.fitness?.refreshPlans(a,now);return true;
  },{liveId:fixture.id});
 }
 reward(now){
  if(!this.day||this.day.rewarded||!this.day.fixtures.every(f=>f.status==='completed'))return false;
  const rows=leagueStandings(this.day),accounts=rows.map(r=>this.c.accounts.get(r.id)).filter(Boolean);
  return this.transaction(accounts,()=>{for(const row of rows){const a=this.c.accounts.get(row.id);if(!a||a.leagueRewardDay===this.day.id)continue;const reward=LEAGUE_REWARDS[row.rank-1];
   this.c.economy.adjust(a,reward.gold,'daily-league-rank');this.c.playerPacks.addPacks(a,PLAYER_PACK_TYPES.LEGENDARY,reward.packs);a.leagueRewardDay=this.day.id;
   this.notify(a,{id:`league-reward:${this.day.id}:${a.id}`,day:this.day.id,kind:'reward',title:`每日联赛结算 · 第${row.rank}名`,text:`已到账 ${reward.gold} 金币、${reward.packs} 个传奇球员卡包。`,createdAt:now});
  }this.day.rewarded=true;this.day.completedAt=now;return true;});
 }
 advance(now=this.c.now(),{maximumChainsPerMatch=1}={}){
  let changed=false;
  if(now>=this.nextCheck){changed=this.ensureDay(now);this.nextCheck=now+10000;}
  if(!this.day||this.day.rewarded)return changed;
  const entries=Object.entries(this.day.live);
  if(entries.length){const [id,live]=entries[this.cursor++%entries.length],before=live.leg.match.nextChainIndex;advanceCampaignLiveLeg(live.leg,now,{maximumChains:maximumChainsPerMatch});changed=live.leg.match.nextChainIndex!==before||changed;if(live.leg.match.finished){this.settle(this.day.fixtures.find(f=>f.id===id),now);this.lastCheckpoint=now;return false;}}
  const pending=this.day.fixtures.find(f=>f.status==='scheduled');
  if(pending&&pending.startsAt<=now&&entries.length<5&&!this.day.fixtures.some(f=>f.round<pending.round&&f.status!=='completed')){this.begin(pending,now);this.lastCheckpoint=now;return false;}
  if(this.reward(now)){this.lastCheckpoint=now;return false;}
  if(changed&&now-this.lastCheckpoint>=30000){this.lastCheckpoint=now;return true;}return false;
 }
 summary(account){return {liveCount:Object.keys(this.day?.live??{}).length,day:this.day?.id??null,unread:(account.leagueNotices??[]).filter(n=>!n.readAt)};}
 read(account,id){const n=(account.leagueNotices??[]).find(n=>n.id===id);if(!n||n.readAt)return {ok:true};const previous=n.readAt;n.readAt=this.c.now();try{this.c.persist();}catch(error){if(previous===undefined)delete n.readAt;else n.readAt=previous;throw error;}return {ok:true};}
 audience(id){
  const now=this.c.now(),names=new Map();
  for(const [key,v] of this.viewers){if(now-v.lastSeenAt>=30000||!this.day?.live[v.matchId]){this.viewers.delete(key);continue;}if(v.matchId===id)names.set(v.accountId,{id:v.accountId,name:v.name});}
  return [...names.values()].sort((a,b)=>a.id.localeCompare(b.id));
 }
 watch(account,id,session){
  if(typeof session!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(session))fail('观赛会话无效',400);
  this.audience(id);const result=this.snapshot(id);
  if(!result.completed){
   const key=account.id+'|'+session;
   const own=[...this.viewers.entries()].filter(([,v])=>v.accountId===account.id);
   if(!this.viewers.has(key)&&own.length>=8)this.viewers.delete(own.sort((a,b)=>a[1].lastSeenAt-b[1].lastSeenAt)[0][0]);
   this.viewers.set(key,{matchId:id,accountId:account.id,name:account.nickname??account.draft?.teamName??'玩家',lastSeenAt:this.c.now()});result.spectators=this.audience(id);
  }
  return result;
 }
 leave(account,id,session){const key=account.id+'|'+session;if(this.viewers.get(key)?.matchId===id)this.viewers.delete(key);return {ok:true};}
 view(account){
  const day=this.day;if(!day){const {teams,missing}=this.participants();return {day:null,ownId:account.id,waitingForTeams:missing.length>0,standings:leagueStandings({teams,fixtures:[]}),fixtures:[],scorers:[],assists:[],rewards:LEAGUE_REWARDS};}
  const stats=Object.values(day.stats),sort=key=>stats.filter(s=>s[key]>0).sort((a,b)=>b[key]-a[key]||b.ratingTotal/b.appearances-a.ratingTotal/a.appearances||a.playerId.localeCompare(b.playerId)).slice(0,30);
  return {day:day.id,serverNow:this.c.now(),ownId:account.id,rewarded:day.rewarded,standings:leagueStandings(day),fixtures:day.fixtures.map(({broadcast,archivedFields,...f})=>({...f,hasReport:Boolean(broadcast||archivedFields),spectators:this.audience(f.id),...(day.live[f.id]?{score:[...day.live[f.id].leg.match.score],minute:day.live[f.id].leg.match.minute}:{})})),scorers:sort('goals'),assists:sort('assists'),rewards:LEAGUE_REWARDS};
 }
 snapshot(id){const f=this.day?.fixtures.find(f=>f.id===id);if(!f)fail('该场联赛已清理或不存在',404);const live=this.day.live[id];if(live)return {competition:'daily-league',spectators:this.audience(id),completed:false,challenge:{id,phase:'first-leg',format:'league-single'},live:{key:id,legNumber:1,broadcast:publicCampaignLiveLeg(live.leg)}};const report=restoreArchivedFields(f).broadcast;if(!report)fail('此场比赛没有可播放战报',404);return {competition:'daily-league',spectators:[],completed:true,live:null,battle:{id,broadcasts:[report]}};}
}
