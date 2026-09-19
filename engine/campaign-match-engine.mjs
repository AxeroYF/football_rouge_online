import { campaignBondCatalog } from '../shared/football/campaign-bonds.mjs';
import { calculateV2TacticalFit } from './s4-v2.1/versus/public/v2-tactical-fit.js';
import { resolveV2TacticalDimensions } from './s4-v2.1/versus/v2/spatial-model-v2.js';
import { v2PenaltyShootout } from './s4-v2.1/versus/v2/penalty-shootout-v2.js';
import { activeCaptain } from './s4-v2.1/versus/public/captain-rules.js';
import { analyzeElevenBoardFormation } from './s4-v2.1/versus/public/formation-rules.js';
import { buildAccountMatchSeat, DEFAULT_PLAN, clonePlayer, defaultPositions } from '../shared/football/account-match-seat.mjs';
export { buildAccountMatchSeat };
import { createPlayerCardViewModel } from "../shared/player-card/player-card-contract.js";
import { advanceV2Match, createV2Match, createV2MatchRng, finishV2Match, publicV2Match, simulateV2Match } from "./s4-v2.1/versus/v2/match-engine-v2.js";
import { DEFAULT_FORMATION_LINES } from "./s4-v2.1/versus/public/formation-rules.js";
import {
  CAMPAIGN_EXTRA_TIME_CHAINS,
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_CHAINS,
  CAMPAIGN_REGULATION_LIVE_MS,
} from "../shared/config/challenge.mjs";

export {
  CAMPAIGN_EXTRA_TIME_CHAINS,
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_CHAINS,
  CAMPAIGN_REGULATION_LIVE_MS,
};

export const CAMPAIGN_ENGINE = Object.freeze({
  name: "S4 V2.1",
  modelVersion: "match-engine-v2.1",
  profile: "v2.1-stable-dynamic.2",
});

function matchWeatherOptions(weather, knockout = false) {
  const value = typeof weather === "string" ? { type: weather } : (weather ?? {});
  let type = ["sunny", "snow", "rain", "storm", "superStorm"].includes(value.type) ? value.type : "sunny";
  if(knockout && type === "superStorm") type = "storm";
  const fallbackPrecipitation = { sunny:0, snow:45, rain:70, storm:70, superStorm:100 }[type];
  const precipitation = Number.isFinite(Number(value.precipitation))
    ? Math.max(0, Math.min(100, Number(value.precipitation)))
    : fallbackPrecipitation;
  return { weather:type, precipitation };
}


function matchReferee(seed) {
  const roll=createV2MatchRng(`${seed}:referee`)()*100;
  return roll<28?'lenient':roll<78?'standard':'strict';
}


function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}


function chooseAiLineup(catalog, seed, clubOwned) {
  const desired = { GK:1, DEF:4, MID:3, ATT:3 };
  const targetOverall = clubOwned ? 88 : 76;
  const picked = [];
  for (const [pool, count] of Object.entries(desired)) {
    const candidates = catalog
      .filter((player) => player.pool === pool && player.isX !== true)
      .sort((left, right) => {
        const leftScore = Math.abs(Number(left.overall ?? 70) - targetOverall) * 1000 + hash(`${seed}:${left.id}`) % 1000;
        const rightScore = Math.abs(Number(right.overall ?? 70) - targetOverall) * 1000 + hash(`${seed}:${right.id}`) % 1000;
        return leftScore - rightScore;
      });
    picked.push(...candidates.slice(0, count));
  }
  if (picked.length !== 11) throw new Error("球员数据库不足，无法生成地块守军");
  return picked;
}

