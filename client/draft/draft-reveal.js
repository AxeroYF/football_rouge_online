// Decode the three candidates before flipping; bounded waits also handle missing art.
export function revealDraftOffer(offer, onReady, env = globalThis) {
  let stopped = false, finished = false, started = false, frame = null, imageTimer = null, finishTimer = null;
  const flips = [...offer.querySelectorAll('.draft-flip')];
  const images = [...offer.querySelectorAll('img')];
  const clearPending = () => {
    if (frame !== null) env.cancelAnimationFrame(frame);
    env.clearTimeout(imageTimer); env.clearTimeout(finishTimer);
    offer.removeEventListener('animationend', animationEnd);
  };
  function finish() {
    if (stopped || finished) return;
    finished = true; clearPending();
    offer.classList.remove('is-loading', 'is-revealing');
    onReady();
  }
  function animationEnd(event) {
    if (event.animationName === 'draft-flip-reveal' && event.target === flips.at(-1)) finish();
  }
  function start() {
    if (stopped || finished || started) return;
    started = true; env.clearTimeout(imageTimer);
    if (!flips.length) { finish(); return; }
    frame = env.requestAnimationFrame(() => {
      if (stopped || finished) return;
      offer.classList.remove('is-loading'); offer.classList.add('is-revealing');
      offer.addEventListener('animationend', animationEnd);
      finishTimer = env.setTimeout(finish, 700);
    });
  }
  offer.classList.add('is-loading');
  for (const image of images) { image.loading = 'eager'; image.decoding = 'async'; }
  imageTimer = env.setTimeout(start, 350);
  Promise.allSettled(images.map(image => {
    try { return image.decode?.(); } catch { return undefined; }
  })).then(start);
  return { destroy() {
    if (stopped) return;
    stopped = true; clearPending(); offer.classList.remove('is-loading', 'is-revealing');
  } };
}
