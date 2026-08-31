function versusCard(id, name, rarity, category, roles, tags, summary, rules) {
  return Object.freeze({
    id: `v11-${id}`,
    name,
    rarity,
    category,
    eligibleRoleGroups: Object.freeze(roles),
    tags: Object.freeze([...tags, "versus11-new"]),
    polarity: tags.includes("tradeoff") ? "mixed" : "positive",
    summary,
    rules: Object.freeze(rules.map((rule) => Object.freeze(rule))),
    dropWeight: 1,
    maxLevel: 1,
    mode: "versus11",
    source: "versus11-new",
    developerLabel: "11人制新增",
    introducedIn: "versus11-batch-1",
  });
}

export const VERSUS_NEW_TRAIT_BATCH = Object.freeze([
  versusCard("high-line-keeper", "高位门卫", "rare", "goalkeeping", ["GK"], ["distribution", "pace", "tradeoff"], "传球+5、速度+3，但守门-2。", [
    { hook: "attribute", add: { passing: 5, pace: 3, goalkeeping: -2 } },
  ]),
  versusCard("aerial-collector", "制空区领主", "epic", "goalkeeping", ["GK"], ["aerial", "shotStopping", "tradeoff"], "弹跳+7、守门+4，但反应-3。", [
    { hook: "attribute", add: { jumping: 7, goalkeeping: 4, reflexes: -3 } },
  ]),
  versusCard("late-save-focus", "末段专注", "rare", "goalkeeping", ["GK"], ["lateGame", "composure"], "70分钟后反应与冷静各+6。", [
    { hook: "attribute", add: { reflexes: 6, composure: 6 }, when: { minuteGte: 70 } },
  ]),
  versusCard("snow-gloves", "雪线手套", "common", "environment", ["GK"], ["weather", "snow"], "雪天守门与反应各+5。", [
    { hook: "attribute", add: { goalkeeping: 5, reflexes: 5 }, when: { weather: "snow" } },
  ]),
  versusCard("keeper-quarterback", "四分卫门将", "rare", "goalkeeping", ["GK"], ["distribution", "tradeoff"], "传球与视野各+6，但力量-3。", [
    { hook: "attribute", add: { passing: 6, vision: 6, strength: -3 } },
  ]),
  versusCard("recovery-defender", "回追专家", "common", "defending", ["DEF"], ["pace", "positioning", "tradeoff"], "速度+5、站位+3，但力量-3。", [
    { hook: "attribute", add: { pace: 5, positioning: 3, strength: -3 } },
  ]),
  versusCard("box-sentinel", "禁区哨兵", "rare", "defending", ["DEF"], ["marking", "positioning", "tradeoff"], "站位+6、盯人+5，但传球-3。", [
    { hook: "attribute", add: { positioning: 6, marking: 5, passing: -3 } },
  ]),
  versusCard("overlap-engine", "套边发动机", "common", "tactics", ["DEF"], ["wide", "crossing", "stamina", "tradeoff"], "出任边路时传中+6、耐力+4，但站位-2。", [
    { hook: "attribute", add: { crossing: 6, stamina: 4, positioning: -2 }, when: { roleIsWide: true } },
  ]),
  versusCard("last-ditch-tackler", "最后一铲", "epic", "defending", ["DEF"], ["tackling", "aggression", "tradeoff"], "抢断+8、侵略性+6，但纪律-7。", [
    { hook: "attribute", add: { tackling: 8, aggression: 6, discipline: -7 } },
  ]),
  versusCard("aerial-clearance", "高空清障", "common", "defending", ["DEF"], ["aerial", "tradeoff"], "头球与弹跳各+6，但灵活-3。", [
    { hook: "attribute", add: { heading: 6, jumping: 6, agility: -3 } },
  ]),
  versusCard("build-up-defender", "出球中卫", "rare", "defending", ["DEF"], ["passing", "vision", "tradeoff"], "传球+6、视野+4，但侵略性-3。", [
    { hook: "attribute", add: { passing: 6, vision: 4, aggression: -3 } },
  ]),
  versusCard("rain-slide", "雨战滑铲", "common", "environment", ["DEF"], ["weather", "rain", "tackling", "tradeoff"], "降雨达到35时抢断+7、纪律-2。", [
    { hook: "attribute", add: { tackling: 7, discipline: -2 }, when: { precipitationGte: 35 } },
  ]),
  versusCard("press-resistant", "抗压接球", "rare", "technique", ["MID"], ["firstTouch", "composure", "tradeoff"], "停球+6、冷静+5，但速度-2。", [
    { hook: "attribute", add: { firstTouch: 6, composure: 5, pace: -2 } },
  ]),
  versusCard("deep-playmaker", "拖后组织核", "epic", "passing", ["MID"], ["passing", "vision", "tradeoff"], "传球与视野各+7，但抢断-4。", [
    { hook: "attribute", add: { passing: 7, vision: 7, tackling: -4 } },
  ]),
  versusCard("ball-winning-eight", "扫荡八号位", "rare", "defending", ["MID"], ["tackling", "workRate", "tradeoff"], "抢断+6、投入+5，但射门-4。", [
    { hook: "attribute", add: { tackling: 6, workRate: 5, finishing: -4 } },
  ]),
  versusCard("half-space-runner", "肋部游击手", "common", "tactics", ["MID"], ["offBall", "dribbling", "tradeoff"], "无球+5、盘带+4，但盯人-3。", [
    { hook: "attribute", add: { offBall: 5, dribbling: 4, marking: -3 } },
  ]),
  versusCard("tempo-controller", "节奏控制器", "rare", "passing", ["MID"], ["passing", "decisions", "tradeoff"], "传球与决策各+5，但速度-3。", [
    { hook: "attribute", add: { passing: 5, decisions: 5, pace: -3 } },
  ]),
  versusCard("late-box-runner", "后插上时钟", "common", "tactics", ["MID"], ["lateGame", "offBall", "finishing"], "60分钟后无球+6、射门+4。", [
    { hook: "attribute", add: { offBall: 6, finishing: 4 }, when: { minuteGte: 60 } },
  ]),
  versusCard("storm-outlet", "风暴出球点", "common", "environment", ["MID"], ["weather", "storm", "passing"], "雷暴天气下停球与传球各+6。", [
    { hook: "attribute", add: { firstTouch: 6, passing: 6 }, when: { weather: "storm" } },
  ]),
  versusCard("counter-launcher", "反击发射台", "rare", "passing", ["MID"], ["vision", "pace", "tradeoff"], "视野+6、速度+4，但抢断-3。", [
    { hook: "attribute", add: { vision: 6, pace: 4, tackling: -3 } },
  ]),
  versusCard("channel-runner", "纵深拉边手", "common", "tactics", ["ATT"], ["wide", "pace", "offBall", "tradeoff"], "出任边路时速度+6、无球+4，但头球-3。", [
    { hook: "attribute", add: { pace: 6, offBall: 4, heading: -3 }, when: { roleIsWide: true } },
  ]),
  versusCard("target-nine", "支点九号", "rare", "physical", ["ATT"], ["aerial", "strength", "tradeoff"], "头球+7、力量+6，但盘带-4。", [
    { hook: "attribute", add: { heading: 7, strength: 6, dribbling: -4 } },
  ]),
  versusCard("pressing-forward", "压迫前锋", "common", "tactics", ["ATT"], ["workRate", "stamina", "tradeoff"], "投入+6、耐力+5，但冷静-3。", [
    { hook: "attribute", add: { workRate: 6, stamina: 5, composure: -3 } },
  ]),
  versusCard("penalty-box-poacher", "六码区猎手", "epic", "finishing", ["ATT"], ["finishing", "offBall", "tradeoff"], "射门+8、无球+6，但传球-5。", [
    { hook: "attribute", add: { finishing: 8, offBall: 6, passing: -5 } },
  ]),
  versusCard("inverted-winger", "逆足内切手", "rare", "technique", ["ATT"], ["wide", "dribbling", "finishing", "tradeoff"], "出任边路时盘带+6、射门+4，但传中-4。", [
    { hook: "attribute", add: { dribbling: 6, finishing: 4, crossing: -4 }, when: { roleIsWide: true } },
  ]),
  versusCard("late-clutch-finisher", "末段终结者", "rare", "finishing", ["ATT"], ["lateGame", "finishing", "composure"], "75分钟后射门与冷静各+6。", [
    { hook: "attribute", add: { finishing: 6, composure: 6 }, when: { minuteGte: 75 } },
  ]),
  versusCard("wet-pitch-sprinter", "湿地冲刺手", "common", "environment", ["ATT"], ["weather", "rain", "pace", "tradeoff"], "降雨达到35时速度+6，但停球-2。", [
    { hook: "attribute", add: { pace: 6, firstTouch: -2 }, when: { precipitationGte: 35 } },
  ]),
  versusCard("second-wind", "第二口气", "rare", "physical", ["ANY"], ["lateGame", "stamina", "tradeoff"], "60分钟前耐力-2；60分钟后耐力+6、投入+4。", [
    { hook: "attribute", add: { stamina: -2 }, when: { minuteLte: 59 } },
    { hook: "attribute", add: { stamina: 6, workRate: 4 }, when: { minuteGte: 60 } },
  ]),
  versusCard("secondary-specialist", "副职专家", "epic", "tactics", ["DEF", "MID", "ATT"], ["position", "flexibility"], "出任陌生位置时，位置适配最低为82%。", [
    { hook: "position", minimumFit: 0.82 },
  ]),
  versusCard("comeback-calm", "逆风冷静", "rare", "mentality", ["ANY"], ["comeback", "decisions", "composure"], "球队落后时决策与冷静各+6。", [
    { hook: "attribute", add: { decisions: 6, composure: 6 }, when: { scoreState: "trailing" } },
  ]),
]);

