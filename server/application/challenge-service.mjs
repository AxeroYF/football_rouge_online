import {restoreArchivedFields} from '../infrastructure/history-archive.mjs';
import {bondQuote,holdBond,resolveBond,assertBondFunds} from './pvp-attack-bond.mjs';
import {settlePlayerDefeat} from './player-defeat.mjs';
import {coalitionContributors} from '../../shared/config/coalition.mjs';
import {liberationBeneficiary} from './territory-liberation.mjs';
import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import {endHeadquartersWar} from './war-settlement.mjs';
import {publishWorldNews} from './world-news.mjs';
import { playersAtWar, canConquerFromTerritory } from "../../shared/config/diplomacy.mjs";
import {isEliteTerritory} from '../../shared/config/elite-clubs.mjs';
import { campaignBondCatalog } from '../../shared/football/campaign-bonds.mjs';
import { applyLegConsequences, nextLegSeat } from './match-consequences.mjs';
import { prepareFitnessSeat, setFitness } from '../../shared/football/fitness-lineup.mjs';
import { conquestState, conquestAttackBlock, EXPEDITION_DEFEAT_COOLDOWN_MS } from '../../shared/config/conquest.mjs';
import crypto from "node:crypto";
import { canAttackFromTerritory, captureTerritory, OWNER_TYPES } from "../../territory-model.js";
import { expeditionAttackSource, placeExpeditionPiece } from "../domain/expedition-piece.mjs";
import {
  advanceCampaignLiveLeg,
  buildAccountMatchSeat,
  buildTerritoryDefenderSeat,
  createCampaignLiveLeg,
  finalizeCampaignLiveBattle,
  publicCampaignLiveLeg,
  restoreCampaignLiveLeg,
} from "../../engine/campaign-match-engine.mjs";
import {
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_LIVE_MS,
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
} from "../../shared/config/challenge.mjs";

const HISTORY_EVENT_TYPES=new Set(['kickoff','goal','ownGoal','yellow','red','injury','substitution','lightning','weather','blackWhistle','brawl','penaltyAwarded','penalty','save','miss','trait','penaltyShootoutStart','penaltyShootoutEqualise','penaltyShootoutKick','penalties','halftime','extraTimeStart','extraTimeHalfTime','extraTimeEnd','fulltime','abandoned']);
function compactBattleRecord(battle) {
  const relevant=event=>HISTORY_EVENT_TYPES.has(event.type)||event.importance==='major'||event.importance==='stage';
  return {...battle,events:(battle.events??[]).filter(relevant),
    broadcasts:(battle.broadcasts??[]).map(broadcast=>({...broadcast,events:(broadcast.events??[]).filter(relevant)}))};
}

export function publicChallengeView(challenge, now) {
  const phase = challenge.phase
    ?? (now < challenge.firstLegEndsAt ? "first-leg" : now < challenge.secondLegStartsAt ? "intermission" : "second-leg");
  return {
    id: challenge.id,
    territoryId: challenge.territoryId,
    coalitionId:challenge.coalitionId,
    coalitionContributors:challenge.coalitionContributors,
    defenderCoalitionId:challenge.defenderCoalitionId,
    defenderCoalitionContributors:challenge.defenderCoalitionContributors,
    attackerId: challenge.attackerId,
    attackerTeamName: challenge.attackerTeamName,
    defenderId: challenge.defenderId,
    defenderName: challenge.defenderName,
    startedAt: challenge.startedAt,
    firstLegEndsAt: challenge.firstLegEndsAt,
    secondLegStartsAt: challenge.secondLegStartsAt,
    settleAt: challenge.settleAt,
    phase,
    firstLeg: challenge.live?.firstLeg?.match?.finished ? {score:[...challenge.live.firstLeg.match.score],teams:challenge.live.firstLeg.match.teams.map(team=>({id:team.id,name:team.name}))} : null,
    maritime: Boolean(challenge.maritimeRoute),
    sourceTerritoryId: challenge.fromTerritoryIds?.[0] ?? null,
  };
}

export class ChallengeService {
  constructor({
    world,
    accounts,
    territoryIndex,
    maritimePlanner = null,
    playerDatabase = [],
    ensureAiGarrison,
    awardNeutralCapture = () => null,
    getMatchVenue = () => null,
    getTerritoryWeather = () => ({ type:"sunny", label:"晴朗", icon:"☀", precipitation:0 }),
    save = () => {},
    now = Date.now,
    createChallengeId = (accountId) => `challenge:${crypto.randomBytes(8).toString("hex")}:${accountId}`,
  } = {}) {
    this.world = world;
    this.accounts = accounts;
    this.territoryIndex = territoryIndex;
    this.maritimePlanner = maritimePlanner;
    this.playerDatabase = playerDatabase;
    this.ensureAiGarrison = ensureAiGarrison;
    this.awardNeutralCapture = awardNeutralCapture;
    this.getMatchVenue = getMatchVenue;
    this.getTerritoryWeather = getTerritoryWeather;
    this.save = save;
    this.now = now;
    this.createChallengeId = createChallengeId;
    this.liveAdvanceCursor = 0;
  }

