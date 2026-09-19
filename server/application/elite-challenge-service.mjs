import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import {applyLegConsequences} from './match-consequences.mjs';
import crypto from 'node:crypto';
import {ELITE_CLUBS,ELITE_CLUB_BY_ID,ELITE_CHALLENGE_RULES as RULES,canonicalClubName,eliteFanReward} from '../../shared/config/elite-clubs.mjs';
import {eliteClubPlayers,strongestEliteLineup} from '../../shared/football/elite-lineup.mjs';
import {buildAccountMatchSeat,DEFAULT_PLAN,clonePlayer} from '../../shared/football/account-match-seat.mjs';
import {DEFAULT_FORMATION_LINES} from '../../formation-rules.js';
import {campaignBondCatalog} from '../../shared/football/campaign-bonds.mjs';
import {conquestState,conquestAttackBlock,EXPEDITION_DEFEAT_COOLDOWN_MS} from '../../shared/config/conquest.mjs';
import {createCampaignLiveLeg,advanceCampaignLiveLeg,restoreCampaignLiveLeg,publicCampaignLiveLeg} from '../../engine/campaign-match-engine.mjs';
import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
const copy=value=>JSON.parse(JSON.stringify(value));
export class EliteChallengeService{
 constructor({campaign}){this.c=campaign;this.cache=new Map();this.cursor=0;this.c.world&&(this.c.world.eliteChallenges??={});for(const ch of Object.values(this.c.world?.eliteChallenges??{}))restoreCampaignLiveLeg(ch.leg);}
 active(account){return this.c.world?.eliteChallenges?.[account.id]??null;}
 availableClubs(){return ELITE_CLUBS.filter(club=>this.c.territoryIndex?.territories.some(t=>t.eliteClubIds?.includes(club.id)));}
 team(clubId){
  const club=ELITE_CLUB_BY_ID[clubId];if(!club||!this.availableClubs().some(c=>c.id===clubId))fail('该豪门不在当前地图',404);
  const sources=eliteClubPlayers(this.c.playerDatabase,club),key=JSON.stringify(sources),prior=this.cache.get(clubId);if(prior?.key===key)return prior;
  const lineup=strongestEliteLineup(sources,club.formation),positions={},players=lineup.map(slot=>{const p=clonePlayer(slot.player,{idPrefix:'elite:'+clubId+':'});p.cardDefinitionId=slot.player.cardDefinitionId??slot.player.id;p.cardInstanceId=p.id;p.club=club.name;delete p.card;this.c.enhancement.applyLevel(p,RULES.upgradeLevel);p.state={...p.state,fitness:100};positions[p.id]={x:slot.x,y:slot.y};return p;});
  const plan={...structuredClone(DEFAULT_PLAN),tactic:club.tactic,style:club.style,tacticalDimensions:{...DEFAULT_PLAN.tacticalDimensions,...club.tacticalDimensions}};
  const normalized=this.c.playerDatabase.map(p=>({...p,club:canonicalClubName(p.club)}));
  const seat={id:'elite:'+clubId,name:club.name,players,positions,formation:club.formation,formationLines:DEFAULT_FORMATION_LINES,positionPresets:{position1:positions,position2:positions,position3:positions},formationLinePresets:{position1:DEFAULT_FORMATION_LINES,position2:DEFAULT_FORMATION_LINES,position3:DEFAULT_FORMATION_LINES},captainId:[...players].sort((a,b)=>b.overall-a.overall)[0].id,bondCatalog:campaignBondCatalog(normalized),tactic:plan.tactic,style:plan.style,tacticalPlans:{opening:plan,leading:{...structuredClone(plan),tactic:'defensive',positionPreset:'position2',triggerGoalDifference:1},trailing:{...structuredClone(plan),tactic:'positive',positionPreset:'position3',triggerGoalDifference:1}}};
  const territories=this.c.territoryIndex.territories.filter(t=>t.eliteClubIds?.includes(clubId));
  const result={key,club,sources,seat,territories,average:Number((players.reduce((sum,p)=>sum+p.overall,0)/11).toFixed(1)),preview:lineup.map((slot,i)=>({role:slot.role,position:positions[players[i].id],player:createPlayerCardViewModel(players[i])}))};this.cache.set(clubId,result);return result;
 }
 block(account){if(raidMatchForAccount(this.c.world,account.id))return '豪门远征比赛进行中';if(!account.setupComplete||!account.draft) return '请先完成初始建队';if(this.active(account))return '已有豪门挑战进行中';if(Object.values(this.c.world?.activeChallenges??{}).some(ch=>ch.attackerId===account.id&&!ch.coalitionId))return '远征队正在进行地块比赛';if(account.elite?.reward&&!account.elite.reward.claimedId)return '请先领取上一场豪门挑战的球员奖励';return conquestAttackBlock(conquestState(account,this.c.now()),'club')?.message??null;}
 transaction(account,action){const before=structuredClone(account),active=copy(this.c.world.eliteChallenges??{});try{const result=action();this.c.save();return result;}catch(error){for(const key of Object.keys(account))delete account[key];Object.assign(account,before);this.c.world.eliteChallenges=active;for(const ch of Object.values(active))restoreCampaignLiveLeg(ch.leg);throw error;}}
 begin(account,{clubId,requestId}={}){
  if(!/^[a-f0-9-]{36}$/i.test(String(requestId??'')))fail('请求标识无效',400);
  const previous=account.elite?.requests?.[requestId];if(previous){if(previous.clubId!==clubId)fail('请求标识与原挑战不一致');return {challengeId:previous.id};}
  const blocked=this.block(account);if(blocked)fail(blocked);
  const team=this.team(clubId),squad=structuredClone(account);
  for(const p of squad.draft.roster){p.state={...p.state,fitness:100};if(Object.hasOwn(p,'fitness'))p.fitness=100;}
  const attacker=buildAccountMatchSeat(squad,'expedition',this.c.now(),{fitness:true,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.c.playerDatabase)});
  if(attacker.players.filter(p=>p.active!==false).length<7)fail('可用远征球员不足 7 人');
  const now=this.c.now(),id='elite-challenge:'+crypto.randomUUID(),territory=team.territories[0];
  const leg=createCampaignLiveLeg({home:team.seat,away:attacker,seed:id,legNumber:1,startedAt:now,knockout:true,weather:this.c.campaignWeather(now)?.territories?.[territory.territoryId]??null});
  return this.transaction(account,()=>{this.c.economy.spend(account,RULES.fee,'elite-challenge');account.elite??={requests:{}};account.elite.requests??={};account.elite.requests[requestId]={id,clubId};this.c.world.eliteChallenges[account.id]={id,clubId,territoryId:territory.territoryId,attackerId:account.id,startedAt:now,fanReward:eliteFanReward(team.average),leg};return {challengeId:id};});
 }
 settle(account){const ch=this.active(account);if(!ch?.leg.match.finished)return false;
  advanceCampaignLiveLeg(ch.leg,this.c.now(),{maximumChains:0});
  return this.transaction(account,()=>{
   this.c.fitness?.applyLeg(account,ch,ch.leg,this.c.now());
   applyLegConsequences(this.c.accounts,{id:ch.id,live:{attacker:ch.leg.away,defender:ch.leg.home}},ch.leg);
   const won=ch.leg.winnerIndex===1,at=this.c.now(),broadcast=publicCampaignLiveLeg(ch.leg),score=[...ch.leg.match.score].reverse(),penalties=ch.leg.penalties?[...ch.leg.penalties].reverse():null;
   const result={id:ch.id,challengeId:ch.id,clubId:ch.clubId,territoryId:ch.territoryId,format:'elite-single',outcome:won?'win':'loss',captured:false,score,penalties,extraTimePlayed:ch.leg.extraTimePlayed,settledAt:at,teams:[{name:ch.leg.away.name},{name:ch.leg.home.name}],broadcasts:[broadcast]};
   account.elite??={requests:{}};
   if(won){const candidates=[...this.team(ch.clubId).sources],cards=[];while(candidates.length&&cards.length<RULES.rewardChoices){const index=Math.min(candidates.length-1,Math.floor(Math.max(0,this.c.random())*candidates.length));const p=structuredClone(candidates.splice(index,1)[0]);this.c.enhancement.applyLevel(p,0);p.state={...p.state,fitness:100};delete p.card;cards.push(p);}
    if(cards.length!==RULES.rewardChoices)fail('豪门奖励球员库不足');
    // Existing matches retain their previously advertised 1,000-fan reward.
    const fans=ch.fanReward??1000;account.resources??={};account.resources.fans=Number(account.resources.fans??0)+fans;result.rewards={fans};account.elite.reward={id:ch.id,clubId:ch.clubId,cards,claimedId:null};
   }else{const quota=conquestState(account,at);account.conquest={day:quota.day,resetHour:quota.resetHour,used:quota.used,cooldownUntil:Math.max(quota.cooldownUntil,at+EXPEDITION_DEFEAT_COOLDOWN_MS)};result.attackCooldownUntil=account.conquest.cooldownUntil;}
   account.elite.lastBattle=result;account.elite.history=[...(account.elite.history??[]),{...result,broadcasts:undefined}].slice(-30);delete this.c.world.eliteChallenges[account.id];return true;
  });
 }
 advance(now=this.c.now(),{maximumMatches=1,maximumChainsPerMatch=1}={}){const entries=Object.values(this.c.world?.eliteChallenges??{});let changed=false;for(let i=0;i<Math.min(maximumMatches,entries.length);i++){const ch=entries[(this.cursor+i)%entries.length],before=ch.leg.match.nextChainIndex;advanceCampaignLiveLeg(ch.leg,now,{maximumChains:maximumChainsPerMatch});changed=changed||ch.leg.match.nextChainIndex!==before;const account=this.c.accounts.get(ch.attackerId);if(account&&ch.leg.match.finished){this.settle(account);changed=true;}}this.cursor=(this.cursor+maximumMatches)%Math.max(1,entries.length);return changed;}
 claim(account,{rewardId,playerId}={}){const reward=account.elite?.reward;if(!reward||reward.id!==rewardId)fail('待领取奖励不存在',404);if(reward.claimedId){if(reward.selectedId!==playerId)fail('该奖励已领取');return {playerId:reward.claimedId};}const source=reward.cards.find(p=>p.id===playerId);if(!source)fail('请选择本次三选一中的球员',400);
  return this.transaction(account,()=>{const p=structuredClone(source);p.cardDefinitionId=source.cardDefinitionId??source.id;p.id='elite-reward:'+crypto.randomUUID();p.cardInstanceId=p.id;p.upgradeLevel=0;delete p.card;account.draft.roster.push(p);account.playerSquads??={schemaVersion:2,assignments:{}};account.playerSquads.assignments??={};account.playerSquads.assignments[p.id]='garrison';reward.claimedId=p.id;reward.selectedId=playerId;return {playerId:p.id};});
 }
 snapshot(account,id){const ch=this.active(account);if(!ch||ch.id!==id){const battle=account.elite?.lastBattle;if(battle?.id!==id)fail('比赛不存在或不属于你',404);return {completed:true,challenge:null,live:null,battle};}return {completed:false,challenge:{id:ch.id,phase:'first-leg',format:'elite-single',territoryId:ch.territoryId},live:{key:ch.id,legNumber:1,phase:'first-leg',broadcast:publicCampaignLiveLeg(ch.leg)},battle:null};}
 view(account,selectedId){if(!account.setupComplete)fail('请先完成初始建队');const clubs=this.availableClubs().map(c=>{try{const t=this.team(c.id);return {...c,average:t.average,fans:eliteFanReward(t.average),territoryNames:t.territories.map(t=>t.name),available:true};}catch(error){return {...c,available:false,reason:error.message};}}),selected=clubs.find(c=>c.id===selectedId)??clubs[0],team=selected?.available?this.team(selected.id):null,active=this.active(account),reward=account.elite?.reward;
  return {serverNow:this.c.now(),rules:{...RULES,fans:selected?.fans??0},gold:account.gold,clubs,selected:selected?{...selected,players:team?.preview??[]}:null,blocked:this.block(account),cooldownUntil:conquestState(account,this.c.now()).cooldownUntil,active:active?{id:active.id,clubId:active.clubId,fanReward:active.fanReward??1000,minute:active.leg.match.minute,score:[...active.leg.match.score].reverse(),startedAt:active.startedAt}:null,lastBattle:account.elite?.lastBattle?{...account.elite.lastBattle,broadcasts:undefined}:null,reward:reward&&!reward.claimedId?{id:reward.id,clubId:reward.clubId,cards:reward.cards.map(createPlayerCardViewModel)}:null};
 }
}