export function buildTerritoryDefenderSeat({ catalog, territory, territoryState, seed, garrison = null }) {
  const clubOwned = territoryState.ownerType === "club";
  const byId = new Map(catalog.map((player) => [player.id, player]));
  const selected = garrison?.lineup?.length === 11 ? garrison.lineup.map((slot) => byId.get(slot.playerId)).filter(Boolean) : chooseAiLineup(catalog, seed, clubOwned);
  if (selected.length !== 11) throw new Error("地块守军阵容数据不完整");
  const players = selected.map((player) => clonePlayer(player, { idPrefix:`ai:${territory.territoryId}:` }));
  const positions = garrison ? Object.fromEntries(garrison.lineup.map((slot) => [`ai:${territory.territoryId}:${slot.playerId}`, { x:slot.x, y:slot.y }])) : defaultPositions(players);
  const plan = garrison ? { ...structuredClone(DEFAULT_PLAN), tactic:garrison.tactic, style:garrison.engineStyle, tacticalDimensions:{ ...DEFAULT_PLAN.tacticalDimensions, ...garrison.tacticalDimensions } } : clubOwned
    ? { ...structuredClone(DEFAULT_PLAN), tactic:"positive", style:"highPress", tacticalDimensions:{ ...DEFAULT_PLAN.tacticalDimensions, tempo:60, pressing:66, defensiveLine:60 } }
    : structuredClone(DEFAULT_PLAN);
  return {
    bondCatalog:campaignBondCatalog(catalog),
    id: territoryState.ownerId ?? `neutral:${territory.territoryId}`,
    name: clubOwned ? (territory.initialOwner?.name ?? "豪门守军") : `${territory.name ?? territory.country}联队`,
    players,
    captainId: players[0].id,
    formation: garrison?.formation ?? "4-3-3",
    positions,
    positionPresets: { position1:positions, position2:positions, position3:positions },
    formationLines: DEFAULT_FORMATION_LINES,
    formationLinePresets: { position1:DEFAULT_FORMATION_LINES, position2:DEFAULT_FORMATION_LINES, position3:DEFAULT_FORMATION_LINES },
    tactic: plan.tactic,
    style: plan.style,
    tacticalPlans: { opening:plan, leading:{ ...plan, tactic:"defensive", style:"counterAttack", positionPreset:"position2", triggerGoalDifference:1 }, trailing:{ ...plan, tactic:"positive", style:"highPress", positionPreset:"position3", triggerGoalDifference:1 } },
  };
}

function liveTacticalFit(team,parameters) {
  const players=team.players.filter(p=>p.active);
  return calculateV2TacticalFit(players,Object.fromEntries(players.map(p=>[p.id,p.assignedRole??p.role])),team.positions,team.formationLines,team,resolveV2TacticalDimensions(team.tactic,team.style,team.tacticalDimensions,parameters));
}

function publicBroadcast(match, seats, { legNumber, extraTimePlayed = false, penalties = null } = {}) {
  const view = publicV2Match(match);
  const matchRating = (player) => {
    const stats = player.matchStats ?? {};
    const value = 6 + Number(stats.goals ?? 0) * 1.15 + Number(stats.assists ?? 0) * 0.65
      + Number(stats.shotsOnTarget ?? 0) * 0.08 + Number(stats.tackles ?? 0) * 0.05
      + Number(stats.interceptions ?? 0) * 0.04 + Number(stats.saves ?? 0) * 0.08
      - (player.sentOff ? 1.6 : 0) - (player.injury ? 0.25 : 0);
    return Number(Math.max(1, Math.min(10, value)).toFixed(1));
  };
  return {
    legNumber, minute:Number(view.minute ?? 0), score:[...view.score], finished:Boolean(view.finished), extraTimePlayed, penalties,
    environment:view.environment, events:view.events, abandoned:Boolean(match.abandoned), abandonmentReason:match.abandonmentReason??null,
    penaltyShootout:match.penaltyShootout?structuredClone(match.penaltyShootout):null,
    teams:view.teams.map((team,index) => ({
      ...team,
      stats:{ ...team.stats, possession:Number(team.stats?.possession ?? team.stats?.possessionSeconds ?? team.stats?.possessions ?? 0) },
      formation:analyzeElevenBoardFormation(match.teams[index].players.filter(p=>p.active),match.teams[index].positions,match.teams[index].formationLines).name,
      positions:structuredClone(match.teams[index].positions),
      activeCount:team.players.filter((player) => player.active).length,
      tacticalFit:liveTacticalFit(match.teams[index],match.parameters),
      attackFocus:match.teams[index].attackFocus??"balanced",
      defenseFocus:match.teams[index].defenseFocus??"balanced",
      players:team.players.map((player) => {
        const source = seats[index].players.find((candidate) => candidate.id === player.id);
        const card = createPlayerCardViewModel(source ?? player);
        return {
          ...player,
          position:match.teams[index].positions?.[player.id] ?? match.teams[index].players.find(p=>p.id===player.id)?.boardPosition ?? seats[index].positions?.[player.id] ?? { x:50, y:50 },
          overall:Number(source?.effectiveOverall ?? source?.overall ?? 0),
          grade:String(source?.grade ?? "C"),
          card:{playerId:card.playerId,cardDefinitionId:card.cardDefinitionId,cardInstanceId:card.cardInstanceId,sourceName:card.sourceName,club:card.club,nationality:card.nationality,art:card.art},
          upgradeLevel:Number(source?.upgradeLevel ?? 0),
          captain:activeCaptain(match.teams[index])?.id === player.id,
          rating:matchRating(player),
        };
      }),
    })),
  };
}

