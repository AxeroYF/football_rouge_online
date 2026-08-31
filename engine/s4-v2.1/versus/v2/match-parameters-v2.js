import { readFileSync } from "node:fs";
import { ATTRIBUTE_NAMES } from "../../game/public/schema.js";
import { OFFLINE_ATTRIBUTE_SETTINGS, offlineEngineAttributeValue } from "../offline-attribute-settings.js";

const PARAMETER_PATH = new URL("./match-parameters-v2.json", import.meta.url);
const REQUIRED_CHAIN_STAGES = Object.freeze(["possession", "buildUp", "progression", "finalThird", "chance", "shot"]);
const REQUIRED_CHAIN_FACTORS = Object.freeze(["execution", "control", "connection", "pressureSafety", "space", "progression", "overload"]);
const REQUIRED_SOURCE_ORDER = Object.freeze(["base", "enhancement", "trait", "chemistry", "bond", "position", "tactic", "spatial", "state", "environment"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => clone(entry));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
  );
}

function mergeKnown(base, override, path = "parameters") {
  if (override === undefined) return clone(base);
  if (Array.isArray(base)) {
    if (!Array.isArray(override)) throw new Error(`${path}必须是数组`);
    return clone(override);
  }
  if (!isObject(base)) return clone(override);
  if (!isObject(override)) throw new Error(`${path}必须是对象`);
  for (const key of Object.keys(override)) {
    if (!Object.hasOwn(base, key)) throw new Error(`未知V2参数：${path}.${key}`);
  }
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [
    key,
    mergeKnown(value, override[key], `${path}.${key}`),
  ]));
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function validateRange(errors, range, path) {
  if (!isObject(range) || !finite(range.minimum) || !finite(range.maximum)) {
    errors.push(`${path}必须包含有限的minimum和maximum`);
    return;
  }
  if (Number(range.minimum) > Number(range.maximum)) errors.push(`${path}.minimum不能大于maximum`);
  if (Object.hasOwn(range, "default") && (!finite(range.default) || Number(range.default) < Number(range.minimum) || Number(range.default) > Number(range.maximum))) {
    errors.push(`${path}.default必须位于范围内`);
  }
}

function validateWeightMap(errors, weights, path, allowedKeys = null, expectedTotal = null) {
  if (!isObject(weights) || !Object.keys(weights).length) {
    errors.push(`${path}必须是非空权重对象`);
    return;
  }
  let total = 0;
  for (const [key, value] of Object.entries(weights)) {
    if (allowedKeys && !allowedKeys.has(key)) errors.push(`${path}.${key}不是已定义能力`);
    if (!finite(value) || Number(value) < 0) errors.push(`${path}.${key}必须是非负有限数值`);
    else total += Number(value);
  }
  if (expectedTotal !== null && Math.abs(total - expectedTotal) > 0.000001) errors.push(`${path}权重之和必须为${expectedTotal}，当前为${total}`);
  if (expectedTotal === null && total <= 0) errors.push(`${path}权重之和必须大于0`);
}

