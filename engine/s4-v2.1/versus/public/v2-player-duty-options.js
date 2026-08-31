const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export const V2_PLAYER_DUTY_OPTIONS = deepFreeze({
  advancedForward:{ label:"突前前锋", roles:["ST"], description:"持续攻击防线身后，获得更多射门机会，但越位风险更高。" },
  targetForward:{ label:"支点中锋", roles:["ST"], description:"接应直接传球、护球并为队友做球，减少单纯冲击身后的次数。" },
  deepLyingForward:{ label:"回撤前锋", roles:["ST"], description:"主动回撤参与串联和创造机会，降低禁区内的终结占比。" },
  bylineWinger:{ label:"下底边锋", roles:["LW", "RW"], description:"保持边路宽度并积极下底传中，为中路队友输送机会。" },
  insideForward:{ label:"内切边锋", roles:["LW", "RW"], description:"从边路向禁区内切，增加个人突破和射门参与。" },
  advancedPlaymaker:{ label:"前场组织核心", roles:["AM"], description:"在前场接球、组织和送出关键传球，减少直接射门。" },
  shadowStriker:{ label:"影子前锋", roles:["AM"], description:"频繁前插进入禁区，像第二前锋一样寻找射门机会。" },
  anchor:{ label:"防守锚点", roles:["DM"], description:"留守后腰区域保护中卫，优先维持球队的防守平衡。" },
  ballWinningMidfielder:{ label:"抢球后腰", roles:["DM"], description:"扩大活动范围主动压迫和抢断，消耗更多体能。" },
  deepLyingPlaymaker:{ label:"拖后组织核心", roles:["DM"], description:"从后腰位置接球组织推进，以传球控制比赛节奏。" },
  wideMidfielder:{ label:"传统边前卫", roles:["LM", "RM"], description:"兼顾边路接应、推进和传中，保持攻守平衡。" },
  invertedWideMidfielder:{ label:"内收边前卫", roles:["LM", "RM"], description:"向中路靠拢参与控球和串联，为边后卫留出外线空间。" },
  defensiveWideMidfielder:{ label:"防守边前卫", roles:["LM", "RM"], description:"优先回防和保护边路，减少深入前场的次数。" },
  holdingFullback:{ label:"留守边卫", roles:["LB", "RB", "LWB", "RWB"], description:"谨慎前插并保持防线人数，优先防守本侧区域。" },
  overlappingFullback:{ label:"套边边卫", roles:["LB", "RB", "LWB", "RWB"], description:"沿边线积极套上参与进攻和传中，体能消耗及身后风险更高。" },
  invertedFullback:{ label:"内收边卫", roles:["LB", "RB", "LWB", "RWB"], description:"持球时向中路移动，帮助中场控球并保护转换防守。" },
  ballPlayingDefender:{ label:"出球中卫", roles:["CB"], description:"主动从后场传球组织推进，对出球能力要求更高。" },
  stopper:{ label:"上抢中卫", roles:["CB"], description:"提前离开防线压迫持球人，争取尽早破坏进攻。" },
  coverDefender:{ label:"拖后中卫", roles:["CB"], description:"保持更深位置保护身后空间，负责补位和最后一道防守。" },
});

export const V2_PLAYER_ATTRIBUTE_KEYS = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

