import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { roleGroup } from "../game/public/schema.js";
import { EXTRA_DURATION_MS, HALFTIME_ADJUSTMENT_MS, PENALTY_KICK_INTERVAL_MS, REGULAR_DURATION_MS, advanceVersusMatch, createVersusMatch } from "./match-engine.js";
import { REAL_PLAYER_POOLS, REAL_PLAYERS } from "./player-pool.js";
import { VERSUS_TRAIT_CARDS } from "./trait-pool.js";
import { formationStructureProfile, inferElevenBoardRoles } from "./rules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(here, "../outputs");
const configArgument = process.argv.find((argument) => argument.startsWith("--config="));
const balanceConfigPath = configArgument ? path.resolve(here, configArgument.slice("--config=".length)) : path.join(here, "balance-config.json");
const balanceConfig = JSON.parse(await readFile(balanceConfigPath, "utf8"));
const outputVersion = balanceConfig.outputVersion ?? "v5";
const markdownPath = path.join(outputDirectory, `11人制对战-综合平衡报告-${outputVersion}.md`);
const jsonPath = path.join(outputDirectory, `11人制对战-综合平衡数据-${outputVersion}.json`);
const TACTICS = {
  allOutAttack: "全力进攻",
  positive: "积极进攻",
  balanced: "攻守平衡",
  defensive: "防守反击",
  parkBus: "全力防守",
};
const WEATHER = { sunny: "晴朗", rain: "雨天", storm: "雷暴", snow: "雪天" };
const REFEREES = { lenient: "宽松", standard: "标准", strict: "严格" };
const STYLES = {
  possession: "密集短传",
  longBall: "长传冲吊",
  wingPlay: "两翼齐飞",
  counterAttack: "防守反击",
  highPress: "高位压迫",
  lowBlock: "摆大巴",
  roughPlay: "伐木",
};
const FOCUSES = {
  balanced: "均衡",
  left: "左路",
  center: "中路",
  right: "右路",
};
const STANDARD_FORMATIONS = {
  "4-3-3": [1, 4, 3, 3],
  "4-4-2": [1, 4, 4, 2],
  "3-5-2": [1, 3, 5, 2],
  "5-3-2": [1, 5, 3, 2],
  "4-2-4": [1, 4, 2, 4],
  "3-4-3": [1, 3, 4, 3],
  "3-1-2-1-3": { counts: [1, 3, 4, 3], midfieldLines: [1, 2, 1] },
  "3-4-3（边翼卫）": { counts: [1, 5, 2, 3], wingbacks: true },
  "2-5-3": [1, 2, 5, 3],
  "4-5-1": [1, 4, 5, 1],
  "4-2-3-1": { counts: [1, 4, 5, 1], midfieldLines: [2, 3] },
  "5-4-1": [1, 5, 4, 1],
  "5-2-2-1": { counts: [1, 5, 4, 1], midfieldLines: [2, 2] },
  "4-1-4-1": { counts: [1, 4, 5, 1], midfieldLines: [1, 4] },
  "4-4-1-1": { counts: [1, 4, 5, 1], midfieldLines: [4, 1] },
  "3-4-2-1": { counts: [1, 3, 6, 1], midfieldLines: [4, 2] },
  "4-3-2-1": { counts: [1, 4, 5, 1], midfieldLines: [3, 2] },
  "4-1-2-1-2": { counts: [1, 4, 4, 2], midfieldLines: [1, 2, 1] },
};
const ABNORMAL_FORMATIONS = {
  "2-3-5（双后卫）": { counts: [1, 2, 3, 5] },
  "1-4-5（单后卫）": { counts: [1, 1, 4, 5] },
  "4-3-3（前锋守门）": { counts: [1, 4, 3, 3], swapKeeper: true },
  "2GK-2-3-4（双门将）": { counts: [2, 2, 3, 4] },
};

function hash(value) {
  let state = 2166136261;
  for (const character of String(value)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function traitIds(player, salt) {
  const group = roleGroup(player.role);
  const compatible = VERSUS_TRAIT_CARDS.filter((trait) => {
    const eligible = trait.eligibleRoleGroups ?? [];
    return eligible.includes("ANY") || eligible.includes(group) || eligible.includes(player.role);
  });
  const start = hash(`${salt}:${player.id}`) % compatible.length;
  return [compatible[start]].filter(Boolean).map((trait) => trait.id);
}

function takePlayers(pool, count, offset, salt) {
  return Array.from({ length: count }, (_, index) => {
    const player = pool[(offset + index) % pool.length];
    return { ...player, traits: traitIds(player, salt) };
  });
}

function linePositions(players, y) {
  return Object.fromEntries(players.map((player, index) => [player.id, {
    x: Math.round(((index + 1) / (players.length + 1)) * 76 + 12),
    y,
  }]));
}

function layeredMidfieldPositions(players, lineCounts) {
  const positions = {};
  let offset = 0;
  lineCounts.forEach((count, index) => {
    const y = lineCounts.length === 2 ? [52, 37][index] : 57 - index * 12;
    Object.assign(positions, linePositions(players.slice(offset, offset + count), y));
    offset += count;
  });
  return positions;
}

function defenderPositions(players, specification) {
  if (!specification.wingbacks || players.length < 3) return linePositions(players, 69);
  const centralDefenders = players.slice(0, -2);
  const [leftWingback, rightWingback] = players.slice(-2);
  return {
    ...linePositions(centralDefenders, 69),
    [leftWingback.id]: { x:18, y:57 },
    [rightWingback.id]: { x:82, y:57 },
  };
}

function buildSeat(name, specification, tactic, offset, salt, style = "possession", attackFocus = "balanced", defenseFocus = "balanced") {
  const [goalkeepers, defenders, midfielders, attackers] = specification.counts ?? specification;
  const groups = {
    GK: takePlayers(REAL_PLAYER_POOLS.GK, goalkeepers, offset, salt),
    DEF: takePlayers(REAL_PLAYER_POOLS.DEF, defenders, offset, salt),
    MID: takePlayers(REAL_PLAYER_POOLS.MID, midfielders, offset, salt),
    ATT: takePlayers(REAL_PLAYER_POOLS.ATT, attackers, offset, salt),
  };
  const players = [...groups.GK, ...groups.DEF, ...groups.MID, ...groups.ATT];
  const positions = {
    ...linePositions(groups.GK, 90),
    ...defenderPositions(groups.DEF, specification),
    ...(specification.midfieldLines
      ? layeredMidfieldPositions(groups.MID, specification.midfieldLines)
      : linePositions(groups.MID, 45)),
    ...linePositions(groups.ATT, 19),
  };
  if (specification.swapKeeper) {
    const keeper = groups.GK[0];
    const striker = groups.ATT.at(-1);
    [positions[keeper.id], positions[striker.id]] = [positions[striker.id], positions[keeper.id]];
  }
  return { name, players, positions, tactic, style, attackFocus, defenseFocus };
}

function seededFormationSlots(specification) {
  const [goalkeepers, defenders, midfielders, attackers] = specification.counts ?? specification;
  const groups = {
    GK: Array.from({ length: goalkeepers }, (_, index) => ({ id: `slot-gk-${index}` })),
    DEF: Array.from({ length: defenders }, (_, index) => ({ id: `slot-def-${index}` })),
    MID: Array.from({ length: midfielders }, (_, index) => ({ id: `slot-mid-${index}` })),
    ATT: Array.from({ length: attackers }, (_, index) => ({ id: `slot-att-${index}` })),
  };
  const slots = [...groups.GK, ...groups.DEF, ...groups.MID, ...groups.ATT];
  const positions = {
    ...linePositions(groups.GK, 90),
    ...defenderPositions(groups.DEF, specification),
    ...(specification.midfieldLines ? layeredMidfieldPositions(groups.MID, specification.midfieldLines) : linePositions(groups.MID, 45)),
    ...linePositions(groups.ATT, 19),
  };
  const roles = inferElevenBoardRoles(slots.map((slot) => ({ id: slot.id, position: positions[slot.id] })));
  return slots.map((slot) => ({ id: slot.id, position: positions[slot.id], role: roles[slot.id] }));
}

function seededDraftPlayer(role, used, seed, choiceCount = 3) {
  const available = REAL_PLAYERS.filter((player) => !used.has(player.id));
  const wingbackFullbackRole = role === "LWB" ? "LB" : role === "RWB" ? "RB" : null;
  const tiers = [
    available.filter((player) => player.role === role),
    available.filter((player) => player.secondaryRole === role),
    ...(wingbackFullbackRole ? [available.filter((player) => [player.role, player.secondaryRole].includes(wingbackFullbackRole))] : []),
    available.filter((player) => roleGroup(player.role) === roleGroup(role)),
    available,
  ];
  const candidates = tiers.find((tier) => tier.length) ?? available;
  const offered = [...candidates]
    .sort((left, right) => hash(`${seed}:${left.id}`) - hash(`${seed}:${right.id}`))
    .slice(0, Math.max(1, choiceCount));
  return offered.sort((left, right) => right.overall - left.overall || hash(`${seed}:pick:${left.id}`) - hash(`${seed}:pick:${right.id}`))[0];
}

function buildSeededFormationSeat(name, formationName, tactic, style, seed, attackFocus = "balanced", defenseFocus = "balanced", choiceCount = 3) {
  const slots = seededFormationSlots(STANDARD_FORMATIONS[formationName]);
  const used = new Set();
  const players = [];
  const positions = {};
  slots.forEach((slot, index) => {
    const source = seededDraftPlayer(slot.role, used, `${seed}:${formationName}:${slot.role}:${index}`, choiceCount);
    used.add(source.id);
    players.push({ ...source, attributes: { ...source.attributes }, traits: traitIds(source, `${seed}:trait:${index}`) });
    positions[source.id] = { ...slot.position };
  });
  return { name, players, positions, tactic, style, attackFocus, defenseFocus, formationName };
}

function midfieldShapeKey(formationName) {
  const specification = STANDARD_FORMATIONS[formationName];
  if (specification.wingbacks) return "wingback-system";
  const lineCount = specification.midfieldLines?.length ?? 1;
  return lineCount > 1 ? `layered-${lineCount}` : "flat";
}

const ROLE_SLOTS_433 = [
  ["GK", 50, 90], ["LB", 16, 69], ["CB", 38, 69], ["CB", 62, 69], ["RB", 84, 69],
  ["LM", 20, 45], ["DM", 50, 45], ["RM", 80, 45], ["LW", 18, 19], ["ST", 50, 19], ["RW", 82, 19],
];

function positionCandidates(role, mode) {
  if (role === "GK") return mode === "forwardGoalkeeper"
    ? REAL_PLAYER_POOLS.ATT.filter((player) => player.role === "ST")
    : REAL_PLAYER_POOLS.GK;
  return REAL_PLAYER_POOLS[roleGroup(role)].filter((player) => player.role === role);
}

const ALTERNATE_ROLES = { LB: "CB", CB: "RB", RB: "CB", LM: "DM", DM: "RM", RM: "DM", LW: "ST", ST: "RW", RW: "ST" };
const OTHER_ROLES = { LB: "RB", CB: "LB", RB: "LB", LM: "RM", DM: "LM", RM: "LM", LW: "RW", ST: "LW", RW: "LW" };

function buildPositionSeat(name, mode, tactic, style, offset, salt, transform = (player) => player, attackFocus = "balanced", defenseFocus = "balanced") {
  const used = new Set();
  const players = [];
  const positions = {};
  ROLE_SLOTS_433.forEach(([role, x, y], index) => {
    let candidates = positionCandidates(role, mode).filter((player) => !used.has(player.id));
    if (!candidates.length) candidates = REAL_PLAYERS.filter((player) => !used.has(player.id) && roleGroup(player.role) === roleGroup(role));
    const source = candidates[(offset + index + hash(`${salt}:${role}:${index}`)) % candidates.length];
    const positionAdjusted = mode === "secondary" && role !== "GK"
      ? { ...source, role: ALTERNATE_ROLES[role], secondaryRole: role, pool: roleGroup(ALTERNATE_ROLES[role]) }
      : mode === "unfamiliar" && role !== "GK"
        ? { ...source, role: ALTERNATE_ROLES[role], secondaryRole: OTHER_ROLES[role], pool: roleGroup(ALTERNATE_ROLES[role]) }
        : source;
    const player = { ...transform({ ...positionAdjusted, attributes: { ...positionAdjusted.attributes } }, role), traits: traitIds(positionAdjusted, `${salt}:${index}`) };
    used.add(source.id);
    players.push(player);
    positions[player.id] = { x, y };
  });
  return { name, players, positions, tactic, style, attackFocus, defenseFocus };
}

function withAttributeDelta(delta) {
  return (player) => ({
    ...player,
    attributes: Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [key, Math.max(1, Math.min(99, value + delta))])),
  });
}

