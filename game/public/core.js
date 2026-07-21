import { computeTeamBonds, sumBondBonuses } from "./bonds.js";
import {
  advanceMatchSession,
  createMatchSession,
  resolveMatchSessionInjuryShortHanded,
  matchSessionSnapshot,
  substituteMatchSessionPlayer,
  updateMatchSessionTactics,
} from "../../src/model.js";
import {
  FOOT_LABELS,
  POSITION_GROUPS,
  ROLE_LABELS,
  SEVEN_A_SIDE,
  TACTIC_PRESETS,
  compactPlayerMetrics,
  normalizePlayerSchema,
  playerMetric,
  positionFitScore,
  roleGroup,
} from "./schema.js";
import { normalizeGameConfig } from "./config.js";
import { hydratePlayerTraits } from "./trait-runtime.js";
import { LOCALIZED_PLAYER_NAME_CAPACITY, randomLocalizedPlayerName, randomLocalizedTeamName } from "./names.js";

export { FOOT_LABELS, POSITION_GROUPS, ROLE_LABELS, playerMetric, roleGroup } from "./schema.js";
export { LOCALIZED_NAME_TIERS, LOCALIZED_PLAYER_NAME_CAPACITY, localizedPlayerNameCapacity, nameTier, nameTierIndex, randomLocalizedPlayerName, randomLocalizedTeamName } from "./names.js";
export const TEAM_SIZE = SEVEN_A_SIDE.starters;
export const DEFAULT_FORMATION_KEY = "231";

const SECONDARY_POSITIONS = Object.freeze({
  GK: [], CB: ["LB", "RB", "DM"], LB: ["CB", "LM"], RB: ["CB", "RM"],
  DM: ["CB", "AM", "LM", "RM"], AM: ["DM", "LM", "RM", "ST"], LM: ["LB", "DM", "AM", "LW"], RM: ["RB", "DM", "AM", "RW"],
  ST: ["LW", "RW"], LW: ["LM", "ST"], RW: ["RM", "ST"],
});

export function preferredFootForPosition(position, rng = Math.random) {
  if (["LB", "LM", "LW"].includes(position)) return rng() < 0.72 ? "left" : rng() < 0.9 ? "right" : "both";
  if (["RB", "RM", "RW"].includes(position)) return rng() < 0.72 ? "right" : rng() < 0.9 ? "left" : "both";
  const roll = rng();
  return roll < 0.31 ? "left" : roll < 0.94 ? "right" : "both";
}

export function roleFitScore(player, assignedRole) {
  return positionFitScore(player, assignedRole);
}

export function formationSlotsFromKey(key = DEFAULT_FORMATION_KEY) {
  const match = String(key).match(/^(\d)(\d)(\d)$/);
  const counts = match ? match.slice(1).map(Number) : [2, 3, 1];
  if (counts.some((count) => count < 1) || counts.reduce((sum, count) => sum + count, 0) !== TEAM_SIZE - 1) {
    return formationSlotsFromKey(DEFAULT_FORMATION_KEY);
  }
  return ["GK", ...Array(counts[0]).fill("DEF"), ...Array(counts[1]).fill("MID"), ...Array(counts[2]).fill("ATT")];
}

export const TACTICS = Object.freeze(Object.fromEntries(Object.entries(TACTIC_PRESETS).map(([key, preset]) => [key, {
  name: preset.name,
  attack: preset.attack,
  defense: preset.defense,
  tempo: preset.tempoDelta,
  note: preset.note,
  values: preset.values,
}])));

export const WEATHER = Object.freeze({
  sunny: { name: "晴朗", icon: "SUN", weight: 60, attack: 0, defense: 0, fatigue: 1 },
  rain: { name: "雨天", icon: "RAIN", weight: 15, attack: 1, defense: -5, fatigue: 1.2 },
  storm: { name: "雷暴", icon: "STORM", weight: 15, attack: 0, defense: -7, fatigue: 1.3 },
  snow: { name: "雪天", icon: "SNOW", weight: 10, attack: -10, defense: 1, fatigue: 1.35 },
});

const QUIRKS = ["赛前一定先系左脚鞋带", "坚信门柱也是队友", "庆祝动作排练得比射门多", "会给每一只足球取名字", "下雨天跑得格外认真", "永远自带一卷运动胶带"];

const POSITION_ATTRIBUTE_ADJUSTMENTS = Object.freeze({
  GK: Object.freeze({ passing: 0, firstTouch: -2, dribbling: -18, crossing: -12, finishing: -24, longShots: -18, heading: -3, setPieces: -10, tackling: -8, marking: -6, positioning: 9, vision: 2, decisions: 5, composure: 7, offBall: -16, discipline: 6, pace: -8, acceleration: -8, strength: 3, stamina: -1, agility: 2, jumping: 4, workRate: 0, aggression: -8, goalkeeping: 15, reflexes: 16 }),
  CB: Object.freeze({ passing: -2, firstTouch: -2, dribbling: -6, crossing: -5, finishing: -10, longShots: -7, heading: 8, setPieces: -6, tackling: 11, marking: 11, positioning: 9, vision: -1, decisions: 4, composure: 2, offBall: -5, discipline: 2, pace: -2, acceleration: -3, strength: 8, stamina: 4, agility: -4, jumping: 8, workRate: 5, aggression: 7 }),
  LB: Object.freeze({ passing: 2, firstTouch: 1, dribbling: 3, crossing: 8, finishing: -6, longShots: -2, heading: -3, setPieces: 1, tackling: 5, marking: 4, positioning: 4, vision: 2, decisions: 2, offBall: 3, discipline: 1, pace: 8, acceleration: 8, strength: -2, stamina: 8, agility: 6, jumping: -3, workRate: 8, aggression: 2 }),
  RB: Object.freeze({ passing: 2, firstTouch: 1, dribbling: 3, crossing: 8, finishing: -6, longShots: -2, heading: -3, setPieces: 1, tackling: 5, marking: 4, positioning: 4, vision: 2, decisions: 2, offBall: 3, discipline: 1, pace: 8, acceleration: 8, strength: -2, stamina: 8, agility: 6, jumping: -3, workRate: 8, aggression: 2 }),
  DM: Object.freeze({ passing: 6, firstTouch: 4, dribbling: 0, crossing: 1, finishing: -7, longShots: 3, heading: 1, setPieces: 3, tackling: 7, marking: 6, positioning: 8, vision: 7, decisions: 7, composure: 5, offBall: 1, discipline: 4, pace: -1, acceleration: -2, strength: 4, stamina: 8, jumping: 1, workRate: 8, aggression: 5 }),
  AM: Object.freeze({ passing: 8, firstTouch: 8, dribbling: 7, crossing: 3, finishing: 5, longShots: 7, heading: -3, setPieces: 6, tackling: -5, marking: -5, positioning: 0, vision: 11, decisions: 7, composure: 6, offBall: 8, discipline: 1, pace: 3, acceleration: 4, strength: -4, stamina: 4, agility: 7, jumping: -4, workRate: 3, aggression: -4 }),
  LM: Object.freeze({ passing: 7, firstTouch: 6, dribbling: 7, crossing: 8, finishing: 0, longShots: 3, heading: -4, setPieces: 4, tackling: 0, marking: -1, positioning: 1, vision: 8, decisions: 4, composure: 3, offBall: 5, pace: 7, acceleration: 7, strength: -4, stamina: 7, agility: 8, jumping: -4, workRate: 5, aggression: -3 }),
  RM: Object.freeze({ passing: 7, firstTouch: 6, dribbling: 7, crossing: 8, finishing: 0, longShots: 3, heading: -4, setPieces: 4, tackling: 0, marking: -1, positioning: 1, vision: 8, decisions: 4, composure: 3, offBall: 5, pace: 7, acceleration: 7, strength: -4, stamina: 7, agility: 8, jumping: -4, workRate: 5, aggression: -3 }),
  ST: Object.freeze({ passing: -2, firstTouch: 3, dribbling: 4, crossing: -5, finishing: 12, longShots: 6, heading: 6, setPieces: 1, tackling: -12, marking: -12, positioning: -4, vision: -2, decisions: 3, composure: 7, offBall: 11, discipline: -1, pace: 5, acceleration: 5, strength: 3, stamina: 1, agility: 3, jumping: 4, workRate: 1, aggression: 2 }),
  LW: Object.freeze({ passing: 3, firstTouch: 6, dribbling: 10, crossing: 7, finishing: 6, longShots: 4, heading: -5, setPieces: 2, tackling: -8, marking: -8, positioning: -3, vision: 4, decisions: 2, composure: 3, offBall: 9, pace: 10, acceleration: 10, strength: -5, stamina: 3, agility: 10, jumping: -5, workRate: 3, aggression: -3 }),
  RW: Object.freeze({ passing: 3, firstTouch: 6, dribbling: 10, crossing: 7, finishing: 6, longShots: 4, heading: -5, setPieces: 2, tackling: -8, marking: -8, positioning: -3, vision: 4, decisions: 2, composure: 3, offBall: 9, pace: 10, acceleration: 10, strength: -5, stamina: 3, agility: 10, jumping: -5, workRate: 3, aggression: -3 }),
});