export const V2_PLAYER_DUTY_ATTRIBUTE_WEIGHTS = deepFreeze({
  advancedForward:{ finishing:.24, offBall:.23, pace:.14, acceleration:.14, composure:.1, firstTouch:.06, decisions:.09 },
  targetForward:{ strength:.19, heading:.17, jumping:.13, firstTouch:.14, passing:.1, decisions:.08, composure:.09, offBall:.1 },
  deepLyingForward:{ passing:.2, vision:.18, firstTouch:.16, decisions:.16, composure:.12, dribbling:.09, offBall:.09 },
  bylineWinger:{ crossing:.24, pace:.17, acceleration:.15, dribbling:.16, offBall:.1, stamina:.1, agility:.08 },
  insideForward:{ finishing:.2, dribbling:.19, offBall:.18, acceleration:.14, pace:.1, composure:.11, agility:.08 },
  advancedPlaymaker:{ passing:.22, vision:.22, decisions:.18, firstTouch:.15, composure:.13, dribbling:.1 },
  shadowStriker:{ finishing:.22, offBall:.23, acceleration:.15, pace:.1, composure:.12, firstTouch:.08, decisions:.1 },
  anchor:{ positioning:.22, marking:.17, tackling:.18, decisions:.14, strength:.1, discipline:.1, composure:.09 },
  ballWinningMidfielder:{ tackling:.22, aggression:.16, workRate:.16, stamina:.14, positioning:.11, marking:.09, strength:.12 },
  deepLyingPlaymaker:{ passing:.23, vision:.21, decisions:.18, firstTouch:.15, composure:.13, positioning:.1 },
  wideMidfielder:{ crossing:.2, passing:.14, stamina:.14, workRate:.13, pace:.12, firstTouch:.1, offBall:.1, decisions:.07 },
  invertedWideMidfielder:{ passing:.19, vision:.16, firstTouch:.16, dribbling:.15, decisions:.14, composure:.11, offBall:.09 },
  defensiveWideMidfielder:{ marking:.18, tackling:.18, positioning:.16, workRate:.15, stamina:.13, pace:.08, discipline:.12 },
  holdingFullback:{ positioning:.2, marking:.17, tackling:.18, decisions:.14, discipline:.1, strength:.1, stamina:.11 },
  overlappingFullback:{ stamina:.17, pace:.14, acceleration:.13, crossing:.2, workRate:.14, dribbling:.1, offBall:.12 },
  invertedFullback:{ passing:.18, firstTouch:.14, decisions:.16, positioning:.16, vision:.12, tackling:.13, composure:.11 },
  ballPlayingDefender:{ passing:.2, vision:.13, composure:.16, firstTouch:.13, decisions:.15, positioning:.12, tackling:.11 },
  stopper:{ tackling:.2, aggression:.16, strength:.15, marking:.15, positioning:.13, pace:.1, workRate:.11 },
  coverDefender:{ positioning:.22, pace:.14, acceleration:.11, decisions:.16, marking:.14, tackling:.12, composure:.11 },
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function v2PlayerDutySuitability(player, assignedRole, dutyId, positionFit = 1) {
  const definition = V2_PLAYER_DUTY_OPTIONS[dutyId];
  if (!definition?.roles.includes(String(assignedRole ?? "").toUpperCase())) return null;
  const attributes = player?.effectiveAttributes ?? player?.attributes ?? {};
  const fallback = Number(player?.effectiveOverall ?? player?.overall ?? 60);
  const allAttributeAverage = V2_PLAYER_ATTRIBUTE_KEYS.reduce((sum, key) => sum + Number(attributes[key] ?? fallback), 0) / V2_PLAYER_ATTRIBUTE_KEYS.length;
  const weights = V2_PLAYER_DUTY_ATTRIBUTE_WEIGHTS[dutyId] ?? {};
  const weightTotal = Object.values(weights).reduce((sum, weight) => sum + Number(weight), 0) || 1;
  const specialistScore = Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(attributes[key] ?? fallback) * Number(weight), 0) / weightTotal;
  const fitMultiplier = .72 + clamp(Number(positionFit) || .66, .35, 1.04) * .28;
  return Math.round(clamp((allAttributeAverage * .16 + specialistScore * .84) * fitMultiplier, 1, 99));
}

export function v2BestPlayerDuty(player, assignedRole, positionFit = 1) {
  return v2PlayerDutyOptionsForRole(assignedRole, { includeDefault:false })
    .map((option) => ({ ...option, score:v2PlayerDutySuitability(player, assignedRole, option.id, positionFit) }))
    .filter((option) => Number.isFinite(option.score))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))[0] ?? null;
}

export function v2PlayerDutyOptionsForRole(role, { includeDefault = true } = {}) {
  const normalizedRole = String(role ?? "").toUpperCase();
  const options = Object.entries(V2_PLAYER_DUTY_OPTIONS)
    .filter(([, definition]) => definition.roles.includes(normalizedRole))
    .map(([id, definition]) => ({ id, ...definition }));
  return includeDefault
    ? [{ id:"", label:"默认职责", roles:[normalizedRole], description:"按照当前位置执行标准攻守行为，不附加专项倾向。" }, ...options]
    : options;
}
