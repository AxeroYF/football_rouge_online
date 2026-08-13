import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncAPlayerProfiles } from "./sync-a-player-profiles.js";
import { syncLegendaryProfiles } from "./sync-legendary-profiles.js";
import { syncXPlayerProfiles } from "./sync-x-player-profiles.js";
import { optimizePlayerProfiles } from "./optimize-player-profiles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "public");
const target = path.join(here, "dist");
const gameSource = path.resolve(here, "../game/public");
const gameTarget = path.resolve(here, "../game/dist");
const versusSource = path.resolve(here, "../versus/public");
const versusTarget = path.resolve(here, "../versus/dist");
const aPlayerProfileTarget = path.join(versusTarget, "A_profile");
const legendaryProfileTarget = path.join(versusTarget, "legendary_profile");
const xPlayerProfileTarget = path.join(versusTarget, "x_profile");
const playerProfileSource = path.resolve(here, "../player_profiles");
const playerProfileTarget = path.join(versusTarget, "player_profiles");

const index = await readFile(path.join(source, "index.html"), "utf8");
for (const required of ["styles.css", "app.js", "场边实验室"]) {
  if (!index.includes(required)) throw new Error("index.html is missing: " + required);
}

const gameIndex = await readFile(path.join(gameSource, "index.html"), "utf8");
for (const required of ["冠军之路", "styles.css", "game.js"]) {
  if (!gameIndex.includes(required)) throw new Error("game index.html is missing: " + required);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await writeFile(
  path.join(target, "build-meta.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), localOnly: true }, null, 2) + "\n",
  "utf8",
);

await rm(gameTarget, { recursive: true, force: true });
await mkdir(gameTarget, { recursive: true });
await cp(gameSource, gameTarget, { recursive: true });
await writeFile(
  path.join(gameTarget, "build-meta.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), prototype: true }, null, 2) + "\n",
  "utf8",
);

const versusIndex = await readFile(path.join(versusSource, "index.html"), "utf8");
for (const required of ["黄狗模拟经理", "styles.css", "app.js"]) {
  if (!versusIndex.includes(required)) throw new Error("versus index.html is missing: " + required);
}
await rm(versusTarget, { recursive: true, force: true });
await mkdir(versusTarget, { recursive: true });
await optimizePlayerProfiles();
await syncAPlayerProfiles();
await syncLegendaryProfiles();
await syncXPlayerProfiles();
await cp(versusSource, versusTarget, { recursive: true });
await syncAPlayerProfiles({ assetTargetDirectory:aPlayerProfileTarget });
await syncLegendaryProfiles({ assetTargetDirectory:legendaryProfileTarget });
await syncXPlayerProfiles({ assetTargetDirectory:xPlayerProfileTarget });
await cp(playerProfileSource, playerProfileTarget, { recursive:true }).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
await writeFile(
  path.join(versusTarget, "build-meta.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), prototype: true }, null, 2) + "\n",
  "utf8",
);

console.log("构建完成：devtool/dist、game/dist 与 versus/dist");
