import { TRAIT_CARDS } from "../src/traits.js";
import { VERSUS_NEW_TRAIT_BATCH } from "./new-trait-batch.js";

const SOURCE_TRAITS = new Map(TRAIT_CARDS.map((trait) => [trait.id, trait]));

function versusTrait(id, summary, rules, overrides = {}) {
  const source = SOURCE_TRAITS.get(id);
  if (!source) throw new Error(`Unknown versus trait source: ${id}`);
  return Object.freeze({
    ...source,
    ...overrides,
    mode: "versus11",
    source: "adapted-seven-a-side",
    developerLabel: "11人制适配",
    summary,
    rules: Object.freeze(rules.map((rule) => Object.freeze(rule))),
  });
}

const VERSUS_ADAPTED_TRAIT_CARDS = Object.freeze([
  Object.freeze({
    id:"custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20",
    name:"激素紧缺",
    rarity:"common",
    category:"physical",
    eligibleRoleGroups:Object.freeze(["DEF", "MID", "ATT"]),
    tags:Object.freeze(["physical", "finishing", "pace", "dribbling"]),
    polarity:"mixed",
    summary:"该球员的身高下降5cm，射门、速度、盘带各提升5点。",
    rules:Object.freeze([
      Object.freeze({ hook:"height", addCm:-5 }),
      Object.freeze({ hook:"attribute", add:Object.freeze({ finishing:5, pace:5, dribbling:5 }) }),
    ]),
    dropWeight:1,
    maxLevel:1,
    mode:"versus11",
    source:"ydl-custom",
    developerLabel:"YDL自定义正式卡",
  }),
  versusTrait("aerial-beacon", "身高+20cm，获得ST位置熟练度，头球和弹跳各提升5点。", [
    { hook: "height", addCm: 20 },
    { hook: "position", familiarRoles: ["ST"] },
    { hook: "attribute", add: { heading: 5, jumping: 5 } },
  ], { name: "打点激素" }),
  versusTrait("touchline-flywheel", "该球员在场上时，全队在雷暴天气不会被雷击。", [
    { hook: "teamLightningProtection", immune: true },
  ], { name: "避雷针" }),
  versusTrait("shadow-marker", "该球员在场上时，自动和周围球员获得满值默契线。", [
    { hook: "chemistry", linkNearby: true, value: 100 },
  ], { name: "都是哥们" }),
  versusTrait("set-piece-toolbox", "该球员在场上时，如果遇到黑哨事件，本队视为拥有11名阿根廷球员。", [
    { hook: "argentinaCount", minimum: 11 },
  ], { name: "因凡蒂诺救救我" }),
  versusTrait("rain-boots", "该球员在雨天、雷暴、雪天比赛时，综合能力值提升12%。", [
    { hook: "allAttributes", multiply: 1.12, when: { weather: ["rain", "storm", "snow"] } },
  ], { name: "反向晴天娃娃" }),
  versusTrait("sweeper-keeper", "比赛计时达到60分钟时，该球员综合能力提升10%。", [
    { hook: "allAttributes", multiply: 1.1, when: { minuteGte: 60 } },
  ], { name: "本质大心脏" }),
  versusTrait("lone-finisher", "该球员可以适配任何国家队或俱乐部羁绊。", [
    { hook: "affinityWildcard", nationality: true, club: true },
  ], { name: "变色龙" }),
  versusTrait("big-stage", "更容易制造犯规和点球。在对方禁区内遭遇出脚但未获点球时，有10%概率因假摔吃黄牌。", [
    { hook: "penaltyDraw", foulMultiplier: 1.35, penaltyMultiplier: 1.75, simulationYellowChance: 0.1 },
  ], { name: "跳水王子" }),
  versusTrait("opening-sprint", "该球员所在球队使用伐木战术时，综合能力提升10%。", [
    { hook: "allAttributes", multiply: 1.1, when: { teamStyle: "roughPlay" } },
  ], { name: "铁血蓝白" }),
  versusTrait("stoppage-time-expert", "该球员的体力值固定为94，不会随着比赛消耗变化。", [
    { hook: "fixedFitness", value: 94 },
  ], { name: "996" }),
  versusTrait("double-edged-core", "该球员的边路相关属性获得提升，并解锁LW/RW位置熟练度。", [
    { hook: "attribute", add: { pace: 5, acceleration: 5, dribbling: 4, crossing: 5, offBall: 3 } },
    { hook: "position", familiarRoles: ["LW", "RW"] },
  ], { name: "借过一下" }),
  versusTrait("utility-player", "除门将外，出任任何陌生位置都不受位置不熟惩罚。", [
    { hook: "position", ignoreOutOfPositionPenalty: true, eligibleRoleGroups: ["DEF", "MID", "ATT"] },
  ], { name: "全能战士", tags: ["position", "flexibility"] }),
  versusTrait("muddy-knees", "该球员在比赛中一定会扑出对方主罚的第一粒点球。", [
    { hook: "firstPenaltySave", guaranteed: true },
  ], { name: "一夫当关" }),
  versusTrait("pace-budget", "该球员不会被红牌罚下。", [
    { hook: "redCardImmune", immune: true },
  ], { name: "普拉蒂尼是我爹" }),
  versusTrait("clean-tackle", "抢断+3。", [
    { hook: "attribute", add: { tackling: 3 } },
  ]),
  versusTrait("rainmaker", "降雨达到35时传球与视野各+6。", [
    { hook: "attribute", add: { passing: 6, vision: 6 }, when: { precipitationGte: 35 } },
  ]),
  versusTrait("snow-plough", "雪天力量+8、灵活+4。", [
    { hook: "attribute", add: { strength: 8, agility: 4 }, when: { weather: "snow" } },
  ]),
  versusTrait("false-nine-license", "出任前锋时传球与视野各+5，但射门-3。", [
    { hook: "attribute", add: { passing: 5, vision: 5, finishing: -3 }, when: { activeRole: "ATT" } },
  ]),
  versusTrait("immovable-object", "力量+10、盯人+6，但速度-6。", [
    { hook: "attribute", add: { strength: 10, marking: 6, pace: -6 } },
  ]),
  versusTrait("emergency-gloves", "出任陌生位置时，位置适配最低为65%；常规位置抢断-2。", [
    { hook: "position", minimumFit: 0.65 },
    { hook: "attribute", add: { tackling: -2 }, when: { activeRoleNot: "GK" } },
  ], { name: "紧急手套", tags: ["goalkeeping", "position", "tradeoff"] }),
  versusTrait("front-runner-essential", "球队领先时整体能力提高8%；落后时不受减益影响。", [
    { hook: "allAttributes", multiply: 1.08, when: { scoreState: "leading" } },
  ]),
  versusTrait("chameleon-role", "出任任何位置时，位置适配最低为70%。", [
    { hook: "position", minimumFit: 0.7 },
  ]),
  versusTrait("five-minutes-before-clockout", "60分钟前整体能力降低4%；60分钟后提高12%。", [
    { hook: "allAttributes", multiply: 0.96, when: { minuteLte: 59 } },
    { hook: "allAttributes", multiply: 1.12, when: { minuteGte: 60 } },
  ]),
]);

