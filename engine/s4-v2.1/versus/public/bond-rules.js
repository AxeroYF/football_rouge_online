export const S4_BOND_POOL_MINIMUM = 10;
export const S4_BOND_LINEUP_MINIMUM = 5;
export const S4_BOND_WILDCARD_TRAIT_ID = "lone-finisher";
export const S4_SHORT_PLAYER_MAX_HEIGHT = 175;
export const S4_TALL_PLAYER_MIN_HEIGHT = 185;

export const S4_BOND_BONUS_BY_COUNT = Object.freeze({
  5:0.02,
  6:0.025,
  7:0.03,
  8:0.035,
  9:0.04,
  10:0.05,
  11:0.06,
});

export const S4_REGIONAL_BONDS = Object.freeze([
  Object.freeze({
    id:"nordic",
    name:"北欧",
    memberNationalities:Object.freeze(["丹麦", "芬兰", "冰岛", "挪威", "瑞典", "法罗群岛"]),
  }),
  Object.freeze({
    id:"central-eastern-europe",
    name:"中东欧",
    memberNationalities:Object.freeze(["匈牙利", "捷克", "捷克共和国", "乌克兰", "波兰", "斯洛伐克", "罗马尼亚", "保加利亚", "苏联"]),
  }),
  Object.freeze({
    id:"africa",
    name:"非洲",
    memberNationalities:Object.freeze([
      "阿尔及利亚", "安哥拉", "贝宁", "博茨瓦纳", "布基纳法索", "布隆迪", "佛得角", "喀麦隆", "中非共和国", "乍得",
      "科摩罗", "刚果共和国", "刚果民主共和国", "吉布提", "埃及", "赤道几内亚", "厄立特里亚", "斯威士兰", "埃斯瓦蒂尼", "埃塞俄比亚",
      "加蓬", "冈比亚", "加纳", "几内亚", "几内亚比绍", "科特迪瓦", "肯尼亚", "莱索托", "利比里亚", "利比亚",
      "马达加斯加", "马拉维", "马里", "毛里塔尼亚", "毛里求斯", "摩洛哥", "莫桑比克", "纳米比亚", "尼日尔", "尼日利亚",
      "卢旺达", "圣多美和普林西比", "塞内加尔", "塞舌尔", "塞拉利昂", "索马里", "南非", "南苏丹", "苏丹", "坦桑尼亚",
      "多哥", "突尼斯", "乌干达", "赞比亚", "津巴布韦",
    ]),
  }),
  Object.freeze({
    id:"north-central-america",
    name:"中北美洲",
    memberNationalities:Object.freeze([
      "美国", "加拿大", "墨西哥", "伯利兹", "哥斯达黎加", "萨尔瓦多", "危地马拉", "洪都拉斯", "尼加拉瓜", "巴拿马",
      "安提瓜和巴布达", "巴哈马", "巴巴多斯", "百慕大", "开曼群岛", "古巴", "库拉索", "多米尼克", "多米尼加共和国", "格林纳达",
      "海地", "牙买加", "波多黎各", "圣基茨和尼维斯", "圣卢西亚", "圣文森特和格林纳丁斯", "苏里南", "特立尼达和多巴哥", "圭亚那",
    ]),
  }),
  Object.freeze({
    id:"asia-oceania",
    name:"亚洲大洋洲",
    memberNationalities:Object.freeze([
      "中国", "日本", "韩国", "朝鲜", "蒙古", "中国香港", "香港", "中国澳门", "澳门", "中国台北", "中华台北",
      "文莱", "柬埔寨", "印度尼西亚", "老挝", "马来西亚", "缅甸", "菲律宾", "新加坡", "泰国", "东帝汶", "越南",
      "阿富汗", "孟加拉国", "不丹", "印度", "马尔代夫", "尼泊尔", "巴基斯坦", "斯里兰卡",
      "哈萨克斯坦", "吉尔吉斯斯坦", "塔吉克斯坦", "土库曼斯坦", "乌兹别克斯坦",
      "巴林", "伊朗", "伊拉克", "以色列", "约旦", "科威特", "黎巴嫩", "阿曼", "巴勒斯坦", "卡塔尔", "沙特阿拉伯", "叙利亚", "阿联酋", "也门",
      "亚美尼亚", "阿塞拜疆", "格鲁吉亚", "土耳其", "塞浦路斯",
      "澳大利亚", "新西兰", "巴布亚新几内亚", "斐济", "所罗门群岛", "瓦努阿图", "新喀里多尼亚", "塔希提", "萨摩亚", "美属萨摩亚", "汤加", "库克群岛",
    ]),
  }),
]);

