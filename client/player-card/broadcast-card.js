import { playerCardMarkup, createPlayerCardViewModel, escapePlayerCardHtml as esc } from './player-card.js?v=20260905-tactics-cards-v1';

export function broadcastCardFace(player) {
  const card = createPlayerCardViewModel(player);
  const key = JSON.stringify([player.broadcastTeamIndex ?? 0, player.id ?? card.playerId]);
  // Match fitness/rating/events live outside the face and must not invalidate it.
  const signature = JSON.stringify([card.playerId, card.name, card.sourceName, card.grade,
    card.role, card.overall, card.upgradeLevel, card.nationality, card.club, card.art, card.traits]);
  return `<div class="broadcast-card-face" data-broadcast-card-key="${esc(key)}" data-broadcast-card-signature="${esc(signature)}" aria-hidden="true">${playerCardMarkup(player, {variant:'mini',className:'broadcast-shield-card',animated:false})}<svg class="broadcast-card-team-rim" viewBox="0 0 520 700" aria-hidden="true"><path d="M27 77 63 38 260 8 457 38 493 77V610L456 660 260 693 64 660 27 610Z" fill="none" stroke="currentColor" stroke-width="9"/></svg></div>`;
}

export function captureBroadcastCardFaces(root) {
  return new Map([...root.querySelectorAll('[data-broadcast-card-key]')].map(node => [node.dataset.broadcastCardKey, node]));
}

export function restoreBroadcastCardFaces(root, previous) {
  for (const next of root.querySelectorAll('[data-broadcast-card-key]')) {
    const old = previous.get(next.dataset.broadcastCardKey);
    if (old && old.dataset.broadcastCardSignature === next.dataset.broadcastCardSignature) next.replaceWith(old);
  }
}
