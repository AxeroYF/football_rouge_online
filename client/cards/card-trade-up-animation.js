// Presentation only: called after the server has committed the trade-up.
export function playTradeUpReveal(dialog, onReveal = () => {}) {
  const stage = dialog.querySelector("[data-cmu-reveal]"), result = dialog.querySelector("[data-cmu-reveal-result]");
  if (!stage || !result) { onReveal(); return () => {}; }
  const status = dialog.querySelector("[data-cmu-reveal-status]");
  const button = dialog.querySelector("footer [data-cm-dialog-close]");
  const window = dialog.ownerDocument.defaultView;
  const motion = window?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const originalClick = button?.onclick, originalText = button?.textContent;
  let done = false, disposed = false, timer = null;
  const clean = () => {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
    stage.removeEventListener?.("animationend", ended);
    motion?.removeEventListener?.("change", motionChanged);
    if (button) { button.onclick = originalClick; button.textContent = originalText; }
  };
  const reveal = () => {
    if (done || disposed || !dialog.isConnected) return;
    done = true; clean();
    stage.classList.remove("is-animating"); stage.classList.add("is-revealed");
    stage.setAttribute("aria-busy", "false");
    result.setAttribute("aria-hidden", "false"); result.inert = false;
    if (status) status.hidden = true;
    onReveal();
  };
  const ended = event => { if (event.target === result && event.animationName === "cmu-reveal-card") reveal(); };
  const motionChanged = event => { if (event.matches) reveal(); };
  if (!window?.setTimeout || !motion || motion.matches) reveal();
  else {
    if (button) { button.textContent = "跳过动画"; button.onclick = reveal; }
    stage.addEventListener("animationend", ended);
    motion.addEventListener?.("change", motionChanged);
    // A fallback covers interrupted or disabled CSS animations without blocking the result.
    timer = window.setTimeout(reveal, 2200);
  }
  return () => { disposed = true; clean(); };
}
