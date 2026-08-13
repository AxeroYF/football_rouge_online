import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const A_TARGET_JSON = path.join(ROOT, "A_profile", "a-player-profile-positions.json");
const S_TARGET_JSON = path.join(ROOT, "legendary_profile", "legendary-profile-positions.json");
const X_TARGET_JSON = path.join(ROOT, "x_profile", "x-player-profile-positions.json");

const DLC_BATCHES = Object.freeze([
  Object.freeze({
    key: "dlc1",
    batch: "2026-07-31",
    playerData: path.join(ROOT, "data", "player-dlc-s4-final.json"),
    aDirectory: path.join(ROOT, "player_dlc", "A_profile"),
    aPositions: "a-player-profile-positions (1).json",
    sDirectory: path.join(ROOT, "player_dlc", "S_profile"),
    sPositions: "legendary-profile-positions.json",
    canonicalProfileKeys: false,
    aliases: Object.freeze({}),
  }),
  Object.freeze({
    key: "dlc2",
    batch: "2026-08-03",
    playerData: path.join(ROOT, "data", "player-dlc2-s4-final.json"),
    aDirectory: path.join(ROOT, "player_dlc2", "a_profile"),
    aPositions: "a-player-profile-positions (1).json",
    sDirectory: path.join(ROOT, "player_dlc2", "s_profile"),
    sPositions: "legendary-profile-positions.json",
    canonicalProfileKeys: true,
    aliases: Object.freeze({
      "Alessandro Del Piero": "Del pierro",
    }),
  }),
  Object.freeze({
    key: "dlc3",
    batch: "2026-08-08",
    playerData: path.join(ROOT, "data", "player-dlc3-s4-final.json"),
    aDirectory: path.join(ROOT, "player_dlc3", "A_Profile"),
    aPositions: "a-player-profile-positions.json",
    sDirectory: path.join(ROOT, "player_dlc3", "S_profile"),
    sPositions: "legendary-profile-positions.json",
    xDirectory: path.join(ROOT, "player_dlc3", "X_profile"),
    xPositions: "x-player-profile-positions.json",
    canonicalProfileKeys: true,
    aliases: Object.freeze({}),
    additionalAProfiles: Object.freeze([
      Object.freeze({ sourceKey:"Di_Maria", targetKey:"Ángel Di María", playerId:"s4-fc26-183898" }),
    ]),
    xProfiles: Object.freeze([
      Object.freeze({ sourceKey:"liuzuhao", targetKey:"刘祖豪", playerId:"ydl-x-player-9" }),
    ]),
  }),
]);

const normalizeName = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/\p{M}/gu, "")
  .replace(/[^a-z0-9]/gi, "")
  .toLowerCase();

const requestedBatch = process.argv.find((argument) => argument.startsWith("--batch="))?.split("=")[1] ?? "all";
const selectedBatches = requestedBatch === "all"
  ? DLC_BATCHES
  : DLC_BATCHES.filter((config) => config.key === requestedBatch);
if (!selectedBatches.length) throw new Error(`unknown DLC profile batch: ${requestedBatch}`);

const [{ REAL_PLAYER_POOLS }, ...payloads] = await Promise.all([
  import("../versus/player-pool.js"),
  ...selectedBatches.map((config) => readFile(config.playerData, "utf8").then(JSON.parse)),
]);
const runtimeDlcPlayers = Object.values(REAL_PLAYER_POOLS)
  .flat()
  .filter((player) => player.isDlc === true);
const runtimeBySourceName = new Map(runtimeDlcPlayers.map((player) => [normalizeName(player.sourceName), player]));
const batches = selectedBatches.map((config, index) => ({ ...config, payload:payloads[index] }));

function sourceProfileKey(player, sourceProfiles, config) {
  const keys = Object.keys(sourceProfiles);
  const alias = config.aliases[player.sourceName];
  const exactNames = [alias, player.sourceName].filter(Boolean).map(normalizeName);
  const exactMatches = keys.filter((key) => exactNames.includes(normalizeName(key)));
  if (exactMatches.length === 1) return exactMatches[0];

  const normalizedSourceName = normalizeName(player.sourceName);
  const fuzzyMatches = keys.filter((key) => {
    const normalizedKey = normalizeName(key);
    return normalizedKey && (normalizedSourceName.includes(normalizedKey) || normalizedKey.includes(normalizedSourceName));
  });
  if (fuzzyMatches.length !== 1) {
    throw new Error(`${config.key} profile positioning must uniquely match ${player.sourceName}: ${fuzzyMatches.join(", ") || "none"}`);
  }
  return fuzzyMatches[0];
}

