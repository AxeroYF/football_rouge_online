import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { trackedRawReference } from "../versus/league-shard-store.js";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { REAL_PLAYER_BY_ID } from "../versus/player-pool.js";

const NOW = Date.parse("2026-08-09T16:00:00+08:00");
const account = (id) => ({ id, nickname:id });

function join(service, user) {
  service.beginDraft(user, user.id.slice(-20));
  service.autoDraft(user);
  service.finishDraft(user);
  return service.accountTeam(user.id);
}

function nonLegendBench(service, user) {
  const team = service.accountTeam(user.id);
  return team.rosterIds.find((playerId) => !team.preferredStarterIds.includes(playerId) && REAL_PLAYER_BY_ID[playerId].grade !== "S");
}

function placeTemporaryStarters(service, user, playerIds) {
  const team = service.accountTeam(user.id);
  const replacedIds = team.preferredStarterIds.slice(-playerIds.length);
  const starterIds = [...team.preferredStarterIds.slice(0, -playerIds.length), ...playerIds];
  const positionPresets = Object.fromEntries(Object.entries(team.positionPresets).map(([key, source]) => {
    const positions = { ...source };
    playerIds.forEach((playerId, index) => {
      positions[playerId] = { ...positions[replacedIds[index]] };
      delete positions[replacedIds[index]];
    });
    return [key, positions];
  }));
  service.saveTeam(user, {
    starterIds,
    positionPresets,
    formationLinePresets:team.formationLinePresets,
    tacticalPlans:team.tacticalPlans,
  });
  return replacedIds;
}

test("card trade preview does not clone the complete league state and compact responses avoid full view", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-performance-sender");
  const receiver = account("trade-performance-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:6, acquisitionSource:"repeat-pack" });

  Object.defineProperty(trackedRawReference(service.state), "fullStateCloneSentinel", {
    configurable:true,
    enumerable:true,
    get() { throw new Error("card trade must not enumerate the complete league state"); },
  });
  service.view = () => { throw new Error("compact card trade response must not build the full league view"); };

  const created = service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 500, { compact:true });
  const offer = service.state.cardTradeOffers.at(-1);
  assert.equal(created.compact, true);
  assert.equal(created.cardTradeResult.status, "pending");
  assert.ok(created.tradeLockedCardIds.includes(offered.id));

  const accepted = service.resolveCardTradeOffer(receiver, offer.id, "accept", { compact:true });
  assert.equal(accepted.compact, true);
  assert.equal(accepted.cardTradeResult.status, "accepted");
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, receiver.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, sender.id);
  assert.equal(accepted.tradeLockedCardIds.includes(offered.id), false);
  assert.equal(accepted.cardTradeOffers.find((entry) => entry.id === offer.id)?.status, "accepted");
});

test("card trade repairs all lineup schemes when two starters leave in one trade", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-lineup-sender");
  const receiver = account("trade-lineup-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const occupiedIds = new Set([...senderTeam.rosterIds, ...receiverTeam.rosterIds]);
  const temporaryPlayerIds = Object.values(REAL_PLAYER_BY_ID)
    .filter((player) => player.role && !occupiedIds.has(player.id))
    .slice(0, 3)
    .map((player) => player.id);
  assert.equal(temporaryPlayerIds.length, 3);

  const firstOutgoing = service.grantS4Card(senderTeam, temporaryPlayerIds[0], { grantOwnership:false, upgradeLevel:6, acquisitionSource:"trade-lineup-test" });
  const secondOutgoing = service.grantS4Card(senderTeam, temporaryPlayerIds[1], { grantOwnership:false, upgradeLevel:1, acquisitionSource:"trade-lineup-test" });
  const incoming = service.grantS4Card(receiverTeam, temporaryPlayerIds[2], { grantOwnership:false, upgradeLevel:5, acquisitionSource:"trade-lineup-test" });
  placeTemporaryStarters(service, sender, temporaryPlayerIds.slice(0, 2));
  service.updateLineupScheme(sender, { action:"create", name:"交易测试方案" });

  const vacatedPositions = Object.fromEntries(Object.entries(senderTeam.positionPresets).map(([key, positions]) => [
    key,
    temporaryPlayerIds.slice(0, 2).map((playerId) => ({ ...positions[playerId] })),
  ]));
  service.createCardTradeOffer(sender, receiver.id, [firstOutgoing.id, secondOutgoing.id], [incoming.id], 0, { compact:true });
  const offer = service.state.cardTradeOffers.at(-1);
  const result = service.resolveCardTradeOffer(receiver, offer.id, "accept", { compact:true });

  assert.equal(result.cardTradeResult.status, "accepted");
  assert.equal(senderTeam.preferredStarterIds.length, 11);
  assert.equal(new Set(senderTeam.preferredStarterIds).size, 11);
  assert.ok(senderTeam.preferredStarterIds.every((playerId) => senderTeam.rosterIds.includes(playerId)));
  assert.ok(temporaryPlayerIds.slice(0, 2).every((playerId) => !senderTeam.rosterIds.includes(playerId)));
  assert.ok(senderTeam.lineupSchemes.every((scheme) => scheme.preferredStarterIds.length === 11));
  assert.ok(senderTeam.lineupSchemes.every((scheme) => scheme.preferredStarterIds.every((playerId) => senderTeam.rosterIds.includes(playerId))));
  assert.ok(senderTeam.lineupSchemes.every((scheme) => temporaryPlayerIds.slice(0, 2).every((playerId) => !scheme.preferredStarterIds.includes(playerId))));
  Object.entries(vacatedPositions).forEach(([key, positions]) => {
    const occupiedPositions = Object.values(senderTeam.positionPresets[key]);
    positions.forEach((position) => assert.ok(occupiedPositions.some((candidate) => candidate.x === position.x && candidate.y === position.y)));
  });
  assert.equal(service.selectActualLineup(senderTeam, 1).lineup.length, 11);
});