const PLAYER_ARCHETYPES = Object.freeze({
  GK: Object.freeze([
    { id: "shot-stopper", label: "门线反应型", adjustments: { goalkeeping: 8, reflexes: 10, positioning: 3, passing: -6 } },
    { id: "sweeper-keeper", label: "出击组织型", adjustments: { passing: 9, firstTouch: 6, decisions: 6, pace: 5, goalkeeping: 2, reflexes: -3 } },
    { id: "aerial-keeper", label: "高空统治型", adjustments: { heading: 5, jumping: 8, strength: 7, positioning: 6, agility: -4 }, heightShift: 6 },
  ]),
  CB: Object.freeze([
    { id: "stopper", label: "强硬上抢型", adjustments: { strength: 9, tackling: 8, aggression: 8, pace: -5, passing: -4 } },
    { id: "ball-playing-defender", label: "出球中卫", adjustments: { passing: 9, vision: 7, firstTouch: 6, decisions: 5, tackling: -2 } },
    { id: "cover-defender", label: "回追补位型", adjustments: { pace: 10, acceleration: 8, positioning: 6, strength: -3, heading: -4 } },
    { id: "aerial-defender", label: "制空铁塔", adjustments: { heading: 11, jumping: 9, strength: 8, pace: -5, agility: -4 }, heightShift: 7 },
  ]),
  FB: Object.freeze([
    { id: "overlapping-fullback", label: "套边飞翼", adjustments: { pace: 7, acceleration: 7, crossing: 10, stamina: 8, marking: -4 } },
    { id: "defensive-fullback", label: "防守边闸", adjustments: { tackling: 8, marking: 8, positioning: 6, strength: 4, crossing: -5, dribbling: -3 } },
    { id: "inverted-fullback", label: "内收组织型", adjustments: { passing: 9, firstTouch: 7, decisions: 6, vision: 6, crossing: -3, pace: -2 } },
  ]),
  DM: Object.freeze([
    { id: "anchor", label: "防线屏障", adjustments: { tackling: 9, marking: 8, positioning: 8, strength: 6, dribbling: -5 } },
    { id: "deep-playmaker", label: "拖后组织者", adjustments: { passing: 10, vision: 10, decisions: 7, setPieces: 5, pace: -5, tackling: -2 } },
    { id: "midfield-runner", label: "覆盖型中场", adjustments: { stamina: 11, workRate: 10, pace: 5, tackling: 4, composure: -3 } },
  ]),
  AM: Object.freeze([
    { id: "classic-ten", label: "古典前腰", adjustments: { passing: 10, vision: 11, firstTouch: 8, decisions: 6, pace: -4, tackling: -5 } },
    { id: "shadow-runner", label: "影子攻击手", adjustments: { offBall: 10, finishing: 8, acceleration: 7, composure: 5, marking: -5 } },
    { id: "pressing-ten", label: "压迫前腰", adjustments: { workRate: 9, stamina: 8, aggression: 5, passing: 5, composure: -3 } },
  ]),
  WM: Object.freeze([
    { id: "wide-creator", label: "边路创造者", adjustments: { crossing: 11, passing: 8, vision: 8, decisions: 4, strength: -3 } },
    { id: "two-way-midfielder", label: "攻防往返型", adjustments: { stamina: 9, workRate: 10, tackling: 6, crossing: 4, dribbling: -2 } },
    { id: "ball-carrier", label: "推进持球手", adjustments: { dribbling: 10, acceleration: 8, agility: 8, firstTouch: 6, passing: -2 } },
  ]),
  ST: Object.freeze([
    { id: "poacher", label: "禁区猎手", adjustments: { finishing: 11, offBall: 10, composure: 7, passing: -7, workRate: -3 } },
    { id: "target-forward", label: "支点中锋", adjustments: { heading: 11, strength: 10, jumping: 7, firstTouch: 5, pace: -7, agility: -5 }, heightShift: 7 },
    { id: "pressing-forward", label: "压迫前锋", adjustments: { workRate: 11, stamina: 9, aggression: 7, pace: 6, finishing: -3 } },
    { id: "complete-forward", label: "全能中锋", adjustments: { finishing: 5, passing: 5, dribbling: 4, heading: 4, strength: 4, offBall: 5 } },
  ]),
  W: Object.freeze([
    { id: "inside-forward", label: "内切终结者", adjustments: { finishing: 9, dribbling: 8, offBall: 7, longShots: 5, crossing: -4 } },
    { id: "touchline-winger", label: "贴线爆点", adjustments: { pace: 8, crossing: 11, passing: 5, acceleration: 5, finishing: -4 } },
    { id: "speedster", label: "纯速度爆点", adjustments: { pace: 12, acceleration: 11, agility: 7, decisions: -6, passing: -3 } },
    { id: "wide-playmaker", label: "边路组织者", adjustments: { passing: 9, vision: 10, firstTouch: 7, decisions: 6, pace: -4 } },
  ]),
});

const PHYSICAL_PROFILES = Object.freeze([
  { id: "balanced", label: "均衡体格", adjustments: {}, heightShift: 0, injuryResistance: 2 },
  { id: "explosive", label: "爆发型", adjustments: { pace: 9, acceleration: 11, agility: 6, stamina: -3, strength: -3 }, heightShift: -2, injuryResistance: -5 },
  { id: "powerful", label: "力量型", adjustments: { strength: 11, jumping: 7, heading: 4, pace: -4, acceleration: -5, agility: -5 }, heightShift: 4, injuryResistance: 5 },
  { id: "engine", label: "耐力型", adjustments: { stamina: 12, workRate: 10, pace: 2, strength: 2, acceleration: -2 }, heightShift: 0, injuryResistance: 7 },
  { id: "agile", label: "灵巧型", adjustments: { agility: 11, acceleration: 8, dribbling: 5, strength: -8, heading: -3 }, heightShift: -5, injuryResistance: -2 },
  { id: "tower", label: "高大型", adjustments: { heading: 8, jumping: 9, strength: 7, pace: -5, agility: -8 }, heightShift: 9, injuryResistance: 3 },
  { id: "compact", label: "低重心型", adjustments: { acceleration: 6, agility: 9, strength: 3, heading: -7, jumping: -3 }, heightShift: -8, injuryResistance: 4 },
]);

const CAREER_STAGES = Object.freeze([
  { id: "prospect", label: "青年新秀", weight: 24, age: [17, 21], ability: -4, potential: 18, growth: 112, adjustments: { decisions: -4, composure: -5, consistency: -5 } },
  { id: "developing", label: "成长球员", weight: 29, age: [20, 24], ability: 0, potential: 13, growth: 98, adjustments: { workRate: 2 } },
  { id: "prime", label: "当打之年", weight: 32, age: [24, 29], ability: 3, potential: 6, growth: 78, adjustments: { decisions: 3, composure: 3 } },
  { id: "veteran", label: "经验老将", weight: 15, age: [29, 35], ability: 4, potential: 2, growth: 54, adjustments: { decisions: 8, composure: 9, positioning: 6, pace: -7, acceleration: -8, stamina: -4 } },
]);

const QUALITY_BANDS = Object.freeze([
  { id: "rough", label: "待雕琢", weight: 18, ability: -5, potential: 10 },
  { id: "squad", label: "轮换级", weight: 50, ability: 0, potential: 6 },
  { id: "standout", label: "即战力", weight: 26, ability: 5, potential: 5 },
  { id: "wonderkid", label: "稀有天才", weight: 6, ability: 9, potential: 11 },
]);

const PERSONALITY_TEMPLATES = Object.freeze([
  { id: "professional", adjustments: { professionalism: 23, consistency: 13, volatility: -11 } },
  { id: "leader", adjustments: { leadership: 24, teamwork: 11, mentality: 8 } },
  { id: "resilient", adjustments: { mentality: 15, pressure: 19, volatility: -7 } },
  { id: "ambitious", adjustments: { ambition: 24, professionalism: 7, volatility: 3 } },
  { id: "teamPlayer", adjustments: { teamwork: 22, leadership: 5, ambition: -3 } },
  { id: "volatile", adjustments: { volatility: 27, consistency: -13, pressure: -8 } },
  { id: "laidBack", adjustments: { professionalism: -16, ambition: -13, volatility: -4 } },
]);

