const PHYSICAL_ATTRIBUTES = new Set(["pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate"]);

const LEGEND_TEMPLATES = Object.freeze([
  { name: "古典组织核心", attack: 1.16, passing: 1.3, defense: 0.92, physical: 1.05, mental: 1.22, goalkeeping: 0.45 },
  { name: "爆破边锋", attack: 1.28, passing: 1.1, defense: 0.8, physical: 1.24, mental: 1.12, goalkeeping: 0.4 },
  { name: "禁区之王", attack: 1.32, passing: 1.02, defense: 0.84, physical: 1.18, mental: 1.25, goalkeeping: 0.42 },
  { name: "传奇门神", attack: 0.55, passing: 1.08, defense: 1.2, physical: 1.08, mental: 1.24, goalkeeping: 1.42 },
  { name: "全能队长", attack: 1.17, passing: 1.2, defense: 1.18, physical: 1.17, mental: 1.28, goalkeeping: 0.5 },
  { name: "钢铁中卫", attack: 0.86, passing: 1.05, defense: 1.38, physical: 1.28, mental: 1.2, goalkeeping: 0.48 },
  { name: "中场魔术师", attack: 1.12, passing: 1.36, defense: 1.02, physical: 1.05, mental: 1.3, goalkeeping: 0.45 },
]);

const ATTACK_ATTRIBUTES = new Set(["finishing", "longShots", "offBall", "dribbling", "heading"]);
const PASSING_ATTRIBUTES = new Set(["passing", "firstTouch", "crossing", "vision", "setPieces"]);
const DEFENSE_ATTRIBUTES = new Set(["tackling", "marking", "positioning"]);
const MENTAL_ATTRIBUTES = new Set(["decisions", "composure", "discipline", "aggression"]);
const GOALKEEPING_ATTRIBUTES = new Set(["goalkeeping", "reflexes"]);

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function playerTraitIds(player = {}) {
  const values = Array.isArray(player.traitCards) ? player.traitCards : player.traits ?? [];
  return values.map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean);
}

export function hydratePlayerTraits(player, catalog = [], seed = "match") {
  const byId = catalog instanceof Map ? catalog : new Map((catalog ?? []).map((trait) => [trait.id, trait]));
  const definitions = byId.size
    ? playerTraitIds(player).map((id) => byId.get(id)).filter(Boolean)
    : (player.traitDefinitions ?? []);
  const output = { ...player, traitDefinitions: definitions };
  const copyRule = definitions.flatMap((trait) => trait.rules ?? []).find((rule) => rule.hook === "copyRandomLegend");
  if (copyRule) {
    const template = LEGEND_TEMPLATES[hashText(`${seed}:${player.id}:legend`) % LEGEND_TEMPLATES.length];
    output.copiedLegendTemplate = template;
  }
  return output;
}

export function traitRules(player, hook = null) {
  const rules = (player?.traitDefinitions ?? []).flatMap((trait) => (trait.rules ?? []).map((rule) => ({ ...rule, traitId: trait.id, traitName: trait.name })));
  return hook ? rules.filter((rule) => rule.hook === hook) : rules;
}

