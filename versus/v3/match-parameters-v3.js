import {resolveV2MatchParameters} from "../v2/match-parameters-v2.js";
import {V3_ENGINE_VERSION,V3_RULES,V32_RULES} from "./model-config.js";

export const V31_MATCH_PARAMETERS=resolveV2MatchParameters({
  engineVersion:"3.1.0",
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

export const V32_MATCH_PARAMETERS=resolveV2MatchParameters({
  ...V31_MATCH_PARAMETERS,engineVersion:'3.2.0',v32:V32_RULES,
  state:{...V31_MATCH_PARAMETERS.state,trailingUrgencyMaximum:0,leadingControlMaximum:0,
    levelDecisivenessMaximum:0,leadingShotXgPenaltyPerGoal:0,leadingShotXgMinimumMultiplier:1},
  tactics:{...V31_MATCH_PARAMETERS.tactics,
    stageProbabilityDimensionWeights:Object.fromEntries(Object.entries(V31_MATCH_PARAMETERS.tactics.stageProbabilityDimensionWeights).map(([key,value])=>[key,{...value,timeWasting:0}])),
    attackingCommitment:{...V31_MATCH_PARAMETERS.tactics.attackingCommitment,weights:{...V31_MATCH_PARAMETERS.tactics.attackingCommitment.weights,availableTime:0}}},
  dynamicShape:{...V31_MATCH_PARAMETERS.dynamicShape,modelVersion:"dynamic-shape-v3.2-continuous.1",stableInfluence:1,
    phaseTwo:{...V31_MATCH_PARAMETERS.dynamicShape.phaseTwo,scoreState:{...V31_MATCH_PARAMETERS.dynamicShape.phaseTwo.scoreState,
      trailingAttackingAdvance:0,trailingDefendingAdvance:0,trailingWidthExpansion:0,
      leadingAttackingRetreat:0,leadingDefendingRetreat:0,leadingWidthCompression:0}}},
  spatial:{...V31_MATCH_PARAMETERS.spatial,backlineExposure:{...V31_MATCH_PARAMETERS.spatial.backlineExposure,minimumDefenders:2}},
});

export const V3_MATCH_PARAMETERS=resolveV2MatchParameters({...V32_MATCH_PARAMETERS,engineVersion:V3_ENGINE_VERSION});