  conquestState(account, now = this.now()) {
    return conquestState(account, now, this.wonders?.modifiers(account)?.neutralAttacksBonus ?? 0);
  }

  assertAttackAvailable(account, territoryId) {
    const blocked = conquestAttackBlock(this.conquestState(account), this.world?.territories?.[territoryId]?.ownerType);
    if (blocked) throw Object.assign(new Error(blocked.message), { statusCode: 409, code: blocked.code });
    const target=this.world?.territories?.[territoryId];
    if(target?.ownerType===OWNER_TYPES.PLAYER && target.ownerId!==account.id && !playersAtWar(this.world,account.id,target.ownerId))throw Object.assign(new Error('双方尚未宣战，请先在玩家互动中宣战'),{statusCode:409,code:'not-at-war'});
  }

  restoreActiveChallenges() {
    const catalog=campaignBondCatalog(this.playerDatabase);
    const attach=seat=>{if(seat){seat.bondCatalog=catalog;if(seat.selectionSource)seat.selectionSource.bondCatalog=catalog;}};
    for (const challenge of Object.values(this.world?.activeChallenges ?? {})) {
      attach(challenge.live?.attacker);attach(challenge.live?.defender);
      for(const leg of [challenge.live?.firstLeg,challenge.live?.secondLeg]){
        if(!leg)continue;
        // Old saves lacked identity bond eligibility. Resume future play with the current catalog;
        // completed legs keep their recorded snapshots and results.
        if(!leg.match?.finished){attach(leg.home);attach(leg.away);for(const team of leg.match?.teams??[])attach(team);}
        restoreCampaignLiveLeg(leg);
      }
    }
  }

  territoryMetadata(territoryId) {
    const territory = this.territoryIndex?.territories.find((candidate) => candidate.territoryId === territoryId);
    if (!territory) throw new Error("目标地块不存在");
    return territory;
  }

  battleForChallenge(challenge) {
    if (challenge.battle) return challenge.battle;
    const live = challenge.live;
    if (!live?.firstLeg?.match?.finished || !live?.secondLeg?.match?.finished) return null;
    const battle = finalizeCampaignLiveBattle({
      territoryId: challenge.territoryId,
      seed: challenge.seed,
      attacker: live.attacker,
      defender: live.defender,
      firstLeg: live.firstLeg,
      secondLeg: live.secondLeg,
    });
    battle.challengeId = challenge.id;
    battle.playedAt = challenge.startedAt;
    battle.attackerId = challenge.attackerId;
    battle.defender = challenge.previousOwner;
    battle.fromTerritoryIds = challenge.fromTerritoryIds;
    battle.maritimeRoute = challenge.maritimeRoute;
    battle.captured = false;
    challenge.battle = battle;
    return battle;
  }

  attackingAccount(challenge) {return challenge.coalitionId?this.coalitions.matchAccount(challenge):this.accounts.get(challenge.attackerId);}
  applyAttackingLeg(challenge,leg,at=this.now()) {
    if(challenge.coalitionId||challenge.defenderCoalitionId)return this.coalitions.applyLeg(challenge,leg,at);
    this.fitness?.applyLeg(this.accounts.get(challenge.attackerId),challenge,leg,at);
    applyLegConsequences(this.accounts,challenge,leg);
  }