function withPhysicalDelta({ speed = 0, height = 0 }) {
  return (player) => ({
    ...player,
    heightCm: Math.max(155, Math.min(210, Number(player.heightCm ?? 180) + height)),
    attributes: {
      ...player.attributes,
      pace: Math.max(1, Math.min(99, player.attributes.pace + speed)),
      acceleration: Math.max(1, Math.min(99, player.attributes.acceleration + speed)),
    },
  });
}

function teamPhysicalProfile(seat) {
  const count = Math.max(1, seat.players.length);
  return {
    overallSpeed: Number((seat.players.reduce((sum, player) => sum
      + player.attributes.pace * 0.7
      + player.attributes.acceleration * 0.3, 0) / count).toFixed(2)),
    averageHeightCm: Number((seat.players.reduce((sum, player) => sum + Number(player.heightCm ?? 180), 0) / count).toFixed(2)),
  };
}

const STYLE_ATTRIBUTES = {
  possession: ["passing", "firstTouch", "decisions", "dribbling", "composure", "vision"],
  longBall: ["passing", "vision", "crossing", "heading", "jumping", "strength", "pace"],
  wingPlay: ["crossing", "pace", "acceleration", "dribbling", "passing", "stamina", "offBall", "heading"],
  counterAttack: ["pace", "acceleration", "decisions", "offBall", "finishing", "composure"],
  highPress: ["stamina", "workRate", "aggression", "tackling", "pace", "decisions"],
  lowBlock: ["positioning", "marking", "tackling", "strength", "heading", "jumping", "discipline"],
  roughPlay: ["aggression", "tackling", "strength", "workRate", "stamina", "discipline"],
};

let simulationProgress = null;

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

function startProgress(total) {
  simulationProgress = {
    current: 0,
    total: Math.max(1, total),
    startedAt: Date.now(),
    lastRenderedAt: 0,
    lastBucket: -1,
    lastLineLength: 0,
  };
  renderProgress(true);
}