export function createRng(seed = String(Date.now())) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomItem(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function traitGrade(rarity) {
  return ({ common: "D", rare: "C", epic: "B", legendary: "A" })[rarity] ?? "D";
}

export function traitFitsRole(trait, role) {
  const roles = trait?.eligibleRoleGroups ?? [];
  return roles.includes("ANY") || roles.includes(role) || roles.includes(roleGroup(role));
}

export function traitFitsPlayer(trait, player) {
  if (!player) return false;
  return traitFitsRole(trait, player.role) || Boolean(player.secondaryRole && traitFitsRole(trait, player.secondaryRole));
}

function rollCentered(base, spread, rng, minimum = 1, maximum = 99) {
  const bell = (rng() + rng() + rng()) / 3 - 0.5;
  return clamp(Math.round(base + bell * spread), minimum, maximum);
}

function weightedChoice(entries, rng) {
  const total = entries.reduce((sum, entry) => sum + Number(entry.weight ?? 1), 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= Number(entry.weight ?? 1);
    if (roll <= 0) return entry;
  }
  return entries.at(-1);
}

function archetypeGroup(position) {
  if (["LB", "RB"].includes(position)) return "FB";
  if (["LM", "RM"].includes(position)) return "WM";
  if (["LW", "RW"].includes(position)) return "W";
  return position;
}

function heightRange(position) {
  return ({
    GK: [182, 199], CB: [175, 197], LB: [165, 189], RB: [165, 189], DM: [170, 194], AM: [164, 191],
    LM: [163, 189], RM: [163, 189], ST: [169, 198], LW: [162, 189], RW: [162, 189],
  })[position] ?? [165, 195];
}

function mergeAdjustments(...sources) {
  const output = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) output[key] = (output[key] ?? 0) + Number(value ?? 0);
  }
  return output;
}