  settleChallenge(challenge) {
    const current = this.world?.activeChallenges?.[challenge.territoryId];
    if (!current || current.id !== challenge.id) return null;
    challenge=current;
    const computed = this.battleForChallenge(challenge);
    if (!computed) return null;
    const targetState = this.world.territories[challenge.territoryId];
    const ownerUnchanged = targetState.ownerType === challenge.previousOwner.type
      && (targetState.ownerId ?? null) === (challenge.previousOwner.id ?? null);
    const battle = { coalitionId:challenge.coalitionId,coalitionContributors:challenge.coalitionContributors,defenderCoalitionId:challenge.defenderCoalitionId,defenderCoalitionContributors:challenge.defenderCoalitionContributors, ...computed, attackerId:challenge.attackerId, defenderId:challenge.defenderId, attackerTeamName:challenge.attackerTeamName, defenderName:challenge.defenderName, defender: computed.defender ?? challenge.previousOwner, captured: false, settledAt: this.now() };
    const attacker = this.accounts.get(challenge.attackerId);
    const territoryBefore=structuredClone(targetState), playersBefore=structuredClone(this.world.players);
    const newsBefore=structuredClone(this.world.news),diplomacyBefore=this.world.diplomacy?JSON.parse(JSON.stringify(this.world.diplomacy)):undefined;
    const warEndMarkers=Object.values(this.world.activeChallenges??{}).map(c=>[c,c.warEndedAt]);
    const bondsBefore=structuredClone(this.world.pvpBonds);
    const revisionBefore=this.world.revision, activeBefore={...this.world.activeChallenges}, rewardsBefore=structuredClone(this.world.neutralRewards);
    const fitnessAppliedBefore=challenge.live?.secondLeg?.fitnessApplied;
    const consequenceMarkers=[challenge.live?.firstLeg,challenge.live?.secondLeg].filter(Boolean).map(leg=>[leg,leg.consequencesApplied]);
    const defenderBefore=structuredClone(challenge.live?.defender);
    const coalitionBefore=structuredClone(this.world.coalitions);
    const defeatTransaction=battle.outcome==='win'&&challenge.previousOwner.type===OWNER_TYPES.PLAYER&&((this.world.players[challenge.previousOwner.id]?.territoryIds?.length??0)<=1||territoryBefore.capitalOf===challenge.previousOwner.id||this.accounts.get(challenge.previousOwner.id)?.homeTerritoryId===challenge.territoryId);
    const defeatWorldBefore=defeatTransaction?JSON.parse(JSON.stringify(this.world)):null;
    const accountSnapshots=[...new Set([...(defeatTransaction?this.accounts.values():[]),...(this.world.pvpBonds?.[challenge.attackBondId]?.shares??[]).map(s=>this.accounts.get(s.ownerId)),attacker,this.accounts.get(challenge.defenderId??challenge.previousOwner?.id),...[...(challenge.coalitionContributors??[]),...(challenge.defenderCoalitionContributors??[])].map(id=>this.accounts.get(id))])].filter(Boolean).map(a=>[a,structuredClone(a)]);
    try {
      for(const leg of [challenge.live?.firstLeg,challenge.live?.secondLeg])this.applyAttackingLeg(challenge,leg,battle.settledAt);
      this.wonders?.challengeCompleted(attacker,challenge);
      if (attacker && !attacker.conquest) {
        const quota = this.conquestState(attacker, battle.settledAt);
        attacker.conquest = {...quota};
      }
      const captureQuota=attacker?this.conquestState(attacker,battle.settledAt):null;
      const quotaAvailable=Boolean(captureQuota?.remaining>0&&(challenge.previousOwner.type!=='player'||captureQuota.playerRemaining>0));
      if (battle.outcome === "win" && ownerUnchanged && !quotaAvailable)
        battle.captureBlockedReason = '今日地块征服总次数或玩家地块征服次数已用完';
      const eliteProtected=isEliteTerritory(this.territoryIndex?.territories.find(t=>t.territoryId===challenge.territoryId));
      if(eliteProtected)battle.captureBlockedReason="豪门地块不可占领";
      const warAllowed=challenge.warEndedAt==null&&(targetState.ownerType!==OWNER_TYPES.PLAYER || playersAtWar(this.world,challenge.attackerId,targetState.ownerId));
      if(!warAllowed)battle.captureBlockedReason=challenge.warEndedAt!=null?"总部失守，战争已结束":"双方未处于战争状态";
      if (battle.outcome === "win" && ownerUnchanged && quotaAvailable && !eliteProtected && warAllowed) {
        const beneficiary=liberationBeneficiary(this.world,this.accounts,challenge.attackerId,challenge.territoryId);
        captureTerritory(this.territoryIndex, this.world, challenge.attackerId, challenge.territoryId, {
          permission: { allowed: true, reason: null, fromTerritoryIds: challenge.fromTerritoryIds ?? [] },
        });
        if(challenge.coalitionId)this.world.coalitions[challenge.coalitionId].territoryId=challenge.territoryId;
        else placeExpeditionPiece(attacker, challenge.territoryId);
        battle.captured = true;
        if(beneficiary)targetState.pendingLiberation={challengeId:challenge.id,captorId:challenge.attackerId,originalOwnerId:beneficiary};
        const territory=this.territoryIndex?.territories?.find(t=>t.territoryId===challenge.territoryId);
        publishWorldNews(this.world,{key:challenge.id,type:'capture',text:(challenge.coalitionId?challenge.attackerTeamName+'（归属 '+(attacker?.draft?.teamName??attacker?.nickname??challenge.attackerId)+'）':(attacker?.draft?.teamName??attacker?.nickname??challenge.attackerTeamName??challenge.attackerId))+' 攻下了 '+(territory?[territory.country,territory.name].filter(Boolean).join(' · '):challenge.territoryId),createdAt:battle.settledAt});
        const defenderId=challenge.previousOwner.id;
        if(challenge.previousOwner.type===OWNER_TYPES.PLAYER&&(territoryBefore.capitalOf===defenderId||playersBefore[defenderId]?.capitalTerritoryId===challenge.territoryId||this.accounts.get(defenderId)?.homeTerritoryId===challenge.territoryId))
          battle.warEnded=endHeadquartersWar({world:this.world,accounts:this.accounts,winnerId:challenge.attackerId,loserId:defenderId,territoryId:challenge.territoryId,at:battle.settledAt,key:challenge.id});
        if (attacker) {
          const quota = this.conquestState(attacker, battle.settledAt);
          attacker.conquest = {...quota,used:quota.used+1,playerUsed:quota.playerUsed+(challenge.previousOwner.type==='player'?1:0)};
          const rewards = challenge.previousOwner.type===OWNER_TYPES.NEUTRAL?this.awardNeutralCapture({ account:attacker, challenge, battle }):null;
          if (rewards) battle.rewards = rewards;
        }
      } else {
        this.world.revision += 1;
      }
      battle.attackBond=resolveBond(this.world,this.accounts,challenge.attackBondId,battle.outcome==='win'||!warAllowed||!ownerUnchanged?'refund':'loss',battle.settledAt,battle.outcome==='win'?'进攻获胜':!warAllowed||!ownerUnchanged?'目标状态变化，进攻取消':'');
      if (attacker) {
        if (battle.outcome !== "win" && !challenge.coalitionId) {
          const quota = this.conquestState(attacker, battle.settledAt);
          attacker.conquest = { ...quota,
            cooldownUntil: battle.settledAt + EXPEDITION_DEFEAT_COOLDOWN_MS };
          battle.attackCooldownUntil = attacker.conquest.cooldownUntil;
        }
        attacker.battleHistory ??= [];
        attacker.battleHistory.push(compactBattleRecord(battle));
        attacker.battleHistory = attacker.battleHistory.slice(-50);
      }
      if(challenge.coalitionId){
        const army=this.world.coalitions[challenge.coalitionId];army.lastChallengeId=challenge.id;army.revision++;
        if(battle.outcome!=='win')army.cooldownUntil=battle.settledAt+EXPEDITION_DEFEAT_COOLDOWN_MS;
      }
      if(challenge.defenderCoalitionId){const army=this.world.coalitions[challenge.defenderCoalitionId];army.lastChallengeId=challenge.id;army.revision++;if(battle.outcome==='win')army.cooldownUntil=battle.settledAt+EXPEDITION_DEFEAT_COOLDOWN_MS;}
      // Ordinary PvP defenders need the same durable report as coalition defenders.
      for(const id of new Set([...(challenge.coalitionContributors??[]),...(challenge.defenderCoalitionContributors??[]),challenge.defenderId??challenge.previousOwner?.id])){
        const a=this.accounts.get(id);if(!a||a===attacker)continue;
        a.battleHistory??=[];a.battleHistory.push(compactBattleRecord(battle));a.battleHistory=a.battleHistory.slice(-50);
      }
      if(battle.captured&&challenge.previousOwner.type===OWNER_TYPES.PLAYER)battle.playerDefeat=settlePlayerDefeat({world:this.world,accounts:this.accounts,loserId:challenge.previousOwner.id,territoryId:challenge.territoryId,territoryBefore,at:battle.settledAt});
      delete this.world.activeChallenges[challenge.territoryId];
      this.save();
      return battle;
    } catch (error) {
      if(bondsBefore===undefined)delete this.world.pvpBonds;else this.world.pvpBonds=bondsBefore;
      if(coalitionBefore===undefined)delete this.world.coalitions;else this.world.coalitions=coalitionBefore;
      if(challenge.live?.secondLeg){if(fitnessAppliedBefore===undefined)delete challenge.live.secondLeg.fitnessApplied;else challenge.live.secondLeg.fitnessApplied=fitnessAppliedBefore;}
      for(const [leg,marker] of consequenceMarkers){if(marker===undefined)delete leg.consequencesApplied;else leg.consequencesApplied=marker;}
      if(challenge.live&&defenderBefore)challenge.live.defender=defenderBefore;
      for(const [account,snapshot] of accountSnapshots){for(const key of Object.keys(account))delete account[key];Object.assign(account,snapshot);}
      for(const key of Object.keys(targetState))delete targetState[key];Object.assign(targetState,territoryBefore);
      if(newsBefore===undefined)delete this.world.news;else this.world.news=newsBefore;
      if(diplomacyBefore===undefined)delete this.world.diplomacy;else {this.world.diplomacy=diplomacyBefore;for(const m of Object.values(diplomacyBefore.matches??{}))if(!m.battle)restoreCampaignLiveLeg(m.leg);}
      for(const [c,at]of warEndMarkers){if(at===undefined)delete c.warEndedAt;else c.warEndedAt=at;}
      this.world.players=playersBefore;this.world.revision=revisionBefore;this.world.activeChallenges=activeBefore;this.world.neutralRewards=rewardsBefore;
      if(defeatWorldBefore){
        for(const key of Object.keys(this.world))delete this.world[key];Object.assign(this.world,defeatWorldBefore);this.restoreActiveChallenges();
        for(const m of Object.values(this.world.diplomacy?.matches??{}))if(!m.battle)restoreCampaignLiveLeg(m.leg);
        for(const m of Object.values(this.world.eliteRaids?.matches??{}))restoreCampaignLiveLeg(m.leg);
        for(const m of Object.values(this.world.eliteChallenges??{}))restoreCampaignLiveLeg(m.leg);
      }
      throw error;
    }
  }

