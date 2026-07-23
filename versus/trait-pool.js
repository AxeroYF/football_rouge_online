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
  versusTrait("aerial-beacon", "头球与弹跳各+5，但速度-2。", [
    { hook: "attribute", add: { heading: 5, jumping: 5, pace: -2 } },
  ]),
  versusTrait("touchline-flywheel", "出任边路位置时速度+3、传中+4。", [
    { hook: "attribute", add: { pace: 3, crossing: 4 }, when: { roleIsWide: true } },
  ]),
  versusTrait("shadow-marker", "盯人与抢断各+4，但速度-2。", [
    { hook: "attribute", add: { marking: 4, tackling: 4, pace: -2 } },
  ]),
  versusTrait("set-piece-toolbox", "定位球能力+7。", [
    { hook: "attribute", add: { setPieces: 7 } },
  ]),
  versusTrait("rain-boots", "降雨超过60时灵活+4。", [
    { hook: "attribute", add: { agility: 4 }, when: { precipitationGte: 60 } },
  ]),
  versusTrait("sweeper-keeper", "传球+5，但扑救反应-2。", [
    { hook: "attribute", add: { passing: 5, reflexes: -2 } },
  ]),
  versusTrait("lone-finisher", "射门与冷静各+7，但传球-3。", [
    { hook: "attribute", add: { finishing: 7, composure: 7, passing: -3 } },
  ]),
  versusTrait("big-stage", "70分钟后比分持平或落后时，决策与冷静各+6。", [
    { hook: "attribute", add: { decisions: 6, composure: 6 }, when: { minuteGte: 70, scoreState: ["tied", "trailing"] } },
  ]),
  versusTrait("opening-sprint", "前20分钟速度与无球各+7；65分钟后速度-3。", [
    { hook: "attribute", add: { pace: 7, offBall: 7 }, when: { minuteLte: 20 } },
    { hook: "attribute", add: { pace: -3 }, when: { minuteGte: 65 } },
  ]),
  versusTrait("stoppage-time-expert", "85分钟后冷静+8。", [
    { hook: "attribute", add: { composure: 8 }, when: { minuteGte: 85 } },
  ]),
  versusTrait("double-edged-core", "视野+6、射门+4；体能低于40时决策-5。", [
    { hook: "attribute", add: { vision: 6, finishing: 4 } },
    { hook: "attribute", add: { decisions: -5 }, when: { fitnessLte: 40 } },
  ]),
  versusTrait("utility-player", "除门将外，出任任何陌生位置都不受位置不熟惩罚。", [
    { hook: "position", ignoreOutOfPositionPenalty: true, eligibleRoleGroups: ["DEF", "MID", "ATT"] },
  ], { name: "全能战士", tags: ["position", "flexibility"] }),
  versusTrait("muddy-knees", "降雨达到35时抢断+5。", [
    { hook: "attribute", add: { tackling: 5 }, when: { precipitationGte: 35 } },
  ]),
  versusTrait("pace-budget", "前30分钟速度-2；70分钟后速度与耐力各+4。", [
    { hook: "attribute", add: { pace: -2 }, when: { minuteLte: 30 } },
    { hook: "attribute", add: { pace: 4, stamina: 4 }, when: { minuteGte: 70 } },
  ]),
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
  versusTrait("front-runner-essential", "球队领先时整体能力提高30%；落后时整体能力降低50%。", [
    { hook: "allAttributes", multiply: 1.3, when: { scoreState: "leading" } },
    { hook: "allAttributes", multiply: 0.5, when: { scoreState: "trailing" } },
  ]),
  versusTrait("chameleon-role", "出任任何位置时，位置适配最低为70%。", [
    { hook: "position", minimumFit: 0.7 },
  ]),
  versusTrait("five-minutes-before-clockout", "60分钟前整体能力降低10%；60分钟后提高35%。", [
    { hook: "allAttributes", multiply: 0.9, when: { minuteLte: 59 } },
    { hook: "allAttributes", multiply: 1.35, when: { minuteGte: 60 } },
  ]),
]);

export const VERSUS_TRAIT_CARDS = Object.freeze([...VERSUS_ADAPTED_TRAIT_CARDS, ...VERSUS_NEW_TRAIT_BATCH]);
export { VERSUS_ADAPTED_TRAIT_CARDS, VERSUS_NEW_TRAIT_BATCH };

export const VERSUS_TRAIT_BY_ID = Object.freeze(Object.fromEntries(VERSUS_TRAIT_CARDS.map((trait) => [trait.id, trait])));
export const VERSUS_EXCLUDED_TRAIT_IDS = Object.freeze(TRAIT_CARDS.filter((trait) => !VERSUS_TRAIT_BY_ID[trait.id]).map((trait) => trait.id));
