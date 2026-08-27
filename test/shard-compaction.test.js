import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT = fileURLToPath(new URL("../devtool/compact-league-shards.js", import.meta.url));

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive:true });
  writeFileSync(filePath, JSON.stringify(value), "utf8");
}

function run(mode, root, ...flags) {
  const result = spawnSync(process.execPath, [SCRIPT, mode, root, ...flags], { encoding:"utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("分片压实将当前引用集中到新 revision，并在移除旧备份后安全回收旧目录", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-shard-compaction-"));
  const root = path.join(directory, "league-shards");
  try {
    writeJson(path.join(root, "revisions/1/archives/season.json"), { season:{ id:"season-1" }, playerStats:{ one:{ appearances:18 } }, cup:{ playerStats:{} } });
    writeFileSync(path.join(root, "revisions/1/obsolete.bin"), Buffer.alloc(4096, 1));
    writeJson(path.join(root, "revisions/2/reports/match.json"), { id:"match-1", events:[{ minute:1 }] });
    writeFileSync(path.join(root, "revisions/2/obsolete.bin"), Buffer.alloc(4096, 2));
    writeJson(path.join(root, "revisions/3/core.json"), { season:{ id:"season-2" }, teams:[] });
    writeJson(path.join(root, "revisions/3/matches-index.json"), { entries:[{ id:"match-1", reportPath:"revisions/2/reports/match.json" }] });
    writeJson(path.join(root, "revisions/3/archives-index.json"), { entries:[{ key:"season-1", path:"revisions/1/archives/season.json" }] });
    writeJson(path.join(root, "manifest.json"), {
      schemaVersion:1,
      revision:3,
      updatedAt:1,
      stateVersion:2,
      shards:{
        core:"revisions/3/core.json",
        matches:"revisions/3/matches-index.json",
        archives:{ index:"revisions/3/archives-index.json", entries:[{ key:"season-1", path:"revisions/1/archives/season.json" }] },
      },
    });

    const analysis = run("analyze", root);
    assert.equal(analysis.manifestRevision, 3);
    assert.equal(analysis.exactReferencedFiles, 5);
    assert.equal(analysis.enoughSpace, true);
    assert.ok(analysis.estimatedReclaimableBytes >= 8192);

    const compacted = run("compact", root, "--apply", "--expected-revision=3");
    assert.equal(compacted.previousRevision, 3);
    assert.equal(compacted.manifestRevision, 4);
    assert.equal(compacted.copiedFiles, 5);
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.revision, 4);
    assert.match(manifest.shards.core, /^revisions\/4\/compacted\//);
    assert.match(manifest.shards.matches, /^revisions\/4\/compacted\//);
    assert.match(manifest.shards.archives.entries[0].path, /^revisions\/4\/compacted\//);
    const rewrittenMatchIndex = JSON.parse(readFileSync(path.join(root, manifest.shards.matches), "utf8"));
    assert.match(rewrittenMatchIndex.entries[0].reportPath, /^revisions\/4\/compacted\//);
    assert.equal(readdirSync(path.join(root, "yellowdogs-league-backups")).some((name) => name.startsWith("before-shard-compaction-3-")), true);

    rmSync(path.join(root, "yellowdogs-league-backups"), { recursive:true, force:true });
    const dryRun = run("gc", root, "--expected-revision=4");
    assert.equal(dryRun.status, "dry-run");
    assert.deepEqual([dryRun.deletableRevisionDirectories, existsSync(path.join(root, "revisions/1")), existsSync(path.join(root, "revisions/2"))], [2, true, true]);
    const collected = run("gc", root, "--apply", "--expected-revision=4");
    assert.equal(collected.status, "deleted");
    assert.equal(existsSync(path.join(root, "revisions/1")), false);
    assert.equal(existsSync(path.join(root, "revisions/2")), false);
    assert.equal(existsSync(path.join(root, "revisions/3")), true);
    assert.equal(existsSync(path.join(root, "revisions/4")), true);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});
