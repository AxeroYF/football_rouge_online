import { Random } from "./random.js";
import { NEW_TRAIT_BATCH } from "./new-trait-batch.js";
import { roleGroup } from "../game/public/schema.js";
export { roleGroup } from "../game/public/schema.js";

export const TRAIT_RULES = Object.freeze({
  offerSize: 3,
  maxTraitsPerPlayer: 3,
  rarityWeights: Object.freeze({
    common: 62,
    rare: 27,
    epic: 9,
    legendary: 2,
  }),
  pity: Object.freeze({
    rareAfterOffers: 7,
    epicAfterOffers: 18,
  }),
});

export const RARITY_LABELS = Object.freeze({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传奇",
});

const RARITY_ORDER = ["common", "rare", "epic", "legendary"];

function card(id, name, rarity, category, roles, tags, summary, rules) {
  return Object.freeze({
    id,
    name,
    rarity,
    category,
    eligibleRoleGroups: Object.freeze(roles),
    tags: Object.freeze(tags),
    polarity: tags.includes("tradeoff") ? "mixed" : "positive",
    summary,
    rules: Object.freeze(rules.map((rule) => Object.freeze(rule))),
    dropWeight: 1,
    maxLevel: 1,
  });
}

const BASE_TRAIT_CARDS = Object.freeze([
  card(
    "one-touch",
    "一脚出球",
    "common",
    "technique",
    ["DEF", "MID"],
    ["buildUp", "possession", "antiPress"],
    "对手逼抢达到65以上时，球队后场组织成功率获得相当于+4组织能力的加成。",
    [{ hook: "phase", phase: "buildUp", addRating: 4, when: { opponentPressingGte: 65 } }],
  ),
  card(
    "box-instinct",
    "禁区嗅觉",
    "common",
    "technique",
    ["ATT"],
    ["finishing", "movement"],
    "直塞和倒三角机会中，被选为射手的权重提高35%。",
    [{ hook: "shooterSelection", shotTypes: ["throughBall", "cutback"], multiplyWeight: 1.35 }],
  ),
  card(
    "aerial-beacon",
    "空中灯塔",
    "common",
    "physical",
    ["DEF", "ATT"],
    ["aerial", "cross", "setPiece", "tradeoff"],
    "头球与弹跳各+5、争顶射手权重提高40%，但速度-2。",
    [{ hook: "attribute", add: { heading: 5, jumping: 5, pace: -2 } }, { hook: "shooterSelection", shotTypes: ["cross", "corner"], multiplyWeight: 1.4 }],
  ),
  card(
    "endless-engine",
    "永动机",
    "common",
    "physical",
    ["DEF", "MID", "ATT"],
    ["stamina", "pressing"],
    "整场比赛的动态疲劳惩罚减少25%。",
    [{ hook: "fatigue", multiplyPenalty: 0.75 }],
  ),
  card(
    "touchline-flywheel",
    "边线飞轮",
    "common",
    "technique",
    ["DEF", "MID", "ATT"],
    ["wide", "cross", "tradeoff"],
    "踢边路位置时速度+3、传中+4；被放到中路时机会创造-2。",
    [{ hook: "attribute", add: { pace: 3, crossing: 4 }, when: { roleIsWide: true } }, { hook: "phase", phase: "chanceCreation", addRating: -2, when: { roleIsCentral: true } }],
  ),
  card(
    "shadow-marker",
    "贴身影子",
    "common",
    "defending",
    ["DEF", "MID"],
    ["marking", "duel", "tradeoff"],
    "对方射门权重最高的球员在场时，盯人与抢断各+5，但自身犯规率提高10%。",
    [{ hook: "attribute", add: { marking: 5, tackling: 5 }, when: { opponentPrimaryShooterActive: true } }, { hook: "foul", multiplyProbability: 1.1 }],
  ),
  card(
    "long-shot-license",
    "远射许可证",
    "common",
    "technique",
    ["MID", "ATT"],
    ["longShot", "variance", "tradeoff"],
    "远射选择权重变为1.8倍，远射机会质量提高12%；球队会因此放弃一部分更稳妥的进攻。",
    [{ hook: "shotType", shotType: "longShot", multiplyWeight: 1.8, multiplyXg: 1.12 }],
  ),
  card(
    "set-piece-toolbox",
    "定位球工具箱",
    "common",
    "technique",
    ["DEF", "MID", "ATT"],
    ["setPiece"],
    "定位球能力+7，并优先成为本队主罚者。",
    [{ hook: "attribute", add: { setPieces: 7 } }, { hook: "setPieceTaker", multiplyWeight: 1.5 }],
  ),
  card(
    "penalty-ice",
    "冰点十二码",
    "common",
    "mentality",
    ["DEF", "MID", "ATT"],
    ["penalty", "composure", "tradeoff"],
    "点球进球率增加8个百分点；若仍然罚失，本场状态-8。",
    [{ hook: "shot", shotType: "penalty", addGoalProbability: 0.08 }, { hook: "afterPenaltyMiss", addMorale: -8 }],
  ),
  card(
    "long-pass-switch",
    "长传开关",
    "common",
    "tactics",
    ["DEF", "MID"],
    ["direct", "progression", "tradeoff"],
    "直接进攻的推进能力+5，但后场组织阶段丢失球权的概率增加3个百分点。",
    [{ hook: "phase", phase: "progression", addRating: 5, when: { teamDirectnessGte: 60 } }, { hook: "phase", phase: "buildUp", addFailureProbability: 0.03 }],
  ),
  card(
    "rain-boots",
    "雨鞋",
    "common",
    "environment",
    ["ANY"],
    ["weather", "rain"],
    "无视降雨和烂场地带来的个人传控惩罚；降雨超过60时灵活+4。",
    [{ hook: "weather", ignore: ["rainPassingPenalty", "poorPitchPenalty"] }, { hook: "attribute", add: { agility: 4 }, when: { precipitationGte: 60 } }],
  ),
  card(
    "impact-sub",
    "替补热身王",
    "common",
    "mentality",
    ["ANY"],
    ["substitution", "tempo"],
    "替补登场后的20分钟内，所有阶段能力+5；首发时没有效果。",
    [{ hook: "derivedMetric", addRating: 5, when: { minutesSinceSubLte: 20 } }],
  ),
  card(
    "sweeper-keeper",
    "清道夫门将",
    "common",
    "goalkeeping",
    ["GK"],
    ["highLine", "buildUp", "tradeoff"],
    "防线高度达到60以上时，球队转换防守+4、门将传球+5；出击失败会产生一次高质量吊射。",
    [{ hook: "attribute", add: { passing: 5 }, when: { teamDefensiveLineGte: 60 } }, { hook: "phase", phase: "transitionDefense", addRating: 4, when: { teamDefensiveLineGte: 60 } }, { hook: "sweeperFailure", createShotType: "chip" }],
  ),
  card(
    "safe-outlet",
    "安全出口",
    "common",
    "tactics",
    ["MID", "ATT"],
    ["buildUp", "possession", "tradeoff"],
    "球队后场组织+3，但该球员主动射门的权重降低40%。",
    [{ hook: "phase", phase: "buildUp", addRating: 3 }, { hook: "shooterSelection", multiplyWeight: 0.6 }],
  ),

  card(
    "assist-chef",
    "喂饼大师",
    "rare",
    "playmaking",
    ["MID", "ATT"],
    ["creation", "assist", "tradeoff"],
    "场上存在前锋时机会创造+7，自身射门权重降低45%；由其创造的进球会额外提升射手状态。",
    [{ hook: "phase", phase: "chanceCreation", addRating: 7, when: { strikerActive: true } }, { hook: "shooterSelection", multiplyWeight: 0.55 }, { hook: "afterAssistedGoal", addShooterMorale: 3 }],
  ),
  card(
    "lone-finisher",
    "独狼终结者",
    "rare",
    "personality",
    ["ATT"],
    ["finishing", "chemistry", "tradeoff"],
    "射门与冷静各+7，但该球员在场时球队默契按-5计算。",
    [{ hook: "attribute", add: { finishing: 7, composure: 7 } }, { hook: "teamState", addChemistry: -5 }],
  ),
  card(
    "grows-from-misses",
    "越挫越勇",
    "rare",
    "mentality",
    ["MID", "ATT"],
    ["finishing", "momentum"],
    "每次射失后，下一次射门的射门与冷静各+3，最多叠加3层；进球后清空。",
    [{ hook: "afterShotMiss", addStack: "missResolve", maxStacks: 3 }, { hook: "shot", addPerStack: { finishing: 3, composure: 3 }, stack: "missResolve" }, { hook: "afterGoal", clearStack: "missResolve" }],
  ),
  card(
    "professional-foul",
    "战术犯规",
    "rare",
    "defending",
    ["DEF", "MID"],
    ["counter", "card", "tradeoff"],
    "对手形成反击时有35%概率提前终止该次进攻，但自身吃牌概率变为1.45倍。",
    [{ hook: "opponentCounter", cancelProbability: 0.35 }, { hook: "card", multiplyProbability: 1.45 }],
  ),
  card(
    "pressing-trigger",
    "压迫扳机",
    "rare",
    "tactics",
    ["MID", "ATT"],
    ["pressing", "stamina", "tradeoff"],
    "前场丢球后，下一次防守的逼抢+7；本场疲劳累积速度提高18%。",
    [{ hook: "afterFinalThirdTurnover", addNextPhaseRating: { phase: "press", value: 7 } }, { hook: "fatigue", multiplyPenalty: 1.18 }],
  ),
  card(
    "first-counter-arrow",
    "反击第一箭",
    "rare",
    "tactics",
    ["MID", "ATT"],
    ["counter", "progression", "tradeoff"],
    "反击中的推进与创造各+7，阵地进攻中的创造-3。",
    [{ hook: "phase", phase: ["progression", "chanceCreation"], addRating: 7, when: { possessionType: "counter" } }, { hook: "phase", phase: "chanceCreation", addRating: -3, when: { possessionType: "settled" } }],
  ),
  card(
    "low-block-keeper",
    "低位门神",
    "rare",
    "goalkeeping",
    ["GK"],
    ["lowBlock", "shotStopping", "tradeoff"],
    "防线高度不超过40时扑救+8；防线高度达到60以上时扑救-5。",
    [{ hook: "phase", phase: "shotStopping", addRating: 8, when: { teamDefensiveLineLte: 40 } }, { hook: "phase", phase: "shotStopping", addRating: -5, when: { teamDefensiveLineGte: 60 } }],
  ),
  card(
    "big-stage",
    "大场面球员",
    "rare",
    "mentality",
    ["ANY"],
    ["lateGame", "comeback"],
    "70分钟后，当比分持平或落后时，决策与冷静各+6。",
    [{ hook: "attribute", add: { decisions: 6, composure: 6 }, when: { minuteGte: 70, scoreState: ["tied", "trailing"] } }],
  ),
  card(
    "opening-sprint",
    "开场闪击",
    "rare",
    "physical",
    ["MID", "ATT"],
    ["earlyGame", "pace", "tradeoff"],
    "前20分钟速度与无球各+7；65分钟后额外承受3点疲劳惩罚。",
    [{ hook: "attribute", add: { pace: 7, offBall: 7 }, when: { minuteLte: 20 } }, { hook: "fatigue", addPenalty: 3, when: { minuteGte: 65 } }],
  ),
  card(
    "stoppage-time-expert",
    "读秒专家",
    "rare",
    "mentality",
    ["MID", "ATT"],
    ["lateGame", "finishing"],
    "85分钟后射手选择权重变为2倍、冷静+8；可能因此抢走队友更好的机会。",
    [{ hook: "shooterSelection", multiplyWeight: 2, when: { minuteGte: 85 } }, { hook: "attribute", add: { composure: 8 }, when: { minuteGte: 85 } }],
  ),
  card(
    "glass-cannon",
    "玻璃大炮",
    "rare",
    "physical",
    ["ANY"],
    ["peak", "injury", "tradeoff"],
    "三项最高的非身体能力各+8，但受伤概率变为2.2倍，赛后体能消耗提高25%。",
    [{ hook: "topAttributes", count: 3, exclude: "physical", add: 8 }, { hook: "injury", multiplyProbability: 2.2 }, { hook: "postMatchFitness", multiplyLoss: 1.25 }],
  ),
  card(
    "offside-artist",
    "越位艺术家",
    "rare",
    "movement",
    ["ATT"],
    ["throughBall", "variance", "tradeoff"],
    "直塞形成的机会质量提高20%，但其中18%的推进会因越位直接结束。",
    [{ hook: "shotType", shotType: "throughBall", multiplyXg: 1.2 }, { hook: "progression", when: { intendedShotType: "throughBall" }, forceTurnoverProbability: 0.18, reason: "offside" }],
  ),

  card(
    "hard-mode-scorer",
    "专进难球",
    "epic",
    "quirk",
    ["MID", "ATT"],
    ["finishing", "variance", "tradeoff"],
    "xG不高于0.08的射门，进球率提高55%；xG不低于0.25的射门，进球率降低20%。",
    [{ hook: "shot", multiplyGoalProbability: 1.55, when: { xgLte: 0.08 } }, { hook: "shot", multiplyGoalProbability: 0.8, when: { xgGte: 0.25 } }],
  ),
  card(
    "metronome",
    "节拍器",
    "epic",
    "playmaking",
    ["MID"],
    ["buildUp", "progression", "dependency", "tradeoff"],
    "在场时全队组织与推进各+4；如果他受伤或被罚下，全队本场状态-8。",
    [{ hook: "phase", phase: ["buildUp", "progression"], addRating: 4 }, { hook: "onForcedExit", addTeamMorale: -8 }],
  ),
  card(
    "defense-commander",
    "防线指挥官",
    "epic",
    "leadership",
    ["GK", "DEF"],
    ["defending", "setPiece", "aura", "tradeoff"],
    "在场时全队防守+4、定位球防守+6，但本人参与进攻的能力-3；同名光环只取最高。",
    [{ hook: "phase", phase: "defending", addTeamRating: 4, uniqueAura: true }, { hook: "phase", phase: "setPieceDefense", addTeamRating: 6, uniqueAura: true }, { hook: "phase", phase: "attacking", addRating: -3 }],
  ),
  card(
    "locker-room-glue",
    "更衣室黏合剂",
    "epic",
    "personality",
    ["ANY"],
    ["chemistry", "aura"],
    "该球员进入比赛名单时，球队默契按+12计算；本人不获得这项加成。",
    [{ hook: "teamState", addChemistry: 12, excludeSelf: true, uniqueAura: true }],
  ),
  card(
    "double-edged-core",
    "双刃核心",
    "epic",
    "personality",
    ["MID", "ATT"],
    ["usage", "creation", "finishing", "tradeoff"],
    "55%的关键进攻会优先经过他，创造+6、射门+4；当体能低于40时，全队推进-6。",
    [{ hook: "keyActionSelection", minimumShare: 0.55 }, { hook: "attribute", add: { vision: 6, finishing: 4 } }, { hook: "phase", phase: "progression", addTeamRating: -6, when: { fitnessLte: 40 } }],
  ),
  card(
    "ten-man-hero",
    "十人战神",
    "epic",
    "mentality",
    ["ANY"],
    ["redCard", "comeback"],
    "本队少一人时个人所有阶段能力+8，并让少打一人的团队惩罚减少20%；人数相等时没有效果。",
    [{ hook: "derivedMetric", addRating: 8, when: { teamPlayerDeficitGte: 1 } }, { hook: "shortHandPenalty", multiplyTeamPenalty: 0.8, when: { teamPlayerDeficitGte: 1 } }],
  ),
  card(
    "penalty-reader",
    "扑点专家",
    "epic",
    "goalkeeping",
    ["GK"],
    ["penalty", "reroll", "tradeoff"],
    "每场可让对手第一次罚进的点球重判一次；作为代价，常规传球-3。",
    [{ hook: "afterOpponentPenaltyGoal", reroll: true, chargesPerMatch: 1 }, { hook: "attribute", add: { passing: -3 } }],
  ),
  card(
    "utility-player",
    "万金油",
    "epic",
    "tactics",
    ["DEF", "MID", "ATT"],
    ["position", "substitution", "flexibility"],
    "可以替补除门将外的任意位置，完全取消位置不熟惩罚，但在非主位置只发挥90%的特性加成。",
    [{ hook: "position", ignoreOutOfPositionPenalty: true, eligibleRoleGroups: ["DEF", "MID", "ATT"] }, { hook: "traitEffect", multiplyEffect: 0.9, when: { outsidePrimaryRole: true } }],
  ),
  card(
    "borrowed-peak",
    "借来的巅峰",
    "epic",
    "campaign",
    ["ANY"],
    ["peak", "injury", "oncePerRun", "tradeoff"],
    "每轮征程可主动开启一次：本场所有能力+7；赛后有35%概率受伤，并额外损失20体能。",
    [{ hook: "manualActivation", chargesPerRun: 1, addAllAttributes: 7 }, { hook: "postMatch", injuryProbability: 0.35, addFitness: -20, when: { activated: true } }],
  ),

  card(
    "last-dance",
    "最后一舞",
    "legendary",
    "campaign",
    ["ANY"],
    ["elimination", "story", "tradeoff"],
    "淘汰赛可主动开启：本场所有能力+10；若球队晋级，之后每场身体能力永久-2，直到本轮征程结束。",
    [{ hook: "manualActivation", when: { eliminationMatch: true }, addAllAttributes: 10 }, { hook: "campaignAdvance", addPhysicalAttributes: -2, when: { activatedAndWon: true } }],
  ),
  card(
    "total-football",
    "全攻全守",
    "legendary",
    "tactics",
    ["DEF", "MID", "ATT"],
    ["position", "contribution", "stamina", "tradeoff"],
    "本职阶段之外，还能以70%效率参与相邻的进攻或防守阶段；疲劳累积速度提高30%。",
    [{ hook: "phaseContribution", adjacentPhaseEfficiency: 0.7 }, { hook: "fatigue", multiplyPenalty: 1.3 }],
  ),
  card(
    "rewrite-fate",
    "改写命运",
    "legendary",
    "mentality",
    ["MID", "ATT"],
    ["reroll", "finishing", "tradeoff"],
    "每场第一次错失xG不低于0.25的机会时重判射门；若第二次仍未进球，本场状态-10。",
    [{ hook: "afterShotMiss", reroll: true, chargesPerMatch: 1, when: { xgGte: 0.25 } }, { hook: "afterRerollMiss", addMorale: -10 }],
  ),
  card(
    "nameless-heart",
    "无名队魂",
    "legendary",
    "personality",
    ["ANY"],
    ["underdog", "aura", "teamBuilding"],
    "每有一名未装备史诗或传奇特性的队友，其他队员有效状态+1，最多+8；持卡者本人不享受。",
    [{ hook: "teamState", addPerEligibleTeammate: 1, maximum: 8, excludeSelf: true }],
  ),
  card(
    "keeper-charge",
    "门将冲锋",
    "legendary",
    "goalkeeping",
    ["GK"],
    ["lateGame", "setPiece", "variance", "tradeoff"],
    "85分钟后落后时，门将加入角球与前场定位球，定位球进攻+10；若进攻失败，有15%概率送给对手空门反击。",
    [{ hook: "phase", phase: "setPieceAttack", addTeamRating: 10, when: { minuteGte: 85, scoreState: "trailing" } }, { hook: "afterFailedSetPiece", createEmptyGoalCounterProbability: 0.15, when: { minuteGte: 85, scoreState: "trailing" } }],
  ),

  card(
    "first-step-thief",
    "第一步小偷",
    "common",
    "defending",
    ["DEF", "MID"],
    ["tackling", "duel"],
    "每次防守对位的第一次抢断获得+6判定，失败后本次对位不再生效。",
    [{ hook: "duel", duelType: "tackle", addRating: 6, chargesPerPossession: 1 }],
  ),
  card(
    "wall-pass-addict",
    "撞墙上瘾",
    "common",
    "technique",
    ["MID", "ATT"],
    ["passing", "movement", "possession"],
    "连续短传后推进+4；如果队友没有回传，他会短暂地感到失落。",
    [{ hook: "phase", phase: "progression", addRating: 4, when: { consecutiveShortPassesGte: 2 } }],
  ),
  card(
    "near-post-padlock",
    "近角挂锁",
    "common",
    "goalkeeping",
    ["GK"],
    ["goalkeeping", "shotStopping", "tradeoff"],
    "扑救近角射门+7，但面对挑射时扑救-3。",
    [{ hook: "phase", phase: "shotStopping", addRating: 7, when: { shotTarget: "nearPost" } }, { hook: "phase", phase: "shotStopping", addRating: -3, when: { shotType: "chip" } }],
  ),
  card(
    "loud-organizer",
    "自带扩音器",
    "common",
    "leadership",
    ["GK", "DEF"],
    ["defending", "aura"],
    "本人在场时，相邻防守队友站位+3；解说席可能听见他的全部指令。",
    [{ hook: "attributeAura", target: "adjacentDefenders", add: { positioning: 3 } }],
  ),
  card(
    "muddy-knees",
    "泥腿防线",
    "common",
    "environment",
    ["DEF"],
    ["weather", "rain", "tackling"],
    "雨天与烂场地中抢断+5，铲球动作看起来尤其有说服力。",
    [{ hook: "attribute", add: { tackling: 5 }, when: { precipitationGte: 35 } }],
  ),
  card(
    "second-ball-radar",
    "二点球雷达",
    "common",
    "mentality",
    ["DEF", "MID"],
    ["possession", "aerial"],
    "争顶或封堵后的二点球争夺+6。",
    [{ hook: "phase", phase: "secondBall", addRating: 6 }],
  ),
  card(
    "weak-foot-tuesday",
    "今天练逆足",
    "common",
    "technique",
    ["ANY"],
    ["passing", "variance", "tradeoff"],
    "逆足传射惩罚减半，但有12%概率坚持用逆足处理本可用惯用脚的球。",
    [{ hook: "weakFoot", multiplyPenalty: 0.5 }, { hook: "actionSelection", forceWeakFootProbability: 0.12 }],
  ),
  card(
    "calm-restart",
    "慢慢开门球",
    "common",
    "tactics",
    ["GK", "DEF"],
    ["buildUp", "composure"],
    "比赛领先时门球与后场任意球的组织+5。",
    [{ hook: "phase", phase: "buildUp", addRating: 5, when: { scoreState: "leading", restartFromBack: true } }],
  ),
  card(
    "corner-flag-friend",
    "角旗区熟客",
    "common",
    "technique",
    ["MID", "ATT"],
    ["wide", "possession", "lateGame"],
    "领先时在角旗区护球，球队拖延时间效率+35%。",
    [{ hook: "timeManagement", multiplyDelayEfficiency: 1.35, when: { scoreState: "leading" } }],
  ),
  card(
    "goal-frame-believer",
    "门柱信徒",
    "common",
    "goalkeeping",
    ["GK"],
    ["shotStopping", "morale"],
    "对手射中门框后状态+4，并在下一次扑救中获得+3判定。",
    [{ hook: "afterOpponentWoodwork", addMorale: 4, addNextSaveRating: 3 }],
  ),
  card(
    "pace-budget",
    "省着点跑",
    "common",
    "physical",
    ["DEF", "MID"],
    ["stamina", "lateGame", "tradeoff"],
    "前30分钟速度-2，70分钟后速度与耐力各+4。",
    [{ hook: "attribute", add: { pace: -2 }, when: { minuteLte: 30 } }, { hook: "attribute", add: { pace: 4, stamina: 4 }, when: { minuteGte: 70 } }],
  ),
  card(
    "crowd-powered",
    "人来疯",
    "common",
    "mentality",
    ["ANY"],
    ["home", "morale", "tradeoff"],
    "主场时状态+4，空场或客场时决策-2。",
    [{ hook: "teamState", addForm: 4, when: { venue: "home" } }, { hook: "attribute", add: { decisions: -2 }, when: { venue: ["away", "empty"] } }],
  ),
  card(
    "clean-tackle",
    "干净利落",
    "common",
    "defending",
    ["DEF", "MID"],
    ["tackling", "discipline"],
    "抢断+3，铲球造成犯规的概率降低18%。",
    [{ hook: "attribute", add: { tackling: 3 } }, { hook: "foul", multiplyProbability: 0.82, when: { action: "tackle" } }],
  ),
  card(
    "toe-poke",
    "脚尖一捅",
    "common",
    "technique",
    ["MID", "ATT"],
    ["finishing", "surprise"],
    "禁区内被贴身时仍有30%概率完成低质量捅射。",
    [{ hook: "underPressure", createShotProbability: 0.3, shotType: "toePoke", xgMultiplier: 0.72 }],
  ),
  card(
    "halftime-snack",
    "中场小饼干",
    "common",
    "quirk",
    ["ANY"],
    ["stamina", "halftime"],
    "中场休息额外恢复5点体能。没人知道饼干藏在哪里。",
    [{ hook: "halftime", addFitness: 5 }],
  ),
  card(
    "bounce-reader",
    "反弹预报员",
    "common",
    "technique",
    ["ANY"],
    ["poorPitch", "possession"],
    "场地质量低于60时停球与二点球判断各+4。",
    [{ hook: "attribute", add: { firstTouch: 4, decisions: 4 }, when: { pitchQualityLte: 60 } }],
  ),

  card(
    "nutmeg-tax",
    "穿裆税",
    "rare",
    "technique",
    ["MID", "ATT"],
    ["dribbling", "morale", "tradeoff"],
    "成功过人有18%概率触发穿裆，使对手状态-3；失败时本人决策-2，持续10分钟。",
    [{ hook: "afterDribbleWin", triggerProbability: 0.18, addOpponentMorale: -3 }, { hook: "afterDribbleLoss", addTemporary: { decisions: -2 }, durationMinutes: 10 }],
  ),
  card(
    "captains-armband",
    "队长袖标",
    "rare",
    "leadership",
    ["ANY"],
    ["morale", "aura"],
    "本人担任队长时，全队落后后的状态损失减少50%。",
    [{ hook: "teamMoraleLoss", multiplyLoss: 0.5, when: { isCaptain: true, scoreState: "trailing" } }],
  ),
  card(
    "rainmaker",
    "雨幕导演",
    "rare",
    "environment",
    ["MID"],
    ["weather", "rain", "passing"],
    "雨天传球与视野各+6，且本队雨天失误惩罚减少20%。",
    [{ hook: "attribute", add: { passing: 6, vision: 6 }, when: { precipitationGte: 35 } }, { hook: "weather", multiplyTeamRainError: 0.8 }],
  ),
  card(
    "snow-plough",
    "雪地推土机",
    "rare",
    "physical",
    ["DEF", "ATT"],
    ["weather", "snow", "physical"],
    "雪天力量与平衡各+8，并无视雪天一半速度惩罚。",
    [{ hook: "attribute", add: { strength: 8, balance: 8 }, when: { weather: "snow" } }, { hook: "weather", multiplySnowPacePenalty: 0.5 }],
  ),
  card(
    "protect-one-goal",
    "一球保险箱",
    "rare",
    "defending",
    ["GK", "DEF"],
    ["lateGame", "defending", "tradeoff"],
    "70分钟后领先一球时防守+7，但球队推进-4。",
    [{ hook: "phase", phase: "defending", addRating: 7, when: { minuteGte: 70, leadEquals: 1 } }, { hook: "phase", phase: "progression", addTeamRating: -4, when: { minuteGte: 70, leadEquals: 1 } }],
  ),
  card(
    "derby-blood",
    "德比体质",
    "rare",
    "mentality",
    ["ANY"],
    ["rivalry", "aggression", "tradeoff"],
    "面对宿敌时所有能力+4、侵略性+10，吃牌概率提高20%。",
    [{ hook: "derivedMetric", addRating: 4, when: { rivalryMatch: true } }, { hook: "attribute", add: { aggression: 10 }, when: { rivalryMatch: true } }, { hook: "card", multiplyProbability: 1.2, when: { rivalryMatch: true } }],
  ),
  card(
    "yellow-card-brain",
    "黄牌后长脑子",
    "rare",
    "mentality",
    ["DEF", "MID"],
    ["card", "discipline"],
    "吃到黄牌后决策+6，后续犯规概率降低35%。",
    [{ hook: "afterYellowCard", add: { decisions: 6 }, multiplyFoulProbability: 0.65 }],
  ),
  card(
    "rebound-hunter",
    "补射猎人",
    "rare",
    "movement",
    ["ATT"],
    ["finishing", "rebound"],
    "队友射门被扑后，成为补射者的权重变为2.2倍，补射冷静+5。",
    [{ hook: "shooterSelection", shotTypes: ["rebound"], multiplyWeight: 2.2 }, { hook: "attribute", add: { composure: 5 }, when: { shotType: "rebound" } }],
  ),
  card(
    "false-nine-license",
    "伪九号执照",
    "rare",
    "tactics",
    ["MID", "ATT"],
    ["position", "creation", "tradeoff"],
    "担任前锋时创造+7、传球+5，但禁区内射手选择权重降低25%。",
    [{ hook: "phase", phase: "chanceCreation", addRating: 7, when: { activeRole: "ATT" } }, { hook: "attribute", add: { passing: 5 }, when: { activeRole: "ATT" } }, { hook: "shooterSelection", multiplyWeight: 0.75, when: { inPenaltyArea: true } }],
  ),
  card(
    "keeper-throw-cannon",
    "手抛球大炮",
    "rare",
    "goalkeeping",
    ["GK"],
    ["counter", "distribution"],
    "成功扑救后有28%概率立即发起高质量反击，反击推进+8。",
    [{ hook: "afterSave", createCounterProbability: 0.28, addProgressionRating: 8 }],
  ),
  card(
    "late-bloomer",
    "越踢越来劲",
    "rare",
    "physical",
    ["ANY"],
    ["lateGame", "stamina", "tradeoff"],
    "每经过20分钟所有能力+1，最多4层；开场时所有能力-2。",
    [{ hook: "derivedMetric", addRatingPerMinutes: 1, intervalMinutes: 20, maximum: 4 }, { hook: "derivedMetric", addRating: -2, when: { minuteLte: 19 } }],
  ),
  card(
    "scoreline-amnesia",
    "忘记比分",
    "rare",
    "quirk",
    ["ANY"],
    ["mentality", "composure", "tradeoff"],
    "落后时不承受状态惩罚，但领先时也不获得状态加成。",
    [{ hook: "scoreStateMorale", ignore: ["trailingPenalty", "leadingBonus"] }],
  ),
  card(
    "wall-specialist",
    "人墙砖块",
    "rare",
    "defending",
    ["DEF", "MID"],
    ["setPiece", "bravery"],
    "对方直接任意球的进球率降低18%，成功封堵后本人状态+5。",
    [{ hook: "opponentShot", shotType: "directFreeKick", multiplyGoalProbability: 0.82 }, { hook: "afterFreeKickBlock", addMorale: 5 }],
  ),
  card(
    "bench-oracle",
    "替补席先知",
    "rare",
    "personality",
    ["ANY"],
    ["substitution", "teamBuilding"],
    "坐在替补席时，教练第一次换人的体能判断更准确，并让登场者状态+3。",
    [{ hook: "substitution", revealFitnessAccuracy: true, addIncomingForm: 3, when: { holderOnBench: true }, chargesPerMatch: 1 }],
  ),

  card(
    "weather-forecaster",
    "天气预报员",
    "epic",
    "environment",
    ["ANY"],
    ["weather", "aura"],
    "全队受到的恶劣天气惩罚减少35%，赛前可提前看到天气。",
    [{ hook: "weather", multiplyTeamPenalty: 0.65 }, { hook: "preMatch", revealWeather: true }],
  ),
  card(
    "collective-press",
    "全队一起上",
    "epic",
    "tactics",
    ["MID"],
    ["pressing", "aura", "stamina", "tradeoff"],
    "前场逼抢时全队防守+7；每次成功抢回球权，全队额外损失1体能。",
    [{ hook: "phase", phase: "press", addTeamRating: 7, uniqueAura: true }, { hook: "afterPressRegain", addTeamFitness: -1 }],
  ),
  card(
    "immovable-object",
    "不动如山",
    "epic",
    "defending",
    ["GK", "DEF"],
    ["defending", "physical", "tradeoff"],
    "防守与力量各+10，速度-6；对手的身体对抗加成对其无效。",
    [{ hook: "attribute", add: { defending: 10, strength: 10, pace: -6 } }, { hook: "duel", ignoreOpponentPhysicalBonus: true }],
  ),
  card(
    "chaos-conductor",
    "混乱指挥家",
    "epic",
    "quirk",
    ["MID", "ATT"],
    ["variance", "creation", "tradeoff"],
    "每次进攻的创造能力随机获得-6至+12，正向结果出现概率更高。",
    [{ hook: "phase", phase: "chanceCreation", addRandomRating: { minimum: -6, maximum: 12, positiveBias: 0.62 } }],
  ),
  card(
    "emergency-gloves",
    "谁说我不能守门",
    "epic",
    "goalkeeping",
    ["DEF", "MID", "ATT"],
    ["goalkeeping", "position", "tradeoff"],
    "客串门将时发挥65%的综合能力，不再使用普通非门将惩罚；常规位置防守-2。",
    [{ hook: "position", emergencyGoalkeeperEfficiency: 0.65 }, { hook: "attribute", add: { defending: -2 }, when: { activeRoleNot: "GK" } }],
  ),
  card(
    "comeback-script",
    "逆转剧本",
    "epic",
    "mentality",
    ["MID", "ATT"],
    ["comeback", "lateGame"],
    "60分钟后每落后一球，进攻与冷静各+3，最多叠加3层。",
    [{ hook: "derivedMetric", addPerGoalBehind: { attacking: 3, composure: 3 }, maximumStacks: 3, when: { minuteGte: 60 } }],
  ),
  card(
    "tactical-chameleon",
    "战术变色龙",
    "epic",
    "tactics",
    ["ANY"],
    ["tactics", "flexibility"],
    "每次改变球队战术后的15分钟内，个人所有阶段能力+5；每场最多触发两次。",
    [{ hook: "afterTacticChange", addRating: 5, durationMinutes: 15, chargesPerMatch: 2 }],
  ),
  card(
    "golden-five-minutes",
    "黄金五分钟",
    "epic",
    "mentality",
    ["ATT"],
    ["finishing", "momentum", "tradeoff"],
    "取得进球后的5分钟内射门+12；如果期间没有再次进球，随后10分钟射门-4。",
    [{ hook: "afterGoal", addTemporary: { finishing: 12 }, durationMinutes: 5 }, { hook: "afterGoalBuffExpires", addTemporary: { finishing: -4 }, durationMinutes: 10, when: { noSecondGoal: true } }],
  ),

  card(
    "borrowed-time",
    "向终场借时间",
    "legendary",
    "mentality",
    ["ANY"],
    ["lateGame", "reroll", "tradeoff"],
    "90分钟落后时自动追加一次最后进攻，该次进攻所有阶段+10；失败后赛后体能额外-15。",
    [{ hook: "fullTime", createFinalPossession: true, addAllPhaseRating: 10, when: { scoreState: "trailing" } }, { hook: "postMatchFitness", addLoss: 15, when: { finalPossessionFailed: true } }],
  ),
  card(
    "street-football-soul",
    "街头足球之魂",
    "legendary",
    "technique",
    ["ANY"],
    ["underdog", "dribbling", "creation", "aura"],
    "当本队纸面实力更低时，全队盘带、创造与冷静按实力差获得加成，最高+9。",
    [{ hook: "underdogAura", attributes: ["dribbling", "vision", "composure"], scalePerRatingDeficit: 0.45, maximum: 9, uniqueAura: true }],
  ),
]);

