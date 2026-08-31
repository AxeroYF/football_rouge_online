const registrations = new Map();
const installedDocuments = new WeakSet();
let activeElement = null;

function mapStageFor(element) {
  return element?.closest?.(".map-stage") ?? null;
}

function syncMapStage(element) {
  const stage = mapStageFor(element);
  if (!stage) return;
  const hasOpenWindow = [...registrations.keys()].some((candidate) => (
    mapStageFor(candidate) === stage && candidate.hidden === false
  ));
  stage.classList.toggle("has-stage-window", hasOpenWindow);
}

function requestClose(element, reason = "request") {
  const registration = registrations.get(element);
  if (!registration || element.hidden) return false;
  registration.onRequestClose?.(reason);
  if (!element.hidden) element.hidden = true;
  deactivateStageWindow(element, { restoreFocus:reason !== "superseded" });
  return true;
}

function installDocumentBehavior(documentRef) {
  if (!documentRef || installedDocuments.has(documentRef)) return;
  installedDocuments.add(documentRef);
  documentRef.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.key !== "Escape" || !activeElement) return;
    if (requestClose(activeElement, "escape")) event.preventDefault();
  });
  documentRef.addEventListener("click", (event) => {
    const closeButton = event.target.closest?.("[data-stage-window-close]");
    const stageWindow = closeButton?.closest?.("[data-stage-window]");
    if (stageWindow && !stageWindow.hidden) requestClose(stageWindow, "button");
  });
}

export function registerStageWindow(element, { kind, onRequestClose, documentRef = element?.ownerDocument ?? globalThis.document } = {}) {
  if (!element) throw new TypeError("展示窗口需要有效的根元素");
  registrations.set(element, { kind, onRequestClose, previousFocus:null });
  element.dataset.stageWindow = kind;
  installDocumentBehavior(documentRef);
}

export function activateStageWindow(element) {
  const registration = registrations.get(element);
  if (!registration) throw new Error("展示窗口必须先注册再打开");
  for (const candidate of registrations.keys()) {
    if (candidate !== element && !candidate.hidden) requestClose(candidate, "superseded");
  }
  registration.previousFocus = element.ownerDocument?.activeElement ?? null;
  element.hidden = false;
  element.classList.add("is-stage-window-active");
  element.setAttribute("aria-hidden", "false");
  activeElement = element;
  mapStageFor(element)?.classList.add("has-stage-window");
  queueMicrotask(() => {
    if (activeElement !== element || element.hidden) return;
    element.querySelector("[data-stage-window-initial-focus], [data-stage-window-close], button, input, select, textarea")?.focus?.();
  });
}

export function deactivateStageWindow(element, { restoreFocus = true } = {}) {
  const registration = registrations.get(element);
  element?.classList?.remove("is-stage-window-active");
  element?.setAttribute?.("aria-hidden", "true");
  if (activeElement === element) activeElement = null;
  syncMapStage(element);
  const previousFocus = registration?.previousFocus;
  if (restoreFocus && previousFocus?.isConnected) queueMicrotask(() => previousFocus.focus?.());
}