  settleDueChallenges() {
    if (!this.world?.activeChallenges) return [];
    const now = this.now();
    const settled = [];
    for (const challenge of Object.values(this.world.activeChallenges)) {
      if (!challenge.live && challenge.battle && now >= Number(challenge.settleAt ?? Infinity)) {
        const battle = this.settleChallenge(challenge);
        if (battle) settled.push(battle);
      }
    }
    return settled;
  }

  status(account, challengeIdValue) {
    const challengeId = String(challengeIdValue ?? "");
    const challenge = Object.values(this.world?.activeChallenges ?? {}).find((candidate) => candidate.id === challengeId);
    if (!challenge) {
      const completed = (account.battleHistory ?? [])
        .find((battle) => battle.challengeId === challengeId || battle.id === challengeId);
      if (!completed) throw Object.assign(new Error("进行中的挑战不存在或已经结束"), { statusCode: 404 });
      return { completed: true, challenge: null, live: null, battle: restoreArchivedFields(completed) };
    }
    const live = challenge.live;
    const currentLeg = challenge.phase === "second-leg" ? live?.secondLeg : live?.firstLeg;
    return {
      completed: false,
      challenge: publicChallengeView(challenge, this.now()),
      live: currentLeg ? {
        key: `${challenge.id}:leg-${currentLeg.legNumber}`,
        phase: challenge.phase,
        legNumber: currentLeg.legNumber,
        secondLegStartsAt: challenge.secondLegStartsAt,
        broadcast: publicCampaignLiveLeg(currentLeg, {now:this.now()}),
      } : null,
      battle: null,
    };
  }

