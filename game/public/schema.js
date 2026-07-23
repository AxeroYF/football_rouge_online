export const SEVEN_A_SIDE = Object.freeze({
  starters: 7,
  outfielders: 6,
  benchLimit: 4,
  substitutionLimit: 3,
});

export const POSITION_GROUPS = Object.freeze({
  GK: Object.freeze(["GK"]),
  DEF: Object.freeze(["CB", "LB", "RB", "LWB", "RWB"]),
  MID: Object.freeze(["DM", "AM", "LM", "RM"]),
  ATT: Object.freeze(["ST", "LW", "RW"]),
});

export const POSITION_ORDER = Object.freeze(["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);

export const ROLE_LABELS = Object.freeze({
  GK: "门将", DEF: "后卫", MID: "中场", ATT: "前锋",
  CB: "中后卫", LB: "左边后卫", RB: "右边后卫", LWB: "左边翼卫", RWB: "右边翼卫",
  DM: "后腰", AM: "前腰", LM: "左中场", RM: "右中场",
  ST: "中锋", LW: "左边锋", RW: "右边锋",
});

export const FOOT_LABELS = Object.freeze({ left: "左脚", right: "右脚", both: "双足" });

export const PERSONALITY_PROFILES = Object.freeze({
  professional: Object.freeze({ label: "职业楷模", summary: "训练稳定，成长可靠，很少因一场失利动摇。", growth: 1.18, moraleSwing: 0.78 }),
  leader: Object.freeze({ label: "更衣室领袖", summary: "精神力会感染队友，比分胶着时更能稳定全队。", growth: 1.02, moraleSwing: 0.9 }),
  resilient: Object.freeze({ label: "逆境斗士", summary: "落后和低谷中仍能维持表现，伤愈后恢复更快。", growth: 1.04, moraleSwing: 0.72 }),
  ambitious: Object.freeze({ label: "雄心勃勃", summary: "渴望进步和胜利，成长更快，但失利时情绪波动较大。", growth: 1.14, moraleSwing: 1.2 }),
  teamPlayer: Object.freeze({ label: "团队至上", summary: "更重视配合与集体结果，容易从队友的好表现中获益。", growth: 1.0, moraleSwing: 0.9 }),
  volatile: Object.freeze({ label: "情绪化", summary: "顺风时可能超常发挥，逆风时表现与状态更容易起伏。", growth: 0.96, moraleSwing: 1.45 }),
  laidBack: Object.freeze({ label: "随和散漫", summary: "情绪稳定但训练投入有限，成长速度通常偏慢。", growth: 0.82, moraleSwing: 0.7 }),
});

export const INJURY_PROFILES = Object.freeze({
  none: Object.freeze({ label: "健康", performance: 1, unavailable: false }),
  knock: Object.freeze({ label: "轻微碰撞", performance: 0.96, unavailable: true }),
  minor: Object.freeze({ label: "轻伤", performance: 0.9, unavailable: true }),
  moderate: Object.freeze({ label: "中度伤病", performance: 0.76, unavailable: true }),
  severe: Object.freeze({ label: "重伤", performance: 0.58, unavailable: true }),
  careerEnding: Object.freeze({ label: "生涯终结伤病", performance: 0, unavailable: true }),
});

export const ATTRIBUTE_NAMES = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

export const ATTRIBUTE_LABELS = Object.freeze({
  passing: "传球", firstTouch: "停球", dribbling: "盘带", crossing: "传中", finishing: "射门",
  longShots: "远射", heading: "头球", setPieces: "定位球", tackling: "抢断", marking: "盯人",
  positioning: "站位", vision: "视野", decisions: "决策", composure: "冷静", offBall: "无球",
  discipline: "纪律", pace: "速度", acceleration: "加速", strength: "力量", stamina: "耐力",
  agility: "灵活", jumping: "弹跳", workRate: "投入", aggression: "侵略性", goalkeeping: "守门",
  reflexes: "反应",
});

export const TACTIC_PRESETS = Object.freeze({
  allOutAttack: Object.freeze({ name: "全力进攻", note: "把比赛变成烟花大会", attack: 15, defense: -14, tempoDelta: 12, values: { tempo: 78, directness: 61, width: 66, pressing: 82, defensiveLine: 76, risk: 88, tackleIntensity: 58, counterAttack: 48, crossing: 63, setPieceFocus: 54, timeWasting: 2 } }),
  positive: Object.freeze({ name: "积极进攻", note: "主动寻找第二落点", attack: 8, defense: -5, tempoDelta: 6, values: { tempo: 68, directness: 56, width: 61, pressing: 68, defensiveLine: 64, risk: 68, tackleIntensity: 53, counterAttack: 55, crossing: 57, setPieceFocus: 52, timeWasting: 6 } }),
  balanced: Object.freeze({ name: "攻守平衡", note: "先看清局势再下手", attack: 0, defense: 0, tempoDelta: 0, values: { tempo: 55, directness: 50, width: 52, pressing: 55, defensiveLine: 52, risk: 50, tackleIntensity: 48, counterAttack: 52, crossing: 48, setPieceFocus: 50, timeWasting: 15 } }),
  defensive: Object.freeze({ name: "防守反击", note: "让出球权，盯住身后", attack: -5, defense: 9, tempoDelta: -3, values: { tempo: 49, directness: 67, width: 52, pressing: 40, defensiveLine: 34, risk: 38, tackleIntensity: 54, counterAttack: 82, crossing: 50, setPieceFocus: 58, timeWasting: 25 } }),
  parkBus: Object.freeze({ name: "全力防守", note: "门前临时停车场", attack: -14, defense: 16, tempoDelta: -10, values: { tempo: 38, directness: 74, width: 42, pressing: 28, defensiveLine: 22, risk: 20, tackleIntensity: 61, counterAttack: 70, crossing: 44, setPieceFocus: 62, timeWasting: 43 } }),
});

const LEGACY_POSITIONS = Object.freeze({
  DEF: "CB", MID: "DM", ATT: "ST", FB: "CB", CM: "DM", CF: "ST",
});

export function roleGroup(role) {
  if (role === "GK") return "GK";
  for (const group of ["DEF", "MID", "ATT"]) if (POSITION_GROUPS[group].includes(role)) return group;
  if (["DEF", "FB", "WB"].includes(role)) return "DEF";
  if (["MID", "CM", "AM", "WM"].includes(role)) return "MID";
  return "ATT";
}

export function boardZoneFromY(y) {
  const value = Number(y);
  if (value >= 82) return "GK";
  if (value >= 59) return "DEF";
  if (value >= 33) return "MID";
  return "ATT";
}

export function inferBoardRoles(entries = []) {
  const normalized = entries
    .filter((entry) => entry?.id && Number.isFinite(Number(entry?.position?.x)) && Number.isFinite(Number(entry?.position?.y)))
    .map((entry) => ({ id: entry.id, x: Number(entry.position.x), y: Number(entry.position.y), zone: boardZoneFromY(entry.position.y) }));
  const roles = {};
  const midfielders = normalized.filter((entry) => entry.zone === "MID");
  const wideMidfielders = midfielders.filter((entry) => entry.x < 38 || entry.x > 62);
  const midfieldReferenceY = wideMidfielders.length
    ? wideMidfielders.reduce((sum, entry) => sum + entry.y, 0) / wideMidfielders.length
    : 46;

  for (const entry of normalized) {
    if (entry.zone === "GK") roles[entry.id] = "GK";
    else if (entry.zone === "DEF") roles[entry.id] = entry.x < 38 ? "LB" : entry.x > 62 ? "RB" : "CB";
    else if (entry.zone === "ATT") roles[entry.id] = entry.x < 38 ? "LW" : entry.x > 62 ? "RW" : "ST";
    else if (entry.x < 38) roles[entry.id] = "LM";
    else if (entry.x > 62) roles[entry.id] = "RM";
    else roles[entry.id] = entry.y < midfieldReferenceY ? "AM" : "DM";
  }
  return roles;
}

export function normalizePosition(role, preferredFoot = "right", salt = 0) {
  if (role === "LWB") return "LB";
  if (role === "RWB") return "RB";
  if (POSITION_ORDER.includes(role)) return role;
  if (role === "WB") return preferredFoot === "left" ? "LM" : "RM";
  if (role === "WM") return preferredFoot === "left" ? "LM" : "RM";
  if (role === "W") return preferredFoot === "left" ? "LW" : "RW";
  if (role === "FB") return preferredFoot === "left" ? "LB" : "RB";
  if (role === "AM") return salt % 2 === 0 ? "LM" : "RM";
  return LEGACY_POSITIONS[role] ?? "DM";
}

export function positionFitScore(player, assignedRole) {
  const assigned = normalizePosition(assignedRole, player?.preferredFoot);
  const primary = normalizePosition(player?.role, player?.preferredFoot);
  const secondary = player?.secondaryRole ? normalizePosition(player.secondaryRole, player?.preferredFoot) : null;
  const assignedGroup = roleGroup(assigned);
  const primaryGroup = roleGroup(primary);
  let fit = assigned === primary
    ? 1
    : assigned === secondary
      ? 0.9
      : assignedGroup === primaryGroup
        ? 0.8
        : assignedGroup === "GK"
          ? Math.max(0.35, Number(player?.hidden?.emergencyGoalkeeper ?? 35) / 100)
          : 0.66;
  const leftSide = ["LB", "LWB", "LM", "LW"].includes(assignedRole) || ["LB", "LM", "LW"].includes(assigned);
  const rightSide = ["RB", "RWB", "RM", "RW"].includes(assignedRole) || ["RB", "RM", "RW"].includes(assigned);
  if (leftSide || rightSide) {
    if (player?.preferredFoot === "both") fit *= 1.03;
    else if ((leftSide && player?.preferredFoot === "left") || (rightSide && player?.preferredFoot === "right")) fit *= 1.02;
    else fit *= 0.95;
  }
  return Math.max(0.35, Math.min(1.04, fit));
}

export function clampValue(value, minimum = 1, maximum = 99) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : 50));
}