function proceduralAttributes(position, ability, archetype, physical, career, heightCm, rng) {
  const positionAdjustments = POSITION_ATTRIBUTE_ADJUSTMENTS[position] ?? POSITION_ATTRIBUTE_ADJUSTMENTS.DM;
  const adjustments = mergeAdjustments(positionAdjustments, archetype.adjustments, physical.adjustments, career.adjustments);
  const attributes = {};
  const names = [
    "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
    "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
    "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  ];
  for (const name of names) attributes[name] = rollCentered(ability + (adjustments[name] ?? 0), 20, rng, 18, 94);
  if (heightCm >= 193) {
    attributes.strength = clamp(attributes.strength + 4, 18, 94);
    attributes.agility = clamp(attributes.agility - 4, 18, 94);
    attributes.acceleration = clamp(attributes.acceleration - 2, 18, 94);
  } else if (heightCm <= 168) {
    attributes.agility = clamp(attributes.agility + 5, 18, 94);
    attributes.acceleration = clamp(attributes.acceleration + 3, 18, 94);
    attributes.heading = clamp(attributes.heading - 3, 18, 94);
  }
  if (position === "GK") {
    attributes.goalkeeping = rollCentered(ability + (adjustments.goalkeeping ?? 15), 16, rng, 30, 94);
    attributes.reflexes = rollCentered(ability + (adjustments.reflexes ?? 15), 17, rng, 30, 94);
  } else {
    attributes.goalkeeping = rollCentered(12 + (ability - 55) * 0.12, 16, rng, 1, 31);
    attributes.reflexes = rollCentered(14 + (ability - 55) * 0.12, 16, rng, 1, 34);
  }
  return attributes;
}

function proceduralHidden(personality, physical, career, rng) {
  const baseKeys = ["mentality", "professionalism", "ambition", "consistency", "pressure", "teamwork", "leadership", "volatility"];
  const hidden = { personality: personality.id };
  for (const key of baseKeys) hidden[key] = rollCentered(54 + Number(personality.adjustments[key] ?? 0), 38, rng, 8, 96);
  hidden.injuryResistance = rollCentered(64 + Number(physical.injuryResistance ?? 0) - (career.id === "veteran" ? 5 : 0), 34, rng, 12, 95);
  hidden.emergencyGoalkeeper = rollCentered(36, 70, rng, 5, 90);
  return hidden;
}

export function generatePlayer(role, traits = [], rng = Math.random, index = 0, context = {}) {
  const options = typeof context === "number" ? { stage: context } : context ?? {};
  const stage = options.stage ?? 1;
  const usedNames = options.usedNames ?? [];
  const group = roleGroup(role);
  const position = POSITION_GROUPS[group].includes(role) ? role : randomItem(POSITION_GROUPS[group], rng);
  const archetype = randomItem(PLAYER_ARCHETYPES[archetypeGroup(position)], rng);
  const physical = randomItem(PHYSICAL_PROFILES, rng);
  const career = weightedChoice(CAREER_STAGES, rng);
  const quality = weightedChoice(QUALITY_BANDS, rng);
  const personality = randomItem(PERSONALITY_TEMPLATES, rng);
  const stageAbility = 57 + clamp(Number(stage) - 1, 0, 49) * 0.28;
  const ability = Number.isFinite(Number(options.targetAbility))
    ? Number(options.targetAbility)
    : stageAbility + quality.ability + career.ability;
  const [minimumHeight, maximumHeight] = heightRange(position);
  const heightCm = clamp(
    Math.round(minimumHeight + ((rng() + rng()) / 2) * (maximumHeight - minimumHeight) + Number(archetype.heightShift ?? 0) + Number(physical.heightShift ?? 0)),
    158,
    204,
  );
  const hidden = proceduralHidden(personality, physical, career, rng);
  const attributes = proceduralAttributes(position, ability, archetype, physical, career, heightCm, rng);
  const compatibleTraits = traits.filter((trait) => traitFitsRole(trait, position));
  const innate = randomItem(compatibleTraits.length ? compatibleTraits : traits, rng);
  const age = Math.round(career.age[0] + rng() * (career.age[1] - career.age[0]));
  const potential = Math.round(clamp(
    Math.max(ability + 3, ability + career.potential + quality.potential + (rng() - 0.5) * 7),
    55,
    quality.id === "wonderkid" ? 97 : 94,
  ));
  const prefix = options.idPrefix ?? "rookie";

  const generated = normalizePlayerSchema({
    id: `${prefix}-${position.toLowerCase()}-${Date.now().toString(36)}-${index}-${Math.floor(rng() * 1000000)}`,
    name: randomLocalizedPlayerName(stage, rng, usedNames),
    role: position,
    secondaryRole: position === "GK" ? null : randomItem(SECONDARY_POSITIONS[position], rng),
    preferredFoot: preferredFootForPosition(position, rng),
    attributes,
    heightCm,
    state: { fitness: 100, form: rollCentered(50, 24, rng, 32, 68), morale: rollCentered(66, 26, rng, 44, 82), injuryProneness: 100 - hidden.injuryResistance },
    hidden,
    development: {
      age,
      potential,
      experience: 0,
      level: 1,
      matchesPlayed: 0,
      growthRate: Number(clamp(career.growth + (hidden.professionalism - 50) * 0.35 + (quality.id === "wonderkid" ? 8 : 0), 38, 130).toFixed(1)),
      lastGrowth: null,
    },
    recruitment: {
      generator: "procedural-v2",
      archetype: archetype.id,
      archetypeLabel: archetype.label,
      physicalProfile: physical.id,
      physicalLabel: physical.label,
      careerStage: career.id,
      careerLabel: career.label,
      qualityBand: quality.id,
      qualityLabel: quality.label,
      translatedIdentityPool: LOCALIZED_PLAYER_NAME_CAPACITY.total,
    },
    quirk: `${archetype.label} · ${physical.label} · ${randomItem(QUIRKS, rng)}`,
    traits: innate ? [{ id: innate.id, innate: true, locked: true }] : [],
  }, { index });
  const minimumPotentialGap = ({ prospect: 12, developing: 8, prime: 4, veteran: 1 })[career.id] ?? 4;
  generated.development.potential = Math.round(clamp(
    Math.max(generated.development.potential, playerOverall(generated) + minimumPotentialGap),
    55,
    quality.id === "wonderkid" ? 99 : 96,
  ));
  return generated;
}

export function generateDraftChoices(role, traits, rng = Math.random, context = {}) {
  const stage = typeof context === "number" ? context : context?.stage ?? 1;
  const unavailableNames = new Set(typeof context === "number" ? [] : context?.usedNames ?? []);
  const names = new Set();
  const choices = [];
  while (choices.length < 3) {
    const player = generatePlayer(role, traits, rng, choices.length, { stage, usedNames: new Set([...unavailableNames, ...names]) });
    if (names.has(player.name)) continue;
    names.add(player.name);
    choices.push(player);
  }
  return choices;
}

export function playerOverall(player) {
  const a = compactPlayerMetrics(player);
  const weights = {
    GK: [a.goalkeeping * 0.55, a.composure * 0.18, a.passing * 0.12, a.defense * 0.15],
    DEF: [a.defense * 0.42, a.pace * 0.17, a.stamina * 0.16, a.passing * 0.13, a.composure * 0.12],
    MID: [a.passing * 0.32, a.stamina * 0.2, a.attack * 0.18, a.defense * 0.15, a.composure * 0.15],
    ATT: [a.attack * 0.42, a.pace * 0.2, a.composure * 0.16, a.passing * 0.12, a.stamina * 0.1],
  };
  return Math.round((weights[roleGroup(player.role)] ?? weights.MID).reduce((sum, item) => sum + item, 0));
}

function traitBonus(player, traitCatalog) {
  const traits = player.traits
    .map((entry) => traitCatalog.find((trait) => trait.id === entry.id))
    .filter(Boolean);
  const allTags = traits.flatMap((trait) => trait.tags ?? []);
  return {
    attack: allTags.filter((tag) => ["finishing", "movement", "dribbling", "shot"].includes(tag)).length * 1.8,
    midfield: allTags.filter((tag) => ["possession", "passing", "buildUp", "vision", "antiPress"].includes(tag)).length * 1.6,
    defense: allTags.filter((tag) => ["defending", "marking", "tackling", "aerial", "goalkeeping"].includes(tag)).length * 1.7,
  };
}

export function teamRatings(players, tacticKey = "balanced", traitCatalog = [], formationKey = DEFAULT_FORMATION_KEY, context = {}) {
  const tactic = TACTICS[tacticKey] ?? TACTICS.balanced;
  const slots = formationSlotsFromKey(formationKey);
  const starters = players.slice(0, TEAM_SIZE).map((player) => hydratePlayerTraits(player, traitCatalog, context.seed ?? "rating"));
  let attack = 0;
  let midfield = 0;
  let defense = 0;
  let goalkeeping = 0;
  let goalkeeperCount = 0;
  starters.forEach((player, index) => {
    const a = compactPlayerMetrics(player);
    const assignedRole = player.assignedRole ?? slots[index];
    const fit = roleFitScore(player, assignedRole);
    const bonus = traitBonus(player, traitCatalog);
    const readiness = a.availability / 100;
    const stateBoost = (a.morale - 50) * 0.035 + (a.fitness - 85) * 0.045 + (a.mental - 55) * 0.025;
    attack += (a.attack * 0.47 + a.pace * 0.17 + a.composure * 0.14 + a.passing * 0.08 + a.aerial * 0.08 + a.physical * 0.06 + bonus.attack + stateBoost) * fit * readiness;
    midfield += (a.passing * 0.34 + a.stamina * 0.18 + a.composure * 0.15 + a.defense * 0.09 + a.attack * 0.07 + a.mental * 0.09 + a.physical * 0.08 + bonus.midfield + stateBoost) * fit * readiness;
    defense += (a.defense * 0.34 + a.stamina * 0.15 + a.pace * 0.11 + a.composure * 0.1 + a.aggression * 0.07 + a.aerial * 0.1 + a.physical * 0.08 + a.mental * 0.05 + bonus.defense + stateBoost) * fit * readiness;
    if (assignedRole === "GK") {
      goalkeeping += (a.goalkeeping * 0.64 + a.composure * 0.12 + a.passing * 0.07 + a.aerial * 0.09 + a.mental * 0.08 + stateBoost) * fit * readiness;
      goalkeeperCount += 1;
    }
  });
  const bonds = computeTeamBonds(starters, traitCatalog, context.bonds ?? []);
  const bondBonus = sumBondBonuses(bonds);
  const chemistry = clamp(Number(context.chemistry ?? 50), 0, 100);
  const chemistryBonus = (chemistry - 50) / 10;
  const shape = formationSettings(starters, formationKey);
  const coherenceBonus = (shape.coherence - 50) * 0.04;
  return {
    attack: Math.round(attack / Math.max(1, starters.length) + tactic.attack + bondBonus.attack + chemistryBonus + (shape.attackingNumbers - 50) * 0.12 + coherenceBonus),
    midfield: Math.round(midfield / Math.max(1, starters.length) + tactic.attack * 0.25 + tactic.defense * 0.2 + bondBonus.midfield + chemistryBonus + (shape.midfieldDensity - 50) * 0.1 + coherenceBonus),
    defense: Math.round(defense / Math.max(1, starters.length) + tactic.defense + bondBonus.defense + chemistryBonus + (shape.defensiveBalance - 50) * 0.12 + coherenceBonus),
    goalkeeping: Math.round(goalkeeping / Math.max(1, goalkeeperCount) + bondBonus.goalkeeping + chemistryBonus * 0.35),
    tempo: tactic.tempo + bondBonus.tempo,
    bonds,
    bondBonus,
    chemistry,
    formation: shape,
  };
}

const OPPONENT_FORMATIONS = Object.freeze({
  allOutAttack: Object.freeze(["114", "123", "213"]),
  positive: Object.freeze(["132", "222", "123"]),
  balanced: Object.freeze(["231", "222", "321"]),
  defensive: Object.freeze(["321", "411", "312"]),
  parkBus: Object.freeze(["411", "321", "312"]),
});

export function formationRolePlan(formationKey = DEFAULT_FORMATION_KEY) {
  const [, defenderCount, midfielderCount, attackerCount] = String(formationKey).match(/^(\d)(\d)(\d)$/) ?? [null, "2", "3", "1"];
  const defenders = ({
    1: ["CB"],
    2: ["CB", "CB"],
    3: ["LB", "CB", "RB"],
    4: ["LB", "CB", "CB", "RB"],
  })[Number(defenderCount)] ?? ["CB", "CB"];
  const midfielders = ({
    1: ["DM"],
    2: ["DM", "AM"],
    3: ["LM", "DM", "RM"],
    4: ["LM", "DM", "AM", "RM"],
  })[Number(midfielderCount)] ?? ["LM", "DM", "RM"];
  const attackers = ({
    1: ["ST"],
    2: ["ST", "ST"],
    3: ["LW", "ST", "RW"],
    4: ["LW", "ST", "ST", "RW"],
  })[Number(attackerCount)] ?? ["ST"];
  return ["GK", ...defenders, ...midfielders, ...attackers];
}

export function formationBoardPositions(roles = formationRolePlan()) {
  const counts = roles.reduce((map, role) => map.set(role, (map.get(role) ?? 0) + 1), new Map());
  const seen = new Map();
  return roles.map((role) => {
    const index = seen.get(role) ?? 0;
    seen.set(role, index + 1);
    const total = counts.get(role) ?? 1;
    if (role === "GK") return { x: 50, y: 90 };
    if (role === "LB") return { x: 20, y: 70 };
    if (role === "RB") return { x: 80, y: 70 };
    if (role === "CB") return { x: total === 1 ? 50 : 42 + index * 16, y: 70 };
    if (role === "LM") return { x: 20, y: 46 };
    if (role === "RM") return { x: 80, y: 46 };
    if (role === "AM") return { x: total === 1 ? 50 : 42 + index * 16, y: 38 };
    if (role === "DM") return { x: total === 1 ? 50 : 42 + index * 16, y: 54 };
    if (role === "LW") return { x: 20, y: 18 };
    if (role === "RW") return { x: 80, y: 18 };
    return { x: total === 1 ? 50 : 42 + index * 16, y: 18 };
  });
}

export function generateOpponent(stage = 1, rng = Math.random, usedNames = []) {
  const tier = Math.ceil(stage / 10);
  const base = 48 + stage * 0.72 + tier * 1.4;
  const tactic = randomItem(Object.keys(TACTICS), rng);
  return {
    name: randomLocalizedTeamName(stage, rng, usedNames),
    rating: Math.round(base + (rng() - 0.5) * 7),
    tactic,
    formation: randomItem(OPPONENT_FORMATIONS[tactic] ?? OPPONENT_FORMATIONS.balanced, rng),
    color: randomItem(["#ff6b4a", "#7b8cff", "#f4ba41", "#d65e9d"], rng),
  };
}

export function generateOpponentSquad(opponent, rng = Math.random, benchSize = 4) {
  const starterRoles = formationRolePlan(opponent.formation ?? DEFAULT_FORMATION_KEY);
  const starterPositions = formationBoardPositions(starterRoles);
  const roles = [...starterRoles, ...Array.from({ length: benchSize }, (_, index) => ["CB", "DM", "AM", "LW", "GK"][index % 5])];
  const usedNames = new Set();
  return roles.map((role, index) => {
    const overall = clamp(Math.round(opponent.rating + (rng() - 0.5) * 10), 38, 92);
    const player = generatePlayer(role, [], rng, index, {
      stage: opponent.stage ?? 1,
      usedNames,
      targetAbility: overall,
      idPrefix: `opponent-${opponent.stage ?? 1}`,
    });
    usedNames.add(player.name);
    player.number = index + 1;
    player.overall = overall;
    player.state.fitness = 96;
    player.state.form = 50;
    player.state.morale = 55;
    if (index < TEAM_SIZE) {
      player.assignedRole = starterRoles[index];
      player.boardPosition = { ...starterPositions[index] };
    }
    return player;
  });
}

export function pickWeather(rng = Math.random, configuredWeights = null) {
  const weights = Object.fromEntries(Object.entries(WEATHER).map(([key, weather]) => [key, Math.max(0, Number(configuredWeights?.[key] ?? weather.weight) || 0)]));
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 100;
  const roll = rng() * totalWeight;
  let cursor = 0;
  for (const [key, weather] of Object.entries(WEATHER)) {
    cursor += weights[key];
    if (roll < cursor) return { key, ...weather, weight: Number(((weights[key] / totalWeight) * 100).toFixed(1)) };
  }
  return { key: "sunny", ...WEATHER.sunny };
}

export function formationSettings(players, formationKey = DEFAULT_FORMATION_KEY) {
  const slots = formationSlotsFromKey(formationKey);
  const roles = players.slice(0, TEAM_SIZE).map((player, index) => player.assignedRole ?? slots[index] ?? player.role);
  const groups = roles.map(roleGroup);
  const defenders = groups.filter((group) => group === "DEF").length;
  const midfielders = groups.filter((group) => group === "MID").length;
  const attackers = groups.filter((group) => group === "ATT").length;
  const count = (targets) => roles.filter((role) => targets.includes(role)).length;
  const centerBacks = count(["CB"]);
  const fullbacks = count(["LB", "RB"]);
  const holdingMidfielders = count(["DM"]);
  const attackingMidfielders = count(["AM"]);
  const wideMidfielders = count(["LM", "RM"]);
  const centerForwards = count(["ST"]);
  const wingers = count(["LW", "RW"]);
  const coherence = clamp(
    84 - Math.abs(defenders - 2) * 11 - Math.abs(midfielders - 2) * 8 - Math.abs(attackers - 2) * 9
      - Math.max(0, centerBacks - 2) * 8 - Math.max(0, centerForwards - 2) * 8,
    30,
    92,
  );
  return {
    name: `${defenders}-${midfielders}-${attackers}`,
    defenders,
    midfielders,
    attackers,
    centerBacks,
    fullbacks,
    holdingMidfielders,
    attackingMidfielders,
    wideMidfielders,
    centerForwards,
    wingers,
    coherence,
    defensiveBalance: clamp(50 + (defenders - 2) * 12 - (attackers - 1) * 4 + holdingMidfielders * 3 - attackingMidfielders * 2, 22, 86),
    midfieldDensity: clamp(50 + (midfielders - 2) * 10 + (holdingMidfielders + attackingMidfielders) * 2 - Math.max(0, attackers - 2) * 3, 25, 86),
    attackingNumbers: clamp(46 + (attackers - 1) * 13 + attackingMidfielders * 5 + wingers * 2 - Math.max(0, defenders - 2) * 2, 28, 88),
    width: clamp(42 + fullbacks * 8 + wideMidfielders * 8 + wingers * 9, 32, 88),
    transitionRisk: clamp(50 + (attackers - 1) * 12 - (defenders - 2) * 10 + (attackingMidfielders - holdingMidfielders) * 4, 18, 88),
  };
}

function engineWeather(weather, gameConfig) {
  const values = {
    sunny: { type: "sunny", precipitation: 5, wind: 9, temperature: 21, lightningChance: 0 },
    rain: { type: "rain", precipitation: 72, wind: 18, temperature: 14, lightningChance: 0 },
    storm: { type: "storm", precipitation: 96, wind: 48, temperature: 12, lightningChance: 0.006 },
    snow: { type: "snow", precipitation: 58, wind: 22, temperature: -2, lightningChance: 0 },
  };
  const selected = { ...(values[weather?.key] ?? values.sunny) };
  if (selected.type === "storm") {
    selected.lightningChance = gameConfig.lightning.chance;
    selected.lightningFitnessLossMin = gameConfig.lightning.fitnessLossMin;
    selected.lightningFitnessLossMax = gameConfig.lightning.fitnessLossMax;
    selected.lightningMoraleLossMin = gameConfig.lightning.moraleLossMin;
    selected.lightningMoraleLossMax = gameConfig.lightning.moraleLossMax;
  }
  return selected;
}

function engineTeam(name, roster, bench, tacticKey, formationKey, rating = 60, chemistry = 50, traitCatalog = [], seed = "match") {
  const normalizedRoster = roster.map((player, index) => hydratePlayerTraits(normalizePlayerSchema(player, { index }), traitCatalog, seed));
  const averageState = (key, fallback) => normalizedRoster.length
    ? normalizedRoster.reduce((sum, player) => sum + Number(player.state?.[key] ?? fallback), 0) / normalizedRoster.length
    : fallback;
  return {
    name,
    lineup: normalizedRoster,
    bench: bench.slice(0, SEVEN_A_SIDE.benchLimit).map((player, index) => hydratePlayerTraits(normalizePlayerSchema(player, { index: TEAM_SIZE + index }), traitCatalog, seed)),
    formation: formationSettings(roster, formationKey),
    tactics: { ...(TACTICS[tacticKey] ?? TACTICS.balanced).values },
    coach: { attack: clamp(rating - 12, 35, 88), defense: clamp(rating - 13, 35, 88), adaptability: clamp(rating - 15, 30, 85), substitutions: 55 },
    chemistry: clamp(chemistry, 0, 100),
    morale: averageState("morale", 55),
    form: averageState("form", 50),
  };
}

export function createMatch(team, opponent, options = {}) {
  const rng = options.rng ?? Math.random;
  const gameConfig = normalizeGameConfig(options.gameConfig);
  const refereeNames = ["沈奕", "周正", "林川", "顾衡", "韩彻", "许明"]; 
  const match = {
    minute: 0,
    homeScore: 0,
    awayScore: 0,
    homeShots: 0,
    awayShots: 0,
    homeXg: 0,
    awayXg: 0,
    cards: { home: 0, away: 0 },
    reds: { home: 0, away: 0 },
    sentOffIds: [],
    fouls: { home: 0, away: 0 },
    lightningHits: { home: 0, away: 0 },
    penaltiesAwarded: { home: 0, away: 0 },
    possession: { home: 50, away: 50 },
    phase: "firstHalf",
    tactic: team.tactic ?? "balanced",
    formation: team.formation ?? DEFAULT_FORMATION_KEY,
    opponent,
    gameConfig,
    weather: options.weather ?? pickWeather(rng, gameConfig.weatherWeights),
    referee: options.referee ?? {
      name: randomItem(refereeNames, rng),
      strictness: Math.round(gameConfig.referee.strictnessMin + rng() * (gameConfig.referee.strictnessMax - gameConfig.referee.strictnessMin)),
      penaltyTendency: Math.round(gameConfig.referee.penaltyBiasMin + rng() * (gameConfig.referee.penaltyBiasMax - gameConfig.referee.penaltyBiasMin)),
      homeBias: Math.round(gameConfig.referee.homeBiasMin + rng() * (gameConfig.referee.homeBiasMax - gameConfig.referee.homeBiasMin)),
    },
    homeRoster: options.homeRoster ?? team.players?.slice(0, TEAM_SIZE) ?? [],
    awayRoster: options.awayRoster ?? opponent.squad?.slice(0, TEAM_SIZE) ?? [],
    homeBench: options.homeBench ?? [],
    awayBench: options.awayBench ?? [],
    events: [],
    timeline: [],
    substitutions: 0,
  };
  const homeRating = match.homeRoster.length
    ? match.homeRoster.reduce((sum, player) => sum + playerOverall(player), 0) / match.homeRoster.length
    : 60;
  const traitCatalog = options.traitCatalog ?? [];
  const homeTeam = engineTeam(team.name ?? "主队", match.homeRoster, match.homeBench, match.tactic, match.formation, homeRating, options.chemistry ?? team.chemistry ?? 50, traitCatalog, `${options.seed ?? "match"}:home`);
  const awayTeam = engineTeam(opponent.name ?? "客队", match.awayRoster, match.awayBench, opponent.tactic ?? "balanced", opponent.formation ?? DEFAULT_FORMATION_KEY, opponent.rating ?? 60, opponent.chemistry ?? 55, traitCatalog, `${options.seed ?? "match"}:away`);
  const homeBondBonus = sumBondBonuses(computeTeamBonds(match.homeRoster, traitCatalog, options.bondDefinitions ?? []));
  const awayBondBonus = sumBondBonuses(computeTeamBonds(match.awayRoster, traitCatalog, options.bondDefinitions ?? []));
  homeTeam.bondBonus = homeBondBonus;
  awayTeam.bondBonus = awayBondBonus;
  homeTeam.tactics = { ...homeTeam.tactics, tempo: clamp(homeTeam.tactics.tempo + Number(homeBondBonus.tempo ?? 0), 0, 100), pressing: clamp(homeTeam.tactics.pressing + Number(homeBondBonus.pressing ?? 0), 0, 100), counterAttack: clamp(homeTeam.tactics.counterAttack + Number(homeBondBonus.counterAttack ?? 0), 0, 100) };
  awayTeam.tactics = { ...awayTeam.tactics, tempo: clamp(awayTeam.tactics.tempo + Number(awayBondBonus.tempo ?? 0), 0, 100), pressing: clamp(awayTeam.tactics.pressing + Number(awayBondBonus.pressing ?? 0), 0, 100), counterAttack: clamp(awayTeam.tactics.counterAttack + Number(awayBondBonus.counterAttack ?? 0), 0, 100) };
  const session = createMatchSession(homeTeam, awayTeam, {
    seed: options.seed ?? `shared-${Date.now()}-${Math.floor(rng() * 1000000)}`,
    autoSubstitutions: { home: false, away: true },
    context: {
      minutes: 90,
      basePossessions: 118,
      homeAdvantage: 2.2,
      weather: engineWeather(match.weather, gameConfig),
      pitchQuality: match.weather.key === "storm" ? 56 : match.weather.key === "rain" ? 70 : match.weather.key === "snow" ? 65 : 88,
      referee: {
        strictness: match.referee.strictness,
        penaltyBias: match.referee.penaltyTendency,
        homeBias: match.referee.homeBias,
      },
    },
  });
  Object.defineProperty(match, "_engine", { value: session, enumerable: false, writable: true });
  return match;
}

const COMMENTARY = {
  save: ["门将稳稳收下，顺手整理了一下发型。", "这球被挡出，防线集体松了口气。", "皮球擦柱而出，门柱今天站在防守方。"],
  miss: ["射门飞向看台，差点命中爆米花桶。", "角度有了，力量有了，准星请假了。", "皮球滑门而过，只留下一声叹息。"],
  goal: ["球进了！替补席像弹簧一样全部跳起。", "网窝一颤，这是教练板上计划过的那一种！", "进球！这脚射门连门将的影子都骗过了。"],
};

const FLOW_EVENTS = [
  { type: "build-up", text: (name) => `${name}回撤接球，耐心梳理下一次推进。` },
  { type: "attack", text: (name) => `${name}带球压过中线，场边开始催促队友前插。` },
  { type: "counter", text: (name) => `${name}抓住转换机会发动反击，防线迅速回收。` },
  { type: "duel", text: (name) => `${name}在中场对抗中抢到球权，比赛节奏没有停下来。` },
  { type: "corner", text: (name) => `${name}把进攻推进到底线附近，制造了一次角球压力。` },
];

function participantWeight(player, forAssist = false) {
  const roleWeight = forAssist
    ? { GK: 0.15, DEF: 0.55, MID: 1.5, ATT: 1.05 }
    : { GK: 0.08, DEF: 0.48, MID: 1.08, ATT: 1.85 };
  const ability = player.attributes ? playerMetric(player, "attack") : player.overall ?? 60;
  return (roleWeight[roleGroup(player.assignedRole ?? player.role)] ?? 1) * (0.6 + ability / 100);
}

function pickParticipant(roster, rng, excludedId = null, forAssist = false) {
  const candidates = roster.filter((player) => player.id !== excludedId);
  if (candidates.length === 0) return { id: "unknown", name: "无名球员", role: "MID" };
  const total = candidates.reduce((sum, player) => sum + participantWeight(player, forAssist), 0);
  let roll = rng() * total;
  for (const player of candidates) {
    roll -= participantWeight(player, forAssist);
    if (roll <= 0) return player;
  }
  return candidates[candidates.length - 1];
}

function recordEvent(match, event) {
  event.id = `${event.minute}-${event.type}-${match.timeline.length + 1}`;
  match.timeline.push(event);
  match.events.push(event);
  return event;
}

function recordFlowEvent(match, homePossession, rng) {
  const homeMoves = rng() * 100 < homePossession;
  const roster = (homeMoves ? match.homeRoster : match.awayRoster).filter((player) => !match.sentOffIds.includes(player.id));
  const player = pickParticipant(roster, rng, null, true);
  const flow = randomItem(FLOW_EVENTS, rng);
  return recordEvent(match, {
    minute: Math.max(1, Math.floor(match.minute)),
    side: homeMoves ? "home" : "away",
    type: flow.type,
    playerId: player.id,
    playerName: player.name,
    score: { home: match.homeScore, away: match.awayScore },
    text: flow.text(player.name),
  });
}

function pickOffender(roster, rng) {
  if (!roster.length) return { id: "unknown", name: "无名球员", attributes: { aggression: 60 } };
  const total = roster.reduce((sum, player) => sum + Math.max(20, player.attributes ? playerMetric(player, "aggression") : 60), 0);
  let roll = rng() * total;
  for (const player of roster) {
    roll -= Math.max(20, player.attributes ? playerMetric(player, "aggression") : 60);
    if (roll <= 0) return player;
  }
  return roster.at(-1);
}

function maybeRefereeEvent(match, home, away, weather, rng) {
  const allPlayers = [...match.homeRoster, ...match.awayRoster];
  const averageAggression = allPlayers.reduce((sum, player) => sum + (player.attributes ? playerMetric(player, "aggression") : 60), 0) / Math.max(1, allPlayers.length);
  const foulChance = clamp(0.078 + (averageAggression - 60) / 650 + (["rain", "storm"].includes(weather.key) ? 0.018 : 0), 0.065, 0.14);
  if (rng() >= foulChance) return null;
  const referee = match.referee ?? { name: "主裁判", strictness: 1, penaltyTendency: 1, homeBias: 0 };
  const foulSide = rng() < clamp(0.5 - referee.homeBias, 0.38, 0.62) ? "home" : "away";
  const awardedSide = foulSide === "home" ? "away" : "home";
  const offenderRoster = (foulSide === "home" ? match.homeRoster : match.awayRoster).filter((player) => !match.sentOffIds.includes(player.id));
  const attackingRoster = (awardedSide === "home" ? match.homeRoster : match.awayRoster).filter((player) => !match.sentOffIds.includes(player.id));
  const offender = pickOffender(offenderRoster, rng);
  match.fouls[foulSide] += 1;
  const aggression = offender.attributes ? playerMetric(offender, "aggression") : 60;
  const isPenalty = rng() < clamp(0.085 * referee.penaltyTendency + (weather.key === "storm" ? 0.02 : 0), 0.06, 0.15);
  const redChance = clamp(0.018 * referee.strictness + Math.max(0, aggression - 78) / 900, 0.015, 0.06);
  const yellowChance = clamp(0.22 * referee.strictness + Math.max(0, aggression - 65) / 260, 0.18, 0.48);
  const isRed = rng() < redChance;
  const isYellow = !isRed && rng() < yellowChance;
  let disciplinaryEvent = null;
  if (isRed || isYellow) {
    if (isRed) { match.reds[foulSide] += 1; match.sentOffIds.push(offender.id); }
    else match.cards[foulSide] += 1;
    disciplinaryEvent = recordEvent(match, {
      minute: Math.max(1, Math.floor(match.minute)), side: foulSide, type: isRed ? "red" : "card",
      playerId: offender.id, playerName: offender.name, score: { home: match.homeScore, away: match.awayScore },
      text: isRed
        ? `${referee.name}直接出示红牌！${offender.name}被罚下。`
        : `${referee.name}向${offender.name}出示黄牌。`,
    });
  }
  if (isPenalty) {
    match.penaltiesAwarded[awardedSide] += 1;
    const shooter = pickParticipant(attackingRoster, rng);
    const defending = awardedSide === "home" ? away : home;
    const composure = shooter.attributes ? playerMetric(shooter, "composure") : shooter.overall ?? 65;
    const scored = rng() < clamp(0.76 + (composure - 65) / 300 - (defending.goalkeeping - 65) / 420, 0.62, 0.9);
    if (awardedSide === "home") {
      match.homeShots += 1; match.homeXg += 0.76; if (scored) match.homeScore += 1;
    } else {
      match.awayShots += 1; match.awayXg += 0.76; if (scored) match.awayScore += 1;
    }
    return recordEvent(match, {
      minute: Math.max(1, Math.floor(match.minute)), side: awardedSide,
      type: scored ? "penalty-goal" : "penalty-miss", playerId: shooter.id, playerName: shooter.name,
      assistId: null, assistName: null, xg: 0.76, score: { home: match.homeScore, away: match.awayScore },
      text: scored
        ? `${referee.name}判罚点球，${shooter.name}主罚命中！`
        : `${referee.name}判罚点球，但${shooter.name}没有罚进。`,
    });
  }
  if (disciplinaryEvent) return disciplinaryEvent;
  return recordEvent(match, {
    minute: Math.max(1, Math.floor(match.minute)), side: foulSide, type: "foul",
    playerId: offender.id, playerName: offender.name, score: { home: match.homeScore, away: match.awayScore },
    text: `${offender.name}犯规，${referee.name}示意任意球。`,
  });
}

function addStats(left, right) {
  const output = {};
  for (const key of new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])) {
    if (key === "possession") output[key] = Number((((left?.[key] ?? 50) + (right?.[key] ?? 50)) / 2).toFixed(1));
    else output[key] = Number(left?.[key] ?? 0) + Number(right?.[key] ?? 0);
  }
  return output;
}

