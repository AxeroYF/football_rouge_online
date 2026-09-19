export const DAILY_NEUTRAL_CONQUEST_LIMIT = 8;
export const EXPEDITION_DEFEAT_COOLDOWN_MS = 20 * 60 * 1000;
export const CONQUEST_RESET_HOUR = 8;
const HOUR_MS = 3600000, DAY_MS = 86400000;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;
const RESET_OFFSET_MS = BEIJING_OFFSET_MS - CONQUEST_RESET_HOUR * HOUR_MS;
export function conquestDay(now) {
  return new Date(now + RESET_OFFSET_MS).toISOString().slice(0, 10);
}
export function attackCurfewState(now) {
  const midnight = Math.floor((now + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
  const endsAt = midnight + 8 * HOUR_MS;
  return {active:now < endsAt, endsAt, message:'宵禁中（北京时间 00:00–08:00），08:00 后可发起进攻'};
}
export function conquestState(account, now, bonus = 0) {
  const day = conquestDay(now), saved = account.conquest;
  const captures = (account.battleHistory ?? []).filter(b => b.captured && b.defender?.type === 'neutral');
  const captureTime = b => Number(b.settledAt ?? b.playedAt ?? 0);
  let used;
  if(saved?.resetHour === CONQUEST_RESET_HOUR)used=saved.day===day?Math.max(0,Number(saved.used)||0):0;
  else {
    // Old counters reset at midnight. Remove 00:00–08:00 captures from that
    // calendar day's counter and count them in the preceding conquest day.
    const historyUsed=captures.filter(b=>conquestDay(captureTime(b))===day).length;
    const earlierCaptures=captures.filter(b=>new Date(captureTime(b)+BEIJING_OFFSET_MS).toISOString().slice(0,10)===saved?.day&&conquestDay(captureTime(b))!==saved?.day).length;
    used=Math.max(historyUsed,saved?.day===day?Math.max(0,(Number(saved.used)||0)-earlierCaptures):0);
  }
  const latestDefeat = saved ? 0 : Math.max(0, ...(account.battleHistory ?? [])
    .filter(b => b.outcome && b.outcome !== 'win').map(captureTime));
  const limit = DAILY_NEUTRAL_CONQUEST_LIMIT + Math.max(0, Math.floor(Number(bonus) || 0));
  return { day, resetHour:CONQUEST_RESET_HOUR, limit, used, remaining:Math.max(0,limit-used),
    resetsAt:(Math.floor((now+RESET_OFFSET_MS)/DAY_MS)+1)*DAY_MS-RESET_OFFSET_MS,
    cooldownUntil:Math.max(Number(saved?.cooldownUntil)||0,latestDefeat?latestDefeat+EXPEDITION_DEFEAT_COOLDOWN_MS:0),
    curfew:attackCurfewState(now), serverNow:now };
}
export function conquestAttackBlock(state, ownerType, now = state?.serverNow ?? Date.now()) {
  if (!state) return null;
  const curfew=attackCurfewState(now);
  if(curfew.active)return {code:'attack-curfew',message:curfew.message,endsAt:curfew.endsAt};
  if (state.cooldownUntil > now) {
    const seconds = Math.ceil((state.cooldownUntil - now) / 1000);
    return { code: 'expedition-cooldown', message: `远征队休整中，${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒后可再次攻击` };
  }
  if (ownerType === 'neutral' && now < state.resetsAt && state.remaining <= 0)
    return { code:'neutral-conquest-limit', message:'今日中立地块征服次数已用完，北京时间 08:00 恢复' };
  return null;
}