const bondTypes = Object.freeze([
  Object.freeze({ type:"nationality", field:"nationality", label:"国家队" }),
  Object.freeze({ type:"club", field:"club", label:"俱乐部" }),
]);

const cleanName = (value) => String(value ?? "").trim();

function playerTraitIds(player) {
  const direct = Array.isArray(player?.traits) ? player.traits : [];
  const activeCard = Array.isArray(player?.cards)
    ? player.cards.find((card) => card.id === player.activeCardId) ?? player.cards[0]
    : null;
  const cardTraits = Array.isArray(activeCard?.traits) ? activeCard.traits : [];
  return new Set([...direct, ...cardTraits].map((trait) => cleanName(typeof trait === "string" ? trait : trait?.id)).filter(Boolean));
}

function effectiveHeight(player) {
  const traits = playerTraitIds(player);
  return Number(player?.heightCm ?? 0)
    + (traits.has("aerial-beacon") ? 20 : 0)
    - (traits.has("custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20") ? 10 : 0);
}

function assignedGroup(player, roles = {}) {
  const role = roles[player.id] ?? player.assignedRole ?? player.role;
  if (role === "GK") return "GK";
  if (["CB", "LB", "RB", "LWB", "RWB"].includes(role)) return "DEF";
  if (["ST", "LW", "RW"].includes(role)) return "ATT";
  return "MID";
}

function progressiveStructureBonus(count) {
  return count >= 5 ? Math.min(.05, .02 + (count - 5) * .005) : 0;
}

function structureBond(id, name, members, bonus, count = members.length, targetRoleGroup = null) {
  return {
    id:`structure:${id}`,
    type:"structure",
    label:"阵容结构",
    name,
    count,
    bonus,
    memberIds:members.map((player) => player.id),
    wildcardIds:[],
    targetRoleGroup,
  };
}

function evaluateStructureBonds(lineup, roles) {
  if (lineup.length !== 11) return [];
  const bonds = [];
  if (lineup.every((player) => Number(player.upgradeLevel ?? 0) === 0)) {
    bonds.push(structureBond("united", "团结起来", lineup, .03, 11));
  }
  const shortPlayers = lineup.filter((player) => effectiveHeight(player) < S4_SHORT_PLAYER_MAX_HEIGHT);
  if (shortPlayers.length >= 5) bonds.push(structureBond("small-quick-skillful", "小快灵", shortPlayers, progressiveStructureBonus(shortPlayers.length)));
  const tallPlayers = lineup.filter((player) => effectiveHeight(player) > S4_TALL_PLAYER_MIN_HEIGHT);
  if (tallPlayers.length >= 5) bonds.push(structureBond("aerial-bombardment", "高空轰炸", tallPlayers, progressiveStructureBonus(tallPlayers.length)));
  const defenders = lineup.filter((player) => assignedGroup(player, roles) === "DEF");
  if (defenders.length >= 6) bonds.push(structureBond("steel-defense", "钢铁防线", defenders, .03, defenders.length, "DEF"));
  const attackers = lineup.filter((player) => assignedGroup(player, roles) === "ATT");
  if (attackers.length >= 5) bonds.push(structureBond("blow-them-up", "跟他们爆了", attackers, .03, attackers.length, "ATT"));
  const midfielders = lineup.filter((player) => assignedGroup(player, roles) === "MID");
  if (midfielders.length >= 6) bonds.push(structureBond("mahjong-together", "一起打麻将", midfielders, .03, midfielders.length, "MID"));
  return bonds;
}