export const TRAIT_CARDS = Object.freeze([...BASE_TRAIT_CARDS, ...NEW_TRAIT_BATCH]);

export const TRAIT_BY_ID = Object.freeze(
  Object.fromEntries(TRAIT_CARDS.map((trait) => [trait.id, trait])),
);

export function isTraitEligibleForPlayer(trait, player) {
  const eligible = trait.eligibleRoleGroups;
  return eligible.includes("ANY") || eligible.includes(roleGroup(player.role));
}

function rarityMultiplier(rarity, luck) {
  const boundedLuck = Math.max(-50, Math.min(100, luck));
  const factors = {
    common: 1 - boundedLuck * 0.006,
    rare: 1 + boundedLuck * 0.006,
    epic: 1 + boundedLuck * 0.014,
    legendary: 1 + boundedLuck * 0.025,
  };
  return Math.max(0.08, factors[rarity]);
}

function minimumRarityFromPity(pityOffers) {
  if (pityOffers >= TRAIT_RULES.pity.epicAfterOffers) return "epic";
  if (pityOffers >= TRAIT_RULES.pity.rareAfterOffers) return "rare";
  return "common";
}

function drawRarity(rng, luck, minimumRarity) {
  const minimumIndex = RARITY_ORDER.indexOf(minimumRarity);
  const rarities = RARITY_ORDER.slice(Math.max(0, minimumIndex));
  return rng.weighted(
    rarities,
    (rarity) => TRAIT_RULES.rarityWeights[rarity] * rarityMultiplier(rarity, luck),
  );
}

