import {
  activateStageWindow,
  deactivateStageWindow,
  registerStageWindow,
} from "./stage-window-manager.js";

export const STANDARD_WINDOW_STANDARD = Object.freeze({
  name: "标准窗口",
  maxWidth: 1600,
  edgeGap: 12,
  mobileEdgeGap: 8,
  singleActive: true,
  escapeCloses: true,
});

export function registerStandardWindow(element, options = {}) {
  registerStageWindow(element, { ...options, kind:"standard" });
}

export const activateStandardWindow = activateStageWindow;
export const deactivateStandardWindow = deactivateStageWindow;