export function validateV2MatchParameters(parameters) {
  const errors = [];
  if (!isObject(parameters)) return { valid:false, errors:["V2参数必须是对象"] };
  if (parameters.schemaVersion !== 1) errors.push("schemaVersion必须为1");
  if (!/^2\.1\.\d+$/.test(String(parameters.engineVersion ?? ""))) errors.push("engineVersion必须是2.1.x");
  if (parameters.status !== "parameter-specification") errors.push("当前V2状态必须是parameter-specification");

  validateRange(errors, parameters.ability, "ability");
  if (!finite(parameters.ability?.competitiveAnchor)) errors.push("ability.competitiveAnchor必须是有限数值");
  if (!finite(parameters.ability?.positiveEdgeRetention) || parameters.ability.positiveEdgeRetention <= 0 || parameters.ability.positiveEdgeRetention > 1) errors.push("ability.positiveEdgeRetention必须在(0,1]内");

  const attributeNames = new Set(ATTRIBUTE_NAMES);
  for (const [metric, weights] of Object.entries(parameters.metrics ?? {})) {
    validateWeightMap(errors, weights, `metrics.${metric}`, attributeNames, 1);
  }
  if (!Object.keys(parameters.metrics ?? {}).length) errors.push("metrics不能为空");

  const dimensions = parameters.tactics?.dimensions ?? {};
  for (const [dimension, range] of Object.entries(dimensions)) validateRange(errors, range, `tactics.dimensions.${dimension}`);
  const dimensionNames = Object.keys(dimensions);
  if (!dimensionNames.length) errors.push("tactics.dimensions不能为空");
  for (const [preset, values] of Object.entries(parameters.tactics?.mentalityPresets ?? {})) {
    for (const dimension of dimensionNames) {
      if (!finite(values?.[dimension])) errors.push(`tactics.mentalityPresets.${preset}.${dimension}缺失或无效`);
      else if (Number(values[dimension]) < Number(dimensions[dimension].minimum) || Number(values[dimension]) > Number(dimensions[dimension].maximum)) errors.push(`tactics.mentalityPresets.${preset}.${dimension}超出范围`);
    }
    for (const dimension of Object.keys(values ?? {})) if (!Object.hasOwn(dimensions, dimension)) errors.push(`tactics.mentalityPresets.${preset}.${dimension}不是已定义维度`);
  }
  for (const [style, adjustments] of Object.entries(parameters.tactics?.styleAdjustments ?? {})) {
    for (const [dimension, value] of Object.entries(adjustments ?? {})) {
      if (!Object.hasOwn(dimensions, dimension)) errors.push(`tactics.styleAdjustments.${style}.${dimension}不是已定义维度`);
      if (!finite(value) || Math.abs(Number(value)) > 50) errors.push(`tactics.styleAdjustments.${style}.${dimension}必须在[-50,50]内`);
    }
  }
  for (const [stage, weights] of Object.entries(parameters.tactics?.stageProbabilityDimensionWeights ?? {})) {
    if (!REQUIRED_CHAIN_STAGES.slice(1).includes(stage)) errors.push(`tactics.stageProbabilityDimensionWeights.${stage}不是有效阶段`);
    for (const [dimension, value] of Object.entries(weights ?? {})) {
      if (!Object.hasOwn(dimensions, dimension)) errors.push(`tactics.stageProbabilityDimensionWeights.${stage}.${dimension}不是已定义维度`);
      if (!finite(value) || Math.abs(Number(value)) > 0.2) errors.push(`tactics.stageProbabilityDimensionWeights.${stage}.${dimension}必须位于[-0.2,0.2]内`);
    }
  }
  for (const [style, adjustments] of Object.entries(parameters.tactics?.stageProbabilityStyleAdjustments ?? {})) {
    if (!Object.hasOwn(parameters.tactics?.styleAdjustments ?? {}, style)) errors.push(`tactics.stageProbabilityStyleAdjustments.${style}不是已定义风格`);
    for (const [stage, value] of Object.entries(adjustments ?? {})) {
      if (!REQUIRED_CHAIN_STAGES.slice(1).includes(stage)) errors.push(`tactics.stageProbabilityStyleAdjustments.${style}.${stage}不是有效阶段`);
      if (!finite(value) || Math.abs(Number(value)) > 0.2) errors.push(`tactics.stageProbabilityStyleAdjustments.${style}.${stage}必须位于[-0.2,0.2]内`);
    }
  }

  const spatial = parameters.spatial ?? {};
  if (!Number.isInteger(spatial.grid?.columns) || spatial.grid.columns <= 0 || !Number.isInteger(spatial.grid?.rows) || spatial.grid.rows <= 0) errors.push("spatial.grid行列必须是正整数");
  if (spatial.lanes?.length !== spatial.grid?.columns) errors.push("spatial.lanes数量必须等于grid.columns");
  if (spatial.bands?.length !== spatial.grid?.rows) errors.push("spatial.bands数量必须等于grid.rows");
  if (new Set(spatial.lanes ?? []).size !== spatial.lanes?.length || new Set(spatial.bands ?? []).size !== spatial.bands?.length) errors.push("spatial.lanes和bands不能重复");
  for (const key of ["connectionDistance", "supportDistance", "pressureDistance", "influenceRadius", "influenceFalloff", "minimumInfluence", "tacticalDisplacementMaximum", "dynamicMovementMaximum", "defensiveTrackingRatio", "controlTemperature", "overloadPlayerAdvantage", "maximumLocalAdvantage"]) {
    if (!finite(spatial[key]) || Number(spatial[key]) <= 0) errors.push(`spatial.${key}必须是正数`);
  }
  for (const key of ["minimumDefenders", "minimumMidfielders", "maximumAttackers", "defenderDeficitWeight", "midfielderDeficitWeight", "attackerExcessWeight", "highLineSafeY", "highLineMaximumRiskY", "verticalGapSafe", "verticalGapMaximum", "goalkeeperGapSafe", "goalkeeperGapMaximum", "pressingCommitmentMinimum", "pressingCommitmentMaximum", "highLineWeight", "verticalGapWeight", "goalkeeperGapWeight", "pressingCommitmentWeight", "advancedMidfielderExcessWeight", "threeBackAdvancedMidfielderWeight", "resistancePenaltyMaximum", "spaceBonusMaximum", "underThreeDefenderPossessionMultiplierMinimum"]) {
    if (!finite(spatial.backlineExposure?.[key]) || Number(spatial.backlineExposure[key]) < 0) errors.push(`spatial.backlineExposure.${key}必须是非负数`);
  }
  for (const stage of REQUIRED_CHAIN_STAGES.slice(1)) {
    if (!finite(spatial.backlineExposure?.underThreeDefenderStagePenaltyMaximum?.[stage]) || Number(spatial.backlineExposure.underThreeDefenderStagePenaltyMaximum[stage]) < 0 || Number(spatial.backlineExposure.underThreeDefenderStagePenaltyMaximum[stage]) > 0.2) {
      errors.push(`spatial.backlineExposure.underThreeDefenderStagePenaltyMaximum.${stage}必须位于[0,0.2]`);
    }
  }
  for (const key of ["advancedMidfielderPenaltyPerExtra", "advancedMidfielderMinimumMultiplier", "singleStrikerControlMultiplier", "singleStrikerAttackMultiplier", "singleStrikerSupportMultiplier", "wideMidfielderAttackMultiplier", "wideMidfielderSupportMultiplier", "doublePivot451PivotControlMultiplier", "doublePivot451PivotDefenseMultiplier", "doublePivot451AttackUnitControlMultiplier", "doublePivot451AttackUnitAttackMultiplier", "doublePivot451AttackUnitSupportMultiplier"]) {
    if (!finite(spatial.roleBalance?.[key]) || Number(spatial.roleBalance[key]) <= 0 || Number(spatial.roleBalance[key]) > 2) errors.push(`spatial.roleBalance.${key}必须位于(0,2]`);
  }
  if (!Number.isInteger(Number(spatial.roleBalance?.singleStrikerMaximumAdvancedMidfielders)) || Number(spatial.roleBalance.singleStrikerMaximumAdvancedMidfielders) < 0) errors.push("spatial.roleBalance.singleStrikerMaximumAdvancedMidfielders必须是非负整数");
  for (const [minimumKey, maximumKey] of [["highLineMaximumRiskY", "highLineSafeY"], ["verticalGapSafe", "verticalGapMaximum"], ["goalkeeperGapSafe", "goalkeeperGapMaximum"], ["pressingCommitmentMinimum", "pressingCommitmentMaximum"]]) {
    if (Number(spatial.backlineExposure?.[minimumKey]) >= Number(spatial.backlineExposure?.[maximumKey])) errors.push(`spatial.backlineExposure.${minimumKey} must be less than ${maximumKey}`);
  }
  const movementStages = REQUIRED_CHAIN_STAGES.slice(1);
  const movementRoles = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  for (const stage of movementStages) {
    const movement = spatial.stageAdvance?.[stage];
    for (const role of movementRoles) {
      if (!finite(movement?.[role]) || Number(movement[role]) < 0 || Number(movement[role]) > Number(spatial.dynamicMovementMaximum)) errors.push(`spatial.stageAdvance.${stage}.${role}必须位于动态移动范围内`);
    }
  }

  const dynamicShape = parameters.dynamicShape ?? {};
  if (!["off", "shadow", "stable", "candidate"].includes(dynamicShape.mode)) errors.push("dynamicShape.mode must be off, shadow, stable, or candidate");
  if (typeof dynamicShape.modelVersion !== "string" || !dynamicShape.modelVersion.length) errors.push("dynamicShape.modelVersion must not be empty");
  if (typeof dynamicShape.restrictionsEnabled !== "boolean") errors.push("dynamicShape.restrictionsEnabled must be boolean");
  if (!finite(dynamicShape.stableInfluence) || Number(dynamicShape.stableInfluence) < 0 || Number(dynamicShape.stableInfluence) > 1) errors.push("dynamicShape.stableInfluence must be in [0,1]");
  if (!Number.isInteger(Number(dynamicShape.diagnostics?.sampleEveryChains)) || Number(dynamicShape.diagnostics.sampleEveryChains) <= 0) errors.push("dynamicShape.diagnostics.sampleEveryChains must be a positive integer");
  for (const [minimumKey, maximumKey] of [["minimumX", "maximumX"], ["minimumY", "maximumY"]]) {
    if (!finite(dynamicShape.pitchBounds?.[minimumKey]) || !finite(dynamicShape.pitchBounds?.[maximumKey])) errors.push(`dynamicShape.pitchBounds.${minimumKey}/${maximumKey} must be finite`);
    else if (Number(dynamicShape.pitchBounds[minimumKey]) >= Number(dynamicShape.pitchBounds[maximumKey])) errors.push(`dynamicShape.pitchBounds.${minimumKey} must be less than ${maximumKey}`);
  }
  if (!finite(dynamicShape.minimumPlayerDistance) || Number(dynamicShape.minimumPlayerDistance) <= 0) errors.push("dynamicShape.minimumPlayerDistance must be positive");
  if (!finite(dynamicShape.maximumPlayerDisplacement) || Number(dynamicShape.maximumPlayerDisplacement) <= Number(dynamicShape.minimumPlayerDistance)) errors.push("dynamicShape.maximumPlayerDisplacement must exceed minimumPlayerDistance");
  if (!Number.isInteger(Number(dynamicShape.separation?.maximumIterations)) || Number(dynamicShape.separation.maximumIterations) <= 0) errors.push("dynamicShape.separation.maximumIterations must be a positive integer");
  if (!finite(dynamicShape.separation?.tolerance) || Number(dynamicShape.separation.tolerance) < 0) errors.push("dynamicShape.separation.tolerance must be finite and non-negative");
  for (const role of ["GK", "CB", "FB", "WB", "DM", "CM", "AM", "W", "ST"]) {
    if (!finite(dynamicShape.separation?.roleCorrectionWeight?.[role]) || Number(dynamicShape.separation.roleCorrectionWeight[role]) <= 0) errors.push(`dynamicShape.separation.roleCorrectionWeight.${role} must be positive`);
  }
  for (const key of ["attackingMinimum", "lateWideMinimum"]) {
    if (!Number.isInteger(Number(dynamicShape.restDefense?.[key])) || Number(dynamicShape.restDefense[key]) < 0) errors.push(`dynamicShape.restDefense.${key} must be a non-negative integer`);
  }
  if (!finite(dynamicShape.restDefense?.protectionLineY) || Number(dynamicShape.restDefense.protectionLineY) < Number(dynamicShape.pitchBounds?.minimumY) || Number(dynamicShape.restDefense.protectionLineY) > Number(dynamicShape.pitchBounds?.maximumY)) errors.push("dynamicShape.restDefense.protectionLineY must be inside pitchBounds");
  for (const path of ["ballSidePull.attacking", "ballSidePull.defending", "widthInfluence.attacking", "widthInfluence.defending", "fullback.ballSideAdvance", "fullback.farSideDepthRetention", "fullback.farSideTuck", "defensiveMidfielder.coverShift", "transition.attackingDepthMultiplier", "transition.defendingRecoveryMultiplier", "transition.attackingWidthMultiplier"]) {
    const value = path.split(".").reduce((current, key) => current?.[key], dynamicShape);
    if (!finite(value) || Number(value) < 0) errors.push(`dynamicShape.${path} must be finite and non-negative`);
  }
  for (const role of ["GK", "CB", "FB", "WB", "DM", "CM", "AM", "W", "ST"]) {
    if (!finite(dynamicShape.roleMobility?.[role]) || Number(dynamicShape.roleMobility[role]) < 0) errors.push(`dynamicShape.roleMobility.${role} must be finite and non-negative`);
  }
  for (const stage of movementStages) {
    if (!finite(dynamicShape.stageIntensity?.[stage]) || Number(dynamicShape.stageIntensity[stage]) < 0 || Number(dynamicShape.stageIntensity[stage]) > 1) errors.push(`dynamicShape.stageIntensity.${stage} must be in [0,1]`);
  }
  const phaseTwo = dynamicShape.phaseTwo ?? {};
  if (typeof phaseTwo.enabled !== "boolean") errors.push("dynamicShape.phaseTwo.enabled must be boolean");
  if (!finite(phaseTwo.scoreState?.startMinute) || Number(phaseTwo.scoreState.startMinute) < 0 || Number(phaseTwo.scoreState.startMinute) >= Number(parameters.state?.regulationMinutes ?? 90)) errors.push("dynamicShape.phaseTwo.scoreState.startMinute must be inside regulation time");
  for (const key of ["trailingAttackingAdvance", "trailingDefendingAdvance", "leadingAttackingRetreat", "leadingDefendingRetreat"]) {
    if (!finite(phaseTwo.scoreState?.[key]) || Number(phaseTwo.scoreState[key]) < 0) errors.push(`dynamicShape.phaseTwo.scoreState.${key} must be finite and non-negative`);
  }
  for (const key of ["trailingWidthExpansion", "leadingWidthCompression"]) {
    if (!finite(phaseTwo.scoreState?.[key]) || Number(phaseTwo.scoreState[key]) < 0 || Number(phaseTwo.scoreState[key]) > 0.5) errors.push(`dynamicShape.phaseTwo.scoreState.${key} must be in [0,0.5]`);
  }
  if (!finite(phaseTwo.transitionRecovery?.defendingWidthMultiplier) || Number(phaseTwo.transitionRecovery.defendingWidthMultiplier) <= 0 || Number(phaseTwo.transitionRecovery.defendingWidthMultiplier) > 1) errors.push("dynamicShape.phaseTwo.transitionRecovery.defendingWidthMultiplier must be in (0,1]");
  for (const mapName of ["roleDepthMultiplier", "attackingRunMultiplier"]) {
    for (const role of ["GK", "CB", "FB", "WB", "DM", "CM", "AM", "W", "ST"]) {
      if (!finite(phaseTwo.transitionRecovery?.[mapName]?.[role]) || Number(phaseTwo.transitionRecovery[mapName][role]) <= 0) errors.push(`dynamicShape.phaseTwo.transitionRecovery.${mapName}.${role} must be positive`);
    }
  }
  for (const key of ["attackingRoleExpansion", "lateStageExpansion"]) {
    if (!finite(phaseTwo.wideOccupancy?.[key]) || Number(phaseTwo.wideOccupancy[key]) < 0 || Number(phaseTwo.wideOccupancy[key]) > 0.5) errors.push(`dynamicShape.phaseTwo.wideOccupancy.${key} must be in [0,0.5]`);
  }
  if (!Number.isInteger(Number(phaseTwo.underload?.referencePlayers)) || Number(phaseTwo.underload.referencePlayers) <= 0) errors.push("dynamicShape.phaseTwo.underload.referencePlayers must be a positive integer");
  if (!Number.isInteger(Number(phaseTwo.underload?.maximumMissingPlayers)) || Number(phaseTwo.underload.maximumMissingPlayers) < 0) errors.push("dynamicShape.phaseTwo.underload.maximumMissingPlayers must be a non-negative integer");
  for (const key of ["widthCompressionPerMissing", "defensiveRetreatPerMissing", "attackingRestraintPerMissing"]) {
    if (!finite(phaseTwo.underload?.[key]) || Number(phaseTwo.underload[key]) < 0) errors.push(`dynamicShape.phaseTwo.underload.${key} must be finite and non-negative`);
  }

  const chain = parameters.chain ?? {};
  if (JSON.stringify(chain.stages) !== JSON.stringify(REQUIRED_CHAIN_STAGES)) errors.push(`chain.stages必须严格为${REQUIRED_CHAIN_STAGES.join(" -> ")}`);
  if (!finite(chain.openPlayXgScale) || Number(chain.openPlayXgScale) <= 0 || Number(chain.openPlayXgScale) > 1) errors.push("chain.openPlayXgScale必须位于(0,1]");
  for (const key of ["selectionExponent", "controlProbabilityWeight", "minimumControlMultiplier", "maximumControlMultiplier"]) {
    if (!finite(chain.possessionDuration?.[key]) || Number(chain.possessionDuration[key]) <= 0 || Number(chain.possessionDuration[key]) > 3) errors.push(`chain.possessionDuration.${key}必须位于(0,3]`);
  }
  if (Number(chain.possessionDuration?.minimumControlMultiplier) > Number(chain.possessionDuration?.maximumControlMultiplier)) errors.push("chain.possessionDuration.minimumControlMultiplier不能大于maximumControlMultiplier");
  const longShot = chain.longShot ?? {};
  for (const key of ["baseDecisionChance", "skillDecisionWeight", "longBallBonus", "lowBlockBonus", "attackingMentalityBonus", "structureExposureDecisionBonus", "structureExposureXgBonus", "midfieldVacuumMinimumExposure", "midfieldVacuumBaseChance", "midfieldVacuumMaximumChance", "midfieldVacuumWideLaneMultiplier", "minimumDecisionChance", "maximumDecisionChance", "baseXg", "skillXgWeight", "spaceXgWeight", "minimumXg", "maximumXg"]) {
    if (!finite(longShot[key]) || Number(longShot[key]) < 0 || Number(longShot[key]) > 1) errors.push(`chain.longShot.${key}必须位于[0,1]`);
  }
  if (Number(longShot.midfieldVacuumBaseChance) > Number(longShot.midfieldVacuumMaximumChance)) errors.push("chain.longShot.midfieldVacuumBaseChance must not exceed midfieldVacuumMaximumChance");
  if (Number(longShot.minimumDecisionChance) > Number(longShot.maximumDecisionChance)) errors.push("chain.longShot.minimumDecisionChance不能大于maximumDecisionChance");
  if (Number(longShot.minimumXg) > Number(longShot.maximumXg)) errors.push("chain.longShot.minimumXg不能大于maximumXg");
  const breakaway = chain.breakaway ?? {};
  for (const key of ["minimumHighLineRisk", "maximumXgBonus", "maximumXg", "transitionMultiplier", "directRouteMultiplier"]) {
    if (!finite(breakaway[key]) || Number(breakaway[key]) < 0 || Number(breakaway[key]) > 1) errors.push(`chain.breakaway.${key}必须位于[0,1]`);
  }
  for (const stage of REQUIRED_CHAIN_STAGES) validateRange(errors, chain.probabilityBounds?.[stage], `chain.probabilityBounds.${stage}`);
  for (const stage of REQUIRED_CHAIN_STAGES.slice(1)) {
    const baseProbability = chain.baseProbabilities?.[stage];
    if (!finite(baseProbability) || Number(baseProbability) <= 0 || Number(baseProbability) >= 1) errors.push(`chain.baseProbabilities.${stage}必须位于(0,1)`);
    const weights = chain.factorWeights?.[stage];
    validateWeightMap(errors, weights, `chain.factorWeights.${stage}`, new Set(REQUIRED_CHAIN_FACTORS), 1);
    for (const factor of REQUIRED_CHAIN_FACTORS) if (!Object.hasOwn(weights ?? {}, factor)) errors.push(`chain.factorWeights.${stage}.${factor}缺失`);
  }
  for (const key of ["directThreshold", "directMaximumChance", "directConnectionPenalty", "directSpaceReward", "counterMinimumChance", "counterMaximumChance", "counterConnectionBonus", "counterSpaceReward"]) {
    if (!finite(chain.route?.[key]) || Number(chain.route[key]) < 0 || Number(chain.route[key]) > 100) errors.push(`chain.route.${key}必须是有效非负数`);
  }
  for (const key of ["fatiguePerChain", "pressingFatigueMaximum", "attackingPressFatigueMaximum", "trailingUrgencyMaximum", "leadingControlMaximum", "levelDecisivenessMaximum"]) {
    if (!finite(parameters.state?.[key]) || Number(parameters.state[key]) < 0 || Number(parameters.state[key]) > 1) errors.push(`state.${key}必须位于[0,1]`);
  }
  const styleIdentity = parameters.tactics?.styleIdentity ?? {};
  for (const key of ["minimumFit", "maximumFit"]) {
    if (!finite(styleIdentity[key]) || Number(styleIdentity[key]) <= 0 || Number(styleIdentity[key]) > 2) errors.push(`tactics.styleIdentity.${key}必须位于(0,2]`);
  }
  if (Number(styleIdentity.minimumFit) > Number(styleIdentity.maximumFit)) errors.push("tactics.styleIdentity.minimumFit不能大于maximumFit");
  for (const [style, keys] of Object.entries({ wingPlay:["attackMaximum", "crossingMaximum"], possession:["controlMaximum", "defenseMaximum"], longBall:["progressionMaximum", "headerXgMaximum"], roughPlay:["defenseMaximum", "pressureMaximum"], counterAttack:["transitionMaximum", "outletMaximum"], highPress:["pressureMaximum", "recoveryMaximum"], lowBlock:["defenseMaximum", "outletMaximum"] })) {
    for (const key of keys) if (!finite(styleIdentity?.[style]?.[key]) || Number(styleIdentity[style][key]) < 0 || Number(styleIdentity[style][key]) > 0.5) errors.push(`tactics.styleIdentity.${style}.${key}必须位于[0,0.5]`);
  }
  if (!finite(parameters.state?.levelDecisivenessStartMinute) || Number(parameters.state.levelDecisivenessStartMinute) < 0 || Number(parameters.state.levelDecisivenessStartMinute) >= Number(parameters.state.regulationMinutes)) errors.push("state.levelDecisivenessStartMinute必须位于常规时间内");
  if (!finite(parameters.state?.leadingShotXgPenaltyPerGoal) || Number(parameters.state.leadingShotXgPenaltyPerGoal) < 0 || Number(parameters.state.leadingShotXgPenaltyPerGoal) > 0.5) errors.push("state.leadingShotXgPenaltyPerGoal必须位于[0,0.5]");
  if (!finite(parameters.state?.leadingShotXgMinimumMultiplier) || Number(parameters.state.leadingShotXgMinimumMultiplier) <= 0 || Number(parameters.state.leadingShotXgMinimumMultiplier) > 1) errors.push("state.leadingShotXgMinimumMultiplier必须位于(0,1]");

  validateWeightMap(errors, parameters.environment?.weatherWeights, "environment.weatherWeights");
  validateWeightMap(errors, parameters.environment?.refereeWeights, "environment.refereeWeights");
  for (const [key, value] of Object.entries(parameters.environment?.weatherExecution ?? {})) if (!finite(value) || value < 0.5 || value > 1.2) errors.push(`environment.weatherExecution.${key}必须在[0.5,1.2]内`);
  for (const [key, value] of Object.entries(parameters.environment?.weatherFatigueMultiplier ?? {})) if (!finite(value) || value < 0.5 || value > 2) errors.push(`environment.weatherFatigueMultiplier.${key}必须在[0.5,2]内`);
  const superStormStopRange = parameters.environment?.superStormStopMinuteRange ?? {};
  for (const key of ["minimum", "maximum"]) if (!Number.isInteger(Number(superStormStopRange[key])) || Number(superStormStopRange[key]) < 61 || Number(superStormStopRange[key]) > 89) errors.push(`environment.superStormStopMinuteRange.${key}必须是61-89的整数`);
  if (Number(superStormStopRange.minimum) > Number(superStormStopRange.maximum)) errors.push("environment.superStormStopMinuteRange.minimum不能大于maximum");
  for (const [key, value] of Object.entries(parameters.environment?.refereeDiscipline ?? {})) if (!finite(value) || value < 0.5 || value > 1.5) errors.push(`environment.refereeDiscipline.${key}必须在[0.5,1.5]内`);
  for (const group of ["cardProbability", "directRedProbability", "weatherEventPerChain"]) {
    for (const [key, value] of Object.entries(parameters.environment?.[group] ?? {})) if (!finite(value) || value < 0 || value > 1) errors.push(`environment.${group}.${key}必须在[0,1]内`);
  }
  if (!finite(parameters.events?.secondYellowCardMultiplier) || Number(parameters.events.secondYellowCardMultiplier) < 0 || Number(parameters.events.secondYellowCardMultiplier) > 1) errors.push("events.secondYellowCardMultiplier必须位于[0,1]");
  for (const key of ["injuryPerChain", "blackWhistlePerMatch", "ownGoalPerMatch", "weatherImpactPerMatch"]) {
    if (!finite(parameters.events?.[key]) || parameters.events[key] < 0 || parameters.events[key] > 1) errors.push(`events.${key}必须在[0,1]内`);
  }
  const brawl = parameters.events?.brawl ?? {};
  if (!finite(brawl.basePerEligibleMatch) || Number(brawl.basePerEligibleMatch) < 0 || Number(brawl.basePerEligibleMatch) > 1) errors.push("events.brawl.basePerEligibleMatch必须位于[0,1]内");
  if (!finite(brawl.aggressionBaseline) || Number(brawl.aggressionBaseline) < 0 || Number(brawl.aggressionBaseline) > 100) errors.push("events.brawl.aggressionBaseline必须位于[0,100]内");
  for (const key of ["aggressionMultiplierMaximum", "oneSideRoughPlayMultiplier", "bothSidesRoughPlayMultiplier"]) {
    if (!finite(brawl[key]) || Number(brawl[key]) < 1 || Number(brawl[key]) > 20) errors.push(`events.brawl.${key}必须位于[1,20]内`);
  }
  for (const key of ["lenient", "standard", "strict"]) {
    if (!finite(brawl.refereeMultiplier?.[key]) || Number(brawl.refereeMultiplier[key]) <= 0 || Number(brawl.refereeMultiplier[key]) > 10) errors.push(`events.brawl.refereeMultiplier.${key}必须位于(0,10]内`);
  }
  for (const key of ["minimumMinute", "maximumMinute", "maximumGoalDifference"]) {
    if (!finite(brawl[key]) || Number(brawl[key]) < 0 || Number(brawl[key]) > 90) errors.push(`events.brawl.${key}必须位于[0,90]内`);
  }
  if (Number(brawl.minimumMinute) > Number(brawl.maximumMinute)) errors.push("events.brawl.minimumMinute不能大于maximumMinute");
  for (const key of ["dismissalsPerTeamMinimum", "dismissalsPerTeamMaximum"]) {
    if (!Number.isInteger(Number(brawl[key])) || Number(brawl[key]) < 1 || Number(brawl[key]) > 10) errors.push(`events.brawl.${key}必须是1-10的整数`);
  }
  if (Number(brawl.dismissalsPerTeamMinimum) > Number(brawl.dismissalsPerTeamMaximum)) errors.push("events.brawl.dismissalsPerTeamMinimum不能大于dismissalsPerTeamMaximum");
  for (const key of ["foulMultiplier", "cardMultiplier", "directRedMultiplier", "foulInjuryMultiplier"]) {
    if (!finite(parameters.events?.roughPlay?.[key]) || Number(parameters.events.roughPlay[key]) < 1 || Number(parameters.events.roughPlay[key]) > 5) errors.push(`events.roughPlay.${key}必须位于[1,5]内`);
  }

  const stacking = parameters.stacking ?? {};
  if (JSON.stringify(stacking.sourceOrder) !== JSON.stringify(REQUIRED_SOURCE_ORDER)) errors.push(`stacking.sourceOrder必须严格为${REQUIRED_SOURCE_ORDER.join(" -> ")}`);
  const sourceSet = new Set(stacking.sourceOrder ?? []);
  for (const group of ["attributeSources", "executionSources", "teamSources"]) {
    if (!Array.isArray(stacking[group]) || stacking[group].some((source) => !sourceSet.has(source))) errors.push(`stacking.${group}包含未知来源`);
  }
  const groupedSources = [...(stacking.attributeSources ?? []), ...(stacking.executionSources ?? []), ...(stacking.teamSources ?? [])];
  if (new Set(groupedSources).size !== groupedSources.length) errors.push("stacking来源不能跨域重复");
  for (const [domain, range] of Object.entries(stacking.domainBounds ?? {})) validateRange(errors, range, `stacking.domainBounds.${domain}`);
  if (new Set(Object.values(stacking.effectOwnership ?? {})).size !== Object.keys(stacking.effectOwnership ?? {}).length) errors.push("stacking.effectOwnership要求每个结果拥有独立负责阶段");

  return { valid:errors.length === 0, errors };
}

