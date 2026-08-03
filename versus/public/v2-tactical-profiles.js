export const IN_POSSESSION_PLANS = Object.freeze({ balanced:"综合组织", shortPassing:"短传组织", vertical:"快速纵向推进", wideOverload:"边路展开", centralCombination:"中路渗透", longBall:"长传找前场" });
export const OUT_OF_POSSESSION_PLANS = Object.freeze({ balanced:"综合防守", highPress:"高位逼抢", midBlock:"中位封锁", lowBlock:"低位防守", zonal:"区域协防", manMark:"紧密盯人" });
export const IN_POSSESSION_DETAIL_OPTIONS = Object.freeze({
  tempo:{ patient:"耐心", cautious:"偏慢", balanced:"均衡", quick:"快速", extreme:"极快" },
  directness:{ short:"短传", shorter:"偏短", balanced:"混合", longer:"偏长", direct:"直接长传" },
  attackDirection:{ left:"左路", leftHalf:"左肋", center:"中路", rightHalf:"右肋", right:"右路", balanced:"均衡" },
  chanceCreation:{ patient:"耐心寻找", balanced:"均衡", shootOnSight:"尽快起脚" },
  longShots:{ reduce:"减少", balanced:"均衡", increase:"增加" },
  crossing:{ reduce:"减少", balanced:"均衡", increase:"增加" },
});
export const OUT_OF_POSSESSION_DETAIL_OPTIONS = Object.freeze({
  pressing:{ retreat:"退守", low:"低压", standard:"标准", high:"高压", relentless:"疯狂逼抢" },
  defensiveWidth:{ protectCenter:"保护中路", balanced:"均衡", forceWide:"限制边路" },
  compactness:{ loose:"松散", balanced:"均衡", tight:"紧凑" },
  defenseDirection:{ left:"重点防左", center:"重点防中", right:"重点防右", balanced:"均衡" },
  marking:{ zonal:"区域防守", mixed:"混合", man:"重点盯人" },
  lineStrategy:{ drop:"回收", hold:"保持", offside:"造越位" },
});
export const DEFAULT_IN_POSSESSION_DETAILS = Object.freeze({ tempo:"balanced", directness:"balanced", attackDirection:"balanced", chanceCreation:"balanced", longShots:"balanced", crossing:"balanced" });
export const DEFAULT_OUT_OF_POSSESSION_DETAILS = Object.freeze({ pressing:"standard", defensiveWidth:"balanced", compactness:"balanced", defenseDirection:"balanced", marking:"mixed", lineStrategy:"hold" });

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
  add("tempo", { patient:-18, cautious:-9, balanced:0, quick:11, extreme:22 }[inDetails.tempo] ?? 0);
  add("directness", { short:-24, shorter:-12, balanced:0, longer:13, direct:26 }[inDetails.directness] ?? 0);
  if (inDetails.chanceCreation === "patient") { add("tempo", -5); add("timeWasting", 8); }
  if (inDetails.chanceCreation === "shootOnSight") { add("tempo", 7); add("timeWasting", -8); }
  if (inDetails.crossing === "increase") { add("attackingWidth", 9); add("directness", 4); }
  if (inDetails.crossing === "reduce") add("attackingWidth", -7);
  add("pressing", { retreat:-24, low:-12, standard:0, high:14, relentless:27 }[outDetails.pressing] ?? 0);
  add("compactness", { loose:-16, balanced:0, tight:18 }[outDetails.compactness] ?? 0);
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
