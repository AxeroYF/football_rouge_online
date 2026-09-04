export const SMALL_WINDOW_STANDARD = Object.freeze({
  name: "小型窗口",
  maxWidth: 1180,
  desktopHeight: 820,
  desktopEdgeGap: 24,
  compactEdgeGap: 10,
  mobileEdgeGap: 0,
  escapeCloses: true,
  backdropCloses: true,
  modal: true,
});

export function bindSmallWindow(overlay, { onRequestClose } = {}) {
  if (!overlay) return () => {};
  const dialog = overlay.querySelector("[data-small-window-dialog], [data-team-player-dialog], .small-window__dialog, .team-player-detail-dialog");
  if (!dialog) throw new TypeError("小型窗口缺少对话框内容层");
  overlay.classList.add("small-window");
  overlay.dataset.smallWindow = overlay.dataset.smallWindow || "small-window";
  dialog.classList.add("small-window__dialog");
  dialog.dataset.smallWindowDialog = "";
  dialog.setAttribute("role", dialog.getAttribute("role") || "dialog");
  dialog.setAttribute("aria-modal", "true");

  const requestClose = (reason) => {
    onRequestClose?.(reason);
  };
  const clickHandler = (event) => {
    const closeButton = event.target.closest?.("[data-small-window-close], [data-team-detail-close]");
    if (closeButton || event.target === overlay) requestClose(closeButton ? "button" : "backdrop");
  };
  const keyHandler = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    requestClose("escape");
  };
  overlay.addEventListener("click", clickHandler);
  dialog.addEventListener("keydown", keyHandler);
  queueMicrotask(() => dialog.focus?.());
  return () => {
    overlay.removeEventListener("click", clickHandler);
    dialog.removeEventListener("keydown", keyHandler);
  };
}
