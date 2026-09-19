import { LAUNCH_REWARDS as RULES } from '../../shared/config/launch-rewards.mjs';
import { conquestDay } from '../../shared/config/conquest.mjs';

const FIELDS = ['launchRewards', 'gold', 'goldLedger', 'inventory', 'pendingNeutralRewards'];
export class LaunchRewardService {
  constructor({ economy, playerPacks }) { Object.assign(this, { economy, playerPacks }); }
  recordConquest(account, territoryId) {
    const rewards = account.launchRewards;
    if (rewards?.version !== RULES.version || !territoryId) return;
    const ids = rewards.conqueredTerritoryIds;
    if (ids.length < RULES.requiredConquests && !ids.includes(territoryId)) ids.push(territoryId);
  }
  prepare(accounts, world, now) {
    const snapshots = [];
    const rollback = () => {
      for (const [account, before] of snapshots) for (const key of FIELDS) {
        if (before[key] === undefined) delete account[key]; else account[key] = before[key];
      }
    };
    try {
      for (const account of accounts.values()) {
        const rewards = account.launchRewards;
        if (rewards?.version !== RULES.version || !account.setupComplete) continue;
        const home = world?.territories?.[account.homeTerritoryId];
        const homeReady = home?.ownerType === 'player' && home.ownerId === account.id;
        const first = !rewards.firstConquestPaid && rewards.conqueredTerritoryIds.length >= 1;
        const followingDay = !rewards.followingDayPaid && rewards.conqueredTerritoryIds.length >= RULES.requiredConquests
          && rewards.teamStartedAt != null && conquestDay(now) > conquestDay(rewards.teamStartedAt);
        if (rewards.teamStartedAt != null && rewards.packsPaid && (rewards.productionPaid || !homeReady) && !first && !followingDay) continue;
        snapshots.push([account, structuredClone(Object.fromEntries(FIELDS.map(key => [key, account[key]])))]);
        rewards.teamStartedAt ??= now;
        if (!rewards.packsPaid) {
          for (const [type, count] of Object.entries(RULES.packs)) this.playerPacks.addPacks(account, type, count);
          rewards.packsPaid = true;
        }
        if (homeReady && !rewards.productionPaid) {
          account.pendingNeutralRewards ??= [];
          account.pendingNeutralRewards.push({ id: 'launch-production:' + account.id, kind: 'production',
            amount: RULES.production, source: 'launch', sourceTerritoryId: account.homeTerritoryId,
            receivedAt: now, status: 'pending' });
          rewards.productionPaid = true;
        }
        if (first) {
          this.economy.adjust(account, RULES.firstConquestGold, 'launch-first-conquest');
          rewards.firstConquestPaid = true;
        }
        if (followingDay) {
          this.economy.adjust(account, RULES.followingDayGold, 'launch-following-day');
          rewards.followingDayPaid = true;
        }
      }
      return { rollback };
    } catch (error) { rollback(); throw error; }
  }
}