function renderProgress(force = false) {
  if (!simulationProgress) return;
  const now = Date.now();
  const progress = simulationProgress;
  const ratio = Math.min(1, progress.current / progress.total);
  const bucket = Math.floor(ratio * 20);
  if (!force) {
    if (process.stdout.isTTY && now - progress.lastRenderedAt < 250) return;
    if (!process.stdout.isTTY && bucket === progress.lastBucket) return;
  }
  const barWidth = 28;
  const filled = Math.round(ratio * barWidth);
  const elapsed = now - progress.startedAt;
  const remaining = progress.current > 0 ? elapsed / progress.current * (progress.total - progress.current) : Number.NaN;
  const line = `模拟进度 [${"=".repeat(filled)}${"-".repeat(barWidth - filled)}] ${(ratio * 100).toFixed(1).padStart(5)}% ${progress.current}/${progress.total} | 已用 ${formatDuration(elapsed)} | 预计剩余 ${formatDuration(remaining)}`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line.padEnd(progress.lastLineLength, " ")}`);
    progress.lastLineLength = Math.max(progress.lastLineLength, line.length);
  } else {
    console.log(line);
  }
  progress.lastRenderedAt = now;
  progress.lastBucket = bucket;
}

function tickProgress() {
  if (!simulationProgress) return;
  simulationProgress.current += 1;
  renderProgress(simulationProgress.current >= simulationProgress.total);
}

function finishProgress() {
  if (!simulationProgress) return;
  if (simulationProgress.current < simulationProgress.total) {
    simulationProgress.current = simulationProgress.total;
    renderProgress(true);
  }
  if (process.stdout.isTTY) process.stdout.write("\n");
  simulationProgress = null;
}

function withStyleFit(style, direction) {
  const relevant = new Set(STYLE_ATTRIBUTES[style]);
  return (player, role) => ({
    ...player,
    heightCm: Math.max(160, player.heightCm + (style === "longBall" && ["ST", "CB", "GK"].includes(role) ? direction * 7 : 0)),
    attributes: Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [
      key,
      Math.max(1, Math.min(99, value + (relevant.has(key) ? direction * 8 : 0))),
    ])),
  });
}

function play(home, away, seed, weather = null, referee = null, options = {}) {
  const physicalProfiles = [teamPhysicalProfile(home), teamPhysicalProfile(away)];
  const recordEvents = options.recordEvents === true;
  const match = createVersusMatch([home, away], { now: 0, seed, recordEvents, ...(weather ? { weather } : {}), ...(referee ? { referee } : {}) });
  advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS);
  const regulationScore = match.teams.map((team) => team.score);
  if (!match.finished) advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + EXTRA_DURATION_MS);
  if (!match.finished) advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + EXTRA_DURATION_MS + PENALTY_KICK_INTERVAL_MS * 30);
  tickProgress();
  return {
    seed,
    score: match.teams.map((team) => team.score),
    regulationScore,
    winnerIndex: match.winnerIndex,
    penalties: match.penalties?.score ?? null,
    weather: match.weather.key,
    referee: match.referee.key,
    blackWhistle: match.blackWhistleTriggered,
    teams: match.teams.map((team, index) => {
      const active = team.players.filter((player) => player.active);
      const structure = formationStructureProfile(active, team.positions);
      return {
        name: team.name,
        formation: structure.name,
        tactic: team.tactic,
        style: team.style,
        attackFocus: team.attackFocus,
        defenseFocus: team.defenseFocus,
        activeCount: team.players.filter((player) => player.active).length,
        physical: physicalProfiles[index],
        structure: { midfield:structure.midfieldStructure, multipliers:structure.multipliers },
        wingbacks: active.filter((player) => ["LWB", "RWB"].includes(player.assignedRole)).map((player) => ({ id:player.id, role:player.role, assignedRole:player.assignedRole })),
        stats: { ...team.stats, xg: Number(team.stats.xg.toFixed(3)) },
        ...(recordEvents ? { players: team.players.map((player) => ({
          id: player.id,
          name: player.name,
          role: player.role,
          assignedRole: player.assignedRole,
          grade: player.grade,
          heightCm: player.heightCm,
          overall: player.overall,
        })) } : {}),
      };
    }),
    ...(recordEvents ? { events: match.events } : {}),
    lightningEvents: Number(match.lightningTriggered),
  };
}

function emptyTotals() {
  return {
    matches: 0, goals: 0, shots: 0, shotsOnTarget: 0, xg: 0, fouls: 0,
    yellowCards: 0, redCards: 0, injuries: 0, injuryMatches: 0,
    redCardMatches: 0, lightningInjuries: 0, penaltyShootouts: 0, regulationDraws: 0, blackWhistleMatches: 0,
    weather: Object.fromEntries(Object.keys(WEATHER).map((key) => [key, { matches: 0, goals: 0, shots: 0, injuries: 0, redCards: 0 }])),
    referee: Object.fromEntries(Object.keys(REFEREES).map((key) => [key, { matches: 0, goals: 0, fouls: 0, redCards: 0 }])),
    scoreTotals: Object.fromEntries([0, 1, 2, 3, 4, "5+"].map((key) => [key, 0])),
  };
}

function addTotals(totals, result) {
  totals.matches += 1;
  const goals = result.score[0] + result.score[1];
  const shots = result.teams[0].stats.shots + result.teams[1].stats.shots;
  const injuries = result.teams[0].stats.injuries + result.teams[1].stats.injuries;
  const redCards = result.teams[0].stats.redCards + result.teams[1].stats.redCards;
  totals.goals += goals;
  totals.shots += shots;
  totals.shotsOnTarget += result.teams[0].stats.shotsOnTarget + result.teams[1].stats.shotsOnTarget;
  totals.xg += result.teams[0].stats.xg + result.teams[1].stats.xg;
  totals.fouls += result.teams[0].stats.fouls + result.teams[1].stats.fouls;
  totals.yellowCards += result.teams[0].stats.yellowCards + result.teams[1].stats.yellowCards;
  totals.redCards += redCards;
  totals.injuries += injuries;
  totals.injuryMatches += Number(injuries > 0);
  totals.redCardMatches += Number(redCards > 0);
  totals.lightningInjuries += result.lightningEvents;
  totals.penaltyShootouts += Number(Boolean(result.penalties));
  totals.regulationDraws += Number(result.regulationScore[0] === result.regulationScore[1]);
  totals.blackWhistleMatches += Number(result.blackWhistle);
  totals.scoreTotals[goals >= 5 ? "5+" : goals] += 1;
  const weather = totals.weather[result.weather];
  weather.matches += 1;
  weather.goals += goals;
  weather.shots += shots;
  weather.injuries += injuries;
  weather.redCards += redCards;
  const referee = totals.referee[result.referee];
  referee.matches += 1;
  referee.goals += goals;
  referee.fouls += result.teams[0].stats.fouls + result.teams[1].stats.fouls;
  referee.redCards += redCards;
}

function emptyOutcomes() {
  return { matches: 0, wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, shotsFor: 0, shotsAgainst: 0 };
}

function addOutcome(outcomes, result, subjectIndex) {
  outcomes.matches += 1;
  outcomes.wins += Number(result.winnerIndex === subjectIndex);
  outcomes.losses += Number(result.winnerIndex !== null && result.winnerIndex !== subjectIndex);
  outcomes.draws += Number(result.winnerIndex === null);
  outcomes.goalsFor += result.score[subjectIndex];
  outcomes.goalsAgainst += result.score[subjectIndex === 0 ? 1 : 0];
  outcomes.shotsFor += result.teams[subjectIndex].stats.shots;
  outcomes.shotsAgainst += result.teams[subjectIndex === 0 ? 1 : 0].stats.shots;
}

function outcomeSummary(outcomes) {
  const matches = Math.max(1, outcomes.matches);
  return {
    matches: outcomes.matches,
    winRate: Number((outcomes.wins / matches * 100).toFixed(1)),
    lossRate: Number((outcomes.losses / matches * 100).toFixed(1)),
    goalsFor: Number((outcomes.goalsFor / matches).toFixed(2)),
    goalsAgainst: Number((outcomes.goalsAgainst / matches).toFixed(2)),
    shotsFor: Number((outcomes.shotsFor / matches).toFixed(2)),
    shotsAgainst: Number((outcomes.shotsAgainst / matches).toFixed(2)),
  };
}

function shortageBucket(result, teamIndex) {
  const deficit = 11 - result.teams[teamIndex].activeCount;
  const opponentDeficit = 11 - result.teams[teamIndex === 0 ? 1 : 0].activeCount;
  if (deficit === 0 && opponentDeficit === 0) return "双方满员";
  if (deficit < opponentDeficit) return "人数占优";
  if (deficit === opponentDeficit) return "双方同等减员";
  if (deficit === 1) return "少1人且人数劣势";
  return "少2人以上且人数劣势";
}

function addMetaOutcome(target, key, result, teamIndex) {
  target[key] ??= emptyOutcomes();
  addOutcome(target[key], result, teamIndex);
}

function addMetaMatchup(target, key, opponentKey, result, teamIndex) {
  target[key] ??= {};
  target[key][opponentKey] ??= emptyOutcomes();
  addOutcome(target[key][opponentKey], result, teamIndex);
}

function summarizeMetaOutcomes(target) {
  return Object.fromEntries(Object.entries(target).map(([key, value]) => [key, outcomeSummary(value)]));
}

function summarizeMetaMatchups(target) {
  return Object.fromEntries(Object.entries(target).map(([key, opponents]) => [key, summarizeMetaOutcomes(opponents)]));
}

function runRandomBaseline(matches, draftChoiceCount = 3, lineupMode = "legacyGrouped") {
  const totals = emptyTotals();
  const shortage = {};
  const meta = {
    formation: {}, midfieldShape: {}, tactic: {}, style: {}, formationStyle: {}, formationTactic: {}, styleTactic: {},
    formationMatchups: {}, tacticMatchups: {}, styleMatchups: {},
  };
  const formationKeys = Object.keys(STANDARD_FORMATIONS);
  const tacticKeys = Object.keys(TACTICS);
  const styleKeys = Object.keys(STYLES);
  const focusKeys = Object.keys(FOCUSES);
  for (let index = 0; index < matches; index += 1) {
    const homeFormation = formationKeys[hash(`hf:${index}`) % formationKeys.length];
    const awayFormation = formationKeys[hash(`af:${index}`) % formationKeys.length];
    const homeTactic = tacticKeys[hash(`ht:${index}`) % tacticKeys.length];
    const awayTactic = tacticKeys[hash(`at:${index}`) % tacticKeys.length];
    const homeStyle = styleKeys[hash(`hs:${index}`) % styleKeys.length];
    const awayStyle = styleKeys[hash(`as:${index}`) % styleKeys.length];
    const homeAttackFocus = focusKeys[hash(`haf:${index}`) % focusKeys.length];
    const awayAttackFocus = focusKeys[hash(`aaf:${index}`) % focusKeys.length];
    const homeDefenseFocus = focusKeys[hash(`hdf:${index}`) % focusKeys.length];
    const awayDefenseFocus = focusKeys[hash(`adf:${index}`) % focusKeys.length];
    const metadata = [
      { formation: homeFormation, midfieldShape:midfieldShapeKey(homeFormation), tactic: homeTactic, style: homeStyle, attackFocus: homeAttackFocus, defenseFocus: homeDefenseFocus },
      { formation: awayFormation, midfieldShape:midfieldShapeKey(awayFormation), tactic: awayTactic, style: awayStyle, attackFocus: awayAttackFocus, defenseFocus: awayDefenseFocus },
    ];
    const homeSeat = lineupMode === "seededPositionAware"
      ? buildSeededFormationSeat("主队", homeFormation, homeTactic, homeStyle, `random-lineup:${index}:home`, homeAttackFocus, homeDefenseFocus, draftChoiceCount)
      : buildSeat("主队", STANDARD_FORMATIONS[homeFormation], homeTactic, index % 40, `random:${index}`, homeStyle, homeAttackFocus, homeDefenseFocus);
    const awaySeat = lineupMode === "seededPositionAware"
      ? buildSeededFormationSeat("客队", awayFormation, awayTactic, awayStyle, `random-lineup:${index}:away`, awayAttackFocus, awayDefenseFocus, draftChoiceCount)
      : buildSeat("客队", STANDARD_FORMATIONS[awayFormation], awayTactic, index % 40, `random:${index}`, awayStyle, awayAttackFocus, awayDefenseFocus);
    const result = play(
      homeSeat,
      awaySeat,
      `random-baseline:${index}`,
    );
    addTotals(totals, result);
    for (const teamIndex of [0, 1]) {
      const own = metadata[teamIndex];
      const opponent = metadata[teamIndex === 0 ? 1 : 0];
      const bucket = shortageBucket(result, teamIndex);
      shortage[bucket] ??= emptyOutcomes();
      addOutcome(shortage[bucket], result, teamIndex);
      addMetaOutcome(meta.formation, own.formation, result, teamIndex);
      addMetaOutcome(meta.midfieldShape, own.midfieldShape, result, teamIndex);
      addMetaOutcome(meta.tactic, own.tactic, result, teamIndex);
      addMetaOutcome(meta.style, own.style, result, teamIndex);
      addMetaOutcome(meta.formationStyle, `${own.formation}|${own.style}`, result, teamIndex);
      addMetaOutcome(meta.formationTactic, `${own.formation}|${own.tactic}`, result, teamIndex);
      addMetaOutcome(meta.styleTactic, `${own.style}|${own.tactic}`, result, teamIndex);
      addMetaMatchup(meta.formationMatchups, own.formation, opponent.formation, result, teamIndex);
      addMetaMatchup(meta.tacticMatchups, own.tactic, opponent.tactic, result, teamIndex);
      addMetaMatchup(meta.styleMatchups, own.style, opponent.style, result, teamIndex);
    }
  }
  return {
    totals,
    shortage: Object.fromEntries(Object.entries(shortage).map(([key, value]) => [key, outcomeSummary(value)])),
    seededMeta: {
      formationVsField: summarizeMetaOutcomes(meta.formation),
      midfieldShapeVsField: summarizeMetaOutcomes(meta.midfieldShape),
      tacticVsField: summarizeMetaOutcomes(meta.tactic),
      styleVsField: summarizeMetaOutcomes(meta.style),
      formationStyleVsField: summarizeMetaOutcomes(meta.formationStyle),
      formationTacticVsField: summarizeMetaOutcomes(meta.formationTactic),
      styleTacticVsField: summarizeMetaOutcomes(meta.styleTactic),
      formationMatchups: summarizeMetaMatchups(meta.formationMatchups),
      tacticMatchups: summarizeMetaMatchups(meta.tacticMatchups),
      styleMatchups: summarizeMetaMatchups(meta.styleMatchups),
    },
  };
}

const GOAL_MINUTE_BUCKETS = [
  [1, 15, "01-15"], [16, 30, "16-30"], [31, 45, "31-45"],
  [46, 60, "46-60"], [61, 75, "61-75"], [76, 90, "76-90"],
  [91, 105, "91-105"], [106, 120, "106-120"],
];

function incrementCounter(counter, key, amount = 1) {
  counter[key] = (counter[key] ?? 0) + amount;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))].toFixed(2));
}

function numericSummary(values) {
  if (!values.length) return { count: 0, mean: null, minimum: null, p25: null, median: null, p75: null, p90: null, maximum: null };
  const range = values.reduce((output, value) => ({ minimum: Math.min(output.minimum, value), maximum: Math.max(output.maximum, value) }), { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY });
  return {
    count: values.length,
    mean: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    minimum: Number(range.minimum.toFixed(2)),
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    maximum: Number(range.maximum.toFixed(2)),
  };
}

function intervalHistogram(values) {
  const output = { "0-5": 0, "6-10": 0, "11-15": 0, "16-30": 0, "31-45": 0, "46+": 0 };
  values.forEach((value) => {
    const key = value <= 5 ? "0-5" : value <= 10 ? "6-10" : value <= 15 ? "11-15" : value <= 30 ? "16-30" : value <= 45 ? "31-45" : "46+";
    output[key] += 1;
  });
  return output;
}

function addBreakdown(target, key, team, goalsFor, goalsAgainst) {
  target[key] ??= { teamSamples: 0, goalsFor: 0, goalsAgainst: 0, shots: 0, shotsOnTarget: 0, xg: 0 };
  const value = target[key];
  value.teamSamples += 1;
  value.goalsFor += goalsFor;
  value.goalsAgainst += goalsAgainst;
  value.shots += team.stats.shots;
  value.shotsOnTarget += team.stats.shotsOnTarget;
  value.xg += team.stats.xg;
}

function finalizeBreakdown(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
    teamSamples: value.teamSamples,
    goalsForPerMatch: Number((value.goalsFor / value.teamSamples).toFixed(3)),
    goalsAgainstPerMatch: Number((value.goalsAgainst / value.teamSamples).toFixed(3)),
    shotsPerMatch: Number((value.shots / value.teamSamples).toFixed(3)),
    shotsOnTargetPerMatch: Number((value.shotsOnTarget / value.teamSamples).toFixed(3)),
    xgPerMatch: Number((value.xg / value.teamSamples).toFixed(3)),
    conversionPercent: Number((value.goalsFor / Math.max(1, value.shots) * 100).toFixed(2)),
  }]));
}

function counterWithPercent(counter, total) {
  return Object.fromEntries(Object.entries(counter).sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true })).map(([key, count]) => [key, {
    count,
    percent: Number((count / Math.max(1, total) * 100).toFixed(2)),
  }]));
}

function runGoalEventAnalysis(matches, rawMatchSampleLimit = 0, draftChoiceCount = 3, lineupMode = "legacyGrouped") {
  const formationKeys = Object.keys(STANDARD_FORMATIONS);
  const tacticKeys = Object.keys(TACTICS);
  const styleKeys = Object.keys(STYLES);
  const focusKeys = Object.keys(FOCUSES);
  const minuteExact = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [String(index + 1), 0]));
  const minuteBuckets = Object.fromEntries(GOAL_MINUTE_BUCKETS.map(([, , label]) => [label, 0]));
  const scorerRoles = {};
  const scorerRoleGroups = {};
  const assistRoles = {};
  const attackTypes = {};
  const homeAway = { home: 0, away: 0 };
  const scoreState = { opener: 0, equalizer: 0, goAhead: 0, leadExtension: 0 };
  const firstGoalMinutes = [];
  const betweenAllGoals = [];
  const betweenSameTeamGoals = [];
  const goalXg = [];
  const goalsPerMatch = [];
  const breakdowns = { formation: {}, tactic: {}, style: {}, attackFocus: {}, defenseFocus: {}, weather: {}, referee: {} };
  const rawMatches = [];
  let totalGoals = 0;
  let scorelessMatches = 0;
  let matchesWithExtraTimeGoal = 0;

  for (let index = 0; index < matches; index += 1) {
    const metadata = [0, 1].map((teamIndex) => ({
      formation: formationKeys[hash(`event:f:${teamIndex}:${index}`) % formationKeys.length],
      tactic: tacticKeys[hash(`event:t:${teamIndex}:${index}`) % tacticKeys.length],
      style: styleKeys[hash(`event:s:${teamIndex}:${index}`) % styleKeys.length],
      attackFocus: focusKeys[hash(`event:af:${teamIndex}:${index}`) % focusKeys.length],
      defenseFocus: focusKeys[hash(`event:df:${teamIndex}:${index}`) % focusKeys.length],
    }));
    const seats = metadata.map((team, teamIndex) => lineupMode === "seededPositionAware"
      ? buildSeededFormationSeat(
        teamIndex === 0 ? "主队" : "客队",
        team.formation,
        team.tactic,
        team.style,
        `event-detail:${index}:${teamIndex}`,
        team.attackFocus,
        team.defenseFocus,
        draftChoiceCount,
      )
      : buildSeat(
        teamIndex === 0 ? "主队" : "客队",
        STANDARD_FORMATIONS[team.formation],
        team.tactic,
        (index * 2 + teamIndex) % 40,
        `event-detail:${index}:${teamIndex}`,
        team.style,
        team.attackFocus,
        team.defenseFocus,
      ));
    const seed = `goal-event-analysis:${index}`;
    const result = play(seats[0], seats[1], seed, null, null, { recordEvents: true });
    const goals = result.events.filter((entry) => entry.type === "goal" || (entry.type === "penalty" && entry.scored));
    const orderedGoals = [...goals].sort((left, right) => left.minute - right.minute);
    goalsPerMatch.push(goals.length);
    totalGoals += goals.length;
    scorelessMatches += Number(goals.length === 0);
    matchesWithExtraTimeGoal += Number(goals.some((goal) => goal.minute > 90));
    if (orderedGoals.length) firstGoalMinutes.push(orderedGoals[0].minute);
    for (let goalIndex = 1; goalIndex < orderedGoals.length; goalIndex += 1) betweenAllGoals.push(orderedGoals[goalIndex].minute - orderedGoals[goalIndex - 1].minute);
    for (const teamIndex of [0, 1]) {
      const teamGoals = orderedGoals.filter((goal) => goal.teamIndex === teamIndex);
      for (let goalIndex = 1; goalIndex < teamGoals.length; goalIndex += 1) betweenSameTeamGoals.push(teamGoals[goalIndex].minute - teamGoals[goalIndex - 1].minute);
      const opponentIndex = teamIndex === 0 ? 1 : 0;
      addBreakdown(breakdowns.formation, metadata[teamIndex].formation, result.teams[teamIndex], result.score[teamIndex], result.score[opponentIndex]);
      addBreakdown(breakdowns.tactic, metadata[teamIndex].tactic, result.teams[teamIndex], result.score[teamIndex], result.score[opponentIndex]);
      addBreakdown(breakdowns.style, metadata[teamIndex].style, result.teams[teamIndex], result.score[teamIndex], result.score[opponentIndex]);
      addBreakdown(breakdowns.attackFocus, metadata[teamIndex].attackFocus, result.teams[teamIndex], result.score[teamIndex], result.score[opponentIndex]);
      addBreakdown(breakdowns.defenseFocus, metadata[teamIndex].defenseFocus, result.teams[teamIndex], result.score[teamIndex], result.score[opponentIndex]);
    }
    addBreakdown(breakdowns.weather, result.weather, { stats: {
      shots: result.teams[0].stats.shots + result.teams[1].stats.shots,
      shotsOnTarget: result.teams[0].stats.shotsOnTarget + result.teams[1].stats.shotsOnTarget,
      xg: result.teams[0].stats.xg + result.teams[1].stats.xg,
    } }, goals.length, 0);
    addBreakdown(breakdowns.referee, result.referee, { stats: {
      shots: result.teams[0].stats.shots + result.teams[1].stats.shots,
      shotsOnTarget: result.teams[0].stats.shotsOnTarget + result.teams[1].stats.shotsOnTarget,
      xg: result.teams[0].stats.xg + result.teams[1].stats.xg,
    } }, goals.length, 0);

    orderedGoals.forEach((goal, goalIndex) => {
      const team = result.teams[goal.teamIndex];
      const scorer = team.players.find((player) => player.id === goal.actorId);
      const assister = team.players.find((player) => player.id === goal.assistId);
      const minute = Math.max(1, Math.min(120, goal.minute));
      minuteExact[String(minute)] += 1;
      const minuteBucket = GOAL_MINUTE_BUCKETS.find(([minimum, maximum]) => minute >= minimum && minute <= maximum)?.[2] ?? "106-120";
      minuteBuckets[minuteBucket] += 1;
      incrementCounter(scorerRoles, scorer?.assignedRole ?? "UNKNOWN");
      incrementCounter(scorerRoleGroups, roleGroup(scorer?.assignedRole ?? scorer?.role ?? "ST"));
      if (assister) incrementCounter(assistRoles, assister.assignedRole ?? "UNKNOWN");
      incrementCounter(attackTypes, goal.attackType ?? (goal.type === "penalty" ? "penalty" : "unknown"));
      homeAway[goal.teamIndex === 0 ? "home" : "away"] += 1;
      if (Number.isFinite(goal.xg)) goalXg.push(goal.xg);
      if (goalIndex === 0) scoreState.opener += 1;
      else {
        const [homeScore, awayScore] = goal.score ?? [0, 0];
        if (homeScore === awayScore) scoreState.equalizer += 1;
        else if ((goal.teamIndex === 0 && homeScore === awayScore + 1) || (goal.teamIndex === 1 && awayScore === homeScore + 1)) scoreState.goAhead += 1;
        else scoreState.leadExtension += 1;
      }
    });

    if (rawMatches.length < rawMatchSampleLimit) rawMatches.push({
      index,
      seed,
      weather: result.weather,
      referee: result.referee,
      score: result.score,
      regulationScore: result.regulationScore,
      penalties: result.penalties,
      winnerIndex: result.winnerIndex,
      teams: metadata.map((team, teamIndex) => ({ ...team, name: result.teams[teamIndex].name, physical: result.teams[teamIndex].physical, structure:result.teams[teamIndex].structure, wingbacks:result.teams[teamIndex].wingbacks, stats: result.teams[teamIndex].stats })),
      goals: orderedGoals.map((goal) => {
        const team = result.teams[goal.teamIndex];
        const scorer = team.players.find((player) => player.id === goal.actorId);
        const assister = team.players.find((player) => player.id === goal.assistId);
        return {
          minute: goal.minute,
          phase: goal.phase,
          teamIndex: goal.teamIndex,
          scorer: scorer ? { id: scorer.id, name: scorer.name, role: scorer.assignedRole, grade: scorer.grade } : null,
          assist: assister ? { id: assister.id, name: assister.name, role: assister.assignedRole } : null,
          attackType: goal.attackType ?? (goal.type === "penalty" ? "penalty" : "unknown"),
          xg: goal.xg,
          score: goal.score,
        };
      }),
    });
  }

  return {
    matches,
    totalGoals,
    goalsPerMatch: numericSummary(goalsPerMatch),
    scorelessMatches: { count: scorelessMatches, percent: Number((scorelessMatches / Math.max(1, matches) * 100).toFixed(2)) },
    matchesWithExtraTimeGoal: { count: matchesWithExtraTimeGoal, percent: Number((matchesWithExtraTimeGoal / Math.max(1, matches) * 100).toFixed(2)) },
    firstGoalMinute: numericSummary(firstGoalMinutes),
    goalMinuteDistribution: { exact: minuteExact, buckets: counterWithPercent(minuteBuckets, totalGoals) },
    goalIntervals: {
      betweenAnyGoals: { summary: numericSummary(betweenAllGoals), buckets: counterWithPercent(intervalHistogram(betweenAllGoals), betweenAllGoals.length) },
      betweenSameTeamGoals: { summary: numericSummary(betweenSameTeamGoals), buckets: counterWithPercent(intervalHistogram(betweenSameTeamGoals), betweenSameTeamGoals.length) },
    },
    scorerPositionDistribution: counterWithPercent(scorerRoles, totalGoals),
    scorerLineDistribution: counterWithPercent(scorerRoleGroups, totalGoals),
    assistPositionDistribution: counterWithPercent(assistRoles, Object.values(assistRoles).reduce((sum, value) => sum + value, 0)),
    attackTypeDistribution: counterWithPercent(attackTypes, totalGoals),
    homeAwayDistribution: counterWithPercent(homeAway, totalGoals),
    scoreStateDistribution: counterWithPercent(scoreState, totalGoals),
    goalXg: numericSummary(goalXg),
    parameterBreakdowns: Object.fromEntries(Object.entries(breakdowns).map(([key, value]) => [key, finalizeBreakdown(value)])),
    rawMatchSamples: rawMatches,
  };
}

function runFormationComparisons(matchesPerFormation, draftChoiceCount = 3, lineupMode = "legacyGrouped") {
  const output = {};
  for (const [name, specification] of Object.entries(STANDARD_FORMATIONS)) {
    const outcomes = emptyOutcomes();
    for (let index = 0; index < matchesPerFormation; index += 1) {
      const subjectIndex = index % 2;
      const subject = lineupMode === "seededPositionAware"
        ? buildSeededFormationSeat(name, name, "balanced", "possession", `formation:${name}:${index}:subject`, "balanced", "balanced", draftChoiceCount)
        : buildSeat(name, specification, "balanced", index % 40, `formation:${index}`);
      const baseline = lineupMode === "seededPositionAware"
        ? buildSeededFormationSeat("4-3-3基准", "4-3-3", "balanced", "possession", `formation:${name}:${index}:baseline`, "balanced", "balanced", draftChoiceCount)
        : buildSeat("4-3-3基准", STANDARD_FORMATIONS["4-3-3"], "balanced", index % 40, `formation:${index}`);
      const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `formation:${name}:${index}`);
      addOutcome(outcomes, result, subjectIndex);
    }
    output[name] = outcomeSummary(outcomes);
  }
  return output;
}

function runAbnormalComparisons(matchesPerFormation) {
  const output = {};
  for (const [name, specification] of Object.entries(ABNORMAL_FORMATIONS)) {
    const outcomes = emptyOutcomes();
    for (let index = 0; index < matchesPerFormation; index += 1) {
      const subjectIndex = index % 2;
      const subject = buildSeat(name, specification, "balanced", index % 40, `abnormal:${index}`);
      const baseline = buildSeat("4-3-3基准", STANDARD_FORMATIONS["4-3-3"], "balanced", index % 40, `abnormal:${index}`);
      const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `abnormal:${name}:${index}`);
      addOutcome(outcomes, result, subjectIndex);
    }
    output[name] = outcomeSummary(outcomes);
  }
  return output;
}

function runTacticMatrix(matchesPerPair) {
  const output = {};
  for (const homeTactic of Object.keys(TACTICS)) {
    output[homeTactic] = {};
    for (const awayTactic of Object.keys(TACTICS)) {
      const outcomes = emptyOutcomes();
      for (let index = 0; index < matchesPerPair; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildSeat(TACTICS[homeTactic], STANDARD_FORMATIONS["4-3-3"], homeTactic, index % 40, `tactics:${index}`);
        const opponent = buildSeat(TACTICS[awayTactic], STANDARD_FORMATIONS["4-3-3"], awayTactic, index % 40, `tactics:${index}`);
        const result = play(...(subjectIndex === 0 ? [subject, opponent] : [opponent, subject]), `tactics:${homeTactic}:${awayTactic}:${index}`);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[homeTactic][awayTactic] = outcomeSummary(outcomes);
    }
  }
  return output;
}

function runStyleMatrix(matchesPerPair) {
  const output = {};
  for (const subjectStyle of Object.keys(STYLES)) {
    output[subjectStyle] = {};
    for (const opponentStyle of Object.keys(STYLES)) {
      const outcomes = emptyOutcomes();
      for (let index = 0; index < matchesPerPair; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildPositionSeat(STYLES[subjectStyle], "primary", "balanced", subjectStyle, index % 40, `styles:${index}`);
        const opponent = buildPositionSeat(STYLES[opponentStyle], "primary", "balanced", opponentStyle, index % 40, `styles:${index}`);
        const result = play(...(subjectIndex === 0 ? [subject, opponent] : [opponent, subject]), `styles:${subjectStyle}:${opponentStyle}:${index}`);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[subjectStyle][opponentStyle] = outcomeSummary(outcomes);
    }
  }
  return output;
}

function runFocusMatrix(matchesPerPair) {
  const output = {};
  for (const attackFocus of Object.keys(FOCUSES)) {
    output[attackFocus] = {};
    for (const defenseFocus of Object.keys(FOCUSES)) {
      const outcomes = emptyOutcomes();
      for (let index = 0; index < matchesPerPair; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildPositionSeat(FOCUSES[attackFocus], "primary", "balanced", "possession", index % 40, `focus:${index}`, (player) => player, attackFocus, "balanced");
        const opponent = buildPositionSeat(FOCUSES[defenseFocus], "primary", "balanced", "possession", index % 40, `focus:${index}`, (player) => player, "balanced", defenseFocus);
        const result = play(...(subjectIndex === 0 ? [subject, opponent] : [opponent, subject]), `focus:${attackFocus}:${defenseFocus}:${index}`);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[attackFocus][defenseFocus] = outcomeSummary(outcomes);
    }
  }
  return output;
}

function runWeatherStyleImpact(matchesPerCombination) {
  const output = {};
  for (const weather of Object.keys(WEATHER)) {
    output[weather] = {};
    for (const style of Object.keys(STYLES)) {
      const outcomes = emptyOutcomes();
      for (let index = 0; index < matchesPerCombination; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildPositionSeat(`${WEATHER[weather]}·${STYLES[style]}`, "primary", "balanced", style, index % 40, `weather:${index}`);
        const baseline = buildPositionSeat("密集短传基准", "primary", "balanced", "possession", index % 40, `weather:${index}`);
        const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `weather:${weather}:${style}:${index}`, weather);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[weather][style] = outcomeSummary(outcomes);
    }
  }
  return output;
}

function runRefereeStyleImpact(matchesPerCombination) {
  const output = {};
  for (const referee of Object.keys(REFEREES)) {
    output[referee] = {};
    for (const style of Object.keys(STYLES)) {
      const outcomes = emptyOutcomes();
      for (let index = 0; index < matchesPerCombination; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildPositionSeat(`${REFEREES[referee]}·${STYLES[style]}`, "primary", "balanced", style, index % 40, `referee:${index}`);
        const baseline = buildPositionSeat(`${REFEREES[referee]}·密集短传基准`, "primary", "balanced", "possession", index % 40, `referee:${index}`);
        const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `referee:${referee}:${style}:${index}`, "sunny", referee);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[referee][style] = outcomeSummary(outcomes);
    }
  }
  return output;
}

function runPositionImpact(matchesPerScenario) {
  const scenarios = {
    primary: "全部主位置",
    secondary: "尽量安排副位置",
    unfamiliar: "同线陌生位置",
    forwardGoalkeeper: "前锋客串门将",
  };
  const output = {};
  for (const [mode, label] of Object.entries(scenarios)) {
    const outcomes = emptyOutcomes();
    for (let index = 0; index < matchesPerScenario; index += 1) {
      const subjectIndex = index % 2;
      const subject = buildPositionSeat(label, mode, "balanced", "possession", index % 40, `position:${index}`);
      const baseline = buildPositionSeat("主位置基准", "primary", "balanced", "possession", index % 40, `position:${index}`);
      const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `position:${mode}:${index}`);
      addOutcome(outcomes, result, subjectIndex);
    }
    output[mode] = { label, ...outcomeSummary(outcomes) };
  }
  return output;
}

function runAbilityImpact(matchesPerScenario) {
  const output = {};
  for (const delta of [-8, -4, 4, 8]) {
    const outcomes = emptyOutcomes();
    for (let index = 0; index < matchesPerScenario; index += 1) {
      const subjectIndex = index % 2;
      const subject = buildPositionSeat(`全属性${delta > 0 ? "+" : ""}${delta}`, "primary", "balanced", "possession", index % 40, `ability:${index}`, withAttributeDelta(delta));
      const baseline = buildPositionSeat("基准能力", "primary", "balanced", "possession", index % 40, `ability:${index}`);
      const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `ability:${delta}:${index}`);
      addOutcome(outcomes, result, subjectIndex);
    }
    output[delta] = { label: `全属性 ${delta > 0 ? "+" : ""}${delta}`, ...outcomeSummary(outcomes) };
  }
  return output;
}

function runPhysicalImpact(matchesPerScenario) {
  const dimensions = {
    overallSpeed: { deltas: [-8, -4, 4, 8], unit: "rating", transform: (delta) => withPhysicalDelta({ speed: delta }) },
    averageHeightCm: { deltas: [-8, -4, 4, 8], unit: "cm", transform: (delta) => withPhysicalDelta({ height: delta }) },
  };
  const output = {};
  for (const [dimension, definition] of Object.entries(dimensions)) {
    output[dimension] = {};
    for (const delta of definition.deltas) {
      const outcomes = emptyOutcomes();
      let measuredValue = 0;
      for (let index = 0; index < matchesPerScenario; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildPositionSeat(`${dimension}:${delta}`, "primary", "balanced", "possession", index % 40, `physical:${dimension}:${index}`, definition.transform(delta));
        const baseline = buildPositionSeat(`${dimension}:baseline`, "primary", "balanced", "possession", index % 40, `physical:${dimension}:${index}`);
        measuredValue += teamPhysicalProfile(subject)[dimension];
        const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `physical:${dimension}:${delta}:${index}`);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[dimension][delta] = {
        delta,
        unit: definition.unit,
        measuredTeamAverage: Number((measuredValue / matchesPerScenario).toFixed(2)),
        ...outcomeSummary(outcomes),
      };
    }
  }
  return output;
}

function runStyleFitImpact(matchesPerScenario) {
  const output = {};
  for (const style of Object.keys(STYLES)) {
    output[style] = {};
    for (const [fit, direction] of [["adapted", 1], ["unfit", -1]]) {
      const outcomes = emptyOutcomes();
      for (let index = 0; index < matchesPerScenario; index += 1) {
        const subjectIndex = index % 2;
        const subject = buildPositionSeat(`${STYLES[style]}·${fit}`, "primary", "balanced", style, index % 40, `style-fit:${index}`, withStyleFit(style, direction));
        const baseline = buildPositionSeat(`${STYLES[style]}·基准`, "primary", "balanced", style, index % 40, `style-fit:${index}`);
        const result = play(...(subjectIndex === 0 ? [subject, baseline] : [baseline, subject]), `style-fit:${style}:${fit}:${index}`);
        addOutcome(outcomes, result, subjectIndex);
      }
      output[style][fit] = outcomeSummary(outcomes);
    }
  }
  return output;
}

function percentage(value, total) {
  return `${(value / Math.max(1, total) * 100).toFixed(1)}%`;
}

function perMatch(value, matches) {
  return (value / Math.max(1, matches)).toFixed(2);
}

function markdown(data) {
  const totals = data.randomBaseline.totals;
  const weatherRows = Object.entries(totals.weather).map(([key, value]) =>
    `| ${WEATHER[key]} | ${value.matches} | ${percentage(value.matches, totals.matches)} | ${perMatch(value.goals, value.matches)} | ${perMatch(value.shots, value.matches)} | ${perMatch(value.injuries, value.matches)} | ${perMatch(value.redCards, value.matches)} |`).join("\n");
  const formationRows = Object.entries(data.formations).map(([name, value]) =>
    `| ${name} | ${value.matches} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} | ${value.shotsFor} | ${value.shotsAgainst} |`).join("\n");
  const abnormalRows = Object.entries(data.abnormalFormations).map(([name, value]) =>
    `| ${name} | ${value.matches} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} | ${value.shotsFor} | ${value.shotsAgainst} |`).join("\n");
  const shortageRows = Object.entries(data.randomBaseline.shortage).map(([name, value]) =>
    `| ${name} | ${value.matches} | ${value.winRate}% | ${value.lossRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  const tacticKeys = Object.keys(TACTICS);
  const tacticHeader = `| 本方策略 \\ 对方策略 | ${tacticKeys.map((key) => TACTICS[key]).join(" | ")} |`;
  const tacticDivider = `|---|${tacticKeys.map(() => "---:").join("|")}|`;
  const tacticRows = tacticKeys.map((row) => `| ${TACTICS[row]} | ${tacticKeys.map((column) => {
    const value = data.tactics[row][column];
    return `${value.winRate}%<br>${value.goalsFor}-${value.goalsAgainst}`;
  }).join(" | ")} |`).join("\n");
  const scoreRows = Object.entries(totals.scoreTotals).map(([goals, matches]) => `| ${goals}球 | ${matches} | ${percentage(matches, totals.matches)} |`).join("\n");
  return `# 11人制好友对战批量模拟与平衡报告 v2

生成日期：2026-07-21  
固定种子：\`versus-balance-v2\`

## 实验设计

- 随机基线：${data.config.randomMatches}场，双方从7种常规阵型和5种策略中确定性抽样。
- 阵型对照：每种阵型对攻守平衡4-3-3进行${data.config.formationMatches}场，主客位置各占一半。
- 策略矩阵：25种策略组合各${data.config.tacticMatches}场，全部使用4-3-3，主客位置各占一半。
- 异常阵容：每种异常阵容对标准4-3-3进行${data.config.abnormalMatches}场。
- 球员来自真实球员池，每人绑定2张位置适配特性卡。结果包含加时赛和点球大战。

## 总体比赛数据

| 指标 | 结果 |
|---|---:|
| 总场次 | ${totals.matches} |
| 场均进球 | ${perMatch(totals.goals, totals.matches)} |
| 场均射门 / 射正 | ${perMatch(totals.shots, totals.matches)} / ${perMatch(totals.shotsOnTarget, totals.matches)} |
| 场均xG | ${perMatch(totals.xg, totals.matches)} |
| 场均犯规 | ${perMatch(totals.fouls, totals.matches)} |
| 场均黄牌 / 红牌 | ${perMatch(totals.yellowCards, totals.matches)} / ${perMatch(totals.redCards, totals.matches)} |
| 出现红牌的比赛 | ${percentage(totals.redCardMatches, totals.matches)} |
| 场均伤退 | ${perMatch(totals.injuries, totals.matches)} |
| 出现伤退的比赛 | ${percentage(totals.injuryMatches, totals.matches)} |
| 雷击伤退 | ${totals.lightningInjuries}次 |
| 常规时间战平 | ${percentage(totals.regulationDraws, totals.matches)} |
| 进入点球大战 | ${percentage(totals.penaltyShootouts, totals.matches)} |

### 单场总进球分布

| 总进球 | 场次 | 占比 |
|---|---:|---:|
${scoreRows}

## 天气统计

| 天气 | 场次 | 概率 | 场均进球 | 场均射门 | 场均伤退 | 场均红牌 |
|---|---:|---:|---:|---:|---:|---:|
${weatherRows}

雷暴场次会保证至少一次雷击伤退，因此雷暴的伤退率明显高于其他天气。这是当前隐藏机制的直接结果。

## 常规阵型胜率

对手固定为攻守平衡4-3-3；胜率为包含加时赛和点球大战后的最终胜率。

| 本方阵型 | 场次 | 胜率 | 场均进球 | 场均失球 | 场均射门 | 场均被射门 |
|---|---:|---:|---:|---:|---:|---:|
${formationRows}

## 异常阵容惩罚验证

| 异常阵容 | 场次 | 胜率 | 场均进球 | 场均失球 | 场均射门 | 场均被射门 |
|---|---:|---:|---:|---:|---:|---:|
${abnormalRows}

异常阵容现在受到三层约束：球员位置熟悉度、单线人数结构系数、整体协同与转换风险。前锋守门还会额外降低门线能力；双门将和过度堆叠前场也存在边际递减。

## 策略对抗矩阵

每格格式为“最终胜率 / 场均进球-场均失球”。行是本方策略，列是对方策略。

${tacticHeader}
${tacticDivider}
${tacticRows}

## 伤退与少人胜率

以下是随机基线中按终场人数状态统计的球队视角数据。它是条件相关性统计，不代表减员发生前双方一定完全同强。

| 人数状态 | 球队样本 | 胜率 | 负率 | 场均进球 | 场均失球 |
|---|---:|---:|---:|---:|---:|
${shortageRows}

## 结论

1. 1到2名后卫不再能只依赖高属性抵消结构缺陷，防线人数越少，防守系数和转换风险惩罚越强。
2. 前锋守门属于严重错位，同时影响门将能力和全队协同，胜率应显著低于正常4-3-3。
3. 3到5后卫的常规阵型仍保持可玩，不使用统一硬惩罚；差异主要来自中前场人数和策略克制。
4. 少人作战的统计需要结合减员时间理解。较晚发生的伤退对最终结果影响较小，后续若要进一步精确，可增加“第几分钟减员”的分层报告。
`;
}

