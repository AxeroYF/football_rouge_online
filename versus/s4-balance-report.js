import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { roleGroup } from "../game/public/schema.js";
import { advanceVersusMatch, createVersusMatch, HALFTIME_ADJUSTMENT_MS, REGULAR_DURATION_MS } from "./match-engine.js";
import { isXPlayer, REAL_PLAYERS } from "./player-pool.js";
import { defaultElevenPositions, inferElevenBoardRoles } from "./rules.js";
import { applyS4Enhancement } from "./s4-balance.js";
import { YDL_TRAIT_CARDS } from "./trait-pool.js";
import { createS4BondCatalog, evaluateS4LineupBonds } from "./public/bond-rules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const configPath = path.resolve(here, argument("config") ?? "s4-balance-config.json");
const outputPathArgument = argument("output");

function hash(seed, value) {
  let state = 2166136261;
  for (const character of `${seed}:${value}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function seededRandom(seed) {
  let state = hash(seed, "rng");
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function weightedPick(rng, weights) {
  const entries = Object.entries(weights);
  const roll = rng() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = 0;
  return entries.find(([, weight]) => (cursor += weight) >= roll)?.[0] ?? entries.at(-1)[0];
}

const FORMATIONS = Object.freeze({
  "4-3-3":[["GK",50,90],["LB",16,69],["CB",38,69],["CB",62,69],["RB",84,69],["LM",20,45],["DM",50,45],["RM",80,45],["LW",18,19],["ST",50,19],["RW",82,19]],
  "4-2-3-1":[["GK",50,90],["LB",16,69],["CB",38,69],["CB",62,69],["RB",84,69],["DM",35,55],["DM",65,55],["LM",20,38],["AM",50,36],["RM",80,38],["ST",50,17]],
  "3-4-3":[["GK",50,90],["CB",25,69],["CB",50,70],["CB",75,69],["LM",15,48],["DM",40,49],["AM",60,43],["RM",85,48],["LW",18,19],["ST",50,18],["RW",82,19]],
  "3-5-2":[["GK",50,90],["CB",25,69],["CB",50,70],["CB",75,69],["LM",14,48],["DM",36,52],["AM",50,40],["DM",64,52],["RM",86,48],["ST",38,18],["ST",62,18]],
  "5-3-2":[["GK",50,90],["LWB",10,59],["CB",30,70],["CB",50,72],["CB",70,70],["RWB",90,59],["LM",24,44],["DM",50,48],["RM",76,44],["ST",38,18],["ST",62,18]],
});
const TACTICS = ["allOutAttack", "positive", "balanced", "defensive", "parkBus"];
const STYLES = ["possession", "longBall", "wingPlay", "counterAttack", "highPress", "lowBlock", "roughPlay"];
const FOCUSES = ["balanced", "left", "center", "right"];
const ROLE_FALLBACKS = Object.freeze({ LWB:"LB", RWB:"RB" });
const TASK_GROUPS = Object.freeze({ appearances:["GK","DEF","MID","ATT"], goals:["ATT"], assists:["MID"], tackles:["DEF"], saves:["GK"] });

function eligiblePlayers(role, used, legendMode = "any") {
  const target = ROLE_FALLBACKS[role] ?? role;
  const available = REAL_PLAYERS.filter((player) => !isXPlayer(player) && !used.has(player.id) && (legendMode === "only" ? player.grade === "S" : legendMode === "exclude" ? player.grade !== "S" : true));
  const tiers = [
    available.filter((player) => player.role === target),
    available.filter((player) => player.secondaryRole === target),
    available.filter((player) => roleGroup(player.role) === roleGroup(target)),
    available,
  ];
  return tiers.find((values) => values.length) ?? [];
}

function nationalityCandidates(nationality, role, used, legendMode = "any") {
  const target = ROLE_FALLBACKS[role] ?? role;
  const available = REAL_PLAYERS.filter((player) => !isXPlayer(player) && player.nationality === nationality && !used.has(player.id) && (legendMode === "only" ? player.grade === "S" : legendMode === "exclude" ? player.grade !== "S" : true));
  const tiers = [
    available.filter((player) => player.role === target),
    available.filter((player) => player.secondaryRole === target),
    available.filter((player) => roleGroup(player.role) === roleGroup(target)),
    available,
  ];
  return tiers.find((values) => values.length) ?? [];
}

function legendSlotFit(player, role) {
  const target = ROLE_FALLBACKS[role] ?? role;
  if (player.role === target) return 4;
  if (player.secondaryRole === target) return 3;
  if ((role === "LWB" && [player.role, player.secondaryRole].includes("LB"))
    || (role === "RWB" && [player.role, player.secondaryRole].includes("RB"))) return 3;
  if (roleGroup(player.role) === roleGroup(target)) return 1;
  return 0;
}

function assignLegendsToFormation(formationName, count, rng) {
  const slots = FORMATIONS[formationName].map(([role], index) => ({ role, index }));
  const legends = REAL_PLAYERS.filter((player) => player.grade === "S");
  const candidates = legends.flatMap((player) => slots.map((slot) => ({
    player,
    slot,
    fit:legendSlotFit(player, slot.role),
    tie:rng(),
  }))).filter((entry) => entry.fit > 0)
    .sort((left, right) => right.fit - left.fit || left.tie - right.tie);
  const assignments = new Map();
  const usedPlayers = new Set();
  for (const candidate of candidates) {
    if (assignments.size >= count) break;
    if (assignments.has(candidate.slot.index) || usedPlayers.has(candidate.player.id)) continue;
    assignments.set(candidate.slot.index, candidate.player);
    usedPlayers.add(candidate.player.id);
  }
  return assignments;
}

function startingPositionFit(player, assignedRole) {
  if (!player) return "outOfGroup";
  const target = ROLE_FALLBACKS[assignedRole] ?? assignedRole;
  if (player.role === target) return "primary";
  if (player.secondaryRole === target
    || (assignedRole === "LWB" && [player.role, player.secondaryRole].includes("LB"))
    || (assignedRole === "RWB" && [player.role, player.secondaryRole].includes("RB"))) return "secondary";
  if (roleGroup(player.role) === roleGroup(target)) return "sameGroup";
  return "outOfGroup";
}

function traitIdsFor(player, count, rng) {
  const compatible = YDL_TRAIT_CARDS.filter((trait) => (trait.eligibleRoleGroups ?? []).some((group) => group === "ANY" || group === roleGroup(player.role) || group === player.role));
  const available = [...compatible];
  const ids = [];
  while (ids.length < count && available.length) ids.push(available.splice(Math.floor(rng() * available.length), 1)[0].id);
  return ids;
}

function upgradeFor(archetype, rng) {
  if (archetype === "standard") return rng() < .82 ? 0 : 1;
  if (archetype === "enhanced") return pick(rng, [2,3,4,5,5,6,7,8]);
  if (archetype === "traitHeavy") return pick(rng, [5,5,6,7,8]);
  if (archetype === "legendHeavy") return pick(rng, [0,1,2,3,4,5]);
  return pick(rng, [2,3,4,5,6,7,8]);
}

function xPlayer(role, id, upgradeLevel, traitIds) {
  const group = roleGroup(role);
  const emphasis = group === "GK" ? ["goalkeeping","reflexes","positioning","composure"] : group === "DEF" ? ["tackling","marking","positioning","strength","pace"] : group === "MID" ? ["passing","vision","decisions","firstTouch","stamina"] : ["finishing","offBall","pace","dribbling","composure"];
  const attributes = Object.fromEntries(Object.keys(REAL_PLAYERS[0].attributes).map((key) => [key, emphasis.includes(key) ? 68 : 55]));
  return { ...applyS4Enhancement({ id, name:`模拟X-${role}`, role:ROLE_FALLBACKS[role] ?? role, secondaryRole:null, pool:group, overall:62, grade:"X", nationality:"中国", club:"黄狗青训", heightCm:group === "GK" ? 186 : 180, preferredFoot:"both", attributes, referenceAttributes:{ ...attributes }, state:{ fitness:100 }, xPlayer:true }, upgradeLevel), traits:traitIds };
}

function buildSeat(seed, side, archetype, options = {}) {
  const rng = seededRandom(`${seed}:${side}:${archetype}`);
  const formationName = options.formation ?? pick(rng, Object.keys(FORMATIONS));
  const used = new Set();
  const players = [];
  const positions = {};
  const legendCount = options.legendCount ?? (archetype === "legendHeavy" ? 5 : archetype === "standard" ? Number(rng() < .25) : Math.floor(rng() * 3));
  const exactLegendCount = options.legendCount != null || archetype === "legendHeavy";
  const legendAssignments = exactLegendCount ? assignLegendsToFormation(formationName, legendCount, rng) : new Map();
  const nationalityPool = REAL_PLAYERS.filter((player) => !isXPlayer(player)).reduce((counts, player) => counts.set(player.nationality, (counts.get(player.nationality) ?? 0) + 1), new Map());
  const nationality = options.nationality ?? (archetype === "nationalityHeavy"
    ? pick(rng, [...nationalityPool.entries()].filter(([, count]) => count >= 10).map(([name]) => name))
    : null);
  let xRemaining = archetype === "xLed" ? 1 : 0;
  const xRoleGroup = options.xRoleGroup ?? pick(rng, ["GK", "DEF", "MID", "ATT"]);
  const xIndex = xRemaining ? FORMATIONS[formationName].findIndex(([role]) => roleGroup(ROLE_FALLBACKS[role] ?? role) === xRoleGroup) : -1;
  FORMATIONS[formationName].forEach(([role, x, y], index) => {
    const upgradeLevel = options.upgradeLevel ?? upgradeFor(archetype, rng);
    const traitCount = options.traitCount ?? (archetype === "traitHeavy" ? (upgradeLevel >= 8 ? 2 : 1) : upgradeLevel >= 7 ? 2 : upgradeLevel >= 4 ? 1 : 0);
    let player;
    if (xRemaining && index === xIndex) {
      const ids = traitIdsFor({ role:ROLE_FALLBACKS[role] ?? role }, Math.max(1, Math.min(3, traitCount + 1)), seededRandom(`${seed}:${side}:x-traits:${index}`));
      player = xPlayer(role, `${side}-x-${seed}`, upgradeLevel, ids);
      xRemaining -= 1;
    } else {
      const assignedLegend = legendAssignments.get(index);
      let candidates;
      if (assignedLegend) {
        candidates = [assignedLegend];
      } else if (nationality) {
        const nationalCandidates = nationalityCandidates(nationality, role, used, exactLegendCount ? "exclude" : "any");
        candidates = nationalCandidates.length ? nationalCandidates : eligiblePlayers(role, used, exactLegendCount ? "exclude" : "any");
      } else {
        candidates = eligiblePlayers(role, used, exactLegendCount ? "exclude" : "any");
      }
      const source = candidates[Math.floor(rng() * candidates.length)];
      used.add(source.id);
      const ids = traitIdsFor(source, traitCount, seededRandom(`${seed}:${side}:traits:${index}`));
      player = { ...applyS4Enhancement({ ...source, attributes:{ ...source.attributes } }, upgradeLevel), traits:ids };
    }
    players.push(player);
    positions[player.id] = { x, y };
  });
  const shift = (source, yDelta, xScale = 1) => Object.fromEntries(Object.entries(source).map(([id, point]) => [id, { x:50 + (point.x - 50) * xScale, y:Math.max(8, Math.min(92, point.y + yDelta)) }]));
  const positionPresets = { position1:positions, position2:shift(positions, 4, .96), position3:shift(positions, -4, 1.04) };
  const tactic = options.tactic ?? pick(rng, TACTICS);
  const style = options.style ?? pick(rng, STYLES);
  return {
    name:`${archetype}-${side}`,
    simulationFormation:formationName,
    simulationArchetype:archetype,
    players,
    positions:structuredClone(positionPresets.position1),
    positionPresets,
    tactic,
    style,
    tacticalPlans:options.staticPlans ? null : { opening:{ tactic, style, positionPreset:"position1" }, leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" }, trailing:{ tactic:"positive", style:"possession", positionPreset:"position3" } },
    attackFocus:pick(rng, FOCUSES),
    defenseFocus:pick(rng, FOCUSES),
    preserveFitness:true,
    bondCatalog:createS4BondCatalog(REAL_PLAYERS),
    // The normal match engine refreshes the top two identity/structure bonds.
    // Keep this explicit in simulation seats so nationality-heavy scenarios exercise the same path.
    nationalityBond:nationality,
  };
}

export { buildSeat as buildS4BalanceSeat, seededRandom as createS4BalanceRng, weightedPick as pickS4BalanceArchetype };

function settle(match) {
  advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS);
  return match.report;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rounded(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function emptyAggregate() {
  return { matches:0, goals:0, shots:0, shotsOnTarget:0, xg:0, fouls:0, yellowCards:0, redCards:0, corners:0, injuries:0, draws:0, dynamicPositionMatches:0, playerSamples:{ GK:[], DEF:[], MID:[], ATT:[] }, archetypes:{}, upgradeLevels:{}, traitCounts:{}, legendCounts:{}, bondCounts:{ nationality:0, club:0, structure:0 }, positionFitStarts:{ primary:0, secondary:0, sameGroup:0, outOfGroup:0 }, xMatches:0 };
}

export function createS4BalanceAggregate() {
  return emptyAggregate();
}

function addMatch(aggregate, report, seats, archetypes) {
  aggregate.matches += 1;
  aggregate.draws += Number(report.score[0] === report.score[1]);
  aggregate.goals += report.score[0] + report.score[1];
  aggregate.dynamicPositionMatches += Number(report.teams.some((team) => team.inMatchPositionAdjustment));
  seats.forEach((seat, teamIndex) => {
    const team = report.teams[teamIndex];
    for (const key of ["shots","shotsOnTarget","xg","fouls","yellowCards","redCards","corners","injuries"]) aggregate[key] += Number(team.stats[key] ?? 0);
    const archetype = archetypes[teamIndex];
    const outcome = aggregate.archetypes[archetype] ??= { teamSamples:0, wins:0, draws:0, goalsFor:0, goalsAgainst:0 };
    outcome.teamSamples += 1;
    outcome.wins += Number(report.score[teamIndex] > report.score[1 - teamIndex]);
    outcome.draws += Number(report.score[teamIndex] === report.score[1 - teamIndex]);
    outcome.goalsFor += report.score[teamIndex];
    outcome.goalsAgainst += report.score[1 - teamIndex];
    const legendCount = seat.players.filter((player) => player.grade === "S").length;
    const openingRolesById = inferElevenBoardRoles(seat.players.map((entry) => ({ id:entry.id, position:seat.positions[entry.id] })));
    const openingRoles = Object.fromEntries(seat.players.map((player) => [player.id, openingRolesById[player.id] ?? player.role]));
    evaluateS4LineupBonds(seat.players, seat.bondCatalog, { roles:openingRoles }).forEach((bond) => { aggregate.bondCounts[bond.type] = Number(aggregate.bondCounts[bond.type] ?? 0) + 1; });
    aggregate.legendCounts[legendCount] = Number(aggregate.legendCounts[legendCount] ?? 0) + 1;
    if (seat.players.some((player) => player.grade === "X")) aggregate.xMatches += 1;
    team.players.forEach((player) => {
      const source = seat.players.find((entry) => entry.id === player.id);
      const group = roleGroup(player.assignedRole);
      aggregate.positionFitStarts[startingPositionFit(source, player.assignedRole)] += 1;
      const penaltiesWon = report.importantEvents.filter((event) => event.type === "penaltyAwarded" && event.opponentId === player.id).length;
      aggregate.playerSamples[group].push({ appearances:1, goals:player.stats.goals, penaltiesWon, assists:player.stats.assists, tackles:player.stats.tackles, yellowCards:player.stats.yellowCards, saves:player.stats.saves, grade:source?.grade, upgradeLevel:Number(source?.upgradeLevel ?? 0), traitCount:Number(source?.traits?.length ?? 0), xPlayer:source?.grade === "X" });
      aggregate.upgradeLevels[source?.upgradeLevel ?? 0] = Number(aggregate.upgradeLevels[source?.upgradeLevel ?? 0] ?? 0) + 1;
      aggregate.traitCounts[source?.traits?.length ?? 0] = Number(aggregate.traitCounts[source?.traits?.length ?? 0] ?? 0) + 1;
    });
  });
}

function estimatedAppearances(samples, stat, target) {
  const rate = mean(samples.map((sample) => sample[stat]));
  return rate > 0 ? rounded(target / rate, 1) : null;
}

function maximumValue(values) {
  let maximum = 0;
  for (const value of values) if (value > maximum) maximum = value;
  return maximum;
}

export function taskDifficulty(samplesByGroup, thresholds) {
  return Object.fromEntries(Object.entries(TASK_GROUPS).map(([stat, groups]) => {
    const samples = groups.flatMap((group) => samplesByGroup[group] ?? []);
    const values = samples.map((sample) => sample[stat]);
    return [stat, {
      eligibleRoleGroups:groups,
      playerMatchSamples:samples.length,
      eventsPerAppearance:rounded(mean(values), 4),
      zeroEventAppearanceRatePercent:rounded(values.filter((value) => value === 0).length / Math.max(1, values.length) * 100, 2),
      perAppearanceDistribution:{ p50:percentile(values,.5), p75:percentile(values,.75), p90:percentile(values,.9), p95:percentile(values,.95), maximum:maximumValue(values) },
      milestoneEstimatedAppearances:Object.fromEntries((thresholds[stat] ?? []).map((target) => [target, estimatedAppearances(samples, stat, target)])),
    }];
  }));
}

export function taskDifficultyByRole(samplesByGroup, thresholdsByRole = {}) {
  return Object.fromEntries(["GK", "DEF", "MID", "ATT"].map((group) => {
    const samples = samplesByGroup[group] ?? [];
    const thresholds = thresholdsByRole[group] ?? {};
    return [group, Object.fromEntries(Object.entries(thresholds).map(([stat, milestones]) => {
      const values = samples.map((sample) => Number(sample[stat] ?? 0));
      return [stat, {
        playerMatchSamples:samples.length,
        eventsPerAppearance:rounded(mean(values), 4),
        zeroEventAppearanceRatePercent:rounded(values.filter((value) => value === 0).length / Math.max(1, values.length) * 100, 2),
        perAppearanceDistribution:{ p50:percentile(values,.5), p75:percentile(values,.75), p90:percentile(values,.9), p95:percentile(values,.95), maximum:maximumValue(values) },
        milestoneEstimatedAppearances:Object.fromEntries(milestones.map((target) => [target, estimatedAppearances(samples, stat, target)])),
      }];
    }))];
  }));
}

function summarizeDistribution(values) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(values).sort(([left],[right]) => Number(left) - Number(right)).map(([key, value]) => [key, { count:value, percent:rounded(value / total * 100, 2) }]));
}

function summarizeAggregate(aggregate, config) {
  const teamMatches = aggregate.matches * 2;
  const positionStarts = Object.values(aggregate.positionFitStarts).reduce((sum, value) => sum + value, 0) || 1;
  const xSamples = Object.fromEntries(Object.entries(aggregate.playerSamples).map(([group, samples]) => [group, samples.filter((sample) => sample.xPlayer)]));
  return {
    matches:aggregate.matches,
    overallRhythm:{ goalsPerMatch:rounded(aggregate.goals / aggregate.matches), shotsPerMatch:rounded(aggregate.shots / aggregate.matches), shotsOnTargetPerMatch:rounded(aggregate.shotsOnTarget / aggregate.matches), xgPerMatch:rounded(aggregate.xg / aggregate.matches), foulsPerMatch:rounded(aggregate.fouls / aggregate.matches), yellowCardsPerMatch:rounded(aggregate.yellowCards / aggregate.matches), redCardsPerMatch:rounded(aggregate.redCards / aggregate.matches), cornersPerMatch:rounded(aggregate.corners / aggregate.matches), injuriesPerMatch:rounded(aggregate.injuries / aggregate.matches), drawRatePercent:rounded(aggregate.draws / aggregate.matches * 100, 2), dynamicPositionAdjustmentMatchRatePercent:rounded(aggregate.dynamicPositionMatches / aggregate.matches * 100, 2) },
    ecosystemComposition:{ teamArchetypes:Object.fromEntries(Object.entries(aggregate.archetypes).map(([key,value]) => [key,{ teamSamples:value.teamSamples, winRatePercent:rounded(value.wins / value.teamSamples * 100,2), drawRatePercent:rounded(value.draws / value.teamSamples * 100,2), goalsForPerMatch:rounded(value.goalsFor / value.teamSamples), goalsAgainstPerMatch:rounded(value.goalsAgainst / value.teamSamples) }])), upgradeLevels:summarizeDistribution(aggregate.upgradeLevels), activeTraitCounts:summarizeDistribution(aggregate.traitCounts), startingLegendCounts:summarizeDistribution(aggregate.legendCounts), activeBondCounts:aggregate.bondCounts, xPlayerTeamSampleRatePercent:rounded(aggregate.xMatches / teamMatches * 100,2) },
    lineupPositionIntegrity:{
      startingPlayerSamples:positionStarts,
      fitDistribution:Object.fromEntries(Object.entries(aggregate.positionFitStarts).map(([key, value]) => [key, { count:value, percent:rounded(value / positionStarts * 100, 2) }])),
      outOfRoleGroupRatePercent:rounded(aggregate.positionFitStarts.outOfGroup / positionStarts * 100, 2),
    },
    xTaskDifficulty:taskDifficulty(xSamples, config.taskThresholds),
    xTaskDifficultyByRole:taskDifficultyByRole(xSamples, config.taskThresholdsByRole),
    allPlayerPositionBaseline:taskDifficulty(aggregate.playerSamples, config.taskThresholds),
    allPlayerTaskBaselineByRole:taskDifficultyByRole(aggregate.playerSamples, config.taskThresholdsByRole),
  };
}

function emptyOutcome() {
  return { matches:0, wins:0, draws:0, losses:0, goalsFor:0, goalsAgainst:0, shotsFor:0, shotsAgainst:0 };
}

function addOutcome(outcome, report, subjectIndex) {
  outcome.matches += 1;
  outcome.wins += Number(report.score[subjectIndex] > report.score[1-subjectIndex]);
  outcome.draws += Number(report.score[subjectIndex] === report.score[1-subjectIndex]);
  outcome.losses += Number(report.score[subjectIndex] < report.score[1-subjectIndex]);
  outcome.goalsFor += report.score[subjectIndex];
  outcome.goalsAgainst += report.score[1-subjectIndex];
  outcome.shotsFor += report.teams[subjectIndex].stats.shots;
  outcome.shotsAgainst += report.teams[1-subjectIndex].stats.shots;
}

function outcomeSummary(outcome) {
  const matches = Math.max(1, outcome.matches);
  return { matches:outcome.matches, winRatePercent:rounded(outcome.wins/matches*100,2), drawRatePercent:rounded(outcome.draws/matches*100,2), lossRatePercent:rounded(outcome.losses/matches*100,2), goalsForPerMatch:rounded(outcome.goalsFor/matches), goalsAgainstPerMatch:rounded(outcome.goalsAgainst/matches), shotsForPerMatch:rounded(outcome.shotsFor/matches), shotsAgainstPerMatch:rounded(outcome.shotsAgainst/matches) };
}

function playConfigured(seed, subjectOptions, controlOptions, index, weather = null, referee = null, subjectArchetype = "enhanced", controlArchetype = "enhanced") {
  const subjectHome = index % 2 === 0;
  const subject = buildSeat(seed, "mirror", subjectArchetype, subjectOptions);
  const control = buildSeat(seed, "mirror", controlArchetype, controlOptions);
  const seats = subjectHome ? [subject, control] : [control, subject];
  const report = settle(createVersusMatch(seats, { now:0, seed, competitionMode:"league", regulationOnly:true, recordEvents:true, ...(weather ? { weather } : {}), ...(referee ? { referee } : {}) }));
  return { report, subjectIndex:subjectHome ? 0 : 1 };
}

function runMatrix(seed, rowValues, columnValues, matchesPerCell, optionsForCell, labels = {}, progress = () => {}, phase = "矩阵实验") {
  return Object.fromEntries(rowValues.map((row) => [row, Object.fromEntries(columnValues.map((column) => {
    const outcome = emptyOutcome();
    for (let index = 0; index < matchesPerCell; index += 1) {
      const matchSeed = `${seed}:${row}:${column}:${index}`;
      const configured = optionsForCell(row, column, index);
      const { report, subjectIndex } = playConfigured(matchSeed, configured.subject, configured.control, index, configured.weather, configured.referee, configured.subjectArchetype, configured.controlArchetype);
      addOutcome(outcome, report, subjectIndex);
      progress(phase);
    }
    return [column, { ...outcomeSummary(outcome), rowLabel:labels[row] ?? row, columnLabel:labels[column] ?? column }];
  }))]));
}

function runTacticalCombinationStudy(seed, formationNames, matchesPerCell, progress = () => {}) {
  const sampleSize = Number(matchesPerCell ?? 0);
  return Object.fromEntries(formationNames.map((formation) => [formation, Object.fromEntries(TACTICS.map((tactic) => [tactic, Object.fromEntries(STYLES.map((style) => {
    const outcome = emptyOutcome();
    for (let index = 0; index < sampleSize; index += 1) {
      const matchSeed = `${seed}:${formation}:${tactic}:${style}:${index}`;
      const { report, subjectIndex } = playConfigured(matchSeed,
        { formation, tactic, style, staticPlans:true },
        { formation, tactic:"balanced", style:"possession", staticPlans:true },
        index);
      addOutcome(outcome, report, subjectIndex);
      progress("tactical combinations");
    }
    return [style, { ...outcomeSummary(outcome), baseline:"same formation + balanced + possession" }];
  }))]))]));
}

function runXTaskStudy(config, progress = () => {}) {
  const matchesPerRole = Number(config.experiments.xTaskMatchesPerRole);
  const aggregate = emptyAggregate();
  for (const group of ["GK","DEF","MID","ATT"]) for (let index = 0; index < matchesPerRole; index += 1) {
    const seed = `${config.seed}:x-task:${group}:${index}`;
    const xHome = index % 2 === 0;
    const xSeat = buildSeat(seed, "x", "xLed", { xRoleGroup:group });
    const control = buildSeat(seed, "control", weightedPick(seededRandom(`${seed}:control`), config.ecosystemWeights));
    const seats = xHome ? [xSeat, control] : [control, xSeat];
    const report = settle(createVersusMatch(seats, { now:0, seed, competitionMode:"league", regulationOnly:true, recordEvents:true }));
    addMatch(aggregate, report, seats, xHome ? ["xLed","field"] : ["field","xLed"]);
    progress(`X任务研究/${group}`);
  }
  const xSamples = Object.fromEntries(Object.entries(aggregate.playerSamples).map(([group,samples]) => [group,samples.filter((sample) => sample.xPlayer)]));
  return {
    matches:aggregate.matches,
    matchesPerRole,
    taskDifficulty:taskDifficulty(xSamples, config.taskThresholds),
    taskDifficultyByRole:taskDifficultyByRole(xSamples, config.taskThresholdsByRole),
    sampleCountsByRole:Object.fromEntries(Object.entries(xSamples).map(([group,samples]) => [group,samples.length])),
  };
}

function experimentMatchCount(config) {
  const e = config.experiments;
  return config.matches
    + 4 * e.xTaskMatchesPerRole
    + Object.keys(FORMATIONS).length ** 2 * e.formationMatchesPerCell
    + TACTICS.length ** 2 * e.tacticMatchesPerCell
    + STYLES.length ** 2 * e.styleMatchesPerCell
    + Object.keys(FORMATIONS).length * TACTICS.length * STYLES.length * Number(e.tacticalCombinationMatchesPerCell ?? 0)
    + 9 ** 2 * e.upgradeMatchesPerCell
    + 4 ** 2 * e.traitMatchesPerCell
    + 6 ** 2 * e.legendMatchesPerCell
    + e.dynamicPlanMatches
    + 4 * STYLES.length * e.weatherStyleMatchesPerCell
    + 3 * STYLES.length * e.refereeStyleMatchesPerCell;
}

export async function runS4BalanceReport(config, options = {}) {
  const progress = options.progress ?? (() => {});
  const aggregate = emptyAggregate();
  const rawMatchSamples = [];
  const matchStart = Number(config.matchStart ?? 0);
  const matchEnd = matchStart + Number(config.matches ?? 0);
  const rawSampleStart = Number(config.rawSampleStart ?? 0);
  const rawSampleEnd = rawSampleStart + Number(config.rawMatchSampleLimit ?? 0);
  for (let index = matchStart; index < matchEnd; index += 1) {
    const seed = `${config.seed}:ecosystem:${index}`;
    const rng = seededRandom(seed);
    const archetypes = [weightedPick(rng, config.ecosystemWeights), weightedPick(rng, config.ecosystemWeights)];
    const seats = archetypes.map((archetype, side) => buildSeat(seed, side === 0 ? "home" : "away", archetype));
    const report = settle(createVersusMatch(seats, { now:0, seed, competitionMode:"league", regulationOnly:true, recordEvents:true }));
    addMatch(aggregate, report, seats, archetypes);
    if (index >= rawSampleStart && index < rawSampleEnd) rawMatchSamples.push({ seed, archetypes, score:report.score, weather:report.weather.key, referee:report.referee.key, teams:report.teams.map((team, teamIndex) => ({ name:team.name, formation:team.formation, openingFormation:inferElevenBoardRoles(seats[teamIndex].players.map((player) => ({ id:player.id, position:seats[teamIndex].positions[player.id] }))), startingBonds:evaluateS4LineupBonds(seats[teamIndex].players, seats[teamIndex].bondCatalog, { roles:inferElevenBoardRoles(seats[teamIndex].players.map((player) => ({ id:player.id, position:seats[teamIndex].positions[player.id] })))}).map((bond) => ({ type:bond.type, name:bond.name, count:bond.count, bonus:bond.bonus })), nationalityBond:seats[teamIndex].nationalityBond ?? null, activePlan:team.activePlan, inMatchPositionAdjustment:team.inMatchPositionAdjustment, stats:team.stats, players:team.players.map((player) => {
      const source = seats[teamIndex].players.find((entry) => entry.id === player.id);
      return { id:player.id, name:player.name, grade:player.grade, naturalRole:source?.role, secondaryRole:source?.secondaryRole ?? null, assignedRole:player.assignedRole, startingPositionFit:startingPositionFit(source, player.assignedRole), overall:player.overall, upgradeLevel:player.upgradeLevel, traits:player.traits, stats:player.stats };
    }) })), importantEvents:report.importantEvents });
    progress("生态样本");
  }
  const experiments = config.experiments ?? { xTaskMatchesPerRole:1, formationMatchesPerCell:1, tacticMatchesPerCell:1, styleMatchesPerCell:1, upgradeMatchesPerCell:1, traitMatchesPerCell:1, legendMatchesPerCell:1, dynamicPlanMatches:1, weatherStyleMatchesPerCell:1, refereeStyleMatchesPerCell:1 };
  const formationNames = Object.keys(FORMATIONS);
  const upgradeLevels = Array.from({ length:9 }, (_, index) => index);
  const traitCounts = [0,1,2,3];
  const legendCounts = [0,1,2,3,4,5];
  const weatherKeys = ["sunny","rain","storm","snow"];
  const refereeKeys = ["lenient","standard","strict"];
  const dynamicOutcome = emptyOutcome();
  for (let index = 0; index < experiments.dynamicPlanMatches; index += 1) {
    const seed = `${config.seed}:dynamic:${index}`;
    const { report, subjectIndex } = playConfigured(seed, {}, { staticPlans:true }, index);
    addOutcome(dynamicOutcome, report, subjectIndex);
    progress("动态战术");
  }
  const experimentalResults = {
    xTaskStudy:runXTaskStudy({ ...config, experiments }, progress),
    formationMatrix:runMatrix(`${config.seed}:formation`, formationNames, formationNames, experiments.formationMatchesPerCell, (subject, control) => ({ subject:{ formation:subject, tactic:"balanced", style:"possession", staticPlans:true }, control:{ formation:control, tactic:"balanced", style:"possession", staticPlans:true } }), {}, progress, "阵型克制矩阵"),
    tacticMatrix:runMatrix(`${config.seed}:tactic`, TACTICS, TACTICS, experiments.tacticMatchesPerCell, (subject, control) => ({ subject:{ tactic:subject }, control:{ tactic:control } }), {}, progress, "战术矩阵"),
    styleMatrix:runMatrix(`${config.seed}:style`, STYLES, STYLES, experiments.styleMatchesPerCell, (subject, control) => ({ subject:{ style:subject }, control:{ style:control } }), {}, progress, "风格矩阵"),
    tacticalCombinationStudy:runTacticalCombinationStudy(`${config.seed}:tactical-combinations`, formationNames, experiments.tacticalCombinationMatchesPerCell, progress),
    upgradeMatrix:runMatrix(`${config.seed}:upgrade`, upgradeLevels, upgradeLevels, experiments.upgradeMatchesPerCell, (subject, control) => ({ subject:{ upgradeLevel:subject, traitCount:0 }, control:{ upgradeLevel:control, traitCount:0 } }), {}, progress, "强化矩阵"),
    traitCountMatrix:runMatrix(`${config.seed}:traits`, traitCounts, traitCounts, experiments.traitMatchesPerCell, (subject, control) => ({ subject:{ upgradeLevel:8, traitCount:subject }, control:{ upgradeLevel:8, traitCount:control } }), {}, progress, "特性矩阵"),
    legendDensityMatrix:runMatrix(`${config.seed}:legends`, legendCounts, legendCounts, experiments.legendMatchesPerCell, (subject, control) => ({ subject:{ legendCount:subject, upgradeLevel:0, traitCount:0 }, control:{ legendCount:control, upgradeLevel:0, traitCount:0 } }), {}, progress, "传奇矩阵"),
    dynamicPlansVsStatic:outcomeSummary(dynamicOutcome),
    weatherStyleMatrix:runMatrix(`${config.seed}:weather-style`, weatherKeys, STYLES, experiments.weatherStyleMatchesPerCell, (weather, style) => ({ subject:{ style }, control:{ style:"possession" }, weather }), {}, progress, "天气矩阵"),
    refereeStyleMatrix:runMatrix(`${config.seed}:referee-style`, refereeKeys, STYLES, experiments.refereeStyleMatchesPerCell, (referee, style) => ({ subject:{ style }, control:{ style:"possession" }, referee }), {}, progress, "裁判矩阵"),
  };
  const totalMatches = experimentMatchCount({ ...config, experiments });
  const result = {
    schemaVersion:"yellowdogs-s4-balance-v5",
    outputVersion:config.outputVersion,
    seed:config.seed,
    reproducibility:{ deterministic:true, seedStrategy:"root seed + scenario + match index", command:"npm run balance:ydl:s4", generatedAtExcludedFromDeterministicPayload:true },
    simulationScope:{ competitionMode:"league", matchEngine:"current 11v11 versus engine", matches:totalMatches, includes:["S4 enhancement levels 0-8 full matrix","0-3 active YDL traits full matrix","0-5 position-suitable legends per starting XI full matrix","X player task study split by four role groups and role-specific milestones","controlled formation counter matrix with mirrored home/away fixtures","tactic/style head-to-head matrices","formation x tactic x style combinations against same-formation balanced-possession baselines","three tactical position presets","score-driven tactic/style/position switching","weather and referee cross matrices","fine board-position role recognition","starting lineup position-integrity audit"], legendNote:"正式联赛模式按当前规则关闭旧传奇专属能力；传奇按主位置、次位置与同位置组优先匹配阵型槽位，并保留S级基础数值、强化和特性影响。", interceptionMetricNote:"当前引擎没有独立interceptions字段；任务难度中的tackles是抢断与拦截的合并代理口径。" },
    config:{ matches:config.matches, totalMatches, ecosystemWeights:config.ecosystemWeights, taskThresholds:config.taskThresholds, taskThresholdsByRole:config.taskThresholdsByRole, experiments },
    results:summarizeAggregate(aggregate, config),
    experiments:experimentalResults,
    rawMatchSamples,
  };
  if (options.includeInternalAggregate) result.internalAggregate = aggregate;
  return result;
}

export function mergeS4BalanceAggregates(target, source) {
  for (const key of ["matches", "goals", "shots", "shotsOnTarget", "xg", "fouls", "yellowCards", "redCards", "corners", "injuries", "draws", "dynamicPositionMatches", "xMatches"]) target[key] = Number(target[key] ?? 0) + Number(source[key] ?? 0);
  for (const group of Object.keys(target.playerSamples)) target.playerSamples[group].push(...(source.playerSamples?.[group] ?? []));
  for (const [name, value] of Object.entries(source.archetypes ?? {})) {
    const current = target.archetypes[name] ??= { teamSamples:0, wins:0, draws:0, goalsFor:0, goalsAgainst:0 };
    for (const key of Object.keys(current)) current[key] = Number(current[key] ?? 0) + Number(value[key] ?? 0);
  }
  for (const key of ["upgradeLevels", "traitCounts", "legendCounts", "bondCounts", "positionFitStarts"]) {
    for (const [name, value] of Object.entries(source[key] ?? {})) target[key][name] = Number(target[key][name] ?? 0) + Number(value ?? 0);
  }
  return target;
}

export function summarizeS4BalanceAggregate(aggregate, config) {
  return summarizeAggregate(aggregate, config);
}

export function buildS4BalanceReportFromAggregate(config, aggregate, experimentalResults, rawMatchSamples = []) {
  const experiments = config.experiments ?? {};
  const totalMatches = experimentMatchCount({ ...config, experiments });
  return {
    schemaVersion:"yellowdogs-s4-balance-v5",
    outputVersion:config.outputVersion,
    seed:config.seed,
    reproducibility:{ deterministic:true, seedStrategy:"root seed + scenario + match index", command:"npm run balance:ydl:s4", generatedAtExcludedFromDeterministicPayload:true },
    simulationScope:{ competitionMode:"league", matchEngine:"current 11v11 versus engine", matches:totalMatches, includes:["parallel-safe independent seeded match shards","S4 enhancement levels 0-8 full matrix","0-3 active YDL traits full matrix","0-5 position-suitable legends per starting XI full matrix","X player task study split by four role groups and role-specific milestones","controlled formation counter matrix with mirrored home/away fixtures","tactic/style head-to-head matrices","formation x tactic x style combinations against same-formation balanced-possession baselines","three tactical position presets","score-driven tactic/style/position switching","weather and referee cross matrices","fine board-position role recognition","starting lineup position-integrity audit"], legendNote:"正式联赛模式按当前规则关闭旧传奇专属能力；传奇按主位置、次位置与同位置组优先匹配阵型槽位，并保留S级基础数值、强化和特性影响。", interceptionMetricNote:"当前引擎没有独立interceptions字段；任务难度中的tackles是抢断与拦截的合并代理口径。" },
    config:{ matches:config.matches, totalMatches, ecosystemWeights:config.ecosystemWeights, taskThresholds:config.taskThresholds, taskThresholdsByRole:config.taskThresholdsByRole, experiments },
    results:summarizeAggregate(aggregate, config),
    experiments:experimentalResults,
    rawMatchSamples,
  };
}

export function splitS4BalanceReportOutput(data, rawSamplesFileName) {
  const rawMatchSamples = Array.isArray(data.rawMatchSamples) ? data.rawMatchSamples : [];
  const mainReport = {
    ...data,
    rawMatchSamples:[],
    outputProtection:{
      statisticalMatchesPreserved:Number(data.simulationScope?.matches ?? data.config?.totalMatches ?? data.results?.matches ?? 0),
      aggregateAndMatrixResultsPreserved:true,
      rawMatchSamplesSeparated:true,
      rawMatchSampleCount:rawMatchSamples.length,
      rawMatchSamplesFile:rawSamplesFileName,
    },
  };
  const rawReport = {
    schemaVersion:data.schemaVersion,
    outputVersion:data.outputVersion,
    seed:data.seed,
    statisticalMatches:Number(data.simulationScope?.matches ?? data.config?.totalMatches ?? data.results?.matches ?? 0),
    note:"Diagnostic raw samples only; aggregate and matrix accuracy is stored in the main report.",
    rawMatchSamples,
  };
  return { mainReport, rawReport };
}
function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "计算中";
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function terminalProgress(total) {
  const state = { current:0, total:Math.max(1, total), startedAt:Date.now(), lastRenderedAt:0, lastBucket:-1, lastLineLength:0 };
  const render = (phase, force = false) => {
    const now = Date.now();
    const ratio = Math.min(1, state.current / state.total);
    const bucket = Math.floor(ratio * 20);
    if (!force && (process.stdout.isTTY ? now - state.lastRenderedAt < 250 : bucket === state.lastBucket)) return;
    const barWidth = 28;
    const filled = Math.round(ratio * barWidth);
    const elapsed = now - state.startedAt;
    const remaining = state.current ? elapsed / state.current * (state.total - state.current) : Number.NaN;
    const line = `模拟进度 [${"=".repeat(filled)}${"-".repeat(barWidth - filled)}] ${(ratio * 100).toFixed(1).padStart(5)}% ${state.current}/${state.total} | ${phase} | 已用 ${formatDuration(elapsed)} | 预计剩余 ${formatDuration(remaining)}`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line.padEnd(state.lastLineLength, " ")}`);
      state.lastLineLength = Math.max(state.lastLineLength, line.length);
    } else console.log(line);
    state.lastRenderedAt = now;
    state.lastBucket = bucket;
  };
  render("准备中", true);
  return {
    tick(phase) {
      state.current = Math.min(state.total, state.current + 1);
      render(phase, state.current === state.total);
    },
    finish() {
      state.current = state.total;
      render("完成", true);
      if (process.stdout.isTTY) process.stdout.write("\n");
    },
  };
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const experiments = config.experiments ?? { xTaskMatchesPerRole:1, formationMatchesPerCell:1, tacticMatchesPerCell:1, styleMatchesPerCell:1, upgradeMatchesPerCell:1, traitMatchesPerCell:1, legendMatchesPerCell:1, dynamicPlanMatches:1, weatherStyleMatchesPerCell:1, refereeStyleMatchesPerCell:1 };
  const progress = terminalProgress(experimentMatchCount({ ...config, experiments }));
  const data = await runS4BalanceReport(config, { progress:(phase) => progress.tick(phase) });
  const outputPath = outputPathArgument ? path.resolve(outputPathArgument) : path.resolve(here, `../outputs/S4赛季比赛模拟-${config.outputVersion}.json`);
  await mkdir(path.dirname(outputPath), { recursive:true });
  const rawSamplesPath = outputPath.replace(/\.json$/i, "-raw-samples.json");
  const separated = splitS4BalanceReportOutput(data, path.basename(rawSamplesPath));
  const mainSerialized = `${JSON.stringify(separated.mainReport, null, 2)}\n`;
  await writeFile(outputPath, mainSerialized, "utf8");
  progress.finish();
  console.log(`S4 balance core JSON generated: ${outputPath} (${(Buffer.byteLength(mainSerialized) / 1024 / 1024).toFixed(2)} MB)`);
  try {
    const rawSerialized = `${JSON.stringify(separated.rawReport, null, 2)}\n`;
    await writeFile(rawSamplesPath, rawSerialized, "utf8");
    console.log(`S4 diagnostic samples generated: ${rawSamplesPath} (${(Buffer.byteLength(rawSerialized) / 1024 / 1024).toFixed(2)} MB)`);
  } catch (error) {
    console.warn(`Core balance result is safe, but diagnostic sample output failed: ${error.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
