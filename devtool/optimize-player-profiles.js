import { createRequire } from "node:module";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 90;
const PROFILE_DIRECTORIES = Object.freeze(["A_profile", "legendary_profile", "x_profile"]);
let sharpInstance = null;

function imageProcessor() {
  if (sharpInstance) return sharpInstance;
  try {
    sharpInstance = require("sharp");
    return sharpInstance;
  } catch {
    throw new Error("生成网页卡面需要 sharp。请先运行 npm install，再重新执行 npm run optimize:player-profiles。");
  }
}

async function optimizeDirectory(directoryName) {
  const sourceDirectory = path.join(ROOT, directoryName);
  const targetDirectory = path.join(sourceDirectory, "webp");
  await mkdir(targetDirectory, { recursive:true });
  const sourceFileNames = (await readdir(sourceDirectory))
    .filter((fileName) => fileName.toLowerCase().endsWith(".png"));
  let sourceBytes = 0;
  let optimizedBytes = 0;
  let converted = 0;

  for (const sourceFileName of sourceFileNames) {
    const sourcePath = path.join(sourceDirectory, sourceFileName);
    const targetPath = path.join(targetDirectory, `${path.parse(sourceFileName).name}.webp`);
    const sourceStat = await stat(sourcePath);
    sourceBytes += sourceStat.size;
    const targetStat = await stat(targetPath).catch(() => null);
    if (!targetStat || targetStat.mtimeMs < sourceStat.mtimeMs) {
      await imageProcessor()(sourcePath)
        .resize({
          width:MAX_DIMENSION,
          height:MAX_DIMENSION,
          fit:"inside",
          withoutEnlargement:true,
        })
        .webp({
          quality:WEBP_QUALITY,
          alphaQuality:100,
          smartSubsample:true,
        })
        .toFile(targetPath);
      converted += 1;
    }
    optimizedBytes += (await stat(targetPath)).size;
  }

  return { directoryName, count:sourceFileNames.length, converted, sourceBytes, optimizedBytes };
}

export async function optimizePlayerProfiles() {
  const results = [];
  for (const directoryName of PROFILE_DIRECTORIES) results.push(await optimizeDirectory(directoryName));
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = await optimizePlayerProfiles();
  for (const result of results) {
    const reduction = result.sourceBytes
      ? Math.round((1 - result.optimizedBytes / result.sourceBytes) * 100)
      : 0;
    console.log(`${result.directoryName}: ${result.count} 张（本次转换 ${result.converted} 张），${(result.sourceBytes / 1024 / 1024).toFixed(1)} MB -> ${(result.optimizedBytes / 1024 / 1024).toFixed(1)} MB（减少 ${reduction}%）`);
  }
}