export function drawTraitOffer({
  seed = Date.now(),
  count = TRAIT_RULES.offerSize,
  player,
  roster,
  excludedIds = [],
  ownedIds = [],
  luck = 0,
  pityOffers = 0,
} = {}) {
  if (!player && (!roster || roster.length === 0)) {
    throw new Error("drawTraitOffer requires player or non-empty roster");
  }
  const rng = new Random(seed);
  const blocked = new Set([...excludedIds, ...ownedIds]);
  const compatible = TRAIT_CARDS.filter((trait) => {
    if (blocked.has(trait.id)) return false;
    if (player) return isTraitEligibleForPlayer(trait, player);
    return roster.some((candidate) => isTraitEligibleForPlayer(trait, candidate));
  });
  if (compatible.length < count) {
    throw new Error("not enough eligible trait cards to create offer");
  }

  const offer = [];
  for (let index = 0; index < count; index += 1) {
    const minimumRarity = index === 0 ? minimumRarityFromPity(pityOffers) : "common";
    let rarity = drawRarity(rng, luck, minimumRarity);
    let candidates = compatible.filter(
      (trait) => trait.rarity === rarity && !offer.some((chosen) => chosen.id === trait.id),
    );
    if (candidates.length === 0) {
      candidates = compatible.filter(
        (trait) =>
          RARITY_ORDER.indexOf(trait.rarity) >= RARITY_ORDER.indexOf(minimumRarity) &&
          !offer.some((chosen) => chosen.id === trait.id),
      );
    }
    if (candidates.length === 0) {
      candidates = compatible.filter(
        (trait) => !offer.some((chosen) => chosen.id === trait.id),
      );
    }
    const chosen = rng.weighted(candidates, (trait) => trait.dropWeight);
    offer.push(chosen);
  }
  return offer;
}

export function grantTraitCard(player, traitId) {
  const trait = TRAIT_BY_ID[traitId];
  if (!trait) throw new Error("unknown trait card: " + traitId);
  if (!isTraitEligibleForPlayer(trait, player)) {
    throw new Error(trait.name + " is not eligible for role " + player.role);
  }
  const current = player.traitCards ?? [];
  if (current.includes(traitId)) throw new Error("player already owns trait: " + traitId);
  if (current.length >= TRAIT_RULES.maxTraitsPerPlayer) {
    throw new Error("player trait slots are full");
  }
  return { ...player, traitCards: [...current, traitId] };
}

export function validateTraitCatalog() {
  const errors = [];
  const ids = new Set();
  for (const trait of TRAIT_CARDS) {
    if (ids.has(trait.id)) errors.push("duplicate id: " + trait.id);
    ids.add(trait.id);
    if (!RARITY_ORDER.includes(trait.rarity)) errors.push("invalid rarity: " + trait.id);
    if (!trait.name || !trait.summary) errors.push("missing copy: " + trait.id);
    if (trait.eligibleRoleGroups.length === 0) errors.push("missing roles: " + trait.id);
    if (trait.rules.length === 0) errors.push("missing rules: " + trait.id);
  }
  return errors;
}