export function createS4BondCatalog(players, minimum = S4_BOND_POOL_MINIMUM) {
  const eligiblePlayers = players.filter((player) => !player?.xPlayer);
  return bondTypes.flatMap(({ type, field, label }) => {
    const counts = new Map();
    eligiblePlayers.forEach((player) => {
      const name = cleanName(player?.[field]);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    const exactBonds = [...counts.entries()]
      .filter(([, poolCount]) => poolCount >= minimum)
      .map(([name, poolCount]) => Object.freeze({ id:`${type}:${name}`, type, field, label, name, poolCount }));
    if (type !== "nationality") return exactBonds.sort((left, right) => right.poolCount - left.poolCount || left.name.localeCompare(right.name, "zh-CN"));
    const regionalBonds = S4_REGIONAL_BONDS.map((definition) => {
      const poolCount = eligiblePlayers.filter((player) => definition.memberNationalities.includes(cleanName(player?.nationality))).length;
      return Object.freeze({
        id:`nationality-region:${definition.id}`,
        type:"nationality",
        field:"nationality",
        label:"地域",
        name:definition.name,
        poolCount,
        regional:true,
        memberNationalities:definition.memberNationalities,
      });
    }).filter((entry) => entry.poolCount >= minimum);
    return [...exactBonds, ...regionalBonds]
      .sort((left, right) => right.poolCount - left.poolCount || Number(left.regional) - Number(right.regional) || left.name.localeCompare(right.name, "zh-CN"));
  });
}

export function s4BondBonus(countValue) {
  const count = Math.max(0, Math.min(11, Math.floor(Number(countValue) || 0)));
  return S4_BOND_BONUS_BY_COUNT[count] ?? 0;
}

export function evaluateS4LineupBonds(players, catalog, options = {}) {
  const lineup = (players ?? []).slice(0, 11);
  const entries = Array.isArray(catalog) ? catalog : [];
  const identityBonds = bondTypes.flatMap(({ type, field, label }) => {
    const available = entries.filter((entry) => entry.type === type);
    if (!available.length) return [];
    const wildcards = lineup.filter((player) => playerTraitIds(player).has(S4_BOND_WILDCARD_TRAIT_ID));
    const regulars = lineup.filter((player) => !playerTraitIds(player).has(S4_BOND_WILDCARD_TRAIT_ID));
    const ranked = available.map((entry) => {
      const members = regulars.filter((player) => {
        const identity = cleanName(player?.[field]);
        return entry.regional ? entry.memberNationalities?.includes(identity) : identity === entry.name;
      });
      const count = Math.min(11, members.length + wildcards.length);
      return {
        id:entry.id,
        type,
        label:entry.label ?? label,
        name:entry.name,
        poolCount:entry.poolCount,
        regional:Boolean(entry.regional),
        count,
        bonus:s4BondBonus(count),
        memberIds:[...members, ...wildcards].slice(0, count).map((player) => player.id),
        wildcardIds:wildcards.map((player) => player.id),
      };
    }).sort((left, right) => right.count - left.count || Number(left.regional) - Number(right.regional) || right.poolCount - left.poolCount || left.name.localeCompare(right.name, "zh-CN"));
    const strongest = ranked[0];
    return strongest?.count >= S4_BOND_LINEUP_MINIMUM ? [strongest] : [];
  });
  return [...identityBonds, ...evaluateStructureBonds(lineup, options.roles ?? {})];
}

export function applyS4BondBonuses(players, bonds, options = {}) {
  const maximumAttribute = options.maximumAttribute === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(1, Number(options.maximumAttribute ?? 99));
  const appliedBonds = [...(bonds ?? [])]
    .sort((left, right) => Number(right.bonus ?? 0) - Number(left.bonus ?? 0))
    .slice(0, 2);
  const bonusByPlayer = new Map();
  const playerById = new Map((players ?? []).map((player) => [player.id, player]));
  appliedBonds.forEach((bond) => bond.memberIds.forEach((id) => {
    const player = playerById.get(id);
    if (bond.targetRoleGroup && assignedGroup(player) !== bond.targetRoleGroup) return;
    bonusByPlayer.set(id, (bonusByPlayer.get(id) ?? 0) + Number(bond.bonus ?? 0));
  }));
  return (players ?? []).map((player) => {
    const bonus = bonusByPlayer.get(player.id) ?? 0;
    if (!bonus) return player;
    return {
      ...player,
      attributes:Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key, value]) => [
        key,
        Number.isFinite(value) ? Math.min(maximumAttribute, Number((value * (1 + bonus)).toFixed(2))) : value,
      ])),
      ydlBondBonus:Number(bonus.toFixed(4)),
      ydlBondIds:appliedBonds.filter((bond) => bond.memberIds.includes(player.id) && (!bond.targetRoleGroup || assignedGroup(player) === bond.targetRoleGroup)).map((bond) => bond.id),
    };
  });
}