function combinedSnapshot(regular, extra) {
  if (!regular) return extra;
  return {
    ...extra,
    score: { home: regular.score.home + extra.score.home, away: regular.score.away + extra.score.away },
    stats: { home: addStats(regular.stats.home, extra.stats.home), away: addStats(regular.stats.away, extra.stats.away) },
    discipline: {
      sentOff: {
        home: [...new Set([...regular.discipline.sentOff.home, ...extra.discipline.sentOff.home])],
        away: [...new Set([...regular.discipline.sentOff.away, ...extra.discipline.sentOff.away])],
      },
      injuredOut: {
        home: [...new Set([...regular.discipline.injuredOut.home, ...extra.discipline.injuredOut.home])],
        away: [...new Set([...regular.discipline.injuredOut.away, ...extra.discipline.injuredOut.away])],
      },
      injuries: {
        home: { ...(regular.discipline.injuries?.home ?? {}), ...(extra.discipline.injuries?.home ?? {}) },
        away: { ...(regular.discipline.injuries?.away ?? {}), ...(extra.discipline.injuries?.away ?? {}) },
      },
    },
    pendingInjury: extra.pendingInjury ?? regular.pendingInjury ?? null,
  };
}

function syncSharedMatch(match, snapshot) {
  match.homeScore = snapshot.score.home;
  match.awayScore = snapshot.score.away;
  match.homeShots = snapshot.stats.home.shots;
  match.awayShots = snapshot.stats.away.shots;
  match.homeXg = snapshot.stats.home.xg;
  match.awayXg = snapshot.stats.away.xg;
  const possessionTotal = snapshot.stats.home.possession + snapshot.stats.away.possession;
  match.possession.home = possessionTotal > 0 ? Math.round((snapshot.stats.home.possession / possessionTotal) * 100) : 50;
  match.possession.away = 100 - match.possession.home;
  match.fouls = { home: snapshot.stats.home.fouls, away: snapshot.stats.away.fouls };
  match.cards = { home: snapshot.stats.home.yellowCards, away: snapshot.stats.away.yellowCards };
  match.reds = { home: snapshot.stats.home.redCards, away: snapshot.stats.away.redCards };
  match.lightningHits = { home: snapshot.stats.home.lightningHits ?? 0, away: snapshot.stats.away.lightningHits ?? 0 };
  match.substitutions = snapshot.stats.home.substitutions;
  match.sentOffIds = [...new Set([...snapshot.discipline.sentOff.home, ...snapshot.discipline.sentOff.away])];
  match.injuredOutIds = [...new Set([...snapshot.discipline.injuredOut.home, ...snapshot.discipline.injuredOut.away])];
  match.injuries = snapshot.discipline.injuries ?? { home: {}, away: {} };
  match.pendingInjury = snapshot.pendingInjury ?? null;
  match.homeRoster = snapshot.lineups.home;
  match.awayRoster = snapshot.lineups.away;
  match.homeBench = snapshot.benches.home;
  match.awayBench = snapshot.benches.away;
}

