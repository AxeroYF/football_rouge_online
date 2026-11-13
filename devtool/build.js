import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncAPlayerProfiles } from "./sync-a-player-profiles.js";
import { syncLegendaryProfiles } from "./sync-legendary-profiles.js";
import { syncXPlayerProfiles } from "./sync-x-player-profiles.js";
import { optimizePlayerProfiles } from "./optimize-player-profiles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminSource = path.resolve(here, "../admin/public");
const adminTarget = path.resolve(here, "../admin/dist");
const versusSource = path.resolve(here, "../versus/public");
const versusTarget = path.resolve(here, "../versus/dist");
const aPlayerProfileTarget = path.join(versusTarget, "A_profile");
const legendaryProfileTarget = path.join(versusTarget, "legendary_profile");
const xPlayerProfileTarget = path.join(versusTarget, "x_profile");
const playerProfileSource = path.resolve(here, "../player_profiles");
const playerProfileTarget = path.join(versusTarget, "player_profiles");

const versusIndex = await readFile(path.join(versusSource, "index.html"), "utf8");
for (const required of ["YFFM1", "styles.css", "app.js"]) {
  if (!versusIndex.includes(required)) throw new Error("versus index.html is missing: " + required);
}
await rm(versusTarget, { recursive: true, force: true });
await mkdir(versusTarget, { recursive: true });
await optimizePlayerProfiles();
// Git includes the runtime WebP assets; original PNGs are optional for builds.
const profileOptions = { requireOriginals:false };
await syncAPlayerProfiles(profileOptions);
await syncLegendaryProfiles(profileOptions);
await syncXPlayerProfiles();
await cp(versusSource, versusTarget, { recursive: true });
await syncAPlayerProfiles({ ...profileOptions, assetTargetDirectory:aPlayerProfileTarget });
await syncLegendaryProfiles({ ...profileOptions, assetTargetDirectory:legendaryProfileTarget });
await syncXPlayerProfiles({ assetTargetDirectory:xPlayerProfileTarget });
await cp(playerProfileSource, playerProfileTarget, { recursive:true }).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
await writeFile(
  path.join(versusTarget, "build-meta.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), product: "YFFM1" }, null, 2) + "\n",
  "utf8",
);

await rm(adminTarget, { recursive: true, force: true });
await mkdir(adminTarget, { recursive: true });
await cp(adminSource, adminTarget, { recursive: true });

console.log("YFFM1 构建完成：versus/dist 与 admin/dist");
