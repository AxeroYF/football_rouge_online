import { readFileSync } from "node:fs";
import { ATTRIBUTE_NAMES } from "../../game/public/schema.js";

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
  return structuredClone(value);
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
  if (!/^2\.0\.0-alpha\.\d+$/.test(String(parameters.engineVersion ?? ""))) errors.push("engineVersion必须是2.0.0-alpha.x");
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
  const movementStages = REQUIRED_CHAIN_STAGES.slice(1);
  const movementRoles = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  for (const stage of movementStages) {
    const movement = spatial.stageAdvance?.[stage];
    for (const role of movementRoles) {
      if (!finite(movement?.[role]) || Number(movement[role]) < 0 || Number(movement[role]) > Number(spatial.dynamicMovementMaximum)) errors.push(`spatial.stageAdvance.${stage}.${role}必须位于动态移动范围内`);
    }
  }

  const chain = parameters.chain ?? {};
  if (JSON.stringify(chain.stages) !== JSON.stringify(REQUIRED_CHAIN_STAGES)) errors.push(`chain.stages必须严格为${REQUIRED_CHAIN_STAGES.join(" -> ")}`);
  if (!finite(chain.openPlayXgScale) || Number(chain.openPlayXgScale) <= 0 || Number(chain.openPlayXgScale) > 1) errors.push("chain.openPlayXgScale必须位于(0,1]");
  const longShot = chain.longShot ?? {};
  for (const key of ["baseDecisionChance", "skillDecisionWeight", "longBallBonus", "lowBlockBonus", "attackingMentalityBonus", "minimumDecisionChance", "maximumDecisionChance", "baseXg", "skillXgWeight", "spaceXgWeight", "minimumXg", "maximumXg"]) {
    if (!finite(longShot[key]) || Number(longShot[key]) < 0 || Number(longShot[key]) > 1) errors.push(`chain.longShot.${key}必须位于[0,1]`);
  }
  if (Number(longShot.minimumDecisionChance) > Number(longShot.maximumDecisionChance)) errors.push("chain.longShot.minimumDecisionChance不能大于maximumDecisionChance");
  if (Number(longShot.minimumXg) > Number(longShot.maximumXg)) errors.push("chain.longShot.minimumXg不能大于maximumXg");
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
  for (const key of ["fatiguePerChain", "pressingFatigueMaximum", "trailingUrgencyMaximum", "leadingControlMaximum"]) {
    if (!finite(parameters.state?.[key]) || Number(parameters.state[key]) < 0 || Number(parameters.state[key]) > 1) errors.push(`state.${key}必须位于[0,1]`);
  }
  if (!finite(parameters.state?.leadingShotXgPenaltyPerGoal) || Number(parameters.state.leadingShotXgPenaltyPerGoal) < 0 || Number(parameters.state.leadingShotXgPenaltyPerGoal) > 0.5) errors.push("state.leadingShotXgPenaltyPerGoal必须位于[0,0.5]");
  if (!finite(parameters.state?.leadingShotXgMinimumMultiplier) || Number(parameters.state.leadingShotXgMinimumMultiplier) <= 0 || Number(parameters.state.leadingShotXgMinimumMultiplier) > 1) errors.push("state.leadingShotXgMinimumMultiplier必须位于(0,1]");

  validateWeightMap(errors, parameters.environment?.weatherWeights, "environment.weatherWeights");
  validateWeightMap(errors, parameters.environment?.refereeWeights, "environment.refereeWeights");
  for (const [key, value] of Object.entries(parameters.environment?.weatherExecution ?? {})) if (!finite(value) || value < 0.5 || value > 1.2) errors.push(`environment.weatherExecution.${key}必须在[0.5,1.2]内`);
  for (const [key, value] of Object.entries(parameters.environment?.refereeDiscipline ?? {})) if (!finite(value) || value < 0.5 || value > 1.5) errors.push(`environment.refereeDiscipline.${key}必须在[0.5,1.5]内`);
  for (const group of ["cardProbability", "directRedProbability", "weatherEventPerChain"]) {
    for (const [key, value] of Object.entries(parameters.environment?.[group] ?? {})) if (!finite(value) || value < 0 || value > 1) errors.push(`environment.${group}.${key}必须在[0,1]内`);
  }
  for (const key of ["injuryPerChain", "blackWhistlePerMatch"]) {
    if (!finite(parameters.events?.[key]) || parameters.events[key] < 0 || parameters.events[key] > 1) errors.push(`events.${key}必须在[0,1]内`);
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
