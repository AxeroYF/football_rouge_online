import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncPlayerProfiles } from "./sync-player-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseCatalogPath = path.join(root, "assets", "data", "s4-player-base-catalog.json");
const productionOverridesPath = path.join(root, "assets", "data", "s4-production-content-overrides.json");
const baseCatalog = JSON.parse(await fs.readFile(baseCatalogPath, "utf8"));
const productionOverrides = JSON.parse((await fs.readFile(productionOverridesPath, "utf8")).replace(/^\uFEFF/, ""));

const poolForRole = (role) => role === "GK" ? "GK"
  : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF"
    : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";

function productionPlayer(player) {
  const storedPatch = productionOverrides.players?.[player.id]
    ?? (player.id === "legend-messi-rat" ? productionOverrides.players?.["legend-messi"] : null);
  if (!storedPatch) return player;
  const patch = player.id === "legend-messi-rat" ? { ...storedPatch, name:"梅老鼠" } : storedPatch;
  const attributes = patch.attributes ? { ...player.attributes, ...patch.attributes } : { ...player.attributes };
  const role = patch.role ?? player.role;
  const overall = Number(patch.overall ?? player.overall);
  const grade = patch.grade ?? player.grade;
  return {
    ...player,
    ...Object.fromEntries(["name", "secondaryRole", "nationality", "club", "heightCm"].filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]])),
    role,
    pool:poolForRole(role),
    overall,
    grade,
    legendary:grade === "S",
    baseOverall:overall,
    attributes,
    referenceAttributes:{ ...attributes },
  };
}

const catalog = baseCatalog.map(productionPlayer);

syncPlayerProfiles();

const byGrade = Object.fromEntries([...new Set(catalog.map((player) => player.grade))].sort().map((grade) => [grade, catalog.filter((player) => player.grade === grade).length]));
await fs.writeFile(path.join(root, "assets", "data", "s4-player-catalog.json"), JSON.stringify(catalog));
syncPlayerProfiles();
console.log(JSON.stringify({
  players:catalog.length,
  grades:byGrade,
  portraits:catalog.filter((player) => player.portrait).length,
  productionOverrides:Object.keys(productionOverrides.players ?? {}).length,
  productionOverridesUpdatedAt:productionOverrides.updatedAt,
}, null, 2));