export function createCampaignLiveLeg({ home, away, seed, legNumber, startedAt, aggregateBaseScore = null, knockout = false, weather = null, venue = null }) {
  const environment = matchWeatherOptions(weather, knockout);
  const match = createV2Match([home,away], {
    seed,
    possessionChains:knockout ? CAMPAIGN_REGULATION_CHAINS + CAMPAIGN_EXTRA_TIME_CHAINS : CAMPAIGN_REGULATION_CHAINS,
    ...environment,
    referee:matchReferee(seed),
  });
  match.regulationChainCount = CAMPAIGN_REGULATION_CHAINS;
  match.scheduledDurationMinutes=knockout?120:90;
  match.campaignForfeit=true;
  return {
    legNumber:Number(legNumber),
    seed:String(seed),
    startedAt:Number(startedAt),
    aggregateBaseScore:Array.isArray(aggregateBaseScore) ? aggregateBaseScore.map(Number) : null,
    knockout:Boolean(knockout),
    venue:venue ? structuredClone(venue) : null,
    weatherSnapshot:structuredClone(weather ?? { type:environment.weather, precipitation:environment.precipitation }),
    extraTimePlayed:false,
    penalties:null,
    winnerIndex:null,
    home:structuredClone(home),
    away:structuredClone(away),
    match,
  };
}

export function restoreCampaignLiveLeg(leg) {
  if (!leg?.match || leg.match.finished || typeof leg.match.rng === "function") return leg;
  leg.match.rng=createV2MatchRng(leg.seed,leg.match.rngState);
  return leg;
}

function campaignAggregateScore(leg) {
  return leg.match.score.map((score,index)=>Number(score)+Number(leg.aggregateBaseScore?.[index]??0));
}

export function advanceCampaignLiveLeg(leg, now = Date.now(), { maximumChains = 1 } = {}) {
  restoreCampaignLiveLeg(leg);
  const match = leg.match;
  if (match.finished) { completeCampaignLeg(leg); return leg; }
  const elapsed = Math.max(0,Number(now)-Number(leg.startedAt));
  let budget = Math.max(0,Math.floor(Number(maximumChains) || 0));
  const advanceTo = (desired) => {
    if (!budget || match.finished || desired <= match.nextChainIndex) return;
    const target = Math.min(desired,match.nextChainIndex+budget);
    const before = match.nextChainIndex;
    advanceV2Match(match,target);
    budget -= match.nextChainIndex-before;
  };
  const regulationTarget = Math.min(CAMPAIGN_REGULATION_CHAINS,Math.floor(elapsed/CAMPAIGN_REGULATION_LIVE_MS*CAMPAIGN_REGULATION_CHAINS));
  advanceTo(regulationTarget);
  if (!match.finished && leg.knockout && match.nextChainIndex >= CAMPAIGN_REGULATION_CHAINS) {
    if (campaignAggregateScore(leg)[0] !== campaignAggregateScore(leg)[1]) finishV2Match(match,{minute:90});
    else leg.extraTimePlayed = true;
  }
  if (!match.finished && leg.extraTimePlayed) {
    const extraElapsed = Math.max(0,elapsed-CAMPAIGN_REGULATION_LIVE_MS);
    const extraTarget = CAMPAIGN_REGULATION_CHAINS + Math.min(CAMPAIGN_EXTRA_TIME_CHAINS,Math.floor(extraElapsed/CAMPAIGN_EXTRA_TIME_LIVE_MS*CAMPAIGN_EXTRA_TIME_CHAINS));
    advanceTo(extraTarget);
  }
  if(match.finished) completeCampaignLeg(leg);
  return leg;
}

export function publicCampaignLiveLeg(leg, {now = null} = {}) {
  restoreCampaignLiveLeg(leg);
  const broadcast = publicBroadcast(leg.match,[leg.home,leg.away],{
    legNumber:leg.legNumber,
    extraTimePlayed:Boolean(leg.extraTimePlayed),
    penalties:leg.penalties ? [...leg.penalties] : null,
  });
  return {...broadcast, venue:leg.venue ? {...leg.venue,sponsors:(leg.venue.sponsors??[]).filter(s=>now===null||s.expiresAt>now)} : null};
}

