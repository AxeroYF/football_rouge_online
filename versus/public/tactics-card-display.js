// Adapted from game_test/.worktrees/Rougelite/client/tactics/card-display-controller.js.
// Keep the original node as the drag target, tooltip owner and position anchor.
export function applyTacticsCardDisplay(root, mode, getPlayer, renderCard) {
  if (!root) return;
  for (const node of root.querySelectorAll('#league-tactics-pitch [data-league-magnet]')) {
    const player = mode === 'cards' ? getPlayer(node.dataset.leagueMagnet) : null;
    const enabled = Boolean(player);
    node.classList.toggle('is-card-mode', enabled);
    const existing = node.querySelector(':scope > .league-magnet-card');
    if (enabled && !existing) {
      const overall = Number(node.querySelector(':scope > i')?.textContent);
      const card = renderCard(Number.isFinite(overall) ? {...player, effectiveOverall:overall} : player);
      node.insertAdjacentHTML('afterbegin', `<div class="league-magnet-card" aria-hidden="true">${card}</div>`);
    }
    if (!enabled) existing?.remove();
  }
}
