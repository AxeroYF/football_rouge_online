import { DRAFT_VERSION } from "../../shared/config/draft.mjs";
import { normalizePlayerSquads } from "../../shared/config/player-squads.mjs";
import { repairTacticsLineups } from "../../shared/config/tactics-repair.mjs";
import { normalizeExpeditionPiece } from "../domain/expedition-piece.mjs";

// This is the write side of state requests. Keep the order and individual save
// boundaries: construction, scouting and lineup repair depend on earlier work.
export function maintainCampaignState(campaign, account) {
  if (account.draft && !account.setupComplete && account.draft.version !== DRAFT_VERSION) {
    campaign.drafting.start(account, account.draft.teamName);
  }
  campaign.settleDueChallenges();
  campaign.buildings.settleConstructions(campaign.world);
  const now = campaign.now();
  if (campaign.economyDue(now)) campaign.save();
  campaign.scouting.settle(account, campaign.world);
  const expeditionNormalization = normalizeExpeditionPiece(account, campaign.world, now);
  if (expeditionNormalization.changed) campaign.save();
  const setupComplete = account.setupComplete === true;
  const normalizedPlayerSquads = normalizePlayerSquads(account.playerSquads, account.draft?.roster ?? []);
  if (JSON.stringify(account.playerSquads ?? null) !== JSON.stringify(normalizedPlayerSquads)) {
    account.playerSquads = normalizedPlayerSquads;
    campaign.save();
  }
  const repairedTactics = repairTacticsLineups(account.tactics, account.draft?.roster ?? [], account.playerSquads);
  if (JSON.stringify(repairedTactics) !== JSON.stringify(account.tactics)) {
    account.tactics = repairedTactics;
    campaign.save();
  }
  return {now, setupComplete, normalizedPlayerSquads};
}