export function finalizeCampaignLiveBattle({ territoryId, seed, attacker, defender, firstLeg, secondLeg }) {
  const firstScore=[...firstLeg.match.score];
  const secondScore=[...secondLeg.match.score];
  const firstAttackerIndex=firstLeg.match.teams.findIndex(t=>t.id===attacker.id);
  const ai=firstAttackerIndex<0?0:firstAttackerIndex;
  const playerAggregate=firstScore[ai]+secondScore[1];
  const defenderAggregate=firstScore[1-ai]+secondScore[0];
  const outcome=playerAggregate!==defenderAggregate ? (playerAggregate>defenderAggregate?"win":"loss") : secondLeg.winnerIndex==null?"draw":secondLeg.winnerIndex===1?"win":"loss";
  const secondView=publicV2Match(secondLeg.match,{eventLimit:80});
  const firstBroadcast=publicCampaignLiveLeg(firstLeg);
  const secondBroadcast=publicCampaignLiveLeg(secondLeg);
  return {
    id:"battle-"+hash(String(seed)+":"+playerAggregate+":"+defenderAggregate).toString(16),
    territoryId,seed,engine:{...CAMPAIGN_ENGINE,engineVersion:secondView.engineVersion},format:"two-legged",
    score:[playerAggregate,defenderAggregate],aggregateScore:[playerAggregate,defenderAggregate],outcome,
    penalties:secondBroadcast.penalties,extraTimePlayed:secondBroadcast.extraTimePlayed,
    teams:[{name:attacker.name,score:playerAggregate,stats:secondView.teams[1].stats},{name:defender.name,score:defenderAggregate,stats:secondView.teams[0].stats}],
    rotations:[{leg:1,players:firstLeg.away.id===attacker.id?firstLeg.away.rotations??[]:firstLeg.home.rotations??[]},{leg:2,players:secondLeg.away.rotations??[]}],
    legs:[{number:1,home:firstLeg.home.name,away:firstLeg.away.name,score:firstScore},{number:2,home:defender.name,away:attacker.name,score:secondScore,extraTimePlayed:secondBroadcast.extraTimePlayed,penalties:secondBroadcast.penalties}],
    broadcasts:[firstBroadcast,secondBroadcast],...battleLegDetails([firstLeg,secondLeg],attacker.id),
  };
}

function completeCampaignLeg(leg) {
  const match=leg.match;
  if(!leg.knockout || leg.winnerIndex!=null) return;
  const aggregate=campaignAggregateScore(leg);
  if(aggregate[0]===aggregate[1] && !match.abandoned && !leg.penalties) {
    if(typeof match.rng!=='function')match.rng=createV2MatchRng(leg.seed,match.rngState);
    match.penaltyShootout ??= v2PenaltyShootout(match);
    leg.penalties=[...match.penaltyShootout.scores];
    if(match.rng.getState)match.rngState=match.rng.getState();
    match.commentary=match.events.map(e=>({...e}));
  }
  leg.winnerIndex=leg.penalties ? (leg.penalties[0]>leg.penalties[1]?0:1)
    : aggregate[0]===aggregate[1] ? (Number.isInteger(match.forfeitedTeamIndex)?1-match.forfeitedTeamIndex:null)
    : aggregate[0]>aggregate[1]?0:1;
}

function battleLegDetails(legs, attackerId) {
  const events=[],postMatchConsequences={injuries:[],suspensions:[]};
  for(const leg of legs){
    const index=leg.match.teams.findIndex(t=>t.id===attackerId);
    const remap=entry=>{
      const output={...structuredClone(entry),legNumber:leg.legNumber};
      for(const key of ['teamIndex','offenderTeamIndex','opponentTeamIndex','attackingTeamIndex','punishedTeamIndex','ownGoalTeamIndex'])
        if(Number.isInteger(output[key]))output[key]=output[key]===index?0:1;
      if(Array.isArray(output.score)&&index===1)output.score=[output.score[1],output.score[0]];
      if(output.id)output.id=`leg-${leg.legNumber}:${output.id}`;
      return output;
    };
    events.push(...leg.match.events.map(remap));
    for(const key of ['injuries','suspensions'])postMatchConsequences[key].push(...(leg.match.postMatchConsequences?.[key]??[]).map(remap));
  }
  return {events,postMatchConsequences};
}

