export const IN_POSSESSION_PLANS = Object.freeze({ balanced:"综合组织", shortPassing:"短传组织", vertical:"快速纵向推进", wideOverload:"边路展开", centralCombination:"中路渗透", longBall:"长传找前场" });
export const OUT_OF_POSSESSION_PLANS = Object.freeze({ balanced:"综合防守", highPress:"高位逼抢", midBlock:"中位封锁", lowBlock:"低位防守", zonal:"区域协防", manMark:"紧密盯人" });

export const IN_POSSESSION_DETAIL_OPTIONS = Object.freeze({
  attackDirection:{ left:"左路", leftHalf:"左肋", center:"中路", rightHalf:"右肋", right:"右路", balanced:"均衡" },
  chanceCreation:{ patient:"耐心寻找", balanced:"均衡", shootOnSight:"尽快起脚" },
  longShots:{ reduce:"减少", balanced:"均衡", increase:"增加" },
  crossing:{ reduce:"减少", balanced:"均衡", increase:"增加" },
});

export const OUT_OF_POSSESSION_DETAIL_OPTIONS = Object.freeze({
  defensiveWidth:{ protectCenter:"保护中路", balanced:"均衡", forceWide:"封锁边路" },
  defenseDirection:{ left:"重点防左", center:"重点防中", right:"重点防右", balanced:"均衡" },
  marking:{ zonal:"区域防守", mixed:"混合", man:"贴身盯人" },
  lineStrategy:{ drop:"回收", hold:"保持", offside:"造越位" },
});

export const DEFAULT_IN_POSSESSION_DETAILS = Object.freeze({ attackDirection:"balanced", chanceCreation:"balanced", longShots:"balanced", crossing:"balanced" });
export const DEFAULT_OUT_OF_POSSESSION_DETAILS = Object.freeze({ defensiveWidth:"balanced", defenseDirection:"balanced", marking:"mixed", lineStrategy:"hold" });

export const V2_POSSESSION_STYLES = Object.freeze({ balanced:"均衡组织", possession:"短传控制", vertical:"快速纵向", wingPlay:"边路展开", longBall:"直接长传" });
export const V2_DEFENSIVE_BLOCKS = Object.freeze({ highPress:"高位防守", midBlock:"中位防守", lowBlock:"低位防守" });
export const V2_TRANSITION_STYLES = Object.freeze({ retain:"稳住球权", balanced:"选择性反击", counterAttack:"立即反击" });
export const V2_DUEL_INTENSITIES = Object.freeze({ cautious:"谨慎对抗", balanced:"正常对抗", roughPlay:"强硬对抗" });

const SPLIT_TACTICAL_ADJUSTMENTS = Object.freeze({
  possessionStyle:Object.freeze({
    balanced:{},
    possession:{ tempo:-8, directness:-22, attackingWidth:-4, compactness:8 },
    vertical:{ tempo:9, directness:15 },
    wingPlay:{ tempo:5, directness:5, attackingWidth:30, compactness:-8 },
    longBall:{ tempo:7, directness:30, attackingWidth:6 },
  }),
  defensiveBlock:Object.freeze({
    highPress:{ defensiveLine:22, pressing:32, compactness:12 },
    midBlock:{},
    lowBlock:{ defensiveLine:-20, pressing:-16, compactness:18 },
  }),
  transitionStyle:Object.freeze({
    retain:{ tempo:-3, directness:-5, counterAttack:-18 },
    balanced:{},
    counterAttack:{ tempo:8, directness:14, counterAttack:20 },
  }),
  duelIntensity:Object.freeze({
    cautious:{ tempo:-2, pressing:-8 },
    balanced:{},
    roughPlay:{ tempo:4, directness:8, pressing:16, compactness:6 },
  }),
});

const LEGACY_STYLE_SPLITS = Object.freeze({
  possession:{ possessionStyle:"possession", defensiveBlock:"midBlock", transitionStyle:"retain", duelIntensity:"balanced" },
  longBall:{ possessionStyle:"longBall", defensiveBlock:"midBlock", transitionStyle:"balanced", duelIntensity:"balanced" },
  wingPlay:{ possessionStyle:"wingPlay", defensiveBlock:"midBlock", transitionStyle:"balanced", duelIntensity:"balanced" },
  counterAttack:{ possessionStyle:"balanced", defensiveBlock:"midBlock", transitionStyle:"counterAttack", duelIntensity:"balanced" },
  highPress:{ possessionStyle:"balanced", defensiveBlock:"highPress", transitionStyle:"balanced", duelIntensity:"balanced" },
  lowBlock:{ possessionStyle:"balanced", defensiveBlock:"lowBlock", transitionStyle:"balanced", duelIntensity:"balanced" },
  roughPlay:{ possessionStyle:"balanced", defensiveBlock:"midBlock", transitionStyle:"balanced", duelIntensity:"roughPlay" },
});

