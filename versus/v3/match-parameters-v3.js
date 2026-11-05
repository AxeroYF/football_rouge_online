import {resolveV2MatchParameters} from "../v2/match-parameters-v2.js";
import {V3_ENGINE_VERSION,V3_RULES} from "./model-config.js";

export const V3_MATCH_PARAMETERS=resolveV2MatchParameters({
  engineVersion:V3_ENGINE_VERSION,
  v3:V3_RULES,
  dynamicShape:{modelVersion:"dynamic-shape-v3.0-stable.1"},
  spatial:{roleBalance:{
    doublePivot451PivotControlMultiplier:1,
    doublePivot451PivotDefenseMultiplier:1,
    doublePivot451AttackUnitControlMultiplier:1,
    doublePivot451AttackUnitAttackMultiplier:1,
    doublePivot451AttackUnitSupportMultiplier:1,
  }},
  chain:{factorWeights:{
    buildUp:{execution:.26,control:.2,connection:.16,pressureSafety:.22,space:.05,progression:.05,overload:.06},
    progression:{execution:.18,control:.16,connection:.22,pressureSafety:.14,space:.12,progression:.11,overload:.07},
    finalThird:{execution:.16,control:.14,connection:.18,pressureSafety:.1,space:.16,progression:.16,overload:.1},
    chance:{execution:.2,control:.1,connection:.1,pressureSafety:.08,space:.22,progression:.18,overload:.12},
    shot:{execution:.34,control:.04,connection:.04,pressureSafety:.06,space:.22,progression:.18,overload:.12},
  }},
  events:{blackWhistlePerMatch:.005,ownGoalPerMatch:.004,brawl:{basePerEligibleMatch:.003}},
});
