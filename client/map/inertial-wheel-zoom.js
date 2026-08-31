const DEFAULT_FRICTION = 9;
const DEFAULT_PIXELS_PER_ZOOM = 240;
const DEFAULT_MAX_VELOCITY = 6.25;
const DEFAULT_MIN_VELOCITY = 0.025;
const MAX_FRAME_SECONDS = 0.05;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeWheelPixels(event, pageHeight = 800) {
  const delta = Number(event?.deltaY ?? 0);
  if (!Number.isFinite(delta)) return 0;
  if (event?.deltaMode === 1) return delta * 16;
  if (event?.deltaMode === 2) return delta * Math.max(1, Number(pageHeight) || 800);
  return delta;
}

export function addWheelImpulse(
  velocity,
  wheelPixels,
  {
    friction = DEFAULT_FRICTION,
    pixelsPerZoom = DEFAULT_PIXELS_PER_ZOOM,
    maxVelocity = DEFAULT_MAX_VELOCITY,
  } = {},
) {
  const currentVelocity = Number.isFinite(velocity) ? velocity : 0;
  const distance = -wheelPixels / Math.max(1, pixelsPerZoom);
  const impulse = distance * Math.max(0.01, friction);
  const retainedVelocity = currentVelocity && Math.sign(currentVelocity) !== Math.sign(impulse)
    ? currentVelocity * 0.35
    : currentVelocity;
  return clamp(retainedVelocity + impulse, -Math.abs(maxVelocity), Math.abs(maxVelocity));
}

export function advanceInertialZoom({
  zoom,
  velocity,
  elapsedSeconds,
  minZoom,
  maxZoom,
  friction = DEFAULT_FRICTION,
}) {
  const duration = clamp(Number(elapsedSeconds) || 0, 0, MAX_FRAME_SECONDS);
  const decay = Math.exp(-Math.max(0.01, friction) * duration);
  const zoomDelta = velocity * (1 - decay) / Math.max(0.01, friction);
  const nextZoom = clamp(zoom + zoomDelta, minZoom, maxZoom);
  const hitLimit = (nextZoom <= minZoom && velocity < 0) || (nextZoom >= maxZoom && velocity > 0);
  return {
    zoom: nextZoom,
    velocity: hitLimit ? 0 : velocity * decay,
  };
}

export function createInertialWheelZoom({
  map,
  element,
  friction = DEFAULT_FRICTION,
  pixelsPerZoom = DEFAULT_PIXELS_PER_ZOOM,
  maxVelocity = DEFAULT_MAX_VELOCITY,
  minVelocity = DEFAULT_MIN_VELOCITY,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!map || !element) throw new TypeError("map and element are required");
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("animation frame support is required");
  }

  let active = false;
  let frameId = null;
  let lastFrameTime = 0;
  let velocity = 0;
  let anchorPoint = null;
  let anchorLatLng = null;
  let startZoom = map.getZoom();

  map.scrollWheelZoom?.disable?.();

  function centerAroundAnchor(zoom) {
    const offset = anchorPoint.subtract(map.getSize().divideBy(2));
    let center = map.unproject(map.project(anchorLatLng, zoom).subtract(offset), zoom);
    if (map.options.maxBounds && typeof map._limitCenter === "function") {
      center = map._limitCenter(center, zoom, map.options.maxBounds);
    }
    return center;
  }

  function settle() {
    if (!active) return;
    active = false;
    velocity = 0;
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;

    // `_move` has already committed every continuous frame. Starting another
    // `_animateZoom` here replays the final fraction as a CSS transition,
    // causing a visible flash and backwards snap. Only close the move lifecycle.
    map._moveEnd(map.getZoom() !== startZoom);
  }

  function scheduleFrame() {
    if (frameId === null) frameId = requestFrame(step);
  }

  function step(timestamp) {
    frameId = null;
    if (!active) return;
    const frameTime = Number.isFinite(timestamp) ? timestamp : now();
    const elapsedSeconds = Math.max(0.001, (frameTime - lastFrameTime) / 1000);
    lastFrameTime = frameTime;
    const next = advanceInertialZoom({
      zoom: map.getZoom(),
      velocity,
      elapsedSeconds,
      minZoom: map.getMinZoom(),
      maxZoom: map.getMaxZoom(),
      friction,
    });
    velocity = next.velocity;

    if (next.zoom !== map.getZoom()) {
      map._move(centerAroundAnchor(next.zoom), next.zoom, { pinch: true, round: false });
    }
    if (Math.abs(velocity) <= minVelocity) {
      settle();
      return;
    }
    scheduleFrame();
  }

  function start() {
    if (active) return;
    active = true;
    startZoom = map.getZoom();
    lastFrameTime = now();
    map._stop?.();
    map._moveStart(true, false);
    scheduleFrame();
  }

  function onWheel(event) {
    const wheelPixels = normalizeWheelPixels(event, element.clientHeight);
    if (!wheelPixels) return;
    event.preventDefault();
    anchorPoint = map.mouseEventToContainerPoint(event);
    anchorLatLng = map.containerPointToLatLng(anchorPoint);
    velocity = addWheelImpulse(velocity, wheelPixels, { friction, pixelsPerZoom, maxVelocity });
    start();
  }

  function onPointerDown() {
    settle();
  }

  function destroy() {
    settle();
    element.removeEventListener("wheel", onWheel);
    element.removeEventListener("pointerdown", onPointerDown, true);
  }

  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("pointerdown", onPointerDown, true);

  return {
    destroy,
    isActive: () => active,
  };
}
