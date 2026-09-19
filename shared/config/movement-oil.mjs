// Shared by movement previews and authoritative server settlement.
export function movementUseOil(value = true) {
  if (typeof value !== 'boolean') throw Object.assign(new Error('移动用油选项无效'), {statusCode:400});
  return value;
}
export function applyMovementOilChoice(estimate, value = true, kind = 'expedition') {
  const useOil = movementUseOil(value);
  const normalDurationMs = estimate.normalDurationMs ?? estimate.durationMs;
  const oilMultiplier = !useOil || estimate.oilShortage ? (kind === 'scout' ? 2 : 4) : 1;
  return {...estimate, useOil, normalDurationMs, oilMultiplier,
    durationMs:normalDurationMs * oilMultiplier,
    oilSpent:oilMultiplier === 1 ? estimate.oilRequired : 0};
}
