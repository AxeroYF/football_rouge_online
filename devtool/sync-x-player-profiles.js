import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { X_PLAYERS } from "../versus/x-player-pool.js";
import { copyOptimizedProfileAsset, optimizedProfileAsset } from "./player-profile-assets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROFILE_DIRECTORY = path.join(ROOT, "x_profile");
const POSITION_PATH = path.join(PROFILE_DIRECTORY, "x-player-profile-positions.json");
const MODULE_PATH = path.join(ROOT, "versus/public/x-player-profiles.js");
const PLAYER_ID_BY_NAME = Object.freeze(Object.fromEntries(X_PLAYERS.map((player) => [player.name, player.id])));

function normalizedProfile(profile, playerId, profileKey) {
  const fileName = String(profile?.fileName ?? "");
  const xPercent = Number(profile?.xPercent);
  const yPercent = Number(profile?.yPercent);
  const widthPercent = Number(profile?.widthPercent);
  if (!fileName.toLowerCase().endsWith(".png")) throw new Error(`${profileKey} 缺少 PNG 文件名`);
  if (![xPercent, yPercent, widthPercent].every(Number.isFinite)) throw new Error(`${profileKey} 的定位参数无效`);
  return {
    playerId,
    profileKey,
    fileName,
    imageUrl:`/versus/x_profile/${encodeURIComponent(fileName)}`,
    xPercent,
    yPercent,
    widthPercent,
  };
}

export async function syncXPlayerProfiles({ assetTargetDirectory = null } = {}) {
  const source = JSON.parse(await readFile(POSITION_PATH, "utf8"));
  if (source?.profileType !== "x" || source?.grade !== "X") throw new Error("X级头像定位文件类型无效");
  const profiles = source?.profiles ?? {};
  const sourceKeys = Object.keys(profiles);
  if (!sourceKeys.length) throw new Error("X级头像定位文件至少需要包含一名球员");

  const unknownProfiles = sourceKeys.filter((name) => !PLAYER_ID_BY_NAME[name]);
  if (unknownProfiles.length) throw new Error(`存在未知X级球员：${unknownProfiles.join(", ")}`);

  const entries = [];
  for (const profileKey of sourceKeys) {
    const profile = normalizedProfile(profiles[profileKey], PLAYER_ID_BY_NAME[profileKey], profileKey);
    await stat(path.join(PROFILE_DIRECTORY, profile.fileName));
    Object.assign(profile, await optimizedProfileAsset(PROFILE_DIRECTORY, "x_profile", profile.fileName));
    entries.push(profile);
  }

  const moduleSource = `// 此文件由 devtool/sync-x-player-profiles.js 根据 x_profile/x-player-profile-positions.json 生成。\n`
    + `export const X_PLAYER_PROFILE_BY_PLAYER_ID = Object.freeze(${JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.playerId, entry])), null, 2)});\n\n`
    + `export function xPlayerProfileForPlayer(player) {\n`
    + `  return player?.id ? X_PLAYER_PROFILE_BY_PLAYER_ID[player.id] ?? null : null;\n`
    + `}\n`;
  await writeFile(MODULE_PATH, moduleSource, "utf8");

  if (assetTargetDirectory) {
    await mkdir(assetTargetDirectory, { recursive:true });
    for (const entry of entries) {
      await copyOptimizedProfileAsset(PROFILE_DIRECTORY, entry.optimizedFileName, assetTargetDirectory);
    }
    await cp(POSITION_PATH, path.join(assetTargetDirectory, path.basename(POSITION_PATH)));
  }

  return { count:entries.length, modulePath:MODULE_PATH, entries };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await syncXPlayerProfiles();
  console.log(`已同步${result.count}张X级头像配置：${result.modulePath}`);
}
