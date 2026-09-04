import { advanceV2Match, createV2Match, createV2MatchRng, finishV2Match, publicV2Match, simulateV2Match } from "./s4-v2.1/versus/v2/match-engine-v2.js";
import { DEFAULT_FORMATION_LINES } from "./s4-v2.1/versus/public/formation-rules.js";
import {
  CAMPAIGN_EXTRA_TIME_CHAINS,
  CAMPAIGN_EXTRA_TIME_LIVE_MS,
  CAMPAIGN_REGULATION_CHAINS,
  CAMPAIGN_REGULATION_LIVE_MS,
} from "../shared/config/challenge.mjs";
import { autoCompletePlayerSquads, PLAYER_SQUAD_IDS } from "../shared/config/player-squads.mjs";

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

function matchWeatherOptions(weather) {
  const value = typeof weather === "string" ? { type: weather } : (weather ?? {});
  const type = ["sunny", "snow", "rain", "storm", "superStorm"].includes(value.type) ? value.type : "sunny";
  const fallbackPrecipitation = { sunny:0, snow:45, rain:70, storm:70, superStorm:100 }[type];
  const precipitation = Number.isFinite(Number(value.precipitation))
    ? Math.max(0, Math.min(100, Number(value.precipitation)))
    : fallbackPrecipitation;
  return { weather:type, precipitation };
}

const DEFAULT_PLAN = Object.freeze({
  tactic: "balanced",
  style: "possession",
  positionPreset: "position1",
  inPossessionDetails: { attackDirection: "balanced", chanceCreation: "balanced", longShots: "balanced", crossing: "balanced" },
  outOfPossessionDetails: { defensiveWidth: "balanced", defenseDirection: "balanced", marking: "mixed", lineStrategy: "hold" },
  tacticalDimensions: { tempo:50, directness:50, attackingWidth:50, defensiveLine:50, pressing:50, compactness:55, counterAttack:50, timeWasting:15 },
  playerDuties: {},
});

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function clonePlayer(player, { idPrefix = "" } = {}) {
  return {
    ...structuredClone(player),
    id: `${idPrefix}${player.id}`,
    active: true,
    state: { ...structuredClone(player.state ?? {}), fitness: Number(player.state?.fitness ?? player.fitness ?? 100) },
  };
}

function sortedPlayers(players) {
  return [...players].sort((left, right) => Number(right.effectiveOverall ?? right.overall ?? 0) - Number(left.effectiveOverall ?? left.overall ?? 0));
}

function defaultStartingEleven(roster) {
  const available = sortedPlayers(roster);
  const selected = [];
  const take = (pool, count) => {
    available.filter((player) => player.pool === pool && !selected.includes(player)).slice(0, count).forEach((player) => selected.push(player));
  };
  take("GK", 1);
  take("DEF", 4);
  take("MID", 3);
  take("ATT", 3);
  for (const pool of ["DEF", "MID", "ATT"]) {
    if (!selected.some((player) => player.pool === pool)) take(pool, 1);
  }
  available.filter((player) => player.pool !== "GK" && !selected.includes(player)).forEach((player) => {
    if (selected.length < 11) selected.push(player);
  });
  return selected.slice(0, 11);
}

function defaultPositions(players) {
  const groups = { GK: [], DEF: [], MID: [], ATT: [] };
  players.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const positions = {};
  for (const [pool, y] of [["GK", 90], ["DEF", 68], ["MID", 44], ["ATT", 20]]) {
    groups[pool].forEach((player, index) => {
      positions[player.id] = { x: Math.round(12 + (index + 1) * 76 / (groups[pool].length + 1)), y };
    });
  }
  return positions;
}

function validSavedStarters(roster, ids) {
  const byId = new Map(roster.map((player) => [player.id, player]));
  const unique = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  const players = unique.map((id) => byId.get(id)).filter(Boolean);
  return players.length === 11 && players.filter((player) => player.pool === "GK").length === 1 ? players : null;
}

