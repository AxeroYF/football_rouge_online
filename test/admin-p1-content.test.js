import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, mkdir, rmdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const root = await mkdtemp(path.join(os.tmpdir(), "yffm1-admin-p1-"));
const contentPath = path.join(root, "content.json");
process.env.YDL_CONTENT_OVERRIDES_PATH = contentPath;
process.env.YDL_PLAYER_CARD_STUDIO_PATH = path.join(root, "studio.json");
process.env.YDL_PLAYER_PROFILE_ROOT = path.join(root, "profiles");
const content = await import("../versus/ydl-content-store.js");
const { REAL_PLAYERS, REAL_PLAYER_POOLS } = await import("../versus/player-pool.js");
const studio = await import("../versus/player-card-studio-store.js");
after(async () => {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "yffm1-admin-p1-"));
  await rm(root, { recursive:true, force:true });
});

test("failed cross-field player validation changes neither the runtime object nor pool indexes", async () => {
  const player = REAL_PLAYERS.find(player => player.role === "GK" && player.grade !== "S");
  const before = JSON.stringify(player);
  const pools = JSON.stringify(Object.values(REAL_PLAYER_POOLS).map(players => players.map(player => player.id)));
  await assert.rejects(content.updateYdlPlayer(player.id, { name:"Must not apply", role:"ST", secondaryRole:"ST" }), /副位置/);
  assert.equal(JSON.stringify(player), before);
  assert.equal(JSON.stringify(Object.values(REAL_PLAYER_POOLS).map(players => players.map(player => player.id))), pools);
  const trait = content.ydlContentSection("traits").traits.find(trait => trait.status === "active");
  await assert.rejects(content.updateYdlTrait(trait.id, { name:"Must not apply", rules:{} }), /JSON数组/);
  assert.deepEqual(content.ydlContentSection("traits").traits.find(entry => entry.id === trait.id), trait);
});

test("disk failure leaves runtime values intact and later commands still work", async () => {
  const player = REAL_PLAYERS.find(player => player.role === "GK" && player.grade !== "S");
  await content.updateYdlPlayer(player.id, { name:player.name });
  const before = JSON.stringify(player), bytes = await readFile(contentPath, "utf8");
  const held = path.join(root, "content-held.json");
  await rename(contentPath, held); await mkdir(contentPath);
  try { await assert.rejects(content.updateYdlPlayer(player.id, { name:"Unsaved name" })); }
  finally { await rmdir(contentPath); await rename(held, contentPath); }
  assert.equal(JSON.stringify(player), before);
  assert.equal(await readFile(contentPath, "utf8"), bytes);
  await Promise.all([content.updateYdlPlayer(player.id, { name:"Concurrent name" }), content.updateYdlPlayer(player.id, { club:"Concurrent club" })]);
  assert.equal(player.name, "Concurrent name"); assert.equal(player.club, "Concurrent club");
  const stored = JSON.parse(await readFile(contentPath, "utf8"));
  assert.equal(stored.players[player.id].name, "Concurrent name"); assert.equal(stored.players[player.id].club, "Concurrent club");
});

test("invalid card placement never overwrites the previous image or metadata; concurrent uploads persist together", async () => {
  const players = REAL_PLAYERS.slice(0, 3);
  const image = color => sharp({ create:{ width:30, height:45, channels:4, background:color } }).png().toBuffer();
  const originalImage = await image({ r:30, g:80, b:120, alpha:1 });
  const changedImage = await image({ r:120, g:10, b:20, alpha:1 });
  const original = await studio.savePlayerCardProfile(players[0].id, { imageBuffer:originalImage });
  const asset = path.join(root, "profiles", "webp", original.optimizedFileName);
  const before = await readFile(asset);
  await assert.rejects(studio.savePlayerCardProfile(players[0].id, { imageBuffer:changedImage, xPercent:"invalid" }), /横向位置/);
  assert.deepEqual(await readFile(asset), before);
  assert.deepEqual(studio.playerCardStudioView().profiles[players[0].id], original);
  const profiles = await Promise.all(players.map(player => studio.savePlayerCardProfile(player.id, { imageBuffer:changedImage, xPercent:48 })));
  const persisted = JSON.parse(await readFile(path.join(root, "studio.json"), "utf8"));
  for (const profile of profiles) assert.equal(persisted.profiles[profile.playerId].contentHash, profile.contentHash);
  assert.deepEqual(await readFile(asset), before, "immutable prior asset remains valid for cached pages");
});
