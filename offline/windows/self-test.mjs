import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, "app", "package.json"));
const ExcelJS = require("exceljs");
const sharp = require("sharp");
const seedRoot = path.join(root, "seed-data");
const profileRoot = path.join(root, "seed-player-profiles", "webp");
const report = JSON.parse(readFileSync(path.join(seedRoot, "OFFLINE_MIGRATION_REPORT.json"), "utf8"));
const accounts = JSON.parse(readFileSync(path.join(seedRoot, "versus-accounts.json"), "utf8"));
const profileCount = readdirSync(profileRoot).filter((name) => name.endsWith(".webp")).length;
const attributeSettingsModule = await import(pathToFileURL(path.join(root, "app", "versus", "offline-attribute-settings.js")).href);
const matchParametersModule = await import(pathToFileURL(path.join(root, "app", "versus", "v2", "match-parameters-v2.js")).href);

if (!existsSync(path.join(root, "runtime", "node.exe"))) throw new Error("缺少 runtime/node.exe");
if (!existsSync(path.join(root, "YDL S4 Offline.exe"))) throw new Error("缺少 Windows GUI 启动器");
if (!existsSync(path.join(root, "app", "devtool", "public-server.js"))) throw new Error("缺少游戏服务入口");
if (report.after?.teams !== 10 || report.after?.matches !== 148 || report.after?.archives !== 12) throw new Error("离线赛季数据数量不正确");
if (Object.keys(accounts.accounts ?? {}).length !== 10) throw new Error("本地球队身份数量不正确");
if (profileCount !== 132) throw new Error("球员图片数量不正确");
if (typeof ExcelJS.Workbook !== "function") throw new Error("ExcelJS 加载失败");
const image = await sharp({ create:{ width:1, height:1, channels:4, background:{ r:0, g:0, b:0, alpha:0 } } }).webp().toBuffer();
if (!image.length) throw new Error("sharp WebP 自检失败");
for (const [rate, expected] of [[1, 112], [0.5, 105.5], [0.3, 102.9]]) {
  const settings = attributeSettingsModule.resolveOfflineAttributeSettings({ YDL_OFFLINE_MODE:"1", YDL_OFFLINE_ATTRIBUTE_UNCAP:"1", YDL_OFFLINE_OVERCAP_RATE:String(rate) });
  const actual = matchParametersModule.v2EngineAttributeValue(112, matchParametersModule.V2_MATCH_PARAMETERS, settings);
  if (Math.abs(actual - expected) > 0.000001) throw new Error(`V2.1 超限属性 ${rate * 100}% 档自检失败`);
}
console.log(JSON.stringify({
  ok:true,
  node:process.version,
  platform:`${process.platform}-${process.arch}`,
  sharp:sharp.versions.sharp,
  teams:report.after.teams,
  matches:report.after.matches,
  archives:report.after.archives,
  accounts:Object.keys(accounts.accounts ?? {}).length,
  playerProfiles:profileCount,
}, null, 2));
