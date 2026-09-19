import { playerCardMarkup } from '../player-card/player-card.js?v=20260905-tactics-cards-v1';

export const TACTICS_DISPLAY_KEY = 'ydl-tactics-piece-display';
const MODES = new Set(['magnets', 'cards']);

export function tacticsCardMarkup(player) {
  return `<div class="league-magnet-card" aria-hidden="true">${playerCardMarkup(player, {
    variant: 'mini', className: 'tactics-shield-card', animated: false,
  })}<svg class="league-card-fit-outline" viewBox="0 0 520 700" aria-hidden="true"><path d="M27 77 63 38 260 8 457 38 493 77V610L456 660 260 693 64 660 27 610Z" fill="none" stroke="currentColor" stroke-width="3"/></svg></div>`;
}

// Presentation preference only: no campaign writes, node replacement or preview reset.
export function createTacticsCardDisplay({ panel, settingsRoot, getPlayer, storage } = {}) {
  try { storage ??= globalThis.localStorage; } catch { storage = null; }
  let mode = 'magnets';
  try {
    const saved = storage?.getItem(TACTICS_DISPLAY_KEY);
    if (MODES.has(saved)) mode = saved;
  } catch { /* Storage may be blocked; the switch still works for this session. */ }

  function apply() {
    for (const button of [panel,settingsRoot].filter(Boolean).flatMap(root=>[...root.querySelectorAll('[data-tactics-piece-display]')])) {
      const selected = button.dataset.tacticsPieceDisplay === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const node of panel.querySelectorAll('[data-league-magnet]')) {
      const player = getPlayer(node.dataset.leagueMagnet);
      const enabled = mode === 'cards' && Boolean(player);
      node.classList.toggle('is-card-mode', enabled);
      const card = node.querySelector('.league-magnet-card');
      if (enabled && !card) node.insertAdjacentHTML('afterbegin', tacticsCardMarkup(player));
      if (!enabled) card?.remove();
    }
  }

  function select(next) {
    if (!MODES.has(next) || mode === next) return;
    mode = next;
    try { storage?.setItem(TACTICS_DISPLAY_KEY, mode); } catch { /* Session fallback. */ }
    apply();
  }

  const markup = () => `<div class="league-piece-display-switcher" role="group" aria-label="场上球员显示方式">${[['magnets', '磁贴'], ['cards', '球员卡']].map(([value, label]) => `<button type="button" data-tactics-piece-display="${value}" aria-pressed="${mode === value}" class="${mode === value ? 'active' : ''}">${label}</button>`).join('')}</div>`;
  if (settingsRoot) {
    settingsRoot.innerHTML = '<span>战术板球员显示</span>' + markup();
    settingsRoot.querySelectorAll('[data-tactics-piece-display]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.tacticsPieceDisplay)));
  }
  return {
    get mode() { return mode; },
    select,
    markup,
    bind() {
      apply();
      for (const button of panel.querySelectorAll('[data-tactics-piece-display]')) {
        button.addEventListener('click', () => select(button.dataset.tacticsPieceDisplay));
      }
    },
  };
}
