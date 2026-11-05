// Adapted from Rougelite 0bdeaa8: bounded reveal, in-place claims and scene cleanup.
export function createPackOpeningEffects(root, env = root.ownerDocument.defaultView) {
  const doc = root.ownerDocument;
  const motion = env.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = null, decodeTimer = null, finishTimer = null, epoch = 0;
  let destroyed = false, pending = false, claimed = false, selectedId = null;
  let originalDisabled = new Map(), originalStatus = new Map();
  const cards = () => [...root.querySelectorAll('.inventory-choice-card')];
  function clearPending() {
    if (frame !== null) env.cancelAnimationFrame(frame);
    env.clearTimeout(decodeTimer); env.clearTimeout(finishTimer);
    frame = decodeTimer = finishTimer = null;
  }
  function finishReveal() {
    clearPending();
    root.classList.remove('is-preparing');
    for (const card of cards()) {
      card.classList.remove('is-revealing');
      card.classList.add('is-revealed');
    }
  }
  function syncMotion() {
    root.classList.toggle('is-motion-paused', doc.hidden || motion.matches);
    if (doc.hidden || motion.matches) { ++epoch; finishReveal(); }
  }
  function animationEnd(event) {
    const revealing = root.querySelectorAll('.inventory-choice-card.is-revealing');
    if (event.animationName === 'inventory-card-reveal' && event.target === revealing[revealing.length - 1]) finishReveal();
  }
  function reveal() {
    if (destroyed) return;
    const current = ++epoch;
    clearPending(); pending = claimed = false; selectedId = null;
    root.setAttribute('aria-busy', 'false');
    delete root.dataset.packOpeningComplete;
    originalDisabled = new Map(); originalStatus = new Map();
    const candidates = cards();
    for (const card of candidates) {
      card.classList.remove('is-pack-selected', 'is-pack-muted', 'is-revealing');
      card.classList.add('is-revealed');
      const button = card.querySelector('[data-s4-pack-choice]');
      if (button) originalDisabled.set(button, button.disabled);
      const status = card.querySelector('.inventory-owned-status');
      if (status) originalStatus.set(status, status.textContent);
    }
    if (!candidates.length || motion.matches || doc.hidden) { finishReveal(); syncMotion(); return; }
    root.classList.add('is-preparing');
    let started = false;
    function start() {
      if (destroyed || current !== epoch || started) return;
      if (doc.hidden || motion.matches) { finishReveal(); return; }
      started = true; env.clearTimeout(decodeTimer);
      frame = env.requestAnimationFrame(() => {
        frame = null;
        if (destroyed || current !== epoch) return;
        root.classList.remove('is-preparing');
        // Large designated pools stay usable without animating every offscreen card.
        const animated = candidates.slice(0, 6);
        animated.forEach((card, index) => {
          card.style.setProperty('--reveal-index', index);
          card.classList.remove('is-revealed'); card.classList.add('is-revealing');
        });
        finishTimer = env.setTimeout(finishReveal, 1080 + (animated.length - 1) * 180);
      });
    }
    const images = candidates.slice(0, 6).flatMap(card => [...card.querySelectorAll('img')]);
    for (const image of images) { image.loading = 'eager'; image.decoding = 'async'; }
    decodeTimer = env.setTimeout(start, 350);
    Promise.allSettled(images.map(image => { try { return image.decode?.(); } catch { return undefined; } })).then(start);
  }
  function select(playerId) {
    if (destroyed || pending || claimed || !root.isConnected) return false;
    const candidates = cards();
    if (!candidates.some(card => card.dataset.packPlayerId === String(playerId))) return false;
    ++epoch; finishReveal(); pending = true; selectedId = String(playerId);
    for (const card of candidates) {
      const selected = card.dataset.packPlayerId === selectedId;
      card.classList.toggle('is-pack-selected', selected);
      card.classList.toggle('is-pack-muted', !selected);
      const button = card.querySelector('[data-s4-pack-choice]');
      if (button) { button.disabled = true; button.setAttribute('aria-pressed', String(selected)); }
      if (selected) { const status = card.querySelector('.inventory-owned-status'); if (status) status.textContent = '领取中…'; }
    }
    root.setAttribute('aria-busy', 'true');
    return true;
  }
  function resetSelection() {
    if (destroyed || claimed) return;
    pending = false; selectedId = null;
    for (const card of cards()) card.classList.remove('is-pack-selected', 'is-pack-muted');
    for (const [button, disabled] of originalDisabled) { button.disabled = disabled; button.removeAttribute('aria-pressed'); }
    for (const [status, text] of originalStatus) status.textContent = text;
    root.setAttribute('aria-busy', 'false');
  }
  function confirm() {
    if (destroyed) return null;
    pending = false; claimed = true; root.dataset.packOpeningComplete = 'true';
    root.setAttribute('aria-busy', 'false');
    const card = cards().find(item => item.dataset.packPlayerId === selectedId);
    const status = card?.querySelector('.inventory-owned-status');
    if (status) status.textContent = '已获得';
    return card?.querySelector('.s4-player-card') ?? null;
  }
  root.addEventListener('animationend', animationEnd);
  doc.addEventListener('visibilitychange', syncMotion);
  motion.addEventListener('change', syncMotion);
  syncMotion();
  return {
    root, reveal, select, resetSelection, confirm,
    get busy() { return pending; },
    get selectedPlayerId() { return selectedId; },
    destroy() {
      if (destroyed) return;
      destroyed = true; ++epoch; clearPending();
      root.removeEventListener('animationend', animationEnd);
      doc.removeEventListener('visibilitychange', syncMotion);
      motion.removeEventListener('change', syncMotion);
      originalDisabled.clear(); originalStatus.clear();
    },
  };
}
