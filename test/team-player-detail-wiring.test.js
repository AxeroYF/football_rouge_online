import {teamPlayerDetailMarkup} from "../client/team/team-controller-ydl.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

test("campaign loads the YDL team controller and player detail stylesheet", () => {
  assert.match(read("app.js"), /team-controller-ydl\.js/);
  assert.match(read("index.html"), /styles\/team-player-detail\.css(?:\?v=[^" ]+)?/);
});

test("team detail uses the shared accessible card dialog", () => {
  const player={id:"review",playerId:"review",name:"测试球员",role:"ST",overall:80,attributes:{finishing:85}};
  const html=teamPlayerDetailMarkup(player);
  assert.match(html,/role="dialog"/);assert.match(html,/aria-modal="true"/);
  assert.match(html,/测试球员/);assert.match(html,/data-small-window-close/);
  const source=read("client/team/team-controller-ydl.js");
  assert.match(source,/data-player-card-action="team-detail"/);assert.match(source,/bindSmallWindow/);
});

test("detail stylesheet provides desktop and mobile attribute grids", () => {
  const source = read("styles/team-player-detail.css");
  assert.match(source, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(source, /@media\(max-width:650px\)/);
  assert.match(source, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /\.team-player-attributes dl>div\.core/);
});
