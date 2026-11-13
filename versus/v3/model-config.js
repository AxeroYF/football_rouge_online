export const V3_ENGINE_VERSION = "3.3.0";
export const V3_ENGINE_PROFILE = "v3.3-tactical-execution.1";
export const V3_MODEL_VERSION = "match-engine-v3.3";
export const V3_SPATIAL_VERSION = "spatial-v3.0-tactical.1";
export const V3_RULES = Object.freeze({
  midfieldTransitionWidth:4,
  executionDifferenceDivisor:200,
  factorSensitivity:0.58,
  directionPreference:1.5,
  sampling:Object.freeze({ bucketSize:12, stageRegularity:0.65, goalRegularity:0.75 }),
});

export const isV3 = parameters => /^3\.[0123]\./.test(String(parameters?.engineVersion ?? ""));
// Reliability features apply to V3.1 and later, retaining old profile identities.
export const isV31 = parameters => /^3\.[123]\./.test(String(parameters?.engineVersion ?? ""));
export const isV32 = parameters => /^3\.[23]\./.test(String(parameters?.engineVersion ?? ""));
export const isV33 = parameters => /^3\.3\./.test(String(parameters?.engineVersion ?? ""));
export const engineProfile = parameters => isV33(parameters) ? V3_ENGINE_PROFILE : isV32(parameters) ? "v3.2-continuous-tactics.1" : isV31(parameters) ? "v3.1-reliability.1" : isV3(parameters) ? "v3.0-tactical-control.1" : "v2.1-stable-dynamic.2";
export const engineModel = parameters => isV33(parameters) ? V3_MODEL_VERSION : isV32(parameters) ? "match-engine-v3.2" : isV31(parameters) ? "match-engine-v3.1" : isV3(parameters) ? "match-engine-v3.0" : "match-engine-v2.1";
export const V32_RULES=Object.freeze({
  maxChains:1800,maxActions:8,maxRecycles:2,minimumActionSeconds:2,
  counterPressWindow:6,counterPressSeconds:3,counterPressMaximum:.52,
  movementUnitsPerSecond:1.05,maximumAddedSeconds:90,decisionTolerance:.12,
});
