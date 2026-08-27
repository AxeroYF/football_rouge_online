import {
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const INDEX_FILES = new Set(["matches-index.json", "archives-index.json"]);
const mode = String(process.argv[2] ?? "analyze");
const root = path.resolve(process.argv[3] ?? "");
const flags = new Set(process.argv.slice(4));
const expectedRevisionFlag = [...flags].find((value) => value.startsWith("--expected-revision="));
const expectedRevision = expectedRevisionFlag ? Number(expectedRevisionFlag.split("=")[1]) : null;
const serviceFlag = [...flags].find((value) => value.startsWith("--service="));
const serviceName = serviceFlag?.split("=")[1] || "football-s4";

function fail(message) {
  throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, pretty = false) {
  mkdirSync(path.dirname(filePath), { recursive:true });
  writeFileSync(filePath, JSON.stringify(value, null, pretty ? 2 : undefined), "utf8");
}

function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, JSON.stringify(value), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, filePath);
}

function relativeReference(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function resolveReference(reference) {
  return path.resolve(root, String(reference));
}

function assertInsideRoot(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) fail(`路径越出分片根目录：${resolved}`);
  return resolved;
}

function isRevisionReference(value) {
  return typeof value === "string" && value.startsWith("revisions/");
}

function collectReferenceGraph(manifest) {
  const references = new Set();
  const queuedIndexes = [];
  const seenIndexes = new Set();
  const collect = (value) => {
    if (isRevisionReference(value)) {
      references.add(value);
      const filePath = assertInsideRoot(resolveReference(value));
      if (INDEX_FILES.has(path.basename(filePath)) && !seenIndexes.has(filePath)) {
        seenIndexes.add(filePath);
        queuedIndexes.push(filePath);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(manifest.shards);
  while (queuedIndexes.length) {
    const filePath = queuedIndexes.pop();
    if (!existsSync(filePath)) fail(`引用索引不存在：${filePath}`);
    collect(readJson(filePath));
  }
  return references;
}

function directorySize(directory) {
  if (!existsSync(directory)) return 0;
  let total = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    readdirSync(current, { withFileTypes:true }).forEach((entry) => {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) total += statSync(target).size;
    });
  }
  return total;
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

function serviceIsActive() {
  if (process.platform !== "linux") return false;
  return spawnSync("systemctl", ["is-active", "--quiet", serviceName], { stdio:"ignore" }).status === 0;
}

function loadCurrentManifest() {
  const manifestPath = path.join(root, "manifest.json");
  if (!existsSync(manifestPath)) fail(`找不到 manifest：${manifestPath}`);
  const manifest = readJson(manifestPath);
  if (!manifest?.shards || !Number.isFinite(Number(manifest.revision))) fail("manifest 格式无效");
  if (expectedRevision != null && Number(manifest.revision) !== expectedRevision) {
    fail(`manifest revision 已变化：期望 ${expectedRevision}，实际 ${manifest.revision}`);
  }
  return { manifestPath, manifest };
}

function exactReferenceSize(references) {
  let total = 0;
  references.forEach((reference) => {
    const filePath = assertInsideRoot(resolveReference(reference));
    if (!existsSync(filePath)) fail(`引用文件不存在：${reference}`);
    total += statSync(filePath).size;
  });
  return total;
}

function revisionDirectories() {
  const revisionsRoot = path.join(root, "revisions");
  if (!existsSync(revisionsRoot)) return [];
  return readdirSync(revisionsRoot)
    .filter((name) => /^\d+$/.test(name))
    .sort((left, right) => Number(left) - Number(right));
}

function analyze() {
  const { manifest } = loadCurrentManifest();
  const references = collectReferenceGraph(manifest);
  const referencedRevisionIds = new Set([...references].map((reference) => reference.split("/")[1]));
  const retainedBytes = [...referencedRevisionIds].reduce((total, revision) => total + directorySize(path.join(root, "revisions", revision)), 0);
  const exactBytes = exactReferenceSize(references);
  const filesystem = statfsSync(root);
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  const requiredHeadroom = Math.ceil(exactBytes * 1.2 + 512 * 1024 * 1024);
  return {
    root,
    manifestRevision:Number(manifest.revision),
    exactReferencedFiles:references.size,
    exactReferencedBytes:exactBytes,
    exactReferencedSize:human(exactBytes),
    retainedRevisionDirectories:referencedRevisionIds.size,
    retainedRevisionBytes:retainedBytes,
    retainedRevisionSize:human(retainedBytes),
    estimatedReclaimableBytes:Math.max(0, retainedBytes - exactBytes),
    estimatedReclaimableSize:human(Math.max(0, retainedBytes - exactBytes)),
    availableBytes,
    availableSize:human(availableBytes),
    requiredHeadroomBytes:requiredHeadroom,
    requiredHeadroomSize:human(requiredHeadroom),
    enoughSpace:availableBytes >= requiredHeadroom,
  };
}

function nextRevisionNumber(manifest) {
  const highestDirectory = Number(revisionDirectories().at(-1) ?? 0);
  return Math.max(Number(manifest.revision) + 1, highestDirectory + 1);
}

function compact() {
  if (!flags.has("--apply")) fail("压实操作必须显式增加 --apply");
  if (serviceIsActive()) fail(`服务 ${serviceName} 仍在运行；压实前必须停止服务`);
  const analysis = analyze();
  if (!analysis.enoughSpace) fail(`可用空间不足：需要 ${analysis.requiredHeadroomSize}，当前 ${analysis.availableSize}`);
  const { manifestPath, manifest } = loadCurrentManifest();
  const newRevision = nextRevisionNumber(manifest);
  const revisionsRoot = path.join(root, "revisions");
  const temporaryRevisionPath = path.join(revisionsRoot, `.tmp-compact-${newRevision}-${process.pid}`);
  const finalRevisionPath = path.join(revisionsRoot, String(newRevision));
  if (existsSync(finalRevisionPath) || existsSync(temporaryRevisionPath)) fail(`目标 revision 已存在：${newRevision}`);
  mkdirSync(path.join(temporaryRevisionPath, "compacted"), { recursive:true });
  const mapping = new Map();
  let sequence = 0;
  const rewriteValue = (value) => {
    if (isRevisionReference(value)) return rewriteReference(value);
    if (Array.isArray(value)) return value.map(rewriteValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteValue(item)]));
    return value;
  };
  const rewriteReference = (reference) => {
    if (mapping.has(reference)) return mapping.get(reference);
    const sourcePath = assertInsideRoot(resolveReference(reference));
    if (!existsSync(sourcePath)) fail(`压实源文件不存在：${reference}`);
    sequence += 1;
    const safeName = path.basename(sourcePath).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const relativeTarget = `revisions/${newRevision}/compacted/${String(sequence).padStart(6, "0")}-${safeName}`;
    const temporaryTarget = path.join(temporaryRevisionPath, "compacted", `${String(sequence).padStart(6, "0")}-${safeName}`);
    mapping.set(reference, relativeTarget);
    if (INDEX_FILES.has(path.basename(sourcePath))) writeJson(temporaryTarget, rewriteValue(readJson(sourcePath)));
    else copyFileSync(sourcePath, temporaryTarget);
    return relativeTarget;
  };
  try {
    const rewrittenShards = rewriteValue(manifest.shards);
    const backupDirectory = path.join(root, "yellowdogs-league-backups");
    mkdirSync(backupDirectory, { recursive:true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
    const backupPath = path.join(backupDirectory, `before-shard-compaction-${manifest.revision}-${stamp}.manifest.json`);
    copyFileSync(manifestPath, backupPath);
    renameSync(temporaryRevisionPath, finalRevisionPath);
    const nextManifest = { ...manifest, revision:newRevision, updatedAt:Date.now(), shards:rewrittenShards };
    atomicWriteJson(manifestPath, nextManifest);
    const verified = collectReferenceGraph(nextManifest);
    verified.forEach((reference) => {
      if (!existsSync(assertInsideRoot(resolveReference(reference)))) fail(`压实后引用缺失：${reference}`);
    });
    return {
      status:"compacted",
      previousRevision:Number(manifest.revision),
      manifestRevision:newRevision,
      copiedFiles:mapping.size,
      copiedBytes:analysis.exactReferencedBytes,
      copiedSize:analysis.exactReferencedSize,
      manifestBackup:backupPath,
      newRevisionPath:finalRevisionPath,
      nextStep:"启动服务并完成健康检查；确认后再处理旧 backup manifest 和执行 gc。",
    };
  } catch (error) {
    if (existsSync(temporaryRevisionPath)) rmSync(temporaryRevisionPath, { recursive:true, force:true });
    throw error;
  }
}

function collectProtectedRevisionIds(manifest) {
  return new Set([...collectReferenceGraph(manifest)].map((reference) => reference.split("/")[1]));
}

function gc() {
  if (serviceIsActive()) fail(`服务 ${serviceName} 仍在运行；垃圾回收前必须停止服务`);
  const { manifest } = loadCurrentManifest();
  const protectedIds = collectProtectedRevisionIds(manifest);
  const backupDirectory = path.join(root, "yellowdogs-league-backups");
  if (existsSync(backupDirectory)) {
    readdirSync(backupDirectory).filter((name) => name.endsWith(".manifest.json")).forEach((name) => {
      protectedIdsForBackup(name, protectedIds);
    });
  }
  const directories = revisionDirectories();
  directories.slice(-2).forEach((name) => protectedIds.add(name));
  const candidates = directories.filter((name) => !protectedIds.has(name));
  const bytes = candidates.reduce((total, name) => total + directorySize(path.join(root, "revisions", name)), 0);
  const result = {
    status:flags.has("--apply") ? "deleted" : "dry-run",
    manifestRevision:Number(manifest.revision),
    protectedRevisionDirectories:protectedIds.size,
    deletableRevisionDirectories:candidates.length,
    deletableBytes:bytes,
    deletableSize:human(bytes),
  };
  if (flags.has("--apply")) candidates.forEach((name) => rmSync(assertInsideRoot(path.join(root, "revisions", name)), { recursive:true, force:true }));
  return result;
}

function protectedIdsForBackup(name, protectedIds) {
  const filePath = path.join(root, "yellowdogs-league-backups", name);
  try {
    collectProtectedRevisionIds(readJson(filePath)).forEach((id) => protectedIds.add(id));
  } catch (error) {
    fail(`备份 manifest 无法读取：${name}：${error.message}`);
  }
}

if (!root || root === path.parse(root).root) fail("必须提供明确的分片根目录，禁止使用文件系统根目录");
if (!existsSync(root) || !statSync(root).isDirectory()) fail(`分片目录不存在：${root}`);

let result;
if (mode === "analyze") result = analyze();
else if (mode === "compact") result = compact();
else if (mode === "gc") result = gc();
else fail(`未知模式：${mode}；可用 analyze、compact、gc`);
console.log(JSON.stringify(result, null, 2));
