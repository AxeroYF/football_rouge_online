import test from "node:test";
import assert from "node:assert/strict";
import { playTradeUpReveal } from "../client/cards/card-trade-up-animation.js";

function element() {
  const classes = new Set(["is-animating"]), events = new Map(), attrs = new Map();
  return { inert: true, hidden: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    addEventListener(type, callback) { events.set(type, callback); }, removeEventListener(type) { events.delete(type); },
    fire(type, event) { events.get(type)?.(event); },
    setAttribute(name, value) { attrs.set(name, value); }, getAttribute: name => attrs.get(name),
  };
}
function fixture(reduced = false) {
  const stage = element(), result = element(), status = element(), motion = element(), button = element();
  const timers = new Map(); let reveals = 0, closes = 0;
  motion.matches = reduced; button.textContent = "返回"; button.onclick = () => closes++;
  const dialog = { isConnected: true, ownerDocument: { defaultView: {
    matchMedia: () => motion, setTimeout(callback, delay) { timers.set(1, { callback, delay }); return 1; }, clearTimeout: id => timers.delete(id),
  } }, querySelector: selector => ({ "[data-cmu-reveal]": stage, "[data-cmu-reveal-result]": result, "[data-cmu-reveal-status]": status, "footer [data-cm-dialog-close]": button })[selector] };
  const cleanup = playTradeUpReveal(dialog, () => reveals++);
  return { stage, result, status, motion, button, timers, dialog, cleanup, reveals: () => reveals, closes: () => closes };
}
test("trade-up reveals only after the result animation ends, and then restores the close action", () => {
  const f = fixture(); assert.equal(f.reveals(), 0); assert.equal(f.button.textContent, "跳过动画");
  f.stage.fire("animationend", { target: f.stage, animationName: "cmu-material-merge" }); assert.equal(f.reveals(), 0);
  f.stage.fire("animationend", { target: f.result, animationName: "cmu-reveal-card" });
  assert.equal(f.reveals(), 1); assert.equal(f.result.inert, false); assert.equal(f.result.getAttribute("aria-hidden"), "false");
  assert.equal(f.stage.classList.contains("is-revealed"), true); assert.equal(f.status.hidden, true); assert.equal(f.timers.size, 0);
  assert.equal(f.button.textContent, "返回"); f.button.onclick(); assert.equal(f.closes(), 1);
});
test("skipping reveals once without closing or performing any new mutation", () => {
  const f = fixture(), skip = f.button.onclick; skip(); skip();
  assert.equal(f.reveals(), 1); assert.equal(f.closes(), 0); assert.equal(f.timers.size, 0);
});
test("reduced motion reveals immediately and can also interrupt an in-progress animation", () => {
  const reduced = fixture(true); assert.equal(reduced.reveals(), 1); assert.equal(reduced.timers.size, 0);
  const active = fixture(); active.motion.fire("change", { matches: true });
  assert.equal(active.reveals(), 1); assert.equal(active.timers.size, 0);
});
test("a missing animationend event still reveals within the bounded fallback", () => {
  const f = fixture(), timer = f.timers.get(1); assert.equal(timer.delay, 2200);
  timer.callback(); assert.equal(f.reveals(), 1); assert.equal(f.timers.size, 0);
});
test("closing or switching accounts cancels timers and prevents stale reveal callbacks", () => {
  const f = fixture(), lateTimer = f.timers.get(1).callback, lateSkip = f.button.onclick;
  f.cleanup(); f.dialog.isConnected = false; lateTimer(); lateSkip();
  f.stage.fire("animationend", { target: f.result, animationName: "cmu-reveal-card" });
  assert.equal(f.reveals(), 0); assert.equal(f.timers.size, 0); assert.equal(f.button.textContent, "返回");
});
