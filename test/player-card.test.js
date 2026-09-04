import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlayerCardViewModel, isPlayerCardViewModel } from "../shared/player-card/player-card-contract.js";
import { playerCardMarkup } from "../client/player-card/player-card.js";

test("player card contract normalizes game portraits and Admin profiles", () => {
  const game = createPlayerCardViewModel({
    id:"p1", name:"一号", sourceName:"Player One", overall:80, effectiveOverall:83, grade:"A", role:"AM", secondaryRole:"RW", club:"黄狗", nationality:"中国",
    portrait:"./assets/player-profiles/a b.webp", portraitPosition:{ x:48, y:51, width:188 },
  });
  const admin = createPlayerCardViewModel({
    id:"p2", name:"二号", overall:75, grade:"B", role:"ST", club:"黄狗", nationality:"中国",
    profile:{ imageUrl:"/assets/player-profiles/admin/hash.webp", x:50, y:52, width:200 },
  });
  assert.equal(game.art.url, "/assets/player-profiles/a b.webp");
  assert.equal(game.overall, 83);
  assert.equal(game.sourceName, "Player One");
  assert.equal(game.secondaryRole, "RW");
  assert.deepEqual(admin.art, { url:"/assets/player-profiles/admin/hash.webp", x:50, y:52, width:200 });
  assert.ok(isPlayerCardViewModel(game));
});

test("standard player card renderer escapes data and exposes stable hooks", () => {
  const markup = playerCardMarkup({
    id:"p<&1", name:"<球员>", overall:88, grade:"S", role:"ST", club:"A&B", nationality:"中国",
    profile:{ imageUrl:"/assets/a.webp", x:50, y:52, width:200 }, traits:["核心"],
  }, { interactive:true, variant:"compact", action:"team-detail" });
  assert.match(markup, /ydl-player-card/);
  assert.match(markup, /player-card-variant-compact/);
  assert.match(markup, /data-player-card-action="team-detail"/);
  assert.match(markup, /data-player-card-id="p&lt;&amp;1"/);
  assert.match(markup, /&lt;球员&gt;/);
  assert.match(markup, /A&amp;B/);
  assert.doesNotMatch(markup, /<球员>/);
});

test("player card renderer supplies a consistent missing-art placeholder for the studio", () => {
  const markup = playerCardMarkup({ id:"p3", name:"待制卡", overall:70, grade:"C", role:"CB" }, {
    variant:"detail", id:"card-preview", imageId:"card-image", showArtPlaceholder:true,
  });
  assert.match(markup, /id="card-preview"/);
  assert.match(markup, /data-player-card-art-placeholder/);
  assert.match(markup, /player-card-variant-detail/);
});

test("canonical card data can be rendered again without losing art or status", () => {
  const first = createPlayerCardViewModel({
    id:"p4", name:"标准卡", overall:81, grade:"A", role:"CM", portrait:"./assets/p4.webp",
    portraitPosition:{ x:49, y:50, width:190 }, state:{ fitness:77, injury:{ matchesRemaining:2 } },
  });
  const second = createPlayerCardViewModel(first);
  assert.deepEqual(second.art, first.art);
  assert.equal(second.status.fitness, 77);
  assert.equal(second.status.injuryMatches, 2);
});

test("card art positioning is bounded by the shared studio contract", () => {
  const card = createPlayerCardViewModel({ id:"p5", portrait:"/assets/p5.webp", portraitPosition:{ x:999, y:-999, width:999 } });
  assert.deepEqual(card.art, { url:"/assets/p5.webp", x:150, y:-50, width:360 });
});

test("active business entry points use the shared player card renderer", () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const relative of ["campaign-entry.js", "admin-v2.js", "client/team/team-controller.js", "client/team/team-controller-ydl.js"]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /playerCardMarkup/);
    assert.doesNotMatch(source, /s4-player-card-head/);
  }
});

test("all nine late S4 legendary profiles stay bound to real card art", () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const registry = JSON.parse(fs.readFileSync(path.join(root, "assets/data/s4-player-profile-registry.json"), "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "assets/data/s4-player-catalog.json"), "utf8"));
  const positions = JSON.parse(fs.readFileSync(path.join(root, "assets/data/s4-legendary-profile-positions.json"), "utf8"));
  const expected = {
    "s4-dlc2-20260803-001":["Alfredo Di Stéfano", "Di Stéfano.webp"],
    "s4-dlc2-20260803-059":["Vítor Baía", "Vítor Baía.webp"],
    "s4-dlc2-20260803-063":["Giuseppe Meazza", "Meazza.webp"],
    "s4-dlc3-20260808-010":["Ferenc Puskás", "Puskás.webp"],
    "s4-dlc3-20260808-011":["Hugo Sánchez", "Sánchez.webp"],
    "s4-dlc3-20260808-015":["Eric Cantona", "Cantona.webp"],
    "s4-dlc3-20260808-016":["Lev Yashin", "Yashin.webp"],
    "s4-dlc3-20260808-020":["George Weah", "Weah.webp"],
    "s4-dlc3-20260808-034":["Franck Ribéry", "Ribéry.webp"],
  };
  for (const [playerId, [profileKey, fileName]] of Object.entries(expected)) {
    const profile = registry.profiles[playerId];
    const player = catalog.find((entry) => entry.id === playerId);
    assert.equal(profile?.profileKey, profileKey, `${playerId} registry profile`);
    assert.equal(profile?.fileName, fileName, `${playerId} registry asset`);
    assert.ok(fs.existsSync(path.join(root, "assets/player-profiles", fileName)), `${fileName} exists`);
    assert.equal(player?.portrait, `./assets/player-profiles/${fileName}`, `${playerId} catalog portrait`);
    assert.deepEqual(player?.portraitPosition, { x:profile.x, y:profile.y, width:profile.width }, `${playerId} catalog position`);
    assert.ok(positions.profiles[profileKey], `${profileKey} position preset`);
  }
});

test("production catalog keeps an English name for every player and shares Messi's source name", () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "assets/data/s4-player-catalog.json"), "utf8"));
  assert.equal(catalog.length, 842);
  assert.equal(catalog.filter((player) => String(player.sourceName ?? "").trim()).length, catalog.length);
  assert.equal(catalog.filter((player) => /\p{Script=Han}/u.test(String(player.sourceName))).length, 0);
  assert.equal(catalog.find((player) => player.id === "legend-messi")?.sourceName, "Lionel Messi");
  assert.equal(catalog.find((player) => player.id === "legend-messi-rat")?.sourceName, "Lionel Messi");
});

test("S4 profile importer accepts public legendary maps and preserves recovered registry entries", () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const source = fs.readFileSync(path.join(root, "scripts/import-s4-player-profiles.mjs"), "utf8");
  assert.match(source, /find\("versus\/dist\/legendary-profiles\.js"\) \?\? find\("versus\/public\/legendary-profiles\.js"\)/);
  assert.match(source, /profiles: \{ \.\.\.\(existingRegistry\.profiles \?\? \{\}\) \}/);
  assert.match(source, /find\(assetDir, fileName\)/);
  const syncSource = fs.readFileSync(path.join(root, "scripts/sync-player-profiles.mjs"), "utf8");
  assert.match(syncSource, /path\.resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)/);
});