test("loading an older nine-player card-trade lineup repairs it from saved presets", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-card-trade-lineup-repair-"));
  const statePath = path.join(directory, "league.json");
  try {
    const first = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const user = account("legacy-trade-lineup-owner");
    const other = account("legacy-trade-lineup-other");
    const team = join(first, user);
    const otherTeam = join(first, other);
    const occupiedIds = new Set([...team.rosterIds, ...otherTeam.rosterIds]);
    const temporaryPlayerIds = Object.values(REAL_PLAYER_BY_ID)
      .filter((player) => player.role && !occupiedIds.has(player.id))
      .slice(0, 3)
      .map((player) => player.id);
    const outgoingCards = temporaryPlayerIds.slice(0, 2).map((playerId, index) => first.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:index ? 1 : 6, acquisitionSource:"legacy-trade-lineup-test" }));
    const incomingCard = first.grantS4Card(otherTeam, temporaryPlayerIds[2], { grantOwnership:false, upgradeLevel:5, acquisitionSource:"legacy-trade-lineup-test" });
    placeTemporaryStarters(first, user, temporaryPlayerIds.slice(0, 2));
    const legacyLineupSchemes = structuredClone(team.lineupSchemes);
    const legacyPositionPresets = structuredClone(team.positionPresets);
    const legacyPositions = structuredClone(team.positions);
    const legacyStarterIds = [...team.preferredStarterIds];
    first.createCardTradeOffer(user, other.id, outgoingCards.map((card) => card.id), [incomingCard.id], 0, { compact:true });
    const offer = first.state.cardTradeOffers.at(-1);
    first.resolveCardTradeOffer(other, offer.id, "accept", { compact:true });

    const departedIds = temporaryPlayerIds.slice(0, 2);
    team.lineupSchemes = legacyLineupSchemes;
    team.preferredStarterIds = legacyStarterIds.filter((playerId) => !departedIds.includes(playerId));
    team.positionPresets = legacyPositionPresets;
    team.positions = legacyPositions;
    departedIds.forEach((playerId) => { team.playerState[playerId] = { fitness:77, suspension:0, cupSuspension:0, injuryRounds:0 }; });
    first.save({ skipDailyBackup:true });

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const repaired = reloaded.accountTeam(user.id);
    assert.equal(repaired.preferredStarterIds.length, 11);
    assert.ok(repaired.preferredStarterIds.every((playerId) => repaired.rosterIds.includes(playerId)));
    assert.ok(repaired.lineupSchemes.every((scheme) => scheme.preferredStarterIds.length === 11));
    assert.ok(repaired.lineupSchemes.every((scheme) => departedIds.every((playerId) => !scheme.preferredStarterIds.includes(playerId))));
    assert.ok(departedIds.every((playerId) => !(playerId in repaired.playerState)));
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("card trade API requests compact mutation responses", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../versus/api.js", import.meta.url), "utf8"));
  assert.match(source, /createCardTradeOffer\([^\n]+\{ compact:true \}\)/);
  assert.match(source, /resolveCardTradeOffer\([^\n]+\{ compact:true \}\)/);
  assert.match(source, /withdrawCardTradeOffer\([^\n]+\{ compact:true \}\)/);
});
