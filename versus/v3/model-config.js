export const V3_ENGINE_VERSION = "3.0.0";
export const V3_ENGINE_PROFILE = "v3.0-tactical-control.1";
export const V3_MODEL_VERSION = "match-engine-v3.0";
export const V3_SPATIAL_VERSION = "spatial-v3.0-tactical.1";
export const V3_RULES = Object.freeze({
  midfieldTransitionWidth:4,
  executionDifferenceDivisor:200,
  factorSensitivity:0.58,
  directionPreference:1.5,
  sampling:Object.freeze({ bucketSize:12, stageRegularity:0.65, goalRegularity:0.75 }),
});

export const isV3 = parameters => /^3\.0\./.test(String(parameters?.engineVersion ?? ""));
export const engineProfile = parameters => isV3(parameters) ? V3_ENGINE_PROFILE : "v2.1-stable-dynamic.2";
