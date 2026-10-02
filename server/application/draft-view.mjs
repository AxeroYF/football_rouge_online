import {LINE_KEYS, hasCurrentDraftOffer, availableDraftPools, draftPositionCounts, draftTargetSize} from '../../shared/config/draft.mjs';
import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';

export function rosterCounts(roster) {
  return Object.fromEntries(LINE_KEYS.map((line) => [line, roster.filter((player) => player.pool === line).length]));
}

export function publicDraft(account) {
  const draft = account.draft;
  if (!draft) return null;
  const playerWithCard = (player) => ({ ...player, card:createPlayerCardViewModel(player) });
  return {
    teamName: draft.teamName,
    roster: draft.roster.map(playerWithCard),
    offer: (hasCurrentDraftOffer(draft) ? draft.offer : []).map(playerWithCard),
    offerId: hasCurrentDraftOffer(draft) ? draft.offerId : null,
    offerPool: hasCurrentDraftOffer(draft) ? draft.offerPool : null,
    availablePools: account.setupComplete ? [] : availableDraftPools(draft),
    positionCounts: draftPositionCounts(draft.roster),
    pickNumber: draft.roster.length + (account.setupComplete ? 0 : 1),
    totalPicks: account.setupComplete ? draft.totalPicks ?? 22 : draftTargetSize(draft),
    counts: rosterCounts(draft.roster),
    complete: account.setupComplete === true,
  };
}