export function assertV2MatchParameters(parameters) {
  const result = validateV2MatchParameters(parameters);
  if (!result.valid) throw new Error(`V2比赛参数无效：\n- ${result.errors.join("\n- ")}`);
  return parameters;
}

const sourceParameters = JSON.parse(readFileSync(PARAMETER_PATH, "utf8"));
assertV2MatchParameters(sourceParameters);

export const V2_MATCH_PARAMETER_SOURCE = PARAMETER_PATH;
export const V2_MATCH_PARAMETERS = deepFreeze(sourceParameters);

export function v2EngineAttributeValue(value, parameters = V2_MATCH_PARAMETERS, attributeSettings = OFFLINE_ATTRIBUTE_SETTINGS) {
  const numeric = Number(value);
  const minimum = Number(parameters.ability.minimum);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.max(minimum, offlineEngineAttributeValue(numeric, attributeSettings, Number(parameters.ability.maximum)));
}


export function resolveV2MatchParameters(overrides = {}) {
  const resolved = mergeKnown(V2_MATCH_PARAMETERS, overrides);
  assertV2MatchParameters(resolved);
  return deepFreeze(resolved);
}

export function v2ParameterManifest(parameters = V2_MATCH_PARAMETERS) {
  assertV2MatchParameters(parameters);
  return deepFreeze({
    schemaVersion:parameters.schemaVersion,
    engineVersion:parameters.engineVersion,
    status:parameters.status,
    metricNames:Object.keys(parameters.metrics),
    tacticalDimensions:Object.keys(parameters.tactics.dimensions),
    mentalityPresets:Object.keys(parameters.tactics.mentalityPresets),
    styleTemplates:Object.keys(parameters.tactics.styleAdjustments),
    zoneCount:parameters.spatial.grid.columns * parameters.spatial.grid.rows,
    chainStages:[...parameters.chain.stages],
    sourceOrder:[...parameters.stacking.sourceOrder],
    effectOwnership:{ ...parameters.stacking.effectOwnership },
  });
}