const YDL_CUSTOM_TRAIT_CARDS = Object.freeze([
  Object.freeze({
    id:"custom-d98bfc9a-2168-4e80-982d-c1cebef18e80",
    name:"顺风战士",
    rarity:"rare",
    category:"custom",
    eligibleRoleGroups:Object.freeze(["ANY"]),
    tags:Object.freeze(["scoreState", "tradeoff"]),
    polarity:"mixed",
    summary:"球队领先时全属性提升10%，落后时降低15%，平局时恢复正常。",
    rules:Object.freeze([
      Object.freeze({ hook:"allAttributes", multiply:1.1, when:Object.freeze({ scoreState:"leading" }) }),
      Object.freeze({ hook:"allAttributes", multiply:0.85, when:Object.freeze({ scoreState:"trailing" }) }),
    ]),
    dropWeight:1,
    maxLevel:1,
    mode:"versus11",
    source:"ydl-custom",
    developerLabel:"YDL自定义正式卡",
  }),
  Object.freeze({
    id:"custom-dc038995-c237-4fa4-b29a-b0e5abf0921a",
    name:"赖着不死",
    rarity:"epic",
    category:"custom",
    eligibleRoleGroups:Object.freeze(["ANY"]),
    tags:Object.freeze(["injury", "immunity"]),
    polarity:"positive",
    summary:"该球员不会受伤",
    rules:Object.freeze([Object.freeze({ hook:"injury", immune:true })]),
    dropWeight:1,
    maxLevel:1,
    mode:"versus11",
    source:"ydl-custom",
    developerLabel:"YDL自定义正式卡",
  }),
  Object.freeze({
    id:"custom-6d0bf2ee-2d26-4f56-9cb7-4c50960df85d",
    name:"别打我大哥",
    rarity:"epic",
    category:"custom",
    eligibleRoleGroups:Object.freeze(["ANY"]),
    tags:Object.freeze(["injury", "team", "protection"]),
    polarity:"positive",
    summary:"该球员在场时，其他队友受伤会将伤病转移到自己身上",
    rules:Object.freeze([Object.freeze({ hook:"teamInjuryTransfer", transferToSelf:true })]),
    dropWeight:1,
    maxLevel:1,
    mode:"versus11",
    source:"ydl-custom",
    developerLabel:"YDL自定义正式卡",
  }),
  Object.freeze({
    id:"custom-3b12d163-d3d9-47df-b6b7-e1d124abcb62",
    name:"大巴司机",
    rarity:"rare",
    category:"custom",
    eligibleRoleGroups:Object.freeze(["GK", "DEF"]),
    tags:Object.freeze(["tactics", "defending"]),
    polarity:"positive",
    summary:"该球员在执行全力防守战术时综合能力提升15%",
    rules:Object.freeze([Object.freeze({ hook:"allAttributes", multiply:1.15, when:Object.freeze({ teamTactic:"parkBus" }) })]),
    dropWeight:1,
    maxLevel:1,
    mode:"versus11",
    source:"ydl-custom",
    developerLabel:"YDL自定义正式卡",
  }),
]);

