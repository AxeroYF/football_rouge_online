import { playerCardMarkup, escapePlayerCardHtml as esc } from '../player-card/player-card.js?v=20260906-card-scroll-v1';
import { DRAFT_POOLS } from '../../shared/config/draft.mjs?v=20260906-draft-v3';
import { LINE_LABELS, ROLE_LABELS } from '../../shared/football/labels.js';
import { meteorLayer } from '../ui/meteor-background.js';
import { revealDraftOffer } from './draft-reveal.js?v=20260906-draft-v3';

const PACK_ART = '/assets/player-packs/player-pack-icon-black-v4-cutout.png';
export function draftMarkup(draft, { pending = false, error = '' } = {}) {
  const picked = draft.roster.length, opening = draft.offer.length > 0;
  const counts = '<div class="draft-line-counts" aria-label="已选球员人数">' + Object.entries(DRAFT_POOLS).map(([line, roles]) => {
    const total = roles.reduce((sum, role) => sum + (draft.positionCounts[role] ?? 0), 0);
    return `<section class="draft-line-count" aria-label="${LINE_LABELS[line]} ${total} 人"><div class="draft-line-total"><span>${LINE_LABELS[line]}</span><b>${total}</b></div><div class="draft-position-counts">` + roles.map(role =>
      `<span title="${esc(ROLE_LABELS[role])}" aria-label="${esc(ROLE_LABELS[role])} ${draft.positionCounts[role] ?? 0} 人"><span>${role}</span><b>${draft.positionCounts[role] ?? 0}</b></span>`).join('') + '</div></section>';
  }).join('') + '</div>';
  const pools = '<div class="draft-pools">' + Object.entries(DRAFT_POOLS).map(([pool, roles]) => {
    const available = draft.availablePools.includes(pool);
    return `<button type="button" class="draft-pool" data-draft-pool="${pool}" ${pending || !available ? 'disabled' : ''} aria-label="打开${LINE_LABELS[pool]}球员包"><span class="draft-pool-art" aria-hidden="true"><img src="${PACK_ART}" alt="" draggable="false"><b>${pool}</b></span><strong>${LINE_LABELS[pool]}</strong><span class="draft-pool-roles">${roles.join(' · ')}</span><span class="draft-pool-action">${available ? '打开球员包 →' : '先选门将'}</span></button>`;
  }).join('') + '</div>';
  const offer = '<div class="draft-offer">' + draft.offer.map((player, index) => `<div class="draft-candidate" style="--draft-reveal-index:${index}"><div class="draft-flip"><div class="draft-card-back" aria-hidden="true"></div><div class="draft-card-front">${playerCardMarkup(player, { interactive: true, animated: false, variant: 'standard', action: 'draft-select', ariaPrefix: '选择' })}</div></div></div>`).join('') + '</div>';
  return `<section class="entry-panel draft-panel" aria-busy="${pending}"><header class="draft-header"><h1>${esc(draft.teamName)}</h1><div class="draft-round" aria-label="已选 ${picked} 人，共 ${draft.totalPicks} 人"><b>${picked}</b><span>/ ${draft.totalPicks}</span></div></header><div class="draft-progress" role="progressbar" aria-label="初始选人进度" aria-valuenow="${picked}" aria-valuemin="0" aria-valuemax="${draft.totalPicks}"><i style="width:${picked / draft.totalPicks * 100}%"></i></div>${counts}<div class="draft-title"><h2>${opening ? esc(LINE_LABELS[draft.offerPool] ?? '选择球员') : '选择球员包'}</h2></div>${opening ? offer : pools}<p class="entry-error draft-error" role="status" ${error ? '' : 'hidden'}>${esc(error)}</p></section>`;
}

export function draftBackgroundMarkup() {
  return meteorLayer() + '<div class="draft-content" data-draft-content></div>';
}

export function createDraftController({ root, request, onState, revealFactory = revealDraftOffer, document: doc = globalThis.document }) {
  let view = null, pending = false, revealing = false, error = '', destroyed = false, renderKey = null, reveal = null;
  root.classList.add('is-drafting');
  root.innerHTML = draftBackgroundMarkup();
  const content = root.querySelector('[data-draft-content]');
  function syncControls() {
    if (destroyed) return;
    const busy = pending || revealing;
    content.setAttribute('aria-busy', String(busy));
    content.querySelector('.draft-panel')?.setAttribute('aria-busy', String(busy));
    content.querySelectorAll('button').forEach(button => {
      button.disabled = busy || Boolean(button.dataset.draftPool && !view.availablePools.includes(button.dataset.draftPool));
    });
    const message = content.querySelector('.draft-error');
    if (message) { message.textContent = error; message.hidden = !error; }
  }
  function render(draft = view) {
    if (destroyed) return;
    view = draft;
    const nextKey = JSON.stringify([view.teamName, view.totalPicks, view.roster.map(player => player.id ?? player.playerId),
      view.offerId, view.offerPool, view.offer.map(player => player.id ?? player.playerId), view.positionCounts, view.availablePools]);
    // Busy/error changes keep the same card nodes, images and animation timeline.
    if (nextKey !== renderKey) {
      reveal?.destroy(); reveal = null;
      renderKey = nextKey; revealing = Boolean(view.offer.length);
      content.innerHTML = draftMarkup(view, { pending: pending || revealing, error });
      if (revealing) reveal = revealFactory(content.querySelector('.draft-offer'), () => { revealing = false; syncControls(); });
    }
    syncControls();
  }
  async function submit(path, body) {
    if (pending || revealing || destroyed) return;
    pending = true; error = ''; syncControls();
    try {
      const result = await request(path, { method: 'POST', body });
      if (!destroyed) onState(result.state);
    } catch (failure) {
      if (destroyed) return;
      error = failure.message;
      // A response may have been lost after the server saved the choice or offer.
      try { const current = await request('/api/campaign/state'); if (!destroyed) onState(current.state); } catch { /* Retain the saved offer for retry. */ }
    } finally {
      pending = false;
      if (!destroyed) syncControls();
    }
  }
  function click(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled || pending || revealing || !view) return;
    if (button.dataset.draftPool) return submit('/api/campaign/draft/open', { pool: button.dataset.draftPool, pickNumber: view.pickNumber });
    if (button.dataset.playerCardAction === 'draft-select') return submit('/api/campaign/draft/choose', { playerId: button.dataset.playerCardId, offerId: view.offerId });
  }
  function visibility() { root.classList.toggle('is-motion-paused', Boolean(doc?.hidden)); }
  visibility(); doc?.addEventListener('visibilitychange', visibility);
  root.addEventListener('click', click);
  return { render, destroy() {
    if (destroyed) return;
    destroyed = true; reveal?.destroy(); doc?.removeEventListener('visibilitychange', visibility);
    root.removeEventListener('click', click); root.classList.remove('is-drafting', 'is-motion-paused');
    root.innerHTML = '';
  } };
}