export function buildAccountMatchSeat(account, squadId = PLAYER_SQUAD_IDS.EXPEDITION) {
  const fullRoster = account?.draft?.roster ?? [];
  const completed = autoCompletePlayerSquads(account?.playerSquads,fullRoster);
  const roster = fullRoster.filter((player) => completed.playerSquads.assignments[String(player.id)] === squadId);
  if (roster.length < 11) throw new Error("球队阵容不足，无法参加地块比赛");
  const tacticsRoot = account.tactics ?? {};
  const tactics = tacticsRoot.squads?.[squadId] ?? tacticsRoot;
  const embedded = tactics.planSnapshots?.__s4V2 ?? {};
  const sourcePlayers = validSavedStarters(roster, embedded.starters ?? tactics.starters) ?? defaultStartingEleven(roster);
  if (sourcePlayers.length !== 11 || sourcePlayers.filter((player) => player.pool === "GK").length !== 1) {
    throw new Error("首发阵容必须包含11名球员且只能有1名门将");
  }
  const players = sourcePlayers.map((player) => clonePlayer(player));
  const fallbackPositions = defaultPositions(players);
  const savedPositionPresets = embedded.positionPresets ?? {};
  const position1 = { ...fallbackPositions, ...(tactics.positions ?? {}), ...(savedPositionPresets.position1 ?? {}) };
  const formationLines = embedded.formationLinePresets ?? { position1: tactics.formationLines ?? DEFAULT_FORMATION_LINES };
  const opening = embedded.tacticalPlans?.opening ?? tactics.planSnapshots?.opening ?? {
    ...structuredClone(DEFAULT_PLAN),
    tactic: tactics.attackStyle ?? DEFAULT_PLAN.tactic,
    style: tactics.defenseStyle ?? DEFAULT_PLAN.style,
    tacticalDimensions: { ...DEFAULT_PLAN.tacticalDimensions, ...(tactics.tacticalBars ?? {}) },
  };
  return {
    id: account.id,
    name: account.draft?.teamName ?? account.nickname ?? "玩家球队",
    players,
    captainId: players.some((player) => player.id === embedded.captainId) ? embedded.captainId : players[0].id,
    formation: tactics.formation ?? "4-3-3",
    positions: position1,
    positionPresets: { position1, position2: savedPositionPresets.position2 ?? position1, position3: savedPositionPresets.position3 ?? position1 },
    formationLines: formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
    formationLinePresets: {
      position1: formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
      position2: formationLines.position2 ?? formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
      position3: formationLines.position3 ?? formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
    },
    tactic: opening.tactic ?? "balanced",
    style: opening.style ?? "possession",
    tacticalPlans: {
      opening,
      leading: embedded.tacticalPlans?.leading ?? tactics.planSnapshots?.leading ?? { ...structuredClone(DEFAULT_PLAN), tactic:"defensive", style:"counterAttack", positionPreset:"position2", triggerGoalDifference:1 },
      trailing: embedded.tacticalPlans?.trailing ?? tactics.planSnapshots?.trailing ?? { ...structuredClone(DEFAULT_PLAN), tactic:"positive", style:"possession", positionPreset:"position3", triggerGoalDifference:1 },
    },
  };
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
    environment:view.environment, events:view.events,
    teams:view.teams.map((team,index) => ({
      ...team,
      stats:{ ...team.stats, possession:Number(team.stats?.possession ?? team.stats?.possessionSeconds ?? team.stats?.possessions ?? 0) },
      formation:seats[index].formation,
      positions:seats[index].positions,
      activeCount:team.players.filter((player) => player.active).length,
      tacticalFit:100,
      attackFocus:"balanced",
      defenseFocus:"balanced",
      players:team.players.map((player) => {
        const source = seats[index].players.find((candidate) => candidate.id === player.id);
        return {
          ...player,
          position:seats[index].positions?.[player.id] ?? { x:50, y:50 },
          overall:Number(source?.effectiveOverall ?? source?.overall ?? 0),
          grade:String(source?.grade ?? "C"),
          upgradeLevel:Number(source?.upgradeLevel ?? 0),
          captain:seats[index].captainId === player.id,
          rating:matchRating(player),
        };
      }),
    })),
  };
}

