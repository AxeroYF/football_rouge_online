import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const NOW = Date.parse("2026-07-23T10:01:00+08:00");

test("sharded service rejects a non-empty directory without a manifest", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-sharded-invalid-"));
  const statePath = path.join(directory, "league-state");
  try {
    mkdirSync(statePath, { recursive:true });
    writeFileSync(path.join(statePath, "unexpected.txt"), "do not initialize", "utf8");
    assert.throws(
      () => new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 }),
      /missing manifest\.json/,
    );
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});
