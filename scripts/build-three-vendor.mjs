import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "node_modules", "three");
const version = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
if (version !== "0.185.1") throw new Error("Expected the pinned Three.js 0.185.1 dependency");
const output = path.join(root, "assets", "vendor", "three");
await mkdir(output, { recursive: true });
for (const [source, target] of [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["examples/jsm/utils/BufferGeometryUtils.js", "BufferGeometryUtils.js"],
  ["examples/jsm/loaders/GLTFLoader.js", "GLTFLoader.js"],
  ["examples/jsm/environments/RoomEnvironment.js", "RoomEnvironment.js"],
  ["examples/jsm/utils/SkeletonUtils.js", "SkeletonUtils.js"],
  ["LICENSE", "LICENSE"],
]) {
  if (target === "GLTFLoader.js") {
    const loader = (await readFile(path.join(packageRoot, source), "utf8"))
      .replace("../utils/BufferGeometryUtils.js", "./BufferGeometryUtils.js")
      .replace("../utils/SkeletonUtils.js", "./SkeletonUtils.js");
    await writeFile(path.join(output, target), loader);
  } else {
    await copyFile(path.join(packageRoot, source), path.join(output, target));
  }
}
console.log("Built local Three.js " + version + " browser modules (no runtime CDN).");
