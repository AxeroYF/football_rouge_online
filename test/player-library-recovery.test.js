import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverPlayerLibrary } from "../scripts/recover-s4-player-library.mjs";

const ATTRIBUTE_NAMES = [
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ydl-player-recovery-"));
  fs.mkdirSync(path.join(root, "assets/data"), { recursive:true });
  fs.mkdirSync(path.join(root, "assets/player-profiles/s4-imported"), { recursive:true });
  const attributes = Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 70]));
  const catalog = [{ id:"p1", name:"一号球员", role:"ST", pool:"ATT", overall:70, grade:"C", nationality:"中国", club:"测试队", attributes, portrait:null, portraitPosition:null }];
  fs.writeFileSync(path.join(root, "assets/data/s4-player-base-catalog.json"), JSON.stringify(catalog));
  fs.writeFileSync(path.join(root, "assets/data/s4-player-catalog.json"), JSON.stringify(catalog));
  fs.writeFileSync(path.join(root, "assets/data/s4-player-profile-registry.json"), JSON.stringify({ schemaVersion:1, profiles:{} }));
  return { root, attributes };
}

test("restores published players and hashed studio profiles idempotently", () => {
  const value = fixture();
  try {
    const hash = "0123456789abcdef01234567.webp";
    fs.writeFileSync(path.join(value.root, "assets/player-profiles/s4-imported", hash), "webp-test");
    const studio = {
      schemaVersion:2, updatedAt:"2026-08-21T10:35:15.000Z",
      batches:{ batch1:{ id:"batch1", name:"DLC4", status:"published" } },
      published:{ p2:{ id:"p2", name:"二号球员", sourceName:"Player Two", role:"AM", secondaryRole:"RW", overall:82, grade:"A", nationality:"中国", club:"测试队", heightCm:181, preferredFoot:"left", attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 82])), batchId:"batch1" } },
      profiles:{ p1:{ playerId:"p1", optimizedFileName:hash, sourceFileName:"one.png", xPercent:51, yPercent:53, widthPercent:190, contentHash:"abc" } },
    };
    const first = recoverPlayerLibrary({ root:value.root, studio, now:"2026-08-30T00:00:00.000Z" });
    assert.equal(first.activePlayers, 2);
    assert.equal(first.addedToCatalog, 1);
    assert.equal(first.existingPlayersGivenProfiles, 1);
    const catalog = JSON.parse(fs.readFileSync(path.join(value.root, "assets/data/s4-player-catalog.json")));
    assert.equal(catalog.find((entry) => entry.id === "p1").portrait, `./assets/player-profiles/s4-imported/${hash}`);
    assert.equal(catalog.find((entry) => entry.id === "p2").sourceName, "Player Two");
    const registry = JSON.parse(fs.readFileSync(path.join(value.root, "assets/data/s4-player-profile-registry.json")));
    assert.equal(registry.profiles.p1.fileName, `s4-imported/${hash}`);
    const admin = JSON.parse(fs.readFileSync(path.join(value.root, "data/player-library-admin.json")));
    assert.equal(admin.librarySource, "YDL");
    assert.deepEqual(admin.batches, {});
    assert.equal(catalog.find((entry) => entry.id === "p2").librarySource, "YDL");
    const second = recoverPlayerLibrary({ root:value.root, studio, now:"2026-08-30T00:00:00.000Z" });
    assert.equal(second.addedToCatalog, 0);
    assert.equal(second.activePlayers, 2);
  } finally { fs.rmSync(value.root, { recursive:true, force:true }); }
});

test("refuses to create mappings when a hashed asset is missing", () => {
  const value = fixture();
  try {
    const studio = { published:{}, profiles:{ p1:{ optimizedFileName:"fedcba9876543210fedcba98.webp", xPercent:50, yPercent:50, widthPercent:180 } } };
    assert.throws(() => recoverPlayerLibrary({ root:value.root, studio }), /缺少 1 个卡画文件/);
  } finally { fs.rmSync(value.root, { recursive:true, force:true }); }
});
