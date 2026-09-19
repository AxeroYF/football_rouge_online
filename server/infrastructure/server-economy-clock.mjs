// Persisted wall-clock anchors distinguish a stopped server from an offline player.
// Rebase only economic clocks; historical ledgers, balances and fractional work stay intact.
export const SERVER_ECONOMY_HEARTBEAT_MS = 30_000;
const valid = n => Number.isSafeInteger(n) && n >= 0;
function shift(object, key, duration, fractional = false) {
  if (!object || object[key] == null) return;
  const validTime = fractional ? n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER : valid;
  if (!validTime(object[key]) || !validTime(object[key] + duration)) throw Error('经济时钟时间无效：' + key);
  object[key] += duration;
}
export function resumeServerEconomy(saved, now) {
  if (!valid(now)) throw Error('服务器时间无效');
  if (!saved?.world) return {durationMs:0, legacy:false};
  const world = saved.world, accounts = Object.values(saved.accounts ?? {}), old = world.serverEconomyClock;
  if (old && (old.schemaVersion !== 1 || !valid(old.lastPersistedAt) || !valid(old.totalPausedMs))) throw Error('服务器经济时钟存档无效');
  // R9 has no heartbeat field. Its last economic settlement is the conservative
  // migration checkpoint. Existing overpayment is handled by a separate recovery plan.
  const anchors = [world.resourceEconomy?.settledAt, world.constructionEconomy?.settledAt,
    ...accounts.flatMap(a => [a.oil?.settledAt, a.operatingCosts?.settledAt])].filter(valid);
  const from = old?.lastPersistedAt ?? (anchors.length ? Math.max(...anchors) : now);
  const durationMs = Math.max(0, now - from);
  if (durationMs > 0) {
    shift(world.resourceEconomy, 'settledAt', durationMs);
    shift(world.constructionEconomy, 'settledAt', durationMs);
    for (const plan of Object.values(world.resourceEconomy?.fanPlans ?? {})) shift(plan, 'growthAt', durationMs);
    for (const a of accounts) {
      shift(a.fanEconomy, 'growthAt', durationMs);
      if (a.oil && a.oil.periodStartedAt == null) a.oil.periodStartedAt = a.oil.settledAt;
      shift(a.oil, 'settledAt', durationMs);
      shift(a.oil, 'periodStartedAt', durationMs);
      shift(a.operatingCosts, 'settledAt', durationMs);
      shift(a.formationResearch?.active, 'updatedAt', durationMs);
      for (const contract of a.sponsorship?.contracts ?? []) {
        if (contract.status !== 'active' || contract.expiresAt <= from) continue;
        const pausedMs = (contract.pausedMs ?? 0) + durationMs;
        if (!valid(pausedMs)) throw Error('赞助暂停时间无效');
        contract.pausedMs = pausedMs;
        shift(contract, 'expiresAt', durationMs);
      }
    }
    for (const territory of Object.values(world.territories ?? {})) {
      for (const building of territory.buildings ?? []) {
        if (building.status !== 'constructing' && !building.upgradeTo && !building.productionWork?.paused) continue;
        shift(building.productionWork, 'updatedAt', durationMs);
        shift(building, 'completesAt', durationMs);
        // Legacy fixed timers have no separate accumulated-work state.
        if (!building.productionWork) shift(building, 'constructionStartedAt', durationMs);
        for (const phase of building.productionWork?.schedule ?? []) {
          shift(phase, 'from', durationMs, true); shift(phase, 'to', durationMs, true);
        }
      }
    }
  }
  const totalPausedMs = (old?.totalPausedMs ?? 0) + durationMs;
  if (!valid(totalPausedMs)) throw Error('累计停服时间无效');
  world.serverEconomyClock = {schemaVersion:1, lastPersistedAt:Math.max(from, now), totalPausedMs,
    ...(old?.lastPause ? {lastPause:old.lastPause} : {}),
    ...(durationMs ? {lastPause:{from, to:now, durationMs, legacy:!old}} : {})};
  return {durationMs, from, to:now, legacy:!old};
}
export function economicCheckpoint(world, now) {
  if (!valid(now)) throw Error('服务器时间无效');
  const old = world?.serverEconomyClock;
  return {schemaVersion:1,totalPausedMs:old?.totalPausedMs ?? 0,...old,lastPersistedAt:Math.max(old?.lastPersistedAt ?? 0,now)};
}
