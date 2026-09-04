import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STANDARD_WINDOW_STANDARD } from "../client/ui/standard-window.js";
import { WIDE_WINDOW_STANDARD } from "../client/ui/wide-window.js";
import { SMALL_WINDOW_STANDARD } from "../client/ui/small-window.js";

test("标准窗口采用球队管理与电视台的展示尺寸", () => {
  assert.deepEqual(STANDARD_WINDOW_STANDARD, {
    name:"标准窗口",
    maxWidth:1600,
    edgeGap:12,
    mobileEdgeGap:8,
    singleActive:true,
    escapeCloses:true,
  });
});

test("加宽窗口采用战术板的现有展示尺寸", () => {
  assert.deepEqual(WIDE_WINDOW_STANDARD, {
    name:"加宽窗口",
    maxWidth:2180,
    edgeGap:16,
    mobileEdgeGap:16,
    singleActive:true,
    escapeCloses:true,
  });
});

test("小型窗口采用26项球员详情的标准展示尺寸和模态逻辑", () => {
  assert.deepEqual(SMALL_WINDOW_STANDARD, {
    name:"小型窗口",
    maxWidth:1180,
    desktopHeight:820,
    desktopEdgeGap:24,
    compactEdgeGap:10,
    mobileEdgeGap:0,
    escapeCloses:true,
    backdropCloses:true,
    modal:true,
  });
  const css = readFileSync(new URL("../styles/small-window.css", import.meta.url), "utf8");
  assert.match(css,/--small-window-height:820px/);
  assert.match(css,/height:min\(var\(--small-window-height\),calc\(100% - 8px\)\)/);
});

test("球队、电视台、YOOGLE、战术板与26项详情分别接入三级标准", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const team = readFileSync(new URL("../client/team/team-controller-ydl.js", import.meta.url), "utf8");
  const tactics = readFileSync(new URL("../tactics-page.js", import.meta.url), "utf8");
  const broadcast = readFileSync(new URL("../campaign-broadcast.js", import.meta.url), "utf8");
  assert.match(html, /data-standard-window="team"/);
  assert.match(html, /data-standard-window="broadcast"/);
  assert.match(html, /data-standard-window="yoogle"/);
  assert.match(html, /data-small-window="inventory"/);
  assert.doesNotMatch(html, /data-standard-window="inventory"/);
  assert.match(html, /data-wide-window="tactics"/);
  assert.match(tactics, /registerWideWindow/);
  assert.doesNotMatch(tactics, /small-window|SmallWindow/);
  assert.match(team, /registerStandardWindow/);
  assert.match(team, /bindSmallWindow/);
  assert.match(html, /inventory-window small-window/);
  assert.match(broadcast, /registerStandardWindow/);
});

test("电视台标准窗口内容层占满可用宽度后再由1600px画面居中", () => {
  const css = readFileSync(new URL("../styles/standard-window.css", import.meta.url), "utf8");
  assert.match(css,/\.standard-window>\.broadcast-v2-content\{width:100%!important;max-width:none!important\}/);
  assert.match(css,/\.standard-window \.broadcast-screen[\s\S]*width:min\(var\(--standard-window-max-width\),100%\)!important/);
});
