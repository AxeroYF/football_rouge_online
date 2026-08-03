import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const NOW = Date.parse("2026-07-23T10:01:00+08:00");

function account(id, nickname) {
  return { id, nickname };
}

test("分片联赛存储可重载比赛详情并保持非目标分片不变", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-sharded-service-"));
  const statePath = path.join(directory, "league-state");
  try {
    const service = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const user = account("shard-owner", "Shard Owner");
    service.beginDraft(user, "Shard FC");
    service.autoDraft(user);
    service.finishDraft(user);
    assert.equal(existsSync(path.join(statePath, "manifest.json")), true);

    service.simulateNextRound();
    const match = service.state.matches.find((entry) => entry.report);
    assert.ok(match);
    const matchCount = service.state.matches.length;
    const reportEventCount = match.report.events.length;
    const revisionBefore = service.shardStore.manifest.revision;
    const matchIndexBefore = readFileSync(path.join(statePath, service.shardStore.manifest.shards.matches), "utf8");

    const detail = service.matchDetail(user, match.id);
    assert.equal(detail.teams.length, 2);
    assert.equal(service.teamHistory("ydl-team-1").length > 0, true);

    service.save({ scopes:["core"] });
    const revisionAfter = service.shardStore.manifest.revision;
    assert.equal(revisionAfter, revisionBefore + 1);
    const matchIndexAfter = readFileSync(path.join(statePath, service.shardStore.manifest.shards.matches), "utf8");
    assert.equal(matchIndexAfter, matchIndexBefore);

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    assert.equal(reloaded.state.matches.length, matchCount);
    assert.equal(reloaded.state.matches.find((entry) => entry.id === match.id).report.events.length, reportEventCount);
    assert.equal(reloaded.matchDetail(user, match.id).teams.length, 2);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("分片服务在保存后保留最近 manifest 备份", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-sharded-backup-"));
  const statePath = path.join(directory, "league-state");
  const backupDir = path.join(directory, "backups");
  try {
    const service = new YellowDogsLeagueService({ statePath, backupDir, now:() => NOW, rng:() => .37 });
    service.save({ forceFull:true });
    assert.equal(readdirSync(backupDir).some((name) => name.endsWith(".manifest.json")), true);
    const manifest = JSON.parse(readFileSync(path.join(statePath, "manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    const reloaded = new YellowDogsLeagueService({ statePath, backupDir, now:() => NOW, rng:() => .37 });
    assert.equal(reloaded.state.teams.length, 10);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("分片 revision 清理在连续保存时限频执行", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-sharded-cleanup-"));
  const statePath = path.join(directory, "league-state");
  try {
    const service = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    let cleanupCount = 0;
    service.shardStore.lastCleanupAt = 0;
    service.shardStore.cleanupRevisions = () => { cleanupCount += 1; };
    service.save({ scopes:["core"], skipDailyBackup:true });
    service.save({ scopes:["core"], skipDailyBackup:true });
    assert.equal(cleanupCount, 1);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("分片模式后台发卡与+4特性绑定使用轻量响应并可重载", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-sharded-card-mutations-"));
  const statePath = path.join(directory, "league-state");
  try {
    const user = account("shard-card-owner", "Shard Card Owner");
    const service = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => 0 });
    service.beginDraft(user, "Shard Card FC");
    service.autoDraft(user);
    service.finishDraft(user);
    const playerId = service.accountTeam(user.id).rosterIds[0];

    const granted = service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:3, quantity:2 }, { compact:true });
    assert.equal(granted.grant.quantity, 2);
    assert.equal(granted.cards.length, 2);
    assert.equal("teams" in granted, false);
    const [mainCard, materialCard] = granted.cards;

    const enhanced = service.enhanceS4Card(user, mainCard.id, materialCard.id, false, { compact:true });
    assert.equal(enhanced.enhancementResult.afterLevel, 4);
    assert.equal(enhanced.enhancementResult.traitOffer.unlockLevel, 4);
    const selectedTrait = enhanced.enhancementResult.traitOffer.traits[0];
    const bound = service.chooseS4EnhancementTrait(user, enhanced.enhancementResult.traitOffer.id, selectedTrait.id, { compact:true });
    assert.equal(bound.enhancementTraitResult.trait.id, selectedTrait.id);
    assert.equal("ownTeam" in bound, false);

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => 0 });
    const reloadedCard = reloaded.state.s4Assets.cards[mainCard.id];
    assert.equal(reloadedCard.upgradeLevel, 4);
    assert.ok(reloadedCard.traitIds.includes(selectedTrait.id));
    assert.equal(reloaded.state.s4Assets.cards[materialCard.id].status, "recycled");
    assert.ok(reloaded.state.s4Packs.cardGrants.some((grant) => grant.id === granted.grant.id));
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});