function markdownV3(data) {
  const totals = data.randomBaseline.totals;
  const matrix = (labels, values) => {
    const keys = Object.keys(labels);
    return `| 本方 \\ 对方 | ${keys.map((key) => labels[key]).join(" | ")} |\n|---|${keys.map(() => "---:").join("|")}|\n${keys.map((row) => `| ${labels[row]} | ${keys.map((column) => `${values[row][column].winRate}%`).join(" | ")} |`).join("\n")}`;
  };
  const weatherRows = Object.entries(totals.weather).map(([key, value]) => `| ${WEATHER[key]} | ${value.matches} | ${percentage(value.matches, totals.matches)} | ${perMatch(value.goals, value.matches)} | ${perMatch(value.shots, value.matches)} | ${perMatch(value.injuries, value.matches)} |`).join("\n");
  const formationRows = Object.entries(data.formations).map(([name, value]) => `| ${name} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} | ${value.shotsFor} | ${value.shotsAgainst} |`).join("\n");
  const positionRows = Object.values(data.positionImpact).map((value) => `| ${value.label} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  const abilityRows = Object.values(data.abilityImpact).map((value) => `| ${value.label} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  const styleFitRows = Object.entries(data.styleFitImpact).map(([style, value]) => `| ${STYLES[style]} | ${value.adapted.winRate}% | ${value.unfit.winRate}% | ${(value.adapted.winRate - value.unfit.winRate).toFixed(1)}个百分点 |`).join("\n");
  const physicalRows = Object.entries(data.physicalImpact).flatMap(([metric, values]) => Object.values(values)
    .sort((left, right) => left.delta - right.delta)
    .map((value) => `| ${metric === "overallSpeed" ? "球队整体速度" : "球队平均身高"} | ${value.delta > 0 ? "+" : ""}${value.delta} ${value.unit} | ${value.measuredTeamAverage} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`)).join("\n");
  const weatherStyleRows = Object.entries(data.weatherStyleImpact).map(([weather, styles]) => `| ${WEATHER[weather]} | ${Object.keys(STYLES).map((style) => `${styles[style].winRate}%`).join(" | ")} |`).join("\n");
  const refereeStyleRows = Object.entries(data.refereeStyleImpact).map(([referee, styles]) => `| ${REFEREES[referee]} | ${Object.keys(STYLES).map((style) => `${styles[style].winRate}%`).join(" | ")} |`).join("\n");
  const shortageRows = Object.entries(data.randomBaseline.shortage).map(([name, value]) => `| ${name} | ${value.matches} | ${value.winRate}% | ${value.lossRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  const formationRates = Object.values(data.formations).map((value) => value.winRate);
  const averageFitGap = Object.values(data.styleFitImpact).reduce((sum, value) => sum + value.adapted.winRate - value.unfit.winRate, 0) / Object.keys(STYLES).length;
  const styleAverages = Object.fromEntries(Object.keys(STYLES).map((style) => [
    style,
    Object.values(data.styles[style]).reduce((sum, value) => sum + value.winRate, 0) / Object.keys(STYLES).length,
  ]));
  const styleAverageText = Object.entries(styleAverages).map(([style, value]) => `${STYLES[style]} ${value.toFixed(1)}%`).join("、");
  const goalEvents = data.goalEventAnalysis;
  const goalMinuteRows = goalEvents ? Object.entries(goalEvents.goalMinuteDistribution.buckets).map(([bucket, value]) => `| ${bucket}分钟 | ${value.count} | ${value.percent}% |`).join("\n") : "| 暂无事件级数据 | 0 | 0% |";
  const scorerRoleRows = goalEvents ? Object.entries(goalEvents.scorerPositionDistribution).sort(([, left], [, right]) => right.count - left.count).map(([role, value]) => `| ${role} | ${value.count} | ${value.percent}% |`).join("\n") : "| 暂无事件级数据 | 0 | 0% |";
  const intervalRows = goalEvents ? Object.entries(goalEvents.goalIntervals.betweenAnyGoals.buckets).map(([bucket, value]) => `| ${bucket}分钟 | ${value.count} | ${value.percent}% |`).join("\n") : "| 暂无事件级数据 | 0 | 0% |";
  const seededMeta = data.randomBaseline.seededMeta;
  const seededFormationRows = Object.entries(seededMeta?.formationVsField ?? {}).map(([key, value]) => `| ${key} | ${value.matches} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  const seededTacticRows = Object.entries(seededMeta?.tacticVsField ?? {}).map(([key, value]) => `| ${TACTICS[key] ?? key} | ${value.matches} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  const seededStyleRows = Object.entries(seededMeta?.styleVsField ?? {}).map(([key, value]) => `| ${STYLES[key] ?? key} | ${value.matches} | ${value.winRate}% | ${value.goalsFor} | ${value.goalsAgainst} |`).join("\n");
  return `# 11人制好友对战综合平衡报告 ${outputVersion}

生成时间：${data.generatedAt}  
模拟总场次：${data.config.totalMatches}  
固定种子体系：\`${data.seed}\`

## 模拟口径

- 正式11人制特性池，每名球员仅绑定1张位置适配特性卡。
- 随机基线 ${data.config.randomMatches} 场；阵型、比赛思路、比赛战术均分开对照。
- 随机基线阵容生成方式：\`${data.config.lineupMode ?? "legacyGrouped"}\`${data.config.lineupMode === "seededPositionAware" ? "；完整球员池按阵型位置进行三选一式组队" : "；保留上一版分线顺序取样，便于版本对照"}。
- 事件级高负载样本 ${data.config.goalEventMatches ?? 0} 场，记录完整进球事件；JSON另保留 ${data.config.rawMatchSampleLimit ?? 0} 场逐场明细。
- 天气×战术、主攻×主守方向、主副位置、全属性差和战术适配度均使用同阵容镜像与主客场对半，降低球员抽样噪声。
- 总量：${data.config.totalMatches} 场，不包含单元测试中的比赛。

## 总体节奏

| 指标 | 结果 |
|---|---:|
| 场均进球 | ${perMatch(totals.goals, totals.matches)} |
| 场均射门 / 射正 | ${perMatch(totals.shots, totals.matches)} / ${perMatch(totals.shotsOnTarget, totals.matches)} |
| 场均 xG | ${perMatch(totals.xg, totals.matches)} |
| 场均黄牌 / 红牌 | ${perMatch(totals.yellowCards, totals.matches)} / ${perMatch(totals.redCards, totals.matches)} |
| 出现伤退的比赛 | ${percentage(totals.injuryMatches, totals.matches)} |
| 常规时间战平 | ${percentage(totals.regulationDraws, totals.matches)} |
| 点球大战 | ${percentage(totals.penaltyShootouts, totals.matches)} |
| 黑哨事件 | ${percentage(totals.blackWhistleMatches, totals.matches)} |

## 进球事件分析

事件样本共 ${goalEvents?.matches ?? 0} 场、${goalEvents?.totalGoals ?? 0} 粒正式比赛进球，不计点球大战命中。

| 指标 | 结果 |
|---|---:|
| 首球平均分钟 | ${goalEvents?.firstGoalMinute.mean ?? "--"} |
| 首球中位分钟 | ${goalEvents?.firstGoalMinute.median ?? "--"} |
| 任意相邻进球平均间隔 | ${goalEvents?.goalIntervals.betweenAnyGoals.summary.mean ?? "--"} 分钟 |
| 同队相邻进球平均间隔 | ${goalEvents?.goalIntervals.betweenSameTeamGoals.summary.mean ?? "--"} 分钟 |
| 0比0场次 | ${goalEvents?.scorelessMatches.percent ?? 0}% |
| 出现加时进球的场次 | ${goalEvents?.matchesWithExtraTimeGoal.percent ?? 0}% |

### 进球时间分布

| 时间段 | 进球 | 占比 |
|---|---:|---:|
${goalMinuteRows}

### 相邻进球间隔

| 间隔 | 次数 | 占比 |
|---|---:|---:|
${intervalRows}

### 射手位置分布

| 场上位置 | 进球 | 占比 |
|---|---:|---:|
${scorerRoleRows}

## 随机种子综合对抗环境

这部分不固定4-3-3或单一战术，而是在随机阵型、比赛思路、比赛战术和攻守方向组合中统计对全体对手的表现。严格单变量结论仍应结合后面的镜像对照实验。

### 阵型对随机环境

| 阵型 | 球队样本 | 胜率 | 场均进球 | 场均失球 |
|---|---:|---:|---:|---:|
${seededFormationRows}

### 比赛思路对随机环境

| 比赛思路 | 球队样本 | 胜率 | 场均进球 | 场均失球 |
|---|---:|---:|---:|---:|
${seededTacticRows}

### 比赛战术对随机环境

| 比赛战术 | 球队样本 | 胜率 | 场均进球 | 场均失球 |
|---|---:|---:|---:|---:|
${seededStyleRows}

## 常规阵型

| 阵型 | 对4-3-3胜率 | 进球 | 失球 | 射门 | 被射门 |
|---|---:|---:|---:|---:|---:|
${formationRows}

阵型胜率跨度：${(Math.max(...formationRates) - Math.min(...formationRates)).toFixed(1)}个百分点。

## 比赛思路矩阵

${matrix(TACTICS, data.tactics)}

## 比赛战术矩阵

${matrix(STYLES, data.styles)}

## 主攻与主守方向矩阵

每格为采用该主攻方向的球队，对采用该主守方向对手的最终胜率；双方其余方向设置保持均衡。

${matrix(FOCUSES, data.directionFocus)}

## 天气对比赛战术

每格为该战术对密集短传基准的最终胜率。

| 天气 | ${Object.values(STYLES).join(" | ")} |
|---|${Object.keys(STYLES).map(() => "---:").join("|")}| 
${weatherStyleRows}

## 裁判尺度对比赛战术

| 裁判尺度 | ${Object.values(STYLES).join(" | ")} |
|---|${Object.keys(STYLES).map(() => "---:").join("|")}| 
${refereeStyleRows}

### 随机天气分布与节奏

| 天气 | 场次 | 概率 | 场均进球 | 场均射门 | 场均伤退 |
|---|---:|---:|---:|---:|---:|
${weatherRows}

## 位置熟悉度影响

| 站位方案 | 对主位置基准胜率 | 进球 | 失球 |
|---|---:|---:|---:|
${positionRows}

## 球员能力影响

| 能力调整 | 对基准胜率 | 进球 | 失球 |
|---|---:|---:|---:|
${abilityRows}

## 战术适配度影响

| 战术 | 适配阵容胜率 | 不适配阵容胜率 | 差值 |
|---|---:|---:|---:|
${styleFitRows}

七种战术的平均适配收益差：${averageFitGap.toFixed(1)}个百分点。

## 球队身体特征影响

| 指标 | 调整 | 实际球队均值 | 胜率 | 进球 | 失球 |
|---|---:|---:|---:|---:|---:|
${physicalRows}

## 伤退与减员

| 人数状态 | 球队样本 | 胜率 | 负率 | 进球 | 失球 |
|---|---:|---:|---:|---:|---:|
${shortageRows}

## 平衡评估

1. **整体节奏。** 场均${perMatch(totals.goals, totals.matches)}球、${perMatch(totals.shots, totals.matches)}次射门；常规时间${percentage(totals.regulationDraws, totals.matches)}战平，${percentage(totals.penaltyShootouts, totals.matches)}进入点球大战。
2. **阵型范围。** 常规阵型对4-3-3的胜率为${Math.min(...formationRates).toFixed(1)}%至${Math.max(...formationRates).toFixed(1)}%，跨度${(Math.max(...formationRates) - Math.min(...formationRates)).toFixed(1)}个百分点。
3. **比赛战术。** 跨对手平均胜率为：${styleAverageText}。每格${data.config.styleMatches}场，正式判断应优先使用完整模拟档。
4. **位置熟悉度。** 全员副位置为${data.positionImpact.secondary.winRate}%，同线陌生位置为${data.positionImpact.unfamiliar.winRate}%，前锋客串门将为${data.positionImpact.forwardGoalkeeper.winRate}%。
5. **能力差。** 全属性+4为${data.abilityImpact[4].winRate}%，+8为${data.abilityImpact[8].winRate}%；用于判断高能力球员是否压过阵型与战术收益。
6. **恶劣天气。** 雷暴下长传冲吊${data.weatherStyleImpact.storm.longBall.winRate}%、防守反击${data.weatherStyleImpact.storm.counterAttack.winRate}%；雪天下分别为${data.weatherStyleImpact.snow.longBall.winRate}%和${data.weatherStyleImpact.snow.counterAttack.winRate}%。

## 建议验收区间

1. 常规阵型对4-3-3保持在42%至58%。
2. 摆大巴跨战术平均胜率保持在45%至50%。
3. 全员副位置对主位置保持在30%至40%。
4. 全属性+4保持在60%至65%，全属性+8保持在70%至75%。
5. 雷暴和雪天可以形成战术倾向，但单一战术不应长期超过65%。
`;
}

const quickMode = process.argv.includes("--quick");
const config = { ...(quickMode ? balanceConfig.quick : balanceConfig.full) };
config.totalMatches = config.randomMatches
  + Object.keys(STANDARD_FORMATIONS).length * config.formationMatches
  + Object.keys(TACTICS).length ** 2 * config.tacticMatches
  + Object.keys(STYLES).length ** 2 * config.styleMatches
  + Object.keys(FOCUSES).length ** 2 * config.focusMatches
  + Object.keys(WEATHER).length * Object.keys(STYLES).length * config.weatherStyleMatches
  + Object.keys(REFEREES).length * Object.keys(STYLES).length * config.refereeStyleMatches
  + 4 * config.positionMatches
  + 4 * config.abilityMatches
  + Object.keys(STYLES).length * 2 * config.styleFitMatches
  + 8 * config.physicalMatches
  + (config.goalEventMatches ?? 0);
const positionOnly = process.env.BALANCE_POSITION_ONLY === "1";
const renderOnly = process.argv.includes("--render-only");
if (!renderOnly) startProgress(positionOnly ? 4 * config.positionMatches : config.totalMatches);
const data = positionOnly || renderOnly
  ? JSON.parse(await readFile(jsonPath, "utf8"))
  : {
      generatedAt: new Date().toISOString(),
      seed: balanceConfig.seed,
      design: balanceConfig.design ?? null,
      targets: balanceConfig.targets,
      analysisDimensions: balanceConfig.analysisDimensions,
      config,
      randomBaseline: runRandomBaseline(config.randomMatches, config.draftChoiceCount ?? 3, config.lineupMode),
      formations: runFormationComparisons(config.formationMatches, config.draftChoiceCount ?? 3, config.lineupMode),
      tactics: runTacticMatrix(config.tacticMatches),
      styles: runStyleMatrix(config.styleMatches),
      directionFocus: runFocusMatrix(config.focusMatches),
      weatherStyleImpact: runWeatherStyleImpact(config.weatherStyleMatches),
      refereeStyleImpact: runRefereeStyleImpact(config.refereeStyleMatches),
      positionImpact: runPositionImpact(config.positionMatches),
      abilityImpact: runAbilityImpact(config.abilityMatches),
      styleFitImpact: runStyleFitImpact(config.styleFitMatches),
      physicalImpact: runPhysicalImpact(config.physicalMatches),
      goalEventAnalysis: runGoalEventAnalysis(config.goalEventMatches ?? 0, config.rawMatchSampleLimit ?? 0, config.draftChoiceCount ?? 3, config.lineupMode),
    };
if (positionOnly) {
  data.generatedAt = new Date().toISOString();
  data.positionImpact = runPositionImpact(config.positionMatches);
}
if (renderOnly) data.seed = balanceConfig.seed;
if (!renderOnly) finishProgress();

await mkdir(outputDirectory, { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await writeFile(markdownPath, markdownV3(data), "utf8");
console.log(`报告已生成：${markdownPath}`);
console.log(`原始数据已生成：${jsonPath}`);
