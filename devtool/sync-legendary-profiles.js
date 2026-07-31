import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyOptimizedProfileAsset, optimizedProfileAsset } from "./player-profile-assets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PROFILE_DIRECTORY = path.join(ROOT, "legendary_profile");
const POSITION_PATH = path.join(PROFILE_DIRECTORY, "legendary-profile-positions.json");
const ADDITION_POSITION_PATH = path.join(PROFILE_DIRECTORY, "legendary-profile-positions1.json");
const MODULE_PATH = path.join(ROOT, "versus/public/legendary-profiles.js");

const PROFILE_KEY_BY_PLAYER_ID = Object.freeze({
  "legend-courtois":"Courtois",
  "s4-fc26-167495":"Neuer",
  "s4-retired-gianluigi-buffon":"Buffon",
  "s4-retired-iker-casillas":"Casillas",
  "s4-retired-oliver-kahn":"Kahn",
  "legend-beckenbauer":"Beckenbauer",
  "s4-retired-paolo-maldini":"Maldini",
  "s4-retired-franco-baresi":"Baresi",
  "s4-retired-alessandro-nesta":"Nesta",
  "s4-retired-fabio-cannavaro":"Cannavaro",
  "s4-retired-carles-puyol":"Puyol",
  "s4-retired-rio-ferdinand":"Ferdinand",
  "s4-retired-philipp-lahm":"Lahm",
  "s4-retired-cafu":"Cafu",
  "s4-retired-javier-zanetti":"Zanetti",
  "s4-retired-marcelo":"Marcelo",
  "s4-retired-roberto-carlos":"Roberto_Carlos",
  "legend-zidane":"Zidane",
  "legend-ronaldinho":"Ronaldinho",
  "legend-kroos":"Kroos",
  "legend-beckham":"Beckham",
  "legend-modric":"Modric",
  "s4-fc26-231866":"Rodri",
  "s4-retired-paul-scholes":"Scholes",
  "s4-retired-frank-lampard":"Lampard",
  "s4-retired-patrick-vieira":"Vieira",
  "s4-retired-claude-makelele":"Makélélé",
  "s4-retired-yaya-toure":"Touré",
  "s4-retired-kaka":"Kaká",
  "s4-retired-luis-figo":"Figo",
  "s4-retired-pavel-nedved":"Nedvěd",
  "s4-retired-clarence-seedorf":"Seedorf",
  "s4-retired-juan-roman-riquelme":"Riquelme",
  "s4-retired-gennaro-gattuso":"Gattuso",
  "legend-pele":"Pelé",
  "legend-maradona":"Maradona",
  "legend-ronaldo-nazario":"Ronaldo_Nazário",
  "legend-messi":"Messi",
  "legend-messi-rat":"MessiRat",
  "legend-cristiano-ronaldo":"Cristiano_Ronaldo",
  "legend-mbappe":"Mbappé",
  "legend-haaland":"Haaland",
  "s4-fc26-165153":"Benzema",
  "s4-retired-thierry-henry":"Henry",
  "s4-retired-wayne-rooney":"Rooney",
  "s4-retired-didier-drogba":"Drogba",
  "s4-retired-samuel-eto-o":"Etoo",
  "s4-retired-andriy-shevchenko":"Shevchenko",
  "s4-retired-gabriel-batistuta":"Batistuta",
  "s4-retired-dennis-bergkamp":"Bergkamp",
  "s4-retired-eusebio":"Eusébio",
  "s4-retired-marco-van-basten":"Marco_van_Basten",
  "s4-retired-johan-cruyff":"Cruyff",
  "s4-retired-george-best":"George_Best",
  "s4-retired-romario":"Romário",
  "s4-dlc-20260731-016":"Neymar Jr",
  "s4-dlc-20260731-017":"Júlio César",
  "s4-dlc-20260731-022":"Marco Materazzi",
  "s4-dlc-20260731-029":"Gerd Müller",
  "s4-dlc-20260731-030":"Frank Rijkaard",
  "s4-dlc-20260731-031":"Ruud Gullit",
  "s4-dlc-20260731-040":"Rivaldo",
  "s4-dlc-20260731-043":"Craig Goodwin",
  "s4-dlc-20260731-048":"Didi",
});

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
    imageUrl:`/versus/legendary_profile/${encodeURIComponent(fileName)}`,
    xPercent,
    yPercent,
    widthPercent,
  };
}

export async function syncLegendaryProfiles({ assetTargetDirectory = null } = {}) {
  const source = JSON.parse(await readFile(POSITION_PATH, "utf8"));
  const additionSource = JSON.parse(await readFile(ADDITION_POSITION_PATH, "utf8"));
  const messiRatProfile = additionSource?.profiles?.MessiRat;
  if (!messiRatProfile) throw new Error("新增传奇定位文件缺少 MessiRat");
  const profiles = { ...(source?.profiles ?? {}), MessiRat:messiRatProfile };
  const mappedKeys = new Set(Object.values(PROFILE_KEY_BY_PLAYER_ID));
  const sourceKeys = Object.keys(profiles);
  if (sourceKeys.length !== mappedKeys.size) throw new Error(`传奇头像定位与ID映射数量不一致：定位${sourceKeys.length}人，映射${mappedKeys.size}人`);
  if (Object.keys(PROFILE_KEY_BY_PLAYER_ID).length !== mappedKeys.size) throw new Error("传奇球员ID映射存在重复或缺失");

  const missingMappings = sourceKeys.filter((key) => !mappedKeys.has(key));
  const missingProfiles = [...mappedKeys].filter((key) => !profiles[key]);
  if (missingMappings.length || missingProfiles.length) {
    throw new Error(`传奇头像映射不完整：未映射配置 ${missingMappings.join(", ") || "无"}；缺少配置 ${missingProfiles.join(", ") || "无"}`);
  }

  const entries = [];
  for (const [playerId, profileKey] of Object.entries(PROFILE_KEY_BY_PLAYER_ID)) {
    const profile = normalizedProfile(profiles[profileKey], playerId, profileKey);
    await stat(path.join(PROFILE_DIRECTORY, profile.fileName));
    Object.assign(profile, await optimizedProfileAsset(PROFILE_DIRECTORY, "legendary_profile", profile.fileName));
    entries.push(profile);
  }

  const moduleSource = `// 此文件由 devtool/sync-legendary-profiles.js 根据 legendary_profile/legendary-profile-positions.json 生成。\n`
    + `export const LEGENDARY_PROFILE_BY_PLAYER_ID = Object.freeze(${JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.playerId, entry])), null, 2)});\n\n`
    + `export function legendaryProfileForPlayer(player) {\n`
    + `  return player?.id ? LEGENDARY_PROFILE_BY_PLAYER_ID[player.id] ?? null : null;\n`
    + `}\n`;
  await writeFile(MODULE_PATH, moduleSource, "utf8");

  if (assetTargetDirectory) {
    await mkdir(assetTargetDirectory, { recursive:true });
    for (const entry of entries) {
      await copyOptimizedProfileAsset(PROFILE_DIRECTORY, entry.optimizedFileName, assetTargetDirectory);
    }
    await cp(POSITION_PATH, path.join(assetTargetDirectory, path.basename(POSITION_PATH)));
    await cp(ADDITION_POSITION_PATH, path.join(assetTargetDirectory, path.basename(ADDITION_POSITION_PATH)));
  }

  return { count:entries.length, modulePath:MODULE_PATH, entries };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await syncLegendaryProfiles();
  console.log(`已同步${result.count}张传奇头像配置：${result.modulePath}`);
}
