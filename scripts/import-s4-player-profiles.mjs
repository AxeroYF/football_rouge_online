import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!source) { console.error("Usage: node scripts/import-s4-player-profiles.mjs <extracted-s4-root>"); process.exit(1); }
const out = path.join(root, "assets/player-profiles");
const imported = path.join(out, "s4-imported");
const registryFile = path.join(root, "assets/data/s4-player-profile-registry.json");
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(imported, { recursive: true });
function find(...parts) { const f = path.join(source, ...parts); return fs.existsSync(f) ? f : null; }
async function loadMap(file, exportName) {
  if (!file) return {};
  const text = fs.readFileSync(file, "utf8");
  const body = text.replace(new RegExp(`^export\\s+const\\s+${exportName}\\s*=`, "m"), "const map =");
  const temp = path.join(imported, `.map-${exportName}.mjs`);
  fs.writeFileSync(temp, `${body}\nexport default map;\n`);
  try { return (await import(`${pathToFileURL(temp).href}?t=${Date.now()}`)).default ?? {}; } finally { fs.rmSync(temp, { force: true }); }
}
const maps = [[find("versus/dist/legendary-profiles.js") ?? find("versus/public/legendary-profiles.js"), "LEGENDARY_PROFILE_BY_PLAYER_ID", "legendary"], [find("versus/public/a-player-profiles.js") ?? find("versus/dist/a-player-profiles.js"), "A_PLAYER_PROFILE_BY_PLAYER_ID", "A"]];
const existingRegistry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, "utf8")) : {};
const registry = { ...existingRegistry, schemaVersion: 1, generatedAt: new Date().toISOString().slice(0, 10), profiles: { ...(existingRegistry.profiles ?? {}) } };
for (const [file, name, group] of maps) {
  const map = await loadMap(file, name);
  for (const [id, value] of Object.entries(map)) {
    const fileName = value.optimizedFileName ?? path.basename((value.imageUrl ?? "").split("?")[0]);
    registry.profiles[id] = { profileKey: value.profileKey, fileName, x: value.xPercent, y: value.yPercent, width: value.widthPercent, sourceGroup: "YDL" };
    const assetDir = group === "A" ? "A_profile/webp" : "legendary_profile/webp";
    const asset = find("versus", `dist/${assetDir}`, fileName) ?? find(assetDir, fileName) ?? find("versus", assetDir, fileName);
    if (asset) fs.copyFileSync(asset, path.join(out, fileName));
  }
}
const hashSource = find("player_profiles", "webp");
if (hashSource) for (const file of fs.readdirSync(hashSource)) if (/\.webp$/i.test(file)) fs.copyFileSync(path.join(hashSource, file), path.join(imported, file));
fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Imported ${Object.keys(registry.profiles).length} mapped profiles.`);