function stableScore(value, salt = "") {
  let hash = 2166136261;
  for (const character of `${value ?? "player"}:${salt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10001) / 100;
}

function inferredPersonality(hidden) {
  if (PERSONALITY_PROFILES[hidden.personality]) return hidden.personality;
  const scores = {
    professional: hidden.professionalism * 1.08 + hidden.consistency * 0.38,
    leader: hidden.leadership * 1.05 + hidden.teamwork * 0.42 + hidden.mentality * 0.25,
    resilient: hidden.mentality * 0.72 + hidden.pressure * 0.58 - hidden.volatility * 0.22,
    ambitious: hidden.ambition * 1.08 + hidden.professionalism * 0.22,
    teamPlayer: hidden.teamwork * 1.08 + hidden.leadership * 0.24,
    volatile: hidden.volatility * 1.22 + (100 - hidden.consistency) * 0.24,
    laidBack: (100 - hidden.professionalism) * 0.88 + (100 - hidden.ambition) * 0.48,
  };
  return Object.entries(scores).sort((left, right) => right[1] - left[1])[0][0];
}

function normalizeHidden(player) {
  const input = player.hidden ?? {};
  const seed = player.id ?? player.name ?? "player";
  const hidden = {
    ...input,
    mentality: Math.round(clampValue(input.mentality ?? 42 + stableScore(seed, "mentality") * 0.5, 1, 99)),
    professionalism: Math.round(clampValue(input.professionalism ?? 35 + stableScore(seed, "professionalism") * 0.58, 1, 99)),
    ambition: Math.round(clampValue(input.ambition ?? 35 + stableScore(seed, "ambition") * 0.58, 1, 99)),
    consistency: Math.round(clampValue(input.consistency ?? 40 + stableScore(seed, "consistency") * 0.52, 1, 99)),
    pressure: Math.round(clampValue(input.pressure ?? 38 + stableScore(seed, "pressure") * 0.56, 1, 99)),
    teamwork: Math.round(clampValue(input.teamwork ?? 38 + stableScore(seed, "teamwork") * 0.56, 1, 99)),
    leadership: Math.round(clampValue(input.leadership ?? 28 + stableScore(seed, "leadership") * 0.62, 1, 99)),
    volatility: Math.round(clampValue(input.volatility ?? 18 + stableScore(seed, "volatility") * 0.68, 1, 99)),
    injuryResistance: Math.round(clampValue(input.injuryResistance ?? 45 + stableScore(seed, "injuryResistance") * 0.46, 1, 99)),
    emergencyGoalkeeper: Math.round(clampValue(input.emergencyGoalkeeper ?? 25 + stableScore(seed, "emergencyGoalkeeper") * 0.5, 1, 99)),
  };
  hidden.personality = inferredPersonality(hidden);
  return hidden;
}

function normalizeInjury(injury) {
  const input = injury && typeof injury === "object" ? injury : {};
  const matchesRemaining = Math.max(0, Math.round(Number(input.matchesRemaining) || 0));
  const severity = matchesRemaining > 0 && INJURY_PROFILES[input.severity] ? input.severity : "none";
  return {
    severity,
    matchesRemaining: severity === "none" ? 0 : matchesRemaining,
    totalMatches: severity === "none" ? 0 : Math.max(matchesRemaining, Math.round(Number(input.totalMatches) || matchesRemaining)),
    cause: severity === "none" ? null : input.cause ?? "match",
    sufferedAtStage: severity === "none" ? null : Number.isFinite(Number(input.sufferedAtStage)) ? Number(input.sufferedAtStage) : null,
  };
}

function normalizeSuspension(suspension) {
  const input = suspension && typeof suspension === "object" ? suspension : {};
  const matchesRemaining = Math.max(0, Math.round(Number(input.matchesRemaining) || 0));
  return {
    matchesRemaining,
    totalMatches: matchesRemaining > 0 ? Math.max(matchesRemaining, Math.round(Number(input.totalMatches) || matchesRemaining)) : 0,
    reason: matchesRemaining > 0 ? input.reason ?? "redCard" : null,
    receivedAtStage: matchesRemaining > 0 && Number.isFinite(Number(input.receivedAtStage)) ? Number(input.receivedAtStage) : null,
  };
}

function roughAbility(attributes, role) {
  const group = roleGroup(role);
  const keys = group === "GK"
    ? ["goalkeeping", "reflexes", "positioning", "composure"]
    : group === "DEF"
      ? ["tackling", "marking", "positioning", "strength", "pace"]
      : group === "MID"
        ? ["passing", "vision", "decisions", "firstTouch", "stamina"]
        : ["finishing", "offBall", "pace", "dribbling", "composure"];
  return keys.reduce((sum, key) => sum + Number(attributes[key] ?? 50), 0) / keys.length;
}

function legacyAttributeSource(player) {
  const input = player?.attributes ?? {};
  const attack = Number(input.attack ?? 60);
  const passing = Number(input.passing ?? 60);
  const defense = Number(input.defense ?? 60);
  const pace = Number(input.pace ?? 60);
  const stamina = Number(input.stamina ?? 65);
  const composure = Number(input.composure ?? 60);
  const aggression = Number(input.aggression ?? 55);
  const goalkeeping = Number(input.goalkeeping ?? 15);
  return {
    passing, firstTouch: (passing + composure) / 2, dribbling: (attack + pace) / 2, crossing: (passing + pace) / 2,
    finishing: attack, longShots: (attack + composure) / 2, heading: (attack + defense) / 2, setPieces: (passing + composure) / 2,
    tackling: defense, marking: defense, positioning: (defense + composure) / 2, vision: passing,
    decisions: composure, composure, offBall: attack, discipline: 100 - aggression * 0.55,
    pace, acceleration: pace, strength: (defense + stamina) / 2, stamina, agility: pace, jumping: (defense + pace) / 2,
    workRate: stamina, aggression, goalkeeping, reflexes: goalkeeping,
  };
}

export function normalizeAttributes(player = {}) {
  const input = player.attributes ?? {};
  const legacy = legacyAttributeSource(player);
  return Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, Math.round(clampValue(input[name] ?? legacy[name]))]));
}

export function normalizePlayerSchema(player = {}, options = {}) {
  const preferredFoot = ["left", "right", "both"].includes(player.preferredFoot) ? player.preferredFoot : "right";
  const role = normalizePosition(player.role ?? options.fallbackRole, preferredFoot, options.index ?? 0);
  const secondary = player.secondaryRole
    ? normalizePosition(player.secondaryRole, preferredFoot, (options.index ?? 0) + 1)
    : null;
  const state = player.state ?? {};
  const hidden = normalizeHidden(player);
  const attributes = normalizeAttributes(player);
  const currentAbility = roughAbility(attributes, role);
  const development = player.development ?? {};
  const seed = player.id ?? player.name ?? options.index ?? "player";
  return {
    ...player,
    role,
    secondaryRole: secondary === role || role === "GK" ? null : secondary,
    preferredFoot,
    heightCm: Math.round(clampValue(player.heightCm ?? player.attributes?.height ?? 180, 155, 205)),
    attributes,
    hidden,
    development: {
      age: Math.round(clampValue(development.age ?? 18 + stableScore(seed, "age") * 0.13, 16, 40)),
      potential: Math.round(clampValue(development.potential ?? currentAbility + 5 + stableScore(seed, "potential") * 0.12, 40, 99)),
      experience: Math.max(0, Math.round(Number(development.experience) || 0)),
      level: Math.max(1, Math.round(Number(development.level) || 1)),
      matchesPlayed: Math.max(0, Math.round(Number(development.matchesPlayed) || 0)),
      growthRate: Number(clampValue(development.growthRate ?? 75 + (hidden.professionalism - 50) * 0.32, 35, 130).toFixed(1)),
      lastGrowth: development.lastGrowth && typeof development.lastGrowth === "object" ? development.lastGrowth : null,
    },
    state: {
      retired: Boolean(state.retired),
      fitness: Math.round(clampValue(state.fitness ?? player.attributes?.fitness ?? 100, 0, 100)),
      form: Math.round(clampValue(state.form ?? 50, 0, 100)),
      morale: Math.round(clampValue(state.morale ?? player.morale ?? 70, 0, 100)),
      injuryProneness: Math.round(clampValue(state.injuryProneness ?? (100 - hidden.injuryResistance), 0, 100)),
      injury: normalizeInjury(state.injury),
      suspension: normalizeSuspension(state.suspension),
    },
  };
}

function rawMentalStrength(normalized) {
  const a = normalized.attributes;
  const h = normalized.hidden;
  return a.composure * 0.23 + a.decisions * 0.18 + a.discipline * 0.08 + h.mentality * 0.2 + h.pressure * 0.13 + h.consistency * 0.1 + h.leadership * 0.08;
}

export function playerMentalStrength(player) {
  return Math.round(clampValue(rawMentalStrength(normalizePlayerSchema(player)), 1, 99));
}

export function playerPhysicalQuality(player) {
  const normalized = normalizePlayerSchema(player);
  const a = normalized.attributes;
  return Math.round(clampValue(a.strength * 0.23 + a.stamina * 0.2 + a.pace * 0.14 + a.acceleration * 0.1 + a.agility * 0.12 + a.jumping * 0.12 + a.workRate * 0.09, 1, 99));
}

export function heightAerialModifier(heightCm = 180) {
  return clampValue((Number(heightCm) - 180) * 0.65, -14, 15);
}

export function playerAerialAbility(player) {
  const normalized = normalizePlayerSchema(player);
  const a = normalized.attributes;
  return Math.round(clampValue(a.heading * 0.43 + a.jumping * 0.29 + a.strength * 0.16 + a.offBall * 0.07 + rawMentalStrength(normalized) * 0.05 + heightAerialModifier(normalized.heightCm), 1, 99));
}

export function playerInjuryAvailability(player) {
  const normalized = normalizePlayerSchema(player);
  return INJURY_PROFILES[normalized.state.injury.severity]?.performance ?? 1;
}

export function isPlayerUnavailable(player) {
  const normalized = normalizePlayerSchema(player);
  const injured = INJURY_PROFILES[normalized.state.injury.severity]?.unavailable && normalized.state.injury.matchesRemaining > 0;
  return Boolean(normalized.state.retired || injured || normalized.state.suspension.matchesRemaining > 0);
}

export function isPlayerSuspended(player) {
  return normalizePlayerSchema(player).state.suspension.matchesRemaining > 0;
}

export function personalityObservation(player) {
  const normalized = normalizePlayerSchema(player);
  const profile = PERSONALITY_PROFILES[normalized.hidden.personality] ?? PERSONALITY_PROFILES.teamPlayer;
  const mental = rawMentalStrength(normalized);
  return {
    id: normalized.hidden.personality,
    label: profile.label,
    summary: profile.summary,
    mentalBand: mental >= 78 ? "意志坚定" : mental >= 64 ? "精神稳定" : mental >= 50 ? "容易受比赛走势影响" : "抗压能力存疑",
  };
}

function weighted(attributes, entries) {
  return entries.reduce((sum, [name, weight]) => sum + Number(attributes[name] ?? 50) * weight, 0);
}

export function playerMetric(player, metric) {
  const normalized = normalizePlayerSchema(player);
  const a = normalized.attributes;
  const metrics = {
    attack: weighted(a, [["finishing", .34], ["offBall", .2], ["dribbling", .16], ["longShots", .12], ["heading", .1], ["composure", .08]]),
    passing: weighted(a, [["passing", .34], ["vision", .22], ["decisions", .16], ["firstTouch", .12], ["crossing", .1], ["setPieces", .06]]),
    defense: weighted(a, [["tackling", .28], ["marking", .25], ["positioning", .22], ["decisions", .1], ["strength", .08], ["discipline", .07]]),
    pace: weighted(a, [["pace", .55], ["acceleration", .3], ["agility", .15]]),
    stamina: weighted(a, [["stamina", .65], ["workRate", .35]]),
    composure: weighted(a, [["composure", .7], ["decisions", .3]]),
    aggression: a.aggression,
    goalkeeping: weighted(a, [["goalkeeping", .58], ["reflexes", .27], ["positioning", .1], ["composure", .05]]),
    fitness: normalized.state.fitness,
    morale: normalized.state.morale,
    height: normalized.heightCm,
    mental: rawMentalStrength(normalized),
    physical: playerPhysicalQuality(normalized),
    aerial: playerAerialAbility(normalized),
    availability: playerInjuryAvailability(normalized) * 100,
  };
  return Math.round(metrics[metric] ?? a[metric] ?? 50);
}

export function compactPlayerMetrics(player) {
  return Object.fromEntries(["attack", "passing", "defense", "pace", "stamina", "composure", "aggression", "goalkeeping", "fitness", "morale", "height", "mental", "physical", "aerial", "availability"].map((key) => [key, playerMetric(player, key)]));
}

export function sevenFormationName(players = []) {
  const counts = { DEF: 0, MID: 0, ATT: 0 };
  players.slice(0, SEVEN_A_SIDE.starters).forEach((player) => {
    const group = roleGroup(player.assignedRole ?? player.role);
    if (group !== "GK") counts[group] += 1;
  });
  return `${counts.DEF}-${counts.MID}-${counts.ATT}`;
}
