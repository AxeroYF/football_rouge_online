import { createHash } from "node:crypto";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const OPTIMIZED_DIRECTORY_NAME = "webp";

export async function optimizedProfileAsset(profileDirectory, publicDirectoryName, sourceFileName) {
  const optimizedFileName = `${path.parse(sourceFileName).name}.webp`;
  const optimizedPath = path.join(profileDirectory, OPTIMIZED_DIRECTORY_NAME, optimizedFileName);
  await stat(optimizedPath);
  const contentHash = createHash("sha256").update(await readFile(optimizedPath)).digest("hex").slice(0, 12);
  return {
    optimizedFileName,
    imageUrl:`/versus/${publicDirectoryName}/${OPTIMIZED_DIRECTORY_NAME}/${encodeURIComponent(optimizedFileName)}?v=${contentHash}`,
  };
}

export async function copyOptimizedProfileAsset(profileDirectory, optimizedFileName, assetTargetDirectory) {
  const targetDirectory = path.join(assetTargetDirectory, OPTIMIZED_DIRECTORY_NAME);
  await mkdir(targetDirectory, { recursive:true });
  await cp(
    path.join(profileDirectory, OPTIMIZED_DIRECTORY_NAME, optimizedFileName),
    path.join(targetDirectory, optimizedFileName),
  );
}
