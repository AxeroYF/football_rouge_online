import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../versus/ydl-content-store.js";
import { REAL_PLAYER_BY_ID } from "../versus/player-pool.js";
import { copyOptimizedProfileAsset, optimizedProfileAsset } from "./player-profile-assets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROFILE_DIRECTORY = path.join(ROOT, "A_profile");
const POSITION_PATH = path.join(PROFILE_DIRECTORY, "a-player-profile-positions.json");
const MODULE_PATH = path.join(ROOT, "versus/public/a-player-profiles.js");
const ADDITIONAL_PROFILE_PLAYER_IDS = new Set(["s4-fc26-183898", "s4-fc26-239231", "s4-fc26-246104"]);

function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizedWords(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eligiblePlayers() {
  return Object.values(REAL_PLAYER_BY_ID)
    .filter((player) => (player.grade === "A" && Number(player.overall) >= 87) || ADDITIONAL_PROFILE_PLAYER_IDS.has(player.id));
}

function playerForProfileKey(profileKey, players) {
  const normalizedKey = normalizedName(profileKey);
  const exactMatches = players.filter((player) => normalizedName(player.sourceName) === normalizedKey);
  const keyWords = normalizedWords(profileKey);
  const wordMatches = exactMatches.length ? [] : players.filter((player) => {
    const sourceWords = ` ${normalizedWords(player.sourceName)} `;
    return keyWords && sourceWords.includes(` ${keyWords} `);
  });
  const matches = exactMatches.length ? exactMatches : wordMatches.length ? wordMatches : players.filter((player) => {
    const normalizedSourceName = normalizedName(player.sourceName);
    return normalizedSourceName.includes(normalizedKey) || normalizedKey.includes(normalizedSourceName);
  });
  if (matches.length !== 1) {
    throw new Error(`${profileKey} 必须唯一匹配一名总评87以上的A级球员，当前匹配：${matches.map((player) => `${player.id}(${player.sourceName})`).join(", ") || "无"}`);
  }
  return matches[0];
}

function normalizedProfile(profile, player, profileKey) {
  const fileName = String(profile?.fileName ?? "");
  const xPercent = Number(profile?.xPercent);
  const yPercent = Number(profile?.yPercent);
  const widthPercent = Number(profile?.widthPercent);
  if (!fileName.toLowerCase().endsWith(".png")) throw new Error(`${profileKey} 缺少 PNG 文件名`);
  if (![xPercent, yPercent, widthPercent].every(Number.isFinite)) throw new Error(`${profileKey} 的定位参数无效`);
  return {
    playerId:player.id,
    profileKey,
    fileName,
    imageUrl:`/versus/A_profile/${encodeURIComponent(fileName)}`,
    xPercent,
    yPercent,
    widthPercent,
  };
}

export async function syncAPlayerProfiles({ assetTargetDirectory = null } = {}) {
  const source = JSON.parse(await readFile(POSITION_PATH, "utf8"));
  if (source?.profileType !== "a" || source?.grade !== "A") throw new Error("A级头像定位文件类型无效");
  const profiles = source?.profiles ?? {};
  const sourceKeys = Object.keys(profiles);
  const players = eligiblePlayers();

  const entries = [];
  for (const profileKey of sourceKeys) {
    const player = playerForProfileKey(profileKey, players);
    const profile = normalizedProfile(profiles[profileKey], player, profileKey);
    await stat(path.join(PROFILE_DIRECTORY, profile.fileName));
    Object.assign(profile, await optimizedProfileAsset(PROFILE_DIRECTORY, "A_profile", profile.fileName));
    entries.push(profile);
  }

  const mappedPlayerIds = new Set(entries.map((entry) => entry.playerId));
  const missingPlayers = players.filter((player) => !mappedPlayerIds.has(player.id));
  const unexpectedMissing = missingPlayers.filter((player) => !player.isDlc);
  if (mappedPlayerIds.size !== entries.length || unexpectedMissing.length) {
    throw new Error(`A级头像映射不完整或存在重复：非DLC未映射 ${unexpectedMissing.map((player) => player.id).join(", ") || "无"}`);
  }

  const sourceFileNames = new Set(entries.map((entry) => entry.fileName));
  const pngFileNames = (await readdir(PROFILE_DIRECTORY)).filter((fileName) => fileName.toLowerCase().endsWith(".png"));
  const extraPngs = pngFileNames.filter((fileName) => !sourceFileNames.has(fileName));
  const missingPngs = [...sourceFileNames].filter((fileName) => !pngFileNames.includes(fileName));
  if (extraPngs.length || missingPngs.length) {
    throw new Error(`A级头像文件与定位JSON不一致：多余 ${extraPngs.join(", ") || "无"}；缺少 ${missingPngs.join(", ") || "无"}`);
  }

  const moduleSource = `// 此文件由 devtool/sync-a-player-profiles.js 根据 A_profile/a-player-profile-positions.json 生成。\n`
    + `export const A_PLAYER_PROFILE_BY_PLAYER_ID = Object.freeze(${JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.playerId, entry])), null, 2)});\n\n`
    + `export function aPlayerProfileForPlayer(player) {\n`
    + `  return player?.id ? A_PLAYER_PROFILE_BY_PLAYER_ID[player.id] ?? null : null;\n`
    + `}\n`;
  await writeFile(MODULE_PATH, moduleSource, "utf8");

  if (assetTargetDirectory) {
    await mkdir(assetTargetDirectory, { recursive:true });
    for (const entry of entries) {
      await copyOptimizedProfileAsset(PROFILE_DIRECTORY, entry.optimizedFileName, assetTargetDirectory);
    }
    await cp(POSITION_PATH, path.join(assetTargetDirectory, path.basename(POSITION_PATH)));
  }

  return {
    count:entries.length,
    modulePath:MODULE_PATH,
    entries,
    pendingDlcPlayers:missingPlayers.map((player) => ({
      id:player.id,
      name:player.name,
      sourceName:player.sourceName,
      overall:player.overall,
      role:player.role,
    })),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await syncAPlayerProfiles();
  console.log(`已同步${result.count}张A级头像配置：${result.modulePath}`);
}
