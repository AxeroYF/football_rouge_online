// Opening grants apply once to fresh campaign accounts, never inferred from balance.
export const LAUNCH_REWARDS = Object.freeze({
  version: 1,
  firstConquestGold: 15_000,
  followingDayGold: 15_000,
  requiredConquests: 3,
  production: 400,
  packs: Object.freeze({ 'rare-player-pack': 2, 'exotic-player-pack': 1 }),
});