export function traitConditionMatches(when, player, context = {}) {
  if (!when) return true;
  const scoreState = context.scoreState ?? "tied";
  const minute = Number(context.minute ?? 0);
  const role = player.assignedRole ?? player.role;
  const isWide = ["LB", "RB", "LM", "RM", "LW", "RW"].includes(role);
  const checks = {
    roleIsWide: () => isWide === Boolean(when.roleIsWide),
    roleIsCentral: () => !isWide === Boolean(when.roleIsCentral),
    minuteGte: () => minute >= Number(when.minuteGte),
    minuteLte: () => minute <= Number(when.minuteLte),
    fitnessLte: () => Number(player.state?.fitness ?? 100) <= Number(when.fitnessLte),
    precipitationGte: () => Number(context.weather?.precipitation ?? 0) >= Number(when.precipitationGte),
    pitchQualityLte: () => Number(context.pitchQuality ?? 100) <= Number(when.pitchQualityLte),
    scoreState: () => (Array.isArray(when.scoreState) ? when.scoreState : [when.scoreState]).includes(scoreState),
    weather: () => (Array.isArray(when.weather) ? when.weather : [when.weather]).includes(context.weather?.type),
    venue: () => (Array.isArray(when.venue) ? when.venue : [when.venue]).includes(context.venue ?? "home"),
    activeRole: () => role === when.activeRole || (when.activeRole === "ATT" && ["ST", "LW", "RW"].includes(role)),
    activeRoleNot: () => role !== when.activeRoleNot,
    teamDefensiveLineGte: () => Number(context.tactics?.defensiveLine ?? 50) >= Number(when.teamDefensiveLineGte),
    teamDefensiveLineLte: () => Number(context.tactics?.defensiveLine ?? 50) <= Number(when.teamDefensiveLineLte),
    teamDirectnessGte: () => Number(context.tactics?.directness ?? 50) >= Number(when.teamDirectnessGte),
    teamPlayerDeficitGte: () => Number(context.playerDeficit ?? 0) >= Number(when.teamPlayerDeficitGte),
    leadEquals: () => Number(context.scoreDifference ?? 0) === Number(when.leadEquals),
    shotType: () => context.shotType === when.shotType,
    xgLte: () => Number(context.xg ?? 1) <= Number(when.xgLte),
    xgGte: () => Number(context.xg ?? 0) >= Number(when.xgGte),
  };
  return Object.entries(when).every(([key]) => checks[key] ? checks[key]() : false);
}

function legendMultiplier(player, attribute) {
  const template = player.copiedLegendTemplate;
  if (!template) return 1;
  if (ATTACK_ATTRIBUTES.has(attribute)) return template.attack;
  if (PASSING_ATTRIBUTES.has(attribute)) return template.passing;
  if (DEFENSE_ATTRIBUTES.has(attribute)) return template.defense;
  if (PHYSICAL_ATTRIBUTES.has(attribute)) return template.physical;
  if (MENTAL_ATTRIBUTES.has(attribute)) return template.mental;
  if (GOALKEEPING_ATTRIBUTES.has(attribute)) return template.goalkeeping;
  return 1;
}

export function traitAdjustedAttribute(player, attribute, baseValue, context = {}) {
  let value = Number(baseValue ?? 50) * legendMultiplier(player, attribute);
  for (const rule of traitRules(player)) {
    if (!traitConditionMatches(rule.when, player, context)) continue;
    if (rule.hook === "attribute" && rule.add && Number.isFinite(Number(rule.add[attribute]))) value += Number(rule.add[attribute]);
    if (rule.hook === "allAttributes" && Number.isFinite(Number(rule.multiply))) value *= Number(rule.multiply);
    if (rule.hook === "afterGoalBuff" && player.matchTraitState?.scored && Number.isFinite(Number(rule.multiplyAllAttributes))) value *= Number(rule.multiplyAllAttributes);
    if (rule.hook === "campaignDeparture" && Number.isFinite(Number(rule.multiplyAllAttributes))) value *= Number(rule.multiplyAllAttributes);
  }
  return Math.max(1, Math.min(99, value));
}

export function traitPositionFit(player, originalFit) {
  const floor = traitRules(player, "position").reduce((value, rule) => Math.max(value, Number(rule.minimumFit) || (rule.ignoreOutOfPositionPenalty ? 1 : 0)), 0);
  return Math.max(originalFit, floor);
}

export function hasTraitRule(player, hook, predicate = () => true) {
  return traitRules(player, hook).some(predicate);
}

export function traitRuleProduct(player, hook, field, context = {}) {
  return traitRules(player, hook).filter((rule) => traitConditionMatches(rule.when, player, context)).reduce((value, rule) => value * (Number(rule[field]) || 1), 1);
}

export function teamTraitRules(players = [], hook, context = {}) {
  return players.flatMap((player) => traitRules(player, hook)
    .filter((rule) => traitConditionMatches(rule.when, player, context))
    .map((rule) => ({ ...rule, player, playerId: player.id, playerName: player.name })));
}

export function weatherPenaltyMultiplier(player) {
  return hasTraitRule(player, "weather", (rule) => rule.ignoreAllPenalties) ? 0 : 1;
}

export function injuryImmune(player) {
  return hasTraitRule(player, "injury", (rule) => rule.immune);
}
