export const FITNESS_RULES = Object.freeze({ minimum: 30, recoveryPerMinute: 0.5, centerPerMinute: 1, defaultRedline: 65 });
export function fitnessRedline(value) {
  const number = Number(value ?? FITNESS_RULES.defaultRedline);
  return Number.isFinite(number) ? Math.max(45, Math.min(100, Math.round(number))) : FITNESS_RULES.defaultRedline;
}
export function boundedFitness(value) {
  const number = Number(value ?? 100);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 100;
}
export function fitnessBand(value) {
  return value >= 80 ? '充沛' : value >= 50 ? '疲劳' : value >= 30 ? '严重疲劳' : '需要休息';
}