function simulateLeg({ home, away, seed, legNumber, aggregateBaseScore = null, knockout = false, possessionChains = 180, weather = null }) {
  const environment = matchWeatherOptions(weather, knockout);
  if (!knockout) {
    const match=simulateV2Match([home,away],{seed,possessionChains,...environment,referee:matchReferee(seed)});
    return { match,broadcast:publicBroadcast(match,[home,away],{legNumber}),winnerIndex:null };
  }
  const match=createV2Match([home,away],{seed,possessionChains:240,...environment,referee:matchReferee(seed)});
  match.regulationChainCount=180;
  match.scheduledDurationMinutes=120;
  match.campaignForfeit=true;
  advanceV2Match(match,180);
  const regulationScore=[...match.score];
  const aggregate=regulationScore.map((score,index)=>score+Number(aggregateBaseScore?.[index]??0));
  let extraTimePlayed=false;
  if (!match.abandoned && aggregate[0]===aggregate[1]) { extraTimePlayed=true; advanceV2Match(match,240); }
  else finishV2Match(match,{minute:90});
  const finalAggregate=match.score.map((score,index)=>score+Number(aggregateBaseScore?.[index]??0));
  const penalties=!match.abandoned&&finalAggregate[0]===finalAggregate[1]?v2PenaltyShootout(match):null;
  if(penalties)match.penaltyShootout=penalties;
  const winnerIndex=penalties?.winnerIndex ?? (finalAggregate[0]===finalAggregate[1]?null:finalAggregate[0]>finalAggregate[1]?0:1);
  return {match,broadcast:publicBroadcast(match,[home,away],{legNumber,extraTimePlayed,penalties:penalties?.scores??null}),winnerIndex,aggregate:finalAggregate,regulationScore};
}

export function simulateCampaignTerritoryMatch({ attacker, defender, territoryId, seed, possessionChains = 180, twoLegged = false, weather = null }) {
  const simulationSeed = String(seed ?? `territory:${territoryId}:${Date.now()}`);
  if (!twoLegged) {
    const leg=simulateLeg({home:attacker,away:defender,seed:simulationSeed,legNumber:1,possessionChains,weather});
    const view=publicV2Match(leg.match,{eventLimit:40});
    const [attackerScore,defenderScore]=view.score;
    return { id:`battle-${hash(`${simulationSeed}:${attackerScore}:${defenderScore}`).toString(16)}`,territoryId,seed:simulationSeed,engine:{...CAMPAIGN_ENGINE,engineVersion:view.engineVersion},score:[attackerScore,defenderScore],outcome:attackerScore>defenderScore?"win":attackerScore<defenderScore?"loss":"draw",teams:view.teams.map((team)=>({name:team.name,score:team.score,stats:team.stats})),events:view.events,postMatchConsequences:view.postMatchConsequences,broadcasts:[leg.broadcast] };
  }
  const first=simulateLeg({home:attacker,away:defender,seed:`${simulationSeed}:leg-1`,legNumber:1,weather});
  const firstScore=[...first.match.score];
  const second=simulateLeg({home:defender,away:attacker,seed:`${simulationSeed}:leg-2`,legNumber:2,aggregateBaseScore:[firstScore[1],firstScore[0]],knockout:true,weather});
  const playerAggregate=firstScore[0]+second.match.score[1];
  const defenderAggregate=firstScore[1]+second.match.score[0];
  const playerWon=playerAggregate!==defenderAggregate ? playerAggregate>defenderAggregate : second.winnerIndex===1;
  const outcome=playerAggregate===defenderAggregate&&second.winnerIndex==null?"draw":playerWon?"win":"loss";
  const secondView=publicV2Match(second.match,{eventLimit:80});
  return {
    id:`battle-${hash(`${simulationSeed}:${playerAggregate}:${defenderAggregate}`).toString(16)}`,territoryId,seed:simulationSeed,
    engine:{...CAMPAIGN_ENGINE,engineVersion:secondView.engineVersion},format:"two-legged",score:[playerAggregate,defenderAggregate],aggregateScore:[playerAggregate,defenderAggregate],outcome,
    penalties:second.broadcast.penalties,extraTimePlayed:second.broadcast.extraTimePlayed,
    teams:[{name:attacker.name,score:playerAggregate,stats:secondView.teams[1].stats},{name:defender.name,score:defenderAggregate,stats:secondView.teams[0].stats}],
    legs:[{number:1,home:attacker.name,away:defender.name,score:firstScore},{number:2,home:defender.name,away:attacker.name,score:[...second.match.score],extraTimePlayed:second.broadcast.extraTimePlayed,penalties:second.broadcast.penalties}],
    broadcasts:[first.broadcast,second.broadcast],...battleLegDetails([{match:first.match,legNumber:1},{match:second.match,legNumber:2}],attacker.id),
  };
}