  advance(now = this.now(), { maximumMatches = 1, maximumChainsPerMatch = 1 } = {}) {
    const challenges = Object.values(this.world?.activeChallenges ?? {}).filter((challenge) => challenge.live);
    if (!challenges.length) return false;
    const limit = Math.max(1, Math.floor(Number(maximumMatches) || 1));
    const start = this.liveAdvanceCursor % challenges.length;
    let processed = 0;
    let changed = false;
    for (let offset = 0; offset < challenges.length && processed < limit; offset += 1) {
      const index = (start + offset) % challenges.length;
      const challenge = challenges[index];
      const live = challenge.live;
      if (challenge.phase === "first-leg") {
        const before = Number(live.firstLeg.match.nextChainIndex ?? 0);
        advanceCampaignLiveLeg(live.firstLeg, now, { maximumChains: maximumChainsPerMatch });
        changed = changed || Number(live.firstLeg.match.nextChainIndex ?? 0) > before;
        if (live.firstLeg.match.finished) {
          this.fitnessTransition(challenge,()=>{
          this.applyAttackingLeg(challenge,live.firstLeg,Number(now));
          challenge.phase = "intermission";
          challenge.firstLegEndsAt = Number(now);
          challenge.secondLegStartsAt = Number(now) + CHALLENGE_SECOND_LEG_COOLDOWN_MS;
          challenge.settleAt = challenge.secondLegStartsAt + CAMPAIGN_REGULATION_LIVE_MS + CAMPAIGN_EXTRA_TIME_LIVE_MS;
          });
          changed = true;
        }
      } else if (challenge.phase === "intermission" && now >= Number(challenge.secondLegStartsAt)) {
        this.fitnessTransition(challenge,()=>{
        this.save();
        const firstScore = [...live.firstLeg.match.score];
        const current=this.attackingAccount(challenge);
        this.applyAttackingLeg(challenge,live.firstLeg);
        const secondAttacker=nextLegSeat(live.attacker,current);
        const secondDefender=nextLegSeat(live.defender,challenge.defenderCoalitionId?this.coalitions.projection(this.world.coalitions[challenge.defenderCoalitionId]):this.accounts.get(challenge.defenderId),{full:true});
        live.secondLeg = createCampaignLiveLeg({
          home: secondDefender,
          venue: this.getMatchVenue(this.accounts.get(challenge.defenderId), Number(challenge.secondLegStartsAt)),
          away: secondAttacker,
          internalAbilityMultipliers: challenge.internalAbilityMultipliers,
          seed: String(challenge.seed) + ":leg-2",
          legNumber: 2,
          startedAt: challenge.secondLegStartsAt,
          aggregateBaseScore: challenge.fitnessVersion===1 ? firstScore : [firstScore[1], firstScore[0]],
          knockout: true,
          weather: this.getTerritoryWeather(challenge.territoryId, challenge.secondLegStartsAt),
        });
        challenge.phase = "second-leg";
        });
        changed = true;
      } else if (challenge.phase === "second-leg" && live.secondLeg) {
        const before = Number(live.secondLeg.match.nextChainIndex ?? 0);
        advanceCampaignLiveLeg(live.secondLeg, now, { maximumChains: maximumChainsPerMatch });
        changed = changed || Number(live.secondLeg.match.nextChainIndex ?? 0) > before;
        if (live.secondLeg.match.finished) {
          challenge.phase = "finished";
          this.battleForChallenge(challenge);
          this.settleChallenge(challenge);
          changed = true;
        }
      } else if(challenge.phase === "finished") {
        this.settleChallenge(challenge); changed=true;
      }
      processed += 1;
      this.liveAdvanceCursor = (index + 1) % Math.max(1, challenges.length);
    }
    return changed;
  }

