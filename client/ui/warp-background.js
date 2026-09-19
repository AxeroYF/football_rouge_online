import { createCardMotionState, advanceCardMotion, drawCardMotion } from '../player-card/card-motion-model.js?v=20260905-shield-v1';

// Reuse the existing star-warp simulation with one bounded canvas for the whole opening screen.
export function createWarpBackground(canvas, { document: doc = canvas.ownerDocument, window: win = doc.defaultView } = {}) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return { destroy() {} };
  const state = createCardMotionState('warp', 90633), reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = null, last = null, painted = -Infinity, destroyed = false, pageHidden = false;
  const active = () => !destroyed && !pageHidden && !doc.hidden && canvas.isConnected;
  function paint() {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#050b14'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(canvas.width / 520, 0, 0, canvas.height / 700, 0, 0);
    drawCardMotion(context, state);
  }
  function tick(now) {
    frame = null;
    if (!active() || reduced.matches) return;
    advanceCardMotion(state, last === null ? 0 : (now - last) / 1000); last = now;
    if (now - painted >= 1000 / 30) { paint(); painted = now; }
    frame = win.requestAnimationFrame(tick);
  }
  function sync() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null; last = null;
    if (!active()) return;
    paint();
    if (!reduced.matches) frame = win.requestAnimationFrame(tick);
  }
  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(win.devicePixelRatio || 1, 1.25, 1280 / Math.max(1, rect.width), 900 / Math.max(1, rect.height));
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    sync();
  }
  const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
  observer?.observe(canvas); win.addEventListener('resize', resize);
  const hide = () => { pageHidden = true; sync(); }, show = () => { pageHidden = false; sync(); };
  doc.addEventListener('visibilitychange', sync); reduced.addEventListener('change', sync);
  win.addEventListener('pagehide', hide); win.addEventListener('pageshow', show); resize();
  return { destroy() {
    destroyed = true; sync(); observer?.disconnect(); win.removeEventListener('resize', resize);
    doc.removeEventListener('visibilitychange', sync); reduced.removeEventListener('change', sync);
    win.removeEventListener('pagehide', hide); win.removeEventListener('pageshow', show);
    canvas.width = 1; canvas.height = 1;
  } };
}
