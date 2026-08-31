import {
  activateStageWindow,
  deactivateStageWindow,
  registerStageWindow,
} from "./stage-window-manager.js";

export const WIDE_WINDOW_STANDARD = Object.freeze({
  name: "加宽窗口",
  maxWidth: 2180,
  edgeGap: 16,
  mobileEdgeGap: 16,
  singleActive: true,
  escapeCloses: true,
});

export function registerWideWindow(element, options = {}) {
  registerStageWindow(element, { ...options, kind:"wide" });
}

export const activateWideWindow = activateStageWindow;
export const deactivateWideWindow = deactivateStageWindow;
