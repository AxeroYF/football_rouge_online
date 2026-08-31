import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ATTRIBUTE_NAMES, PlayerLibraryService } from "../server/application/player-library-service.mjs";

function player(id, name = id) {
  return { id, name, sourceName:name, role:"ST", secondaryRole:null, pool:"ATT", overall:70, grade:"C", nationality:"中国", club:"测试队", heightCm:180, preferredFoot:"right", attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 70])), referenceAttributes:Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 70])), isX:false };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ydl-player-library-"));
  fs.mkdirSync(path.join(root, "assets/data"), { recursive:true }); fs.mkdirSync(path.join(root, "assets/player-profiles"), { recursive:true });
  const catalog = [player("p1", "一号球员")];
  fs.writeFileSync(path.join(root, "assets/data/s4-player-base-catalog.json"), JSON.stringify(catalog));
  fs.writeFileSync(path.join(root, "assets/data/s4-player-catalog.json"), JSON.stringify(catalog));
  fs.writeFileSync(path.join(root, "assets/data/s4-production-content-overrides.json"), JSON.stringify({ schemaVersion:2, players:{} }));
  fs.writeFileSync(path.join(root, "assets/data/s4-player-profile-registry.json"), JSON.stringify({ schemaVersion:1, profiles:{} }));
  const campaign = { playerDatabase:[...catalog], catalog:[...catalog] };
  return { root, catalog, campaign, service:new PlayerLibraryService({ root, catalog, campaign }) };
}

test("PlayerLibraryService audits, edits, stages, publishes and maintains card art", () => {
  const value = fixture();
  try {
    assert.equal(value.service.audit().activePlayers, 1);
    const attributes = Object.fromEntries(ATTRIBUTE_NAMES.map((key) => [key, 82]));
    const edited = value.service.updatePlayer("p1", { name:"一号球星", role:"AM", attributes });
    assert.equal(edited.name, "一号球星");
    assert.equal(JSON.parse(fs.readFileSync(path.join(value.root, "assets/data/s4-production-content-overrides.json"))).players.p1.name, "一号球星");

    const batch = value.service.createBatch({ name:"夏季新卡" });
    const draft = value.service.createDraft({ id:"p2", name:"二号球员", role:"ST", grade:"C", nationality:"中国", club:"测试队", heightCm:181, batchId:batch.id, attributes });
    assert.equal(draft.status, "draft");
    const profile = value.service.saveProfile("p2", { imageDataUrl:`data:image/webp;base64,${Buffer.from("webp-test").toString("base64")}`, x:51, y:53, width:190 });
    assert.match(profile.fileName, /^admin\//);
    const published = value.service.publishDrafts(["p2"]);
    assert.equal(published[0].status, "active");
    assert.equal(value.catalog.length, 2);
    assert.equal(value.service.audit().profileEntries, 1);
    assert.equal(value.service.listBatches()[0].status, "published");
  } finally { fs.rmSync(value.root, { recursive:true, force:true }); }
});
