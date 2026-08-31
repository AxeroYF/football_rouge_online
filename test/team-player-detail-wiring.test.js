import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

test("campaign loads the YDL team controller and player detail stylesheet", () => {
  assert.match(read("app.js"), /team-controller-ydl\.js\?v=20260830-ydl-player-detail-v1/);
  assert.match(read("index.html"), /styles\/team-player-detail\.css\?v=20260830-ydl-player-detail-v1/);
});

test("team cards open an accessible detail dialog with close and Escape handling", () => {
  const source = read("client/team/team-controller-ydl.js");
  assert.match(source, /data-team-player-detail=/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /querySelectorAll\("\[data-team-player-detail\]"\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /effectiveAttributes \?\? player\.displayAttributes/);
});

test("detail stylesheet provides desktop and mobile attribute grids", () => {
  const source = read("styles/team-player-detail.css");
  assert.match(source, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(source, /@media\(max-width:650px\)/);
  assert.match(source, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /\.team-player-attributes dl>div\.core/);
});