const spiritPossession = {
  id:"spirit-possession", name:"请神上身", rarity:"legendary", category:"custom",
  eligibleRoleGroups:["ANY"], tags:["prematch"], polarity:"mixed",
  summary:"开赛前随机化身一名 +4 的 S 级球员，位置不限，持续整场。比赛数据归原球员。",
  rules:[{hook:"spiritPossession"}], dropWeight:1, maxLevel:1,
  mode:"versus11", source:"ydl-custom", developerLabel:"YDL自定义正式卡",
};

const matchTraitCards = [
  {id:"all-in-gamble",name:"梭哈是一种智慧",rarity:"rare",
    summary:"开赛时各有50%概率使自身全属性提升或降低8%，结果维持至终场。",
    rules:[{hook:"allInGamble",winMultiply:1.08,loseMultiply:0.92}]},
  {id:"sponsor-entry",name:"带资进组",rarity:"epic",
    summary:"正式联赛或冠军杯首发时，自身全属性降低10%。完赛每人赞助：B级500、A级750，杯赛十六强至决赛依次1800、2000、2500、3000金币。多人可叠加。",
    rules:[{hook:"sponsorEntry",multiply:0.9}]},
  {id:"high-press-hound",name:"疯狗来了",rarity:"rare",eligibleRoleGroups:["ATT","MID"],polarity:"positive",
    summary:"高位压迫时抢断、速度、投入和耐力各加6点。切换打法时随之生效或解除。",
    rules:[{hook:"attribute",when:{teamStyle:"highPress"},add:{tackling:6,pace:6,workRate:6,stamina:6}}]},
  {id:"overtime-grinder",name:"卷王来了",rarity:"epic",polarity:"positive",
    summary:"进入加时或点球大战后，首次在场时体能恢复至100；决胜阶段射门、冷静各加6点，门将扑救、反应也各加6点。",
    rules:[{hook:"extraTimeRecovery",when:{inExtraOrShootout:true}},
      {hook:"attribute",when:{inExtraOrShootout:true},add:{finishing:6,composure:6}},
      {hook:"attribute",when:{inExtraOrShootout:true,activeRole:"GK"},add:{goalkeeping:6,reflexes:6}}]},
  {id:"captain-boss",name:"队霸来了",rarity:"epic",polarity:"positive",
    summary:"担任在场队长时，队长风格对全队的战术加成和纪律修正幅度翻倍。",
    rules:[{hook:"captainAmplify",multiplier:2}]},
  {id:"nine-dragons-coffin",name:"九龙拉棺",rarity:"legendary",
    summary:"每队每场限一人，在场期间体能锁定100，全属性提升5%。正式联赛或冠军杯正常完赛后，本体卡基础总评永久降低1点，最低50。",
    rules:[{hook:"nineDragonsCoffin",multiply:1.05}]},
].map(card=>({category:"custom",eligibleRoleGroups:["ANY"],tags:["match"],polarity:"mixed",...card,
  dropWeight:1,maxLevel:1,mode:"versus11",source:"ydl-custom",developerLabel:"YDL自定义正式卡"}));

export const VERSUS_TRAIT_CARDS = Object.freeze(
  [...VERSUS_ADAPTED_TRAIT_CARDS, ...VERSUS_NEW_TRAIT_BATCH, ...YDL_CUSTOM_TRAIT_CARDS, spiritPossession, ...matchTraitCards].map((trait) => structuredClone(trait)),
);
export { VERSUS_ADAPTED_TRAIT_CARDS, VERSUS_NEW_TRAIT_BATCH };

export const VERSUS_TRAIT_BY_ID = Object.freeze(Object.fromEntries(VERSUS_TRAIT_CARDS.map((trait) => [trait.id, trait])));
export const VERSUS_EXCLUDED_TRAIT_IDS = Object.freeze(TRAIT_CARDS.filter((trait) => !VERSUS_TRAIT_BY_ID[trait.id]).map((trait) => trait.id));

export const YDL_TRAIT_IDS = Object.freeze([
  "custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20",
  "aerial-beacon",
  "touchline-flywheel",
  "shadow-marker",
  "set-piece-toolbox",
  "rain-boots",
  "sweeper-keeper",
  "lone-finisher",
  "big-stage",
  "opening-sprint",
  "stoppage-time-expert",
  "double-edged-core",
  "utility-player",
  "muddy-knees",
  "pace-budget",
  "custom-d98bfc9a-2168-4e80-982d-c1cebef18e80",
  "custom-dc038995-c237-4fa4-b29a-b0e5abf0921a",
  "custom-6d0bf2ee-2d26-4f56-9cb7-4c50960df85d",
  "custom-3b12d163-d3d9-47df-b6b7-e1d124abcb62",
  "spirit-possession",
  ...matchTraitCards.map(card=>card.id),
]);
export const YDL_TRAIT_CARDS = Object.freeze(YDL_TRAIT_IDS.map((id) => VERSUS_TRAIT_BY_ID[id]));
export const YDL_TRAIT_BY_ID = Object.freeze(Object.fromEntries(YDL_TRAIT_CARDS.map((trait) => [trait.id, trait])));