function engineEventSide(match, event) {
  return event.team === match.opponent.name ? "away" : "home";
}

function translateSharedEvent(match, event, minuteOffset = 0) {
  const side = engineEventSide(match, event);
  const minute = Math.max(1, Math.round(event.minute + minuteOffset));
  if (event.type === "penaltyAwarded") {
    match.penaltiesAwarded[side] += 1;
    return recordEvent(match, {
      minute, side, type: "penalty-awarded", playerId: event.victimId, playerName: event.victim,
      score: { home: match.homeScore, away: match.awayScore }, text: `${match.referee.name}指向点球点！${event.victim ? `${event.victim}制造点球。` : "禁区内出现犯规。"}`,
    });
  }
  const type = event.type === "yellowCard" ? "card"
    : event.type === "redCard" ? "red"
      : event.type === "penaltyMiss" ? "penalty-miss"
        : event.type === "goal" && event.shotType === "penalty" ? "penalty-goal"
          : event.type;
  const playerName = event.player ?? event.playerIn ?? "未知球员";
  const parsedScore = typeof event.score === "string" ? event.score.split("-").map(Number) : null;
  const score = parsedScore?.length === 2
    ? {
        home: parsedScore[0] + (minuteOffset ? match._regularSnapshot?.score.home ?? 0 : 0),
        away: parsedScore[1] + (minuteOffset ? match._regularSnapshot?.score.away ?? 0 : 0),
      }
    : { home: match.homeScore, away: match.awayScore };
  const text = type === "goal" ? `${playerName}破门！${event.assist ? `助攻来自${event.assist}。` : "这是一记没有助攻的进球。"}`
    : type === "penalty-goal" ? `${playerName}主罚点球命中！`
      : type === "penalty-miss" ? `${playerName}没有罚进点球。`
        : type === "card" ? `${match.referee.name}向${playerName}出示黄牌。`
          : type === "red" ? `${match.referee.name}出示红牌，${playerName}被罚下。`
            : type === "foul" ? `${playerName}对${event.victim ?? "对手"}犯规，${match.referee.name}鸣哨。`
              : type === "substitution" ? `${event.playerIn} 换下 ${event.playerOut}`
                : type === "lightning" ? `雷电击中了${playerName}！球员重伤离场，并将强制伤停 ${event.matchesOut ?? 5} 场。`
                : type === "injury" ? event.retired
                  ? `${playerName}遭遇生涯终结伤病，将在赛后结束球员生涯。`
                  : event.traitName
                    ? `${playerName}发动「${event.traitName}」挡出必进球后受伤，预计伤停 ${event.matchesOut ?? 1} 场。`
                    : `${playerName}${event.causedByFoul ? `被${event.offender ?? "对手"}踢伤` : "受伤"}，队医判断为${({ knock: "轻微碰撞", minor: "轻伤", moderate: "中度伤病", severe: "重伤" })[event.severity] ?? "伤病"}，预计伤停 ${event.matchesOut ?? 1} 场。`
                  : type === "save" ? `${playerName}完成射门，但被门将化解。`
                    : type === "miss" ? `${playerName}完成射门，皮球偏出球门。`
                      : `${playerName}参与了这次比赛事件。`;
  return recordEvent(match, {
    minute,
    side,
    type,
    playerId: event.playerId ?? event.playerInId ?? null,
    playerName,
    playerOutId: event.playerOutId ?? null,
    playerInId: event.playerInId ?? null,
    assistId: event.assistId ?? null,
    assistName: event.assist ?? null,
    xg: event.xg ?? 0,
    score,
    text,
    severity: event.severity ?? null,
    matchesOut: event.matchesOut ?? null,
    fitnessLoss: event.fitnessLoss ?? null,
    moraleLoss: event.moraleLoss ?? null,
    cause: event.cause ?? null,
    forceUnavailable: Boolean(event.forceUnavailable),
    retired: Boolean(event.retired),
    causedByFoul: Boolean(event.causedByFoul),
    traitName: event.traitName ?? null,
    offenderId: event.offenderId ?? null,
    offenderName: event.offender ?? null,
  });
}