export function createCampaignLiveLeg({ home, away, seed, legNumber, startedAt, aggregateBaseScore = null, knockout = false, weather = null }) {
  const environment = matchWeatherOptions(weather);
  const match = createV2Match([home,away], {
    seed,
    possessionChains:knockout ? CAMPAIGN_REGULATION_CHAINS + CAMPAIGN_EXTRA_TIME_CHAINS : CAMPAIGN_REGULATION_CHAINS,
    ...environment,
    referee:"standard",
  });
  match.regulationChainCount = CAMPAIGN_REGULATION_CHAINS;
  return {
    legNumber:Number(legNumber),
    seed:String(seed),
    startedAt:Number(startedAt),
    aggregateBaseScore:Array.isArray(aggregateBaseScore) ? aggregateBaseScore.map(Number) : null,
    knockout:Boolean(knockout),
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
  if (match.finished) return leg;
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
  if (match.finished && leg.knockout && leg.winnerIndex == null) {
    const aggregate = campaignAggregateScore(leg);
    if (aggregate[0] === aggregate[1] && !leg.penalties) leg.penalties = penaltyShootout(match,String(leg.seed)+":penalties").scores;
    leg.winnerIndex = leg.penalties ? (leg.penalties[0] > leg.penalties[1] ? 0 : 1) : (aggregate[0] > aggregate[1] ? 0 : 1);
  }
  return leg;
}

export function publicCampaignLiveLeg(leg) {
  restoreCampaignLiveLeg(leg);
  return publicBroadcast(leg.match,[leg.home,leg.away],{
    legNumber:leg.legNumber,
    extraTimePlayed:Boolean(leg.extraTimePlayed),
    penalties:leg.penalties ? [...leg.penalties] : null,
  });
}

export function finalizeCampaignLiveBattle({ territoryId, seed, attacker, defender, firstLeg, secondLeg }) {
  const firstScore=[...firstLeg.match.score];
  const secondScore=[...secondLeg.match.score];
  const playerAggregate=firstScore[0]+secondScore[1];
  const defenderAggregate=firstScore[1]+secondScore[0];
  const playerWon=playerAggregate!==defenderAggregate ? playerAggregate>defenderAggregate : secondLeg.winnerIndex===1;
  const secondView=publicV2Match(secondLeg.match,{eventLimit:80});
  const firstBroadcast=publicCampaignLiveLeg(firstLeg);
  const secondBroadcast=publicCampaignLiveLeg(secondLeg);
  return {
    id:"battle-"+hash(String(seed)+":"+playerAggregate+":"+defenderAggregate).toString(16),
    territoryId,seed,engine:{...CAMPAIGN_ENGINE,engineVersion:secondView.engineVersion},format:"two-legged",
    score:[playerAggregate,defenderAggregate],aggregateScore:[playerAggregate,defenderAggregate],outcome:playerWon?"win":"loss",
    penalties:secondBroadcast.penalties,extraTimePlayed:secondBroadcast.extraTimePlayed,
    teams:[{name:attacker.name,score:playerAggregate,stats:secondView.teams[1].stats},{name:defender.name,score:defenderAggregate,stats:secondView.teams[0].stats}],
    legs:[{number:1,home:attacker.name,away:defender.name,score:firstScore},{number:2,home:defender.name,away:attacker.name,score:secondScore,extraTimePlayed:secondBroadcast.extraTimePlayed,penalties:secondBroadcast.penalties}],
    broadcasts:[firstBroadcast,secondBroadcast],events:secondView.events,postMatchConsequences:secondView.postMatchConsequences,
  };
}

function penaltyShootout(match, seed) {
  const rng = (() => { let state=hash(seed)||1; return () => { state=(Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; }; })();
  const scores=[0,0]; const kicks=[];
  const takers=match.teams.map((team)=>team.players.filter((player)=>player.active && !player.sentOff));
  const kick=(teamIndex,round,phase)=>{
    const taker=takers[teamIndex][kicks.filter((entry)=>entry.teamIndex===teamIndex).length%takers[teamIndex].length];
    const scored=rng()<0.74;
    if (scored) scores[teamIndex]+=1;
    const entry={type:"penaltyShootoutKick",minute:120,teamIndex,round,phase,actorId:taker?.id,actorName:taker?.name,scored,score:[...scores],text:`${taker?.name??"球员"}主罚${scored?"命中":"未进"}，点球比分 ${scores[0]}:${scores[1]}`};
    kicks.push(entry); match.events.push(entry);
  };
  for (let round=1;round<=5;round+=1) { kick(0,round,"initial"); kick(1,round,"initial"); }
  let round=1; while (scores[0]===scores[1]) { kick(0,round,"suddenDeath"); kick(1,round,"suddenDeath"); round+=1; }
  const winnerIndex=scores[0]>scores[1]?0:1;
  match.events.push({type:"penalties",minute:120,teamIndex:winnerIndex,score:[...scores],text:`点球大战结束，${match.teams[winnerIndex].name}以 ${scores[0]}:${scores[1]} 胜出。`});
  return { scores,winnerIndex,kicks };
}

function simulateLeg({ home, away, seed, legNumber, aggregateBaseScore = null, knockout = false, possessionChains = 180, weather = null }) {
  const environment = matchWeatherOptions(weather);
  if (!knockout) {
    const match=simulateV2Match([home,away],{seed,possessionChains,...environment,referee:"standard"});
    return { match,broadcast:publicBroadcast(match,[home,away],{legNumber}),winnerIndex:null };
  }
  const match=createV2Match([home,away],{seed,possessionChains:240,...environment,referee:"standard"});
  match.regulationChainCount=180;
  advanceV2Match(match,180);
  const regulationScore=[...match.score];
  const aggregate=regulationScore.map((score,index)=>score+Number(aggregateBaseScore?.[index]??0));
  let extraTimePlayed=false;
  if (aggregate[0]===aggregate[1]) { extraTimePlayed=true; advanceV2Match(match,240); }
  else finishV2Match(match,{minute:90});
  const finalAggregate=match.score.map((score,index)=>score+Number(aggregateBaseScore?.[index]??0));
  const penalties=finalAggregate[0]===finalAggregate[1]?penaltyShootout(match,`${seed}:penalties`):null;
  const winnerIndex=penalties?.winnerIndex ?? (finalAggregate[0]>finalAggregate[1]?0:1);
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
  const outcome=playerWon?"win":"loss";
  const secondView=publicV2Match(second.match,{eventLimit:80});
  return {
    id:`battle-${hash(`${simulationSeed}:${playerAggregate}:${defenderAggregate}`).toString(16)}`,territoryId,seed:simulationSeed,
    engine:{...CAMPAIGN_ENGINE,engineVersion:secondView.engineVersion},format:"two-legged",score:[playerAggregate,defenderAggregate],aggregateScore:[playerAggregate,defenderAggregate],outcome,
    penalties:second.broadcast.penalties,extraTimePlayed:second.broadcast.extraTimePlayed,
    teams:[{name:attacker.name,score:playerAggregate,stats:secondView.teams[1].stats},{name:defender.name,score:defenderAggregate,stats:secondView.teams[0].stats}],
    legs:[{number:1,home:attacker.name,away:defender.name,score:firstScore},{number:2,home:defender.name,away:attacker.name,score:[...second.match.score],extraTimePlayed:second.broadcast.extraTimePlayed,penalties:second.broadcast.penalties}],
    broadcasts:[first.broadcast,second.broadcast],events:secondView.events,postMatchConsequences:secondView.postMatchConsequences,
  };
}