async function mergeProfiles({ grade, targetJson, targetDirectory, directoryKey, positionsKey }) {
  const target = JSON.parse(await readFile(targetJson, "utf8"));
  const imported = [];

  for (const config of batches) {
    const sourceDirectory = config[directoryKey];
    const source = JSON.parse(await readFile(path.join(sourceDirectory, config[positionsKey]), "utf8"));
    const sourceProfiles = source.profiles ?? {};
    const eligible = config.payload.players.filter((player) => player.grade === grade && (grade !== "A" || player.overall >= 87));
    const usedSourceKeys = new Set();

    for (const player of eligible) {
      const runtimePlayer = runtimeBySourceName.get(normalizeName(player.sourceName));
      if (!runtimePlayer || runtimePlayer.dlcBatch !== config.batch) throw new Error(`${config.key} runtime player not found: ${player.sourceName}`);
      const profileKey = sourceProfileKey(player, sourceProfiles, config);
      if (usedSourceKeys.has(profileKey)) throw new Error(`${config.key} profile positioning reused: ${profileKey}`);
      usedSourceKeys.add(profileKey);

      const profile = sourceProfiles[profileKey];
      const fileName = String(profile.fileName ?? "");
      const positioning = {
        fileName,
        xPercent: Number(profile.xPercent),
        yPercent: Number(profile.yPercent),
        widthPercent: Number(profile.widthPercent),
      };
      if (!fileName.toLowerCase().endsWith(".png")) throw new Error(`${profileKey} requires PNG`);
      if (![positioning.xPercent, positioning.yPercent, positioning.widthPercent].every(Number.isFinite)) {
        throw new Error(`${profileKey} has invalid positioning`);
      }

      const targetKey = config.canonicalProfileKeys ? player.sourceName : profileKey;
      const existing = target.profiles[targetKey];
      if (existing && JSON.stringify(existing) !== JSON.stringify(positioning)) {
        throw new Error(`profile already exists with different positioning: ${targetKey}`);
      }
      await copyFile(path.join(sourceDirectory, fileName), path.join(targetDirectory, fileName));
      target.profiles[targetKey] = positioning;
      imported.push({
        id: runtimePlayer.id,
        name: player.displayNameZh,
        sourceName: player.sourceName,
        profileKey: targetKey,
        fileName,
        batch: config.batch,
        status: existing ? "unchanged" : "imported",
      });
    }

    if (grade === "A") {
      for (const additional of config.additionalAProfiles ?? []) {
        const runtimePlayer = Object.values(REAL_PLAYER_POOLS).flat().find((player) => player.id === additional.playerId);
        if (!runtimePlayer) throw new Error(`${config.key} additional A player not found: ${additional.playerId}`);
        const profile = sourceProfiles[additional.sourceKey];
        if (!profile) throw new Error(`${config.key} additional A profile not found: ${additional.sourceKey}`);
        const positioning = {
          fileName: String(profile.fileName ?? ""),
          xPercent: Number(profile.xPercent),
          yPercent: Number(profile.yPercent),
          widthPercent: Number(profile.widthPercent),
        };
        if (!positioning.fileName.toLowerCase().endsWith(".png") || ![positioning.xPercent, positioning.yPercent, positioning.widthPercent].every(Number.isFinite)) {
          throw new Error(`${additional.sourceKey} has invalid positioning`);
        }
        const existing = target.profiles[additional.targetKey];
        if (existing && JSON.stringify(existing) !== JSON.stringify(positioning)) {
          throw new Error(`profile already exists with different positioning: ${additional.targetKey}`);
        }
        await copyFile(path.join(sourceDirectory, positioning.fileName), path.join(targetDirectory, positioning.fileName));
        target.profiles[additional.targetKey] = positioning;
        imported.push({
          id: additional.playerId,
          name: runtimePlayer.name,
          sourceName: runtimePlayer.sourceName,
          profileKey: additional.targetKey,
          fileName: positioning.fileName,
          batch: config.batch,
          status: existing ? "unchanged" : "imported",
        });
      }
    }
  }

  target.generatedAt = "2026-08-08";
  target.source = `merged existing ${grade} profiles with S4 DLC card art`;
  await writeFile(targetJson, `${JSON.stringify(target, null, 2)}\n`, "utf8");
  return imported;
}

async function mergeXProfiles() {
  const target = JSON.parse(await readFile(X_TARGET_JSON, "utf8"));
  const imported = [];
  for (const config of batches) {
    if (!(config.xProfiles?.length)) continue;
    const source = JSON.parse(await readFile(path.join(config.xDirectory, config.xPositions), "utf8"));
    for (const entry of config.xProfiles) {
      const profile = source.profiles?.[entry.sourceKey];
      if (!profile) throw new Error(`${config.key} X profile not found: ${entry.sourceKey}`);
      const positioning = {
        fileName: String(profile.fileName ?? ""),
        xPercent: Number(profile.xPercent),
        yPercent: Number(profile.yPercent),
        widthPercent: Number(profile.widthPercent),
      };
      const existing = target.profiles[entry.targetKey];
      if (existing && JSON.stringify(existing) !== JSON.stringify(positioning)) {
        throw new Error(`X profile already exists with different positioning: ${entry.targetKey}`);
      }
      await copyFile(path.join(config.xDirectory, positioning.fileName), path.join(ROOT, "x_profile", positioning.fileName));
      target.profiles[entry.targetKey] = positioning;
      imported.push({ id:entry.playerId, profileKey:entry.targetKey, fileName:positioning.fileName });
    }
  }
  await writeFile(X_TARGET_JSON, `${JSON.stringify(target, null, 2)}\n`, "utf8");
  return imported;
}

const aImported = await mergeProfiles({
  grade: "A",
  targetJson: A_TARGET_JSON,
  targetDirectory: path.join(ROOT, "A_profile"),
  directoryKey: "aDirectory",
  positionsKey: "aPositions",
});
const sImported = await mergeProfiles({
  grade: "S",
  targetJson: S_TARGET_JSON,
  targetDirectory: path.join(ROOT, "legendary_profile"),
  directoryKey: "sDirectory",
  positionsKey: "sPositions",
});
const xImported = await mergeXProfiles();

console.log(JSON.stringify({
  batches: batches.map((config) => config.key),
  importedA: aImported.filter((entry) => entry.status === "imported").length,
  importedS: sImported.filter((entry) => entry.status === "imported").length,
  unchanged: [...aImported, ...sImported].filter((entry) => entry.status === "unchanged").length,
  total: aImported.length + sImported.length,
  importedX: xImported.length,
  aImported,
  sImported,
  xImported,
}, null, 2));