export function resolveV2SplitTacticalPlan(plan = {}) {
  const legacy = LEGACY_STYLE_SPLITS[plan.style] ?? LEGACY_STYLE_SPLITS.possession;
  return {
    possessionStyle:Object.hasOwn(V2_POSSESSION_STYLES, plan.possessionStyle) ? plan.possessionStyle : legacy.possessionStyle,
    defensiveBlock:Object.hasOwn(V2_DEFENSIVE_BLOCKS, plan.defensiveBlock) ? plan.defensiveBlock : legacy.defensiveBlock,
    transitionStyle:Object.hasOwn(V2_TRANSITION_STYLES, plan.transitionStyle) ? plan.transitionStyle : legacy.transitionStyle,
    duelIntensity:Object.hasOwn(V2_DUEL_INTENSITIES, plan.duelIntensity) ? plan.duelIntensity : legacy.duelIntensity,
  };
}

export function v2SplitTacticalAdjustments(plan = {}) {
  const split = resolveV2SplitTacticalPlan(plan);
  return Object.entries(split).reduce((result, [group, value]) => {
    Object.entries(SPLIT_TACTICAL_ADJUSTMENTS[group]?.[value] ?? {}).forEach(([key, adjustment]) => {
      result[key] = Number(result[key] ?? 0) + Number(adjustment);
    });
    return result;
  }, {});
}

export function hasV2SplitTacticalPlan(plan = {}) {
  return ["possessionStyle", "defensiveBlock", "transitionStyle", "duelIntensity"].some((key) => Object.hasOwn(plan, key));
}

export const IN_POSSESSION_ADJUSTMENTS = Object.freeze({
  balanced:{},
  shortPassing:{ tempo:-6, directness:-18, compactness:8 },
  vertical:{ tempo:10, directness:18, counterAttack:8 },
  wideOverload:{ attackingWidth:22, directness:4 },
  centralCombination:{ attackingWidth:-18, directness:-8, compactness:10 },
  longBall:{ tempo:5, directness:28 },
});

export const OUT_OF_POSSESSION_ADJUSTMENTS = Object.freeze({
  balanced:{},
  highPress:{ pressing:22, defensiveLine:14, compactness:4 },
  midBlock:{ pressing:-4, defensiveLine:-4, compactness:10 },
  lowBlock:{ pressing:-20, defensiveLine:-22, compactness:18 },
  zonal:{ pressing:-6, compactness:16 },
  manMark:{ pressing:12, compactness:-8 },
});

export function v2TacticalProfileAdjustments(inPossession = "balanced", outOfPossession = "balanced") {
  const result = { ...(IN_POSSESSION_ADJUSTMENTS[inPossession] ?? IN_POSSESSION_ADJUSTMENTS.balanced) };
  Object.entries(OUT_OF_POSSESSION_ADJUSTMENTS[outOfPossession] ?? OUT_OF_POSSESSION_ADJUSTMENTS.balanced).forEach(([key, value]) => {
    result[key] = Number(result[key] ?? 0) + Number(value);
  });
  return result;
}

export function v2TacticalDetailAdjustments(inDetails = DEFAULT_IN_POSSESSION_DETAILS, outDetails = DEFAULT_OUT_OF_POSSESSION_DETAILS) {
  const result = {};
  const add = (key, value) => { result[key] = Number(result[key] ?? 0) + Number(value); };
  if (inDetails.chanceCreation === "patient") { add("tempo", -5); add("timeWasting", 8); }
  if (inDetails.chanceCreation === "shootOnSight") { add("tempo", 7); add("timeWasting", -8); }
  if (inDetails.crossing === "increase") { add("attackingWidth", 9); add("directness", 4); }
  if (inDetails.crossing === "reduce") add("attackingWidth", -7);
  if (outDetails.defensiveWidth === "protectCenter") add("compactness", 11);
  if (outDetails.defensiveWidth === "forceWide") add("compactness", -9);
  if (outDetails.marking === "man") { add("pressing", 8); add("compactness", -5); }
  if (outDetails.marking === "zonal") add("compactness", 7);
  add("defensiveLine", { drop:-18, hold:0, offside:18 }[outDetails.lineStrategy] ?? 0);
  return result;
}

export function applyV2TacticalProfiles(dimensions, inPossession = "balanced", outOfPossession = "balanced", inDetails = DEFAULT_IN_POSSESSION_DETAILS, outDetails = DEFAULT_OUT_OF_POSSESSION_DETAILS) {
  const result = { ...dimensions };
  const adjustments = v2TacticalProfileAdjustments(inPossession, outOfPossession);
  Object.entries(v2TacticalDetailAdjustments(inDetails, outDetails)).forEach(([key, value]) => { adjustments[key] = Number(adjustments[key] ?? 0) + Number(value); });
  Object.entries(adjustments).forEach(([key, value]) => {
    result[key] = Math.max(0, Math.min(100, Number(result[key] ?? 50) + Number(value)));
  });
  return result;
}