  fitnessTransition(challenge,action) {
    const before=JSON.parse(JSON.stringify(challenge));
    const accounts=[...new Set([challenge.attackerId,challenge.defenderId,...(challenge.coalitionContributors??[]),...(challenge.defenderCoalitionContributors??[])])].map(id=>this.accounts.get(id)).filter(Boolean).map(account=>[account,structuredClone(account)]);
    try{action();this.save();}catch(error){
      for(const key of Object.keys(challenge))delete challenge[key];Object.assign(challenge,before);
      for(const leg of [challenge.live?.firstLeg,challenge.live?.secondLeg])if(leg)restoreCampaignLiveLeg(leg);
      for(const [account,saved]of accounts){for(const key of Object.keys(account))delete account[key];Object.assign(account,saved);}
      throw error;
    }
  }

  complete(account, challengeIdValue) {
    const challengeId = String(challengeIdValue ?? "");
    const challenge = Object.values(this.world?.activeChallenges ?? {}).find((candidate) => candidate.id === challengeId);
    if (!challenge) {
      const completed = (account.battleHistory ?? [])
        .find((battle) => battle.challengeId === challengeId || battle.id === challengeId);
      if (completed) return { battle: restoreArchivedFields(completed), alreadyCompleted: true };
      throw Object.assign(new Error("进行中的挑战不存在或已经结束"), { statusCode: 404 });
    }
    if (challenge.attackerId !== account.id) {
      throw Object.assign(new Error("只有发起挑战的球队可以完成结算"), { statusCode: 403 });
    }
    if (!challenge.live?.secondLeg?.match?.finished && !(challenge.battle && this.now() >= Number(challenge.settleAt))) {
      throw Object.assign(new Error("比赛仍在服务器实时推进中"), { statusCode: 409 });
    }
    return { battle: this.settleChallenge(challenge), alreadyCompleted: false };
  }

