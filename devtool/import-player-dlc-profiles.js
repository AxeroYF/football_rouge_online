import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DLC_ROOT = path.join(ROOT, "player_dlc");
const A_SOURCE_JSON = path.join(DLC_ROOT, "A_profile", "a-player-profile-positions (1).json");
const S_SOURCE_JSON = path.join(DLC_ROOT, "S_profile", "legendary-profile-positions.json");
const A_TARGET_JSON = path.join(ROOT, "A_profile", "a-player-profile-positions.json");
const S_TARGET_JSON = path.join(ROOT, "legendary_profile", "legendary-profile-positions.json");

const normalizeName = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{M}/gu, "")
  .replace(/[^a-z0-9]/gi, "")
  .toLowerCase();

const [dlcPayload, { REAL_PLAYER_POOLS }] = await Promise.all([
  readFile(path.join(ROOT, "data", "player-dlc-s4-final.json"), "utf8").then(JSON.parse),
  import("../versus/player-pool.js"),
]);
const runtimeDlcPlayers = Object.values(REAL_PLAYER_POOLS)
  .flat()
  .filter((player) => player.isDlc === true);
const runtimeBySourceName = new Map(runtimeDlcPlayers.map((player) => [normalizeName(player.sourceName), player]));

async function mergeProfiles({ grade, sourceJson, targetJson, sourceDirectory, targetDirectory }) {
  const source = JSON.parse(await readFile(sourceJson, "utf8"));
  const target = JSON.parse(await readFile(targetJson, "utf8"));
  const sourceProfiles = source.profiles ?? {};
  const eligible = dlcPayload.players.filter((player) => player.grade === grade && (grade !== "A" || player.overall >= 87));
  const imported = [];

  for (const player of eligible) {
    const runtimePlayer = runtimeBySourceName.get(normalizeName(player.sourceName));
    if (!runtimePlayer) throw new Error(`DLC runtime player not found: ${player.sourceName}`);
    const profileKey = Object.keys(sourceProfiles).find((key) => normalizeName(key) === normalizeName(player.sourceName));
    if (!profileKey) throw new Error(`${grade} DLC profile positioning not found: ${player.sourceName}`);
    const profile = sourceProfiles[profileKey];
    const fileName = String(profile.fileName ?? "");
    if (!fileName.toLowerCase().endsWith(".png")) throw new Error(`${profileKey} requires PNG`);
    const sourceAsset = path.join(sourceDirectory, fileName);
    const targetAsset = path.join(targetDirectory, fileName);
    await copyFile(sourceAsset, targetAsset);
    if (target.profiles[profileKey]) throw new Error(`profile already exists: ${profileKey}`);
    target.profiles[profileKey] = {
      fileName,
      xPercent: Number(profile.xPercent),
      yPercent: Number(profile.yPercent),
      widthPercent: Number(profile.widthPercent),
    };
    imported.push({ id: runtimePlayer.id, name: player.displayNameZh, sourceName: player.sourceName, profileKey, fileName });
  }

  target.generatedAt = "2026-07-31";
  target.source = `merged existing ${grade} profiles with S4 DLC card art`;
  await writeFile(targetJson, `${JSON.stringify(target, null, 2)}\n`, "utf8");
  return imported;
}

const aImported = await mergeProfiles({
  grade: "A",
  sourceJson: A_SOURCE_JSON,
  targetJson: A_TARGET_JSON,
  sourceDirectory: path.join(DLC_ROOT, "A_profile"),
  targetDirectory: path.join(ROOT, "A_profile"),
});
const sImported = await mergeProfiles({
  grade: "S",
  sourceJson: S_SOURCE_JSON,
  targetJson: S_TARGET_JSON,
  sourceDirectory: path.join(DLC_ROOT, "S_profile"),
  targetDirectory: path.join(ROOT, "legendary_profile"),
});

console.log(JSON.stringify({
  importedA: aImported.length,
  importedS: sImported.length,
  total: aImported.length + sImported.length,
  aImported,
  sImported,
}, null, 2));
