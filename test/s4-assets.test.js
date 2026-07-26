import assert from "node:assert/strict";
import test from "node:test";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { assertS4AssetInvariants, ownershipOwner } from "../versus/s4-assets.js";
import { REAL_PLAYER_BY_ID } from "../versus/player-pool.js";
import { VERSUS_TRAIT_CARDS } from "../versus/trait-pool.js";

const NOW = Date.parse("2026-07-26T12:00:00+08:00");
const account = (id) => ({ id, nickname:id });

function join(service, user) {
  service.beginDraft(user, `${user.id}-team`);
  service.autoDraft(user);
  service.finishDraft(user);
  return service.accountTeam(user.id);
}

function nonLegendBench(service, user) {
  const team = service.accountTeam(user.id);
  return team.rosterIds.find((playerId) => !team.preferredStarterIds.includes(playerId) && !REAL_PLAYER_BY_ID[playerId].legendAbility);
}

test("S4新赛季选秀为每名球员创建独立卡，并为非传奇建立有锚点卡的所有权", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("s4-owner");
  const team = join(service, user);
  const assets = service.view(user).ownTeam.s4Assets;

  assert.equal(assets.cards.length, 22);
  assert.equal(assets.rosterSlotsUsed, 22);
  assert.equal(new Set(assets.cards.map((card) => card.id)).size, 22);
  assert.ok(team.rosterIds.every((playerId) => REAL_PLAYER_BY_ID[playerId].legendAbility || ownershipOwner(service.state, playerId) === user.id));
  assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
});

test("球员卡公开数据包含可直接展示的特性名称", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("s4-trait-card-owner");
  join(service, user);
  const playerId = nonLegendBench(service, user);
  const card = service.representativeCard(user.id, playerId);
  const trait = VERSUS_TRAIT_CARDS[0];
  card.traitIds = [trait.id];

  const publicCard = service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((entry) => entry.id === card.id);
  assert.deepEqual(publicCard.traits, [{ id:trait.id, name:trait.name }]);
});

test("持有所有权的最后一张卡不能静默解约，确认后卡片与所有权同步回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("last-card-owner");
  join(service, user);
  const playerId = nonLegendBench(service, user);
  const card = service.representativeCard(user.id, playerId);

  assert.throws(() => service.releaseCard(user, card.id, false), /最后一张卡/);
  service.releaseCard(user, card.id, true);
  assert.equal(service.playerCards(user.id, playerId).length, 0);
  assert.equal(ownershipOwner(service.state, playerId), null);
  assert.ok(!service.accountTeam(user.id).rosterIds.includes(playerId));
});

test("+2及以上单卡不能使用普通解约", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("protected-card-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const card = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:2, acquisitionSource:"repeat-pack" });

  assert.throws(() => service.releaseCard(user, card.id, false), /\+2及以上/);
  assert.equal(service.state.s4Assets.cards[card.id].status, "active");
});

test("出售最后一张单卡会把非传奇所有权同步转移给买家", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("last-card-seller");
  const buyer = account("last-card-buyer");
  const sellerTeam = join(service, seller);
  const buyerTeam = join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const card = service.representativeCard(seller.id, playerId);
  service.wallet(buyer.id).balance = 100000;

  const listed = service.listCard(seller, card.id, 5000).listings.find((entry) => entry.cardId === card.id);
  assert.equal(listed.includesOwnership, true);
  service.buyListing(buyer, listed.id);

  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  assert.equal(service.playerCards(seller.id, playerId).length, 0);
  assert.equal(service.playerCards(buyer.id, playerId).length, 1);
  assert.ok(!sellerTeam.rosterIds.includes(playerId));
  assert.ok(buyerTeam.rosterIds.includes(playerId));
});

test("市场获得的+3以上单卡在买家没有所有权时不占33人大名单额度", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("enhanced-card-seller");
  const buyer = account("enhanced-card-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const enhanced = service.grantS4Card(sellerTeam, playerId, {
    grantOwnership:false,
    upgradeLevel:5,
    acquisitionSource:"repeat-pack",
  });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listCard(seller, enhanced.id, 8000).listings.find((entry) => entry.cardId === enhanced.id);
  service.buyListing(buyer, listing.id);
  const transferred = service.state.s4Assets.cards[enhanced.id];

  assert.equal(ownershipOwner(service.state, playerId), seller.id);
  assert.equal(transferred.ownerId, buyer.id);
  assert.equal(transferred.upgradeLevel, 5);
  assert.equal(service.view(buyer).ownTeam.roster.find((player) => player.id === playerId).cards[0].rosterExempt, true);
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
});

test("玩家直接交易获得的+3以上单卡同样不占名单额度", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("direct-card-seller");
  const buyer = account("direct-card-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const enhanced = service.grantS4Card(sellerTeam, playerId, {
    grantOwnership:false,
    upgradeLevel:3,
    acquisitionSource:"repeat-pack",
  });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);
  service.wallet(buyer.id).balance = 100000;

  service.directTradeCard(seller, buyer, enhanced.id, 6000);

  const transferred = service.state.s4Assets.cards[enhanced.id];
  assert.equal(transferred.acquisitionSource, "direct-trade");
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
  assert.equal(service.view(buyer).ownTeam.roster.find((player) => player.id === playerId).cards[0].rosterExempt, true);
});

test("所有权出售保留卖家最高卡、给无卡买家一张随权卡并回收其余卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("rights-seller");
  const buyer = account("rights-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const highest = service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const middle = service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:2, acquisitionSource:"repeat-pack" });
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000, highest.id).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  service.buyListing(buyer, listing.id);

  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  assert.deepEqual(service.playerCards(seller.id, playerId).map((card) => card.id), [highest.id]);
  assert.equal(service.playerCards(buyer.id, playerId).length, 1);
  assert.equal(service.state.s4Assets.cards[middle.id].status, "recycled");
  assert.ok(service.state.listings.find((entry) => entry.id === listing.id).recoveryAmount > 0);
  assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
});

test("主动返还所有权时保留最高卡并强制回收其余同名卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("rights-returner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const highest = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const extra = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });

  service.returnOwnership(user, playerId);

  assert.equal(ownershipOwner(service.state, playerId), null);
  assert.deepEqual(service.playerCards(user.id, playerId).map((card) => card.id), [highest.id]);
  assert.equal(service.state.s4Assets.cards[extra.id].status, "recycled");
  assert.equal(service.rosterSlotsUsed(user.id), 22);
});

test("开启全新赛季直接清空S4资产，不迁移旧名单", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("fresh-s4-owner");
  join(service, user);
  assert.ok(Object.keys(service.state.s4Assets.cards).length > 0);

  service.startFreshSeason();

  assert.equal(Object.keys(service.state.s4Assets.cards).length, 0);
  assert.equal(Object.keys(service.state.s4Assets.ownerships).length, 0);
  assert.equal(service.state.s4Assets.transactions.length, 0);
  assert.ok(service.state.teams.every((team) => !team.ownerId && team.rosterIds.length === 0));
});
