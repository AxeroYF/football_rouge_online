export function challengeSchedulerTimings(environment = process.env) {
  return {
    sliceIntervalMs: Math.max(100, Math.min(2000, Number(environment.CAMPAIGN_LIVE_SLICE_MS ?? 100))),
    persistIntervalMs: Math.max(1000, Math.min(30000, Number(environment.CAMPAIGN_LIVE_PERSIST_MS ?? 5000))),
  };
}

export function createChallengeScheduler({
  campaign,
  now = Date.now,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  timings = challengeSchedulerTimings(),
  autoStart = true,
} = {}) {
  if (!campaign) throw new Error("Challenge scheduler requires a campaign service");
  let dirty = false;
  let advanceTimer = null;
  let persistTimer = null;

  const advance = () => {
    dirty = campaign.advanceActiveChallenges(now(), { maximumMatches: 1, maximumChainsPerMatch: 1 }) || dirty;
    return dirty;
  };
  const persist = () => {
    if (!dirty) return false;
    campaign.save();
    dirty = false;
    return true;
  };
  const start = () => {
    if (advanceTimer || persistTimer) return;
    advanceTimer = setIntervalImpl(advance, timings.sliceIntervalMs);
    persistTimer = setIntervalImpl(persist, timings.persistIntervalMs);
    advanceTimer?.unref?.();
    persistTimer?.unref?.();
  };
  const stop = ({ flush = true } = {}) => {
    if (advanceTimer) clearIntervalImpl(advanceTimer);
    if (persistTimer) clearIntervalImpl(persistTimer);
    advanceTimer = null;
    persistTimer = null;
    if (flush) persist();
  };

  if (autoStart) start();
  return { advance, persist, start, stop, isDirty: () => dirty };
}