  maritimeRoutes(account, sourceTerritoryIdValue, pointValue) {
    if (!this.maritimePlanner || !this.world) throw new Error("海上航线系统尚未初始化");
    const requestedPoint = Array.isArray(pointValue) ? pointValue.map(Number) : [];
    if (requestedPoint.length !== 2 || !requestedPoint.every(Number.isFinite)) {
      throw new Error("请选择有效的海岸出发点");
    }
    this.settleDueChallenges();
    const expeditionTerritoryId = expeditionAttackSource(account, this.world, this.now());
    if (String(sourceTerritoryIdValue ?? "") !== expeditionTerritoryId) {
      throw new Error("只能从远征战棋当前所在的地块出海");
    }
    const result = this.maritimePlanner.routesFrom(
      this.world,
      account.id,
      String(sourceTerritoryIdValue ?? ""),
      requestedPoint,
    );
    return {
      ...result,
      routes: result.routes.filter((route) => !this.world.activeChallenges?.[route.targetTerritoryId]),
    };
  }

  begin(account, territoryIdValue, options = {}) {
    if (!this.world || !this.territoryIndex) throw new Error("共享世界尚未初始化");
    if (!account.setupComplete || !account.draft?.roster?.length) throw new Error("请先完成初始建队");
    if (!account.homeTerritoryId) throw new Error("请先选择永久主场");
    this.settleDueChallenges();
    const territoryId = String(territoryIdValue ?? "");
    if(raidMatchForAccount(this.world,account.id)||raidMatchForAccount(this.world,this.world.territories?.[territoryId]?.ownerId))throw Object.assign(Error('豪门远征比赛进行中，请稍后挑战'),{statusCode:409});
    if(!options.coalition&&this.world.eliteChallenges?.[account.id])throw Object.assign(new Error("远征队正在进行豪门挑战"),{statusCode:409});
    if(isEliteTerritory(this.territoryMetadata(territoryId)))throw Object.assign(new Error("豪门地块不可占领，请从顶部豪门挑战入口参赛"),{statusCode:409});
    const existingChallenge = Object.values(this.world.activeChallenges ?? {})
      .find((challenge) => options.coalition ? challenge.coalitionId===options.coalition.id : challenge.attackerId === account.id&&!challenge.coalitionId);
    if (existingChallenge) {
      throw Object.assign(new Error("你已有一场板块挑战正在进行，比赛结束前不能发起新的挑战"), { statusCode: 409 });
    }
    if (this.world.activeChallenges?.[territoryId]) {
      throw Object.assign(new Error("该板块正在被其他球队挑战，请等待本场争夺结束"), { statusCode: 409 });
    }
    const territory = this.territoryMetadata(territoryId);
    this.assertAttackAvailable(account, territoryId);
    const expeditionTerritoryId = options.coalition?.sourceTerritoryId ?? expeditionAttackSource(account, this.world, this.now());
    if(this.world.territories[territoryId]?.ownerType===OWNER_TYPES.NEUTRAL&&!canConquerFromTerritory(this.world,account.id,expeditionTerritoryId))throw Object.assign(new Error('请先向该盟友申请借地征服授权'),{statusCode:403,code:'ally-conquest-permission'});
    let permission = canAttackFromTerritory(
      this.territoryIndex,
      this.world,
      account.id,
      expeditionTerritoryId,
      territoryId,
      this.now(),
    );
    let maritimeRoute = null;
    if (!permission.allowed && permission.reason === "not-adjacent" && options.maritimeRoute) {
      const routeResult = options.coalition
        ? this.coalitions.routes(this.world.coalitions[options.coalition.id],account.id,options.maritimeRoute.sourcePoint)
        : this.maritimeRoutes(account,options.maritimeRoute.sourceTerritoryId,options.maritimeRoute.sourcePoint);
      maritimeRoute = routeResult.routes.find((route) => route.targetTerritoryId === territoryId) ?? null;
      if (maritimeRoute) {
        permission = {
          allowed: true,
          reason: null,
          fromTerritoryIds: [routeResult.sourceTerritoryId],
          maritime: true,
        };
      }
    }
    if (!permission.allowed) {
      const messages = {
        "not-at-war": "双方尚未宣战，请先在玩家互动中宣战",
        "already-owned": "该地块已经属于你",
        "territory-protected": "该地块仍在保护期内",
        "not-adjacent": "该地块既不与领土陆地相邻，也不在当前直线航线内",
      };
      throw new Error(messages[permission.reason] ?? "当前不能挑战该地块");
    }

    const targetState = this.world.territories[territoryId];
    if(targetState.ownerType==='player'&&options.requirePvpConfirmation&&(!options.pvpConfirmed||options.expectedOwnerId!==targetState.ownerId))throw Object.assign(Error('请确认30000金币进攻保证金；目标归属变化后需重新确认'),{statusCode:409});
    if(options.coalition&&targetState.ownerType==='player'&&!options.attackBondId)throw Error('联军进攻需先确认并缴纳保证金');
    if(options.attackBondId){const bond=this.world.pvpBonds?.[options.attackBondId];if(bond?.status!=='held'||bond.territoryId!==territoryId||bond.defenderId!==targetState.ownerId)throw Error('进攻目标归属或保证金状态已变化');}
    this.save();
    const personalBondQuote=targetState.ownerType==='player'&&!options.attackBondId?bondQuote(this.accounts,[account.id],territoryId,targetState.ownerId):null;
    if(personalBondQuote)assertBondFunds(this.accounts,personalBondQuote);
    const attacker = options.coalition?.seat ?? buildAccountMatchSeat(account,"expedition",this.now(),{fitness:true,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.playerDatabase)});
    const defendingAccount = targetState.ownerType === OWNER_TYPES.PLAYER
      ? this.accounts.get(targetState.ownerId)
      : null;
    const now = this.now();
    const seed = `${this.world.seasonId}:${this.world.revision + 1}:${account.id}:${territoryId}:${now}`;
    const garrison = defendingAccount ? null : this.ensureAiGarrison(territoryId);
    const coalitionDefence=this.coalitions?.defenderFor(defendingAccount),defendingArmy=coalitionDefence?.army;
    const defender = coalitionDefence ? coalitionDefence.seat : defendingAccount?.draft?.roster?.length >= 11
      ? buildAccountMatchSeat(defendingAccount,"garrison",this.now(),{fitness:true,allowShortHanded:true,bondCatalog:campaignBondCatalog(this.playerDatabase)})
      : buildTerritoryDefenderSeat({
        catalog: this.playerDatabase,
        territory,
        territoryState: targetState,
        seed,
        garrison,
      });
    const previousOwner = { type: targetState.ownerType, id: targetState.ownerId };
    const challengeId = this.createChallengeId(account.id);
    const liberatingIds=options.coalition?.contributors??[account.id];
    const internalAbilityMultipliers=liberatingIds.some(id=>liberationBeneficiary(this.world,this.accounts,id,territoryId))?[1,1.2]:null;
    const firstLeg = createCampaignLiveLeg({
      home: defender,
      venue: this.getMatchVenue(defendingAccount, now),
      away: attacker,
      internalAbilityMultipliers,
      seed: `${seed}:leg-1`,
      legNumber: 1,
      startedAt: now,
      weather: this.getTerritoryWeather(territoryId, now),
    });
    const challenge = {
      id: challengeId,
      internalAbilityMultipliers,
      territoryId,
      coalitionId:options.coalition?.id,coalitionContributors:options.coalition?.contributors,
      defenderCoalitionId:defendingArmy?.id,defenderCoalitionContributors:defendingArmy?coalitionContributors(defendingArmy):undefined,
      attackerId: account.id,
      attackerTeamName: attacker.name,
      defenderId: previousOwner.id ?? null,
      defenderName: defender.name,
      startedAt: now,
      firstLegEndsAt: now + CAMPAIGN_REGULATION_LIVE_MS,
      secondLegStartsAt: now + CAMPAIGN_REGULATION_LIVE_MS + CHALLENGE_SECOND_LEG_COOLDOWN_MS,
      settleAt: now + CAMPAIGN_REGULATION_LIVE_MS + CHALLENGE_SECOND_LEG_COOLDOWN_MS
        + CAMPAIGN_REGULATION_LIVE_MS + CAMPAIGN_EXTRA_TIME_LIVE_MS,
      phase: "first-leg",
      seed,
      fromTerritoryIds: permission.fromTerritoryIds,
      maritimeRoute,
      previousOwner,
      aiDifficulty: garrison?.difficulty ?? null,
      fitnessVersion:1,
      live: { attacker, defender, firstLeg, secondLeg: null },
    };
    this.world.activeChallenges ??= {};
    const revision=this.world.revision,bondsBefore=structuredClone(this.world.pvpBonds),accountBefore=structuredClone(account);
    if(targetState.ownerType==='player')challenge.attackBondId=options.attackBondId??holdBond(this.world,this.accounts,personalBondQuote,now);
    this.world.activeChallenges[territoryId] = challenge;
    this.world.revision += 1;
    try{this.save();}catch(error){delete this.world.activeChallenges[territoryId];this.world.revision=revision;if(bondsBefore===undefined)delete this.world.pvpBonds;else this.world.pvpBonds=bondsBefore;for(const k of Object.keys(account))delete account[k];Object.assign(account,accountBefore);throw error;}
    return { challengeId, challenge };
  }
}