function ensureExtraTimeSession(match) {
  if (match._extraEngine) return match._extraEngine;
  const regular = matchSessionSnapshot(match._engine);
  Object.defineProperty(match, "_regularSnapshot", { value: regular, enumerable: false, writable: true });
  const homeTeam = engineTeam("主队", regular.lineups.home, regular.benches.home, match.tactic, match.formation, 62, 55);
  const awayTeam = engineTeam(match.opponent.name, regular.lineups.away, regular.benches.away, match.opponent.tactic, match.opponent.formation ?? DEFAULT_FORMATION_KEY, match.opponent.rating, 55);
  homeTeam.bondBonus = { ...(match._engine.home.team.bondBonus ?? {}) };
  awayTeam.bondBonus = { ...(match._engine.away.team.bondBonus ?? {}) };
  const extra = createMatchSession(homeTeam, awayTeam, {
    seed: `extra-${match.opponent.name}-${match.homeScore}-${match.awayScore}`,
    autoSubstitutions: { home: false, away: false },
    context: {
      minutes: 30,
      basePossessions: 42,
      homeAdvantage: 1.2,
      weather: engineWeather(match.weather, match.gameConfig ?? normalizeGameConfig()),
      pitchQuality: 78,
      referee: { strictness: match.referee.strictness, penaltyBias: match.referee.penaltyTendency, homeBias: match.referee.homeBias },
    },
  });
  for (const id of regular.discipline.sentOff.home) extra.home.sentOff.add(id);
  for (const id of regular.discipline.sentOff.away) extra.away.sentOff.add(id);
  Object.defineProperty(match, "_extraEngine", { value: extra, enumerable: false, writable: true });
  return extra;
}

