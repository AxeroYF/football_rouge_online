import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function update(relative, before, after) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (!source.includes(before)) throw new Error(`无法定位接入点：${relative}`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, source.replace(before, after));
  fs.renameSync(temporary, file);
}
update(
  "app.js",
  'import { createTeamController } from "./client/team/team-controller.js?v=20260830-team-s4-cards-v3";',
  'import { createTeamController } from "./client/team/team-controller-ydl.js?v=20260830-ydl-player-detail-v1";',
);
update(
  "index.html",
  '    <link rel="stylesheet" href="./styles/player-card.css?v=20260828-local" />',
  '    <link rel="stylesheet" href="./styles/player-card.css?v=20260828-local" />\n    <link rel="stylesheet" href="./styles/team-player-detail.css?v=20260830-ydl-player-detail-v1" />',
);
