// Adapted from Rougelite 0bdeaa8: bounded reveal, in-place claims and scene cleanup.
const MOTION_STORAGE_KEY = 'yffm1_pack_opening_motion_v1';

function normalizeMotionPreference(value) {
  return ['on', 'off'].includes(value) ? value : 'system';
}

export function createPackOpeningEffects(root, env = root.ownerDocument.defaultView, settings = null) {
  const doc = root.ownerDocument;
  const motion = env.matchMedia('(prefers-reduced-motion: reduce)');
  let motionPreference = 'system';
  try { motionPreference = normalizeMotionPreference(env.localStorage?.getItem(MOTION_STORAGE_KEY)); } catch { /* Storage is optional. */ }
  if (settings) motionPreference = normalizeMotionPreference(settings.value.packMotion);
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
  function reducedMotion() {
    return motionPreference === 'off' || motionPreference === 'system' && motion.matches;
  }
  function motionStatus() {
    return motionPreference === 'system' ? (motion.matches ? '系统已关闭动画' : '系统已开启动画') : motionPreference === 'on' ? '动画已开启' : '动画已关闭';
  }
  function motionControlMarkup() {
    return `<label class="pack-opening-motion"><span>开包动画</span><select data-pack-opening-motion aria-label="开包动画"><option value="system" ${motionPreference === 'system' ? 'selected' : ''}>跟随系统</option><option value="on" ${motionPreference === 'on' ? 'selected' : ''}>开启</option><option value="off" ${motionPreference === 'off' ? 'selected' : ''}>关闭</option></select><small data-pack-opening-motion-status role="status">${motionStatus()}</small></label>`;
  }
  function syncMotion() {
    const wasDisabled = root.dataset.packMotionActive === 'false';
    const disabled = reducedMotion();
    root.dataset.packMotionActive = String(!disabled);
    root.classList.toggle('is-motion-paused', doc.hidden || disabled);
    const select = root.querySelector('[data-pack-opening-motion]');
    if (select) select.value = motionPreference;
    const status = root.querySelector('[data-pack-opening-motion-status]');
    if (status) status.textContent = motionStatus();
    if (doc.hidden || disabled) { ++epoch; finishReveal(); }
    else if (wasDisabled && !pending && !claimed) reveal();
  }
  function changeMotion(event) {
    if (!event.target.matches?.('[data-pack-opening-motion]')) return;
    motionPreference = normalizeMotionPreference(event.target.value);
    if (settings) { settings.update({ packMotion:motionPreference }); return; }
    try { env.localStorage?.setItem(MOTION_STORAGE_KEY, motionPreference); } catch { /* Keep this scene usable without storage. */ }
    syncMotion();
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
    if (!candidates.length || reducedMotion() || doc.hidden) { finishReveal(); return; }
    root.classList.add('is-preparing');
    let started = false;
    function start() {
      if (destroyed || current !== epoch || started) return;
      if (doc.hidden || reducedMotion()) { finishReveal(); return; }
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
  root.addEventListener('change', changeMotion);
  doc.addEventListener('visibilitychange', syncMotion);
  motion.addEventListener('change', syncMotion);
  const unsubscribeSettings = settings?.subscribe(value => { motionPreference = normalizeMotionPreference(value.packMotion); syncMotion(); });
  syncMotion();
  return {
    root, reveal, select, resetSelection, confirm, motionControlMarkup,
    get motionPreference() { return motionPreference; },
    get busy() { return pending; },
    get selectedPlayerId() { return selectedId; },
    destroy() {
      if (destroyed) return;
      destroyed = true; ++epoch; clearPending();
      root.removeEventListener('animationend', animationEnd);
      root.removeEventListener('change', changeMotion);
      doc.removeEventListener('visibilitychange', syncMotion);
      motion.removeEventListener('change', syncMotion);
      unsubscribeSettings?.();
      originalDisabled.clear(); originalStatus.clear();
    },
  };
}