function simulateSharedMinute(match, rng) {
  const extraTime = match.phase === "extraTime" && match.minute > 90;
  const session = extraTime ? ensureExtraTimeSession(match) : match._engine;
  const target = extraTime ? match.minute >= 120 ? Number.POSITIVE_INFINITY : match.minute - 90 : match.minute >= 90 ? Number.POSITIVE_INFINITY : match.minute;
  const events = advanceMatchSession(session, target);
  const current = matchSessionSnapshot(session);
  const snapshot = extraTime ? combinedSnapshot(match._regularSnapshot, current) : current;
  syncSharedMatch(match, snapshot);
  const translated = events.map((event) => translateSharedEvent(match, event, extraTime ? 90 : 0)).filter(Boolean);
  if (translated.length) return translated.find((event) => ["lightning", "injury"].includes(event.type)) ?? translated.at(-1);
  const tempo = (TACTICS[match.tactic]?.tempo ?? 0) + (TACTICS[match.opponent.tactic]?.tempo ?? 0);
  return rng() < clamp(0.19 + tempo / 350, 0.14, 0.28) ? recordFlowEvent(match, match.possession.home, rng) : null;
}

export function updateSharedMatchTactic(match, tacticKey) {
  match.tactic = tacticKey;
  const session = match.phase === "extraTime" && match._extraEngine ? match._extraEngine : match._engine;
  updateMatchSessionTactics(session, "home", TACTICS[tacticKey]?.values ?? TACTICS.balanced.values);
}

export function applySharedMatchSubstitution(match, outgoingId, incomingId) {
  const session = match.phase === "extraTime" && match._extraEngine ? match._extraEngine : match._engine;
  const event = substituteMatchSessionPlayer(session, "home", outgoingId, incomingId, match.phase === "extraTime" ? match.minute - 90 : match.minute);
  if (event) match.pendingInjury = null;
  return event;
}

export function continueSharedMatchShortHanded(match, playerId) {
  const session = match.phase === "extraTime" && match._extraEngine ? match._extraEngine : match._engine;
  const resolved = resolveMatchSessionInjuryShortHanded(session, "home", playerId);
  if (resolved) match.pendingInjury = null;
  return resolved;
}

export function simulateMinute(match, homeRatings, rng = Math.random) {
  if (match._engine) return simulateSharedMinute(match, rng);
  const weather = WEATHER[match.weather.key] ?? WEATHER.sunny;
  const awayTactic = TACTICS[match.opponent.tactic] ?? TACTICS.balanced;
  const away = {
    attack: match.opponent.rating + awayTactic.attack * 0.45 + weather.attack,
    midfield: match.opponent.rating + awayTactic.tempo * 0.2,
    defense: match.opponent.rating + awayTactic.defense * 0.45 + weather.defense,
    goalkeeping: match.opponent.rating + 3 + weather.defense,
    tempo: awayTactic.tempo,
  };
  const home = {
    ...homeRatings,
    attack: homeRatings.attack + weather.attack,
    defense: homeRatings.defense + weather.defense,
    goalkeeping: homeRatings.goalkeeping + weather.defense,
  };
  const homeShortHanded = match.reds.home * 11;
  const awayShortHanded = match.reds.away * 11;
  home.attack -= homeShortHanded;
  home.midfield -= homeShortHanded;
  home.defense -= homeShortHanded * 0.65;
  away.attack -= awayShortHanded;
  away.midfield -= awayShortHanded;
  away.defense -= awayShortHanded * 0.65;
  const possessionEdge = home.midfield - away.midfield;
  const homePossession = clamp(50 + possessionEdge * 0.45, 34, 66);
  match.possession.home = Math.round((match.possession.home * 4 + homePossession) / 5);
  match.possession.away = 100 - match.possession.home;

  const refereeEvent = maybeRefereeEvent(match, home, away, weather, rng);
  if (refereeEvent) return refereeEvent;

  const tempo = 1 + (home.tempo + away.tempo) / 90;
  const actionChance = clamp(0.12 * tempo, 0.07, 0.2);
  if (rng() > actionChance) {
    const flowChance = clamp(0.18 + tempo * 0.03, 0.2, 0.28);
    return rng() < flowChance ? recordFlowEvent(match, homePossession, rng) : null;
  }

  const homeAttacks = rng() * 100 < homePossession;
  const attacking = homeAttacks ? home : away;
  const defending = homeAttacks ? away : home;
  const edge = attacking.attack - (defending.defense * 0.58 + defending.goalkeeping * 0.42);
  const shotQuality = clamp(0.1 + (edge + 12) / 150 + rng() * 0.18, 0.06, 0.42);
  if (homeAttacks) {
    match.homeShots += 1;
    match.homeXg += shotQuality;
  } else {
    match.awayShots += 1;
    match.awayXg += shotQuality;
  }

  const isGoal = rng() < shotQuality;
  const attackingRoster = (homeAttacks ? match.homeRoster : match.awayRoster).filter((player) => !match.sentOffIds.includes(player.id));
  const shooter = pickParticipant(attackingRoster, rng);
  const assist = rng() < 0.72 ? pickParticipant(attackingRoster, rng, shooter.id, true) : null;
  const event = {
    minute: Math.max(1, Math.floor(match.minute)),
    side: homeAttacks ? "home" : "away",
    type: isGoal ? "goal" : rng() < 0.56 ? "save" : "miss",
    playerId: shooter.id,
    playerName: shooter.name,
    assistId: assist?.id ?? null,
    assistName: assist?.name ?? null,
    xg: Number(shotQuality.toFixed(2)),
  };
  if (isGoal) {
    if (homeAttacks) match.homeScore += 1;
    else match.awayScore += 1;
  }
  event.score = { home: match.homeScore, away: match.awayScore };
  event.text = isGoal
    ? `${shooter.name}破门！${assist ? `助攻来自${assist.name}。` : "这是一记没有助攻的个人表演。"}`
    : `${shooter.name}完成射门。${randomItem(COMMENTARY[event.type], rng)}`;
  recordEvent(match, event);

  return event;
}

export function resolvePenaltyShootout(homeComposure, awayRating, rng = Math.random) {
  let home = 0;
  let away = 0;
  for (let index = 0; index < 5; index += 1) {
    if (rng() < clamp(0.7 + (homeComposure - 60) / 240, 0.58, 0.88)) home += 1;
    if (rng() < clamp(0.7 + (awayRating - 60) / 260, 0.58, 0.86)) away += 1;
  }
  while (home === away) {
    if (rng() < 0.72) home += 1;
    if (rng() < 0.71) away += 1;
  }
  return { home, away };
}

export function simulateMatchFast(team, traitCatalog = [], seed = "test", stage = 1) {
  const rng = createRng(seed);
  const opponent = generateOpponent(stage, rng);
  opponent.squad = generateOpponentSquad({ ...opponent, stage }, rng, 4);
  const match = createMatch(team, opponent, { rng, homeRoster: team.players.slice(0, TEAM_SIZE), awayRoster: opponent.squad.slice(0, TEAM_SIZE) });
  const ratings = teamRatings(team.players, team.tactic, traitCatalog, team.formation);
  for (let minute = 1; minute <= 90; minute += 1) {
    match.minute = minute;
    simulateMinute(match, ratings, rng);
  }
  return match;
}
