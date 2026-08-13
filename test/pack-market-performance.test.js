import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { S4_PRIVATE_MIXED_LEGEND_RATE, YellowDogsLeagueService } from "../versus/league-service.js";
import { S4_PACK_PRICES } from "../versus/s4-balance.js";

const NOW = Date.parse("2026-08-10T18:00:00+08:00");
const account = (id) => ({ id, nickname:id });

function join(service, user) {
  service.beginDraft(user, user.id.slice(-20));
  service.autoDraft(user);
  service.finishDraft(user);
  return service.accountTeam(user.id);
}

test("direct private pack batches use one candidate scan and return card deltas instead of ownTeam", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("pack-batch-performance");
  join(service, user);
  const cardsBefore = service.playerCards(user.id).length;
  const packs = service.grantS4Pack(user.id, "private-mixed", 100, { source:"performance-test" });
  let candidateScans = 0;
  const privatePackCandidates = service.privatePackCandidates.bind(service);
  service.privatePackCandidates = (...args) => {
    candidateScans += 1;
    return privatePackCandidates(...args);
  };
  service.ownTeamView = () => { throw new Error("direct compact batch must not rebuild ownTeam"); };

  const result = service.openS4PacksBatch(user, packs.map((pack) => pack.id), { compact:true });

  assert.equal(candidateScans, 1);
  assert.equal("ownTeam" in result, false);
  assert.equal(result.packBatchOpening.results.length, 100);
  assert.equal(result.s4CardDeltas.length, 100);
  assert.ok(result.s4PlayerDeltas.length > 0);
  assert.ok(result.s4PlayerDeltas.every((delta) => delta && Number.isFinite(delta.effectiveOverall)));
  assert.equal(service.playerCards(user.id).length, cardsBefore + 100);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 500_000);
});

test("private mixed packs have an exclusive 1.5 percent legendary hit while position packs do not", () => {
  assert.equal(S4_PRIVATE_MIXED_LEGEND_RATE, 0.015);
  assert.equal(S4_PACK_PRICES["legend-random"], 10000);

  const mixedService = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const mixedUser = account("private-mixed-legend-hit");
  join(mixedService, mixedUser);
  mixedService.rng = () => .01;
  const mixedPack = mixedService.grantS4Pack(mixedUser.id, "private-mixed", 1)[0];
  const mixedResult = mixedService.openS4Pack(mixedUser, mixedPack.id, { compact:true });
  assert.equal(mixedResult.packOpening.legendaryHit, true);
  assert.equal(mixedResult.packOpening.player.grade, "S");
  assert.equal(mixedResult.packOpening.player.legendary, true);
  assert.equal(mixedResult.packOpening.card.acquisitionSource, "private-mixed-legend-hit");

  const positionService = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const positionUser = account("private-position-no-legend-hit");
  join(positionService, positionUser);
  positionService.rng = () => 0;
  const positionPack = positionService.grantS4Pack(positionUser.id, "private-att", 1)[0];
  const positionResult = positionService.openS4Pack(positionUser, positionPack.id, { compact:true });
  assert.equal(positionResult.packOpening.legendaryHit, false);
  assert.notEqual(positionResult.packOpening.player.grade, "S");
});

test("choice pack completion returns complete family metadata without rebuilding ownTeam", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("choice-pack-delta");
  join(service, user);
  service.wallet(user.id).balance = 1_000_000;
  const legacyPack = service.grantS4Pack(user.id, "public-carnival", 1, { source:"legacy-performance-test" })[0];
  const started = service.openS4Pack(user, legacyPack.id, { compact:true });
  const selectedPlayerId = started.s4Packs.offer.players[0].id;
  service.ownTeamView = () => { throw new Error("choice compact result must not rebuild ownTeam"); };

  const selected = service.chooseS4Pack(user, started.s4Packs.offer.id, selectedPlayerId, { compact:true });

  assert.equal("ownTeam" in selected, false);
  assert.equal(selected.s4CardDeltas.length, 50);
  assert.equal(selected.s4PlayerDeltas[0].playerId, selectedPlayerId);
  assert.equal(selected.s4PlayerDeltas[0].ownsRights, true);
  assert.equal(selected.s4PlayerDeltas[0].ownershipReturnPreview.recoveredCardCount, 50);
});

test("market list and cancel compact receipts avoid rebuilding ownTeam and all listings", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("market-receipt-performance");
  const team = join(service, user);
  const playerId = team.rosterIds[0];
  const card = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"performance-test" });
  service.ownTeamView = () => { throw new Error("market receipt must not rebuild ownTeam"); };
  service.activeListingsView = () => { throw new Error("market receipt must not rebuild every listing"); };

  const listed = service.listCard(user, card.id, 1_000_000, { compact:true });
  assert.equal("ownTeam" in listed, false);
  assert.equal("listings" in listed, false);
  assert.equal(listed.listing.cardId, card.id);
  assert.equal("attributes" in listed.listing.player, false);

  const cancelled = service.cancelListing(user, listed.listing.id, { compact:true });
  assert.equal("ownTeam" in cancelled, false);
  assert.equal("listings" in cancelled, false);
  assert.equal(cancelled.cancelledListingId, listed.listing.id);
});

test("market purchases return the transferred family delta instead of the buyer full card warehouse", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("market-delta-seller");
  const buyer = account("market-delta-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = sellerTeam.rosterIds[0];
  const card = service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"performance-test" });
  const listed = service.listCard(seller, card.id, 1_000_000, { compact:true });
  service.wallet(buyer.id).balance = 2_000_000;
  service.ownTeamView = () => { throw new Error("market purchase must not rebuild buyer ownTeam"); };

  const purchased = service.buyListing(buyer, listed.listing.id, { compact:true });

  assert.equal("ownTeam" in purchased, false);
  assert.equal("listings" in purchased, false);
  assert.equal(purchased.marketPurchase.player.id, playerId);
  assert.equal(purchased.s4CardDeltas[0].card.id, card.id);
  assert.equal(purchased.s4PlayerDeltas[0].playerId, playerId);
  assert.equal(service.state.s4Assets.cards[card.id].ownerId, buyer.id);
});

test("large pack and market interfaces mount bounded collections", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  assert.match(appSource, /const LEAGUE_MARKET_PAGE_SIZE = 24/);
  assert.match(appSource, /items:entries\.slice\(start, start \+ LEAGUE_MARKET_PAGE_SIZE\)/);
  assert.match(appSource, /同类卡包已合并显示/);
  assert.match(appSource, /const pageSize = 20/);
  assert.match(appSource, /function applyLeagueMutationDeltas\(nextLeague\)/);
});
