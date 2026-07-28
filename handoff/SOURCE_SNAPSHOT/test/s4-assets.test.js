import assert from "node:assert/strict";
import test from "node:test";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { assertS4AssetInvariants, ownershipOwner } from "../versus/s4-assets.js";
import { isXPlayer, REAL_PLAYER_BY_ID } from "../versus/player-pool.js";
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
  return team.rosterIds.find((playerId) => !team.preferredStarterIds.includes(playerId) && REAL_PLAYER_BY_ID[playerId].grade !== "S");
}

test("S4新赛季选秀为每名球员创建独立卡，并为非传奇建立有锚点卡的所有权", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("s4-owner");
  const team = join(service, user);
  const assets = service.view(user).ownTeam.s4Assets;
  const publicRoster = service.view(user).ownTeam.roster;

  assert.equal(assets.cards.length, 23);
  assert.equal(assets.rosterSlotsUsed, 22);
  assert.equal(new Set(assets.cards.map((card) => card.id)).size, 23);
  assert.ok(team.rosterIds.every((playerId) => REAL_PLAYER_BY_ID[playerId].grade === "S" || ownershipOwner(service.state, playerId) === user.id));
  assert.ok(publicRoster.every((player) => !("legendAbility" in player) && !("signature" in player)));
  assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
});

test("球员卡公开数据包含可直接展示的特性名称和说明", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("s4-trait-card-owner");
  join(service, user);
  const playerId = nonLegendBench(service, user);
  const card = service.representativeCard(user.id, playerId);
  const trait = VERSUS_TRAIT_CARDS[0];
  card.traitIds = [trait.id];

  const publicCard = service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((entry) => entry.id === card.id);
  assert.deepEqual(publicCard.traits, [{ id:trait.id, name:trait.name, summary:trait.summary }]);
});

test("球员信息目录公开所有权、持卡玩家和逐卡强化排名", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const firstUser = account("directory-first");
  const secondUser = account("directory-second");
  const firstTeam = join(service, firstUser);
  join(service, secondUser);
  const playerId = nonLegendBench(service, firstUser);
  const enhanced = service.grantS4Card(firstTeam, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });

  const directory = service.view(firstUser).playerDirectory;
  const player = directory.players.find((entry) => entry.id === playerId);
  const rankedCard = directory.enhancementRanking.find((entry) => entry.cardId === enhanced.id);

  assert.equal(player.ownership.ownerName, firstUser.nickname);
  assert.equal(player.holders.find((holder) => holder.ownerId === firstUser.id).cardCount, 2);
  assert.equal(player.highestUpgradeLevel, 7);
  assert.equal(rankedCard.upgradeLevel, 7);
  assert.equal(rankedCard.ownerName, firstUser.nickname);
  assert.ok(directory.players.length > firstTeam.rosterIds.length);
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

test("+3单卡可以系统回收，+4及以上单卡不能回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("protected-card-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const recyclable = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const protectedCard = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  service.releaseCard(user, recyclable.id, false);
  assert.equal(service.state.s4Assets.cards[recyclable.id].status, "recycled");
  assert.throws(() => service.releaseCard(user, protectedCard.id, false), /\+4及以上/);
  assert.equal(service.state.s4Assets.cards[protectedCard.id].status, "active");
});

test("球员卡管理公开单卡回收资格和所有权回收明细", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("recovery-preview-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const extra = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  const player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  const base = player.cards.find((card) => card.upgradeLevel === 0);
  const enhanced = player.cards.find((card) => card.id === extra.id);

  assert.equal(base.systemRecyclable, true);
  assert.ok(base.systemRecoveryValue > 0);
  assert.equal(enhanced.systemRecyclable, false);
  assert.deepEqual(player.ownershipReturnPreview.retainedCardIds, [extra.id]);
  assert.equal(player.ownershipReturnPreview.recoveredCardCount, 1);
  assert.equal(player.ownershipReturnPreview.totalAmount, player.ownershipReturnPreview.recoveryAmount + player.ownershipReturnPreview.ownershipAmount);
});

test("批量单卡回收一次结算多张卡并保留球员所有权", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("batch-recovery-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const first = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:0, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(user.id).balance;

  const result = service.releaseCards(user, [first.id, second.id]);

  assert.equal(result.cardRecoveryResult.cardCount, 2);
  assert.ok(result.cardRecoveryResult.amount > 0);
  assert.equal(service.wallet(user.id).balance, balanceBefore + result.cardRecoveryResult.amount);
  assert.equal(service.state.s4Assets.cards[first.id].status, "recycled");
  assert.equal(service.state.s4Assets.cards[second.id].status, "recycled");
  assert.equal(ownershipOwner(service.state, playerId), user.id);
});

test("批量单卡回收包含高强化卡时整批拒绝且不改变资产", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("atomic-recovery-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const valid = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const invalid = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(user.id).balance;

  assert.throws(() => service.releaseCards(user, [valid.id, invalid.id]), /\+4及以上/);
  assert.equal(service.state.s4Assets.cards[valid.id].status, "active");
  assert.equal(service.state.s4Assets.cards[invalid.id].status, "active");
  assert.equal(service.wallet(user.id).balance, balanceBefore);
});

test("玩家卡片交易发起时托管金币，接受后交换卡片并结算金币", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-offer-sender");
  const receiver = account("trade-offer-receiver");
  const observer = account("trade-offer-observer");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  join(service, observer);
  const senderPlayerId = nonLegendBench(service, sender);
  const receiverPlayerId = nonLegendBench(service, receiver);
  const offered = service.grantS4Card(senderTeam, senderPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const material = service.grantS4Card(senderTeam, senderPlayerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, receiverPlayerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"repeat-pack" });
  offered.traitIds = [VERSUS_TRAIT_CARDS[0].id];
  const senderBalance = service.wallet(sender.id).balance;
  const receiverBalance = service.wallet(receiver.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 1200);
  const pending = service.state.cardTradeOffers.find((offer) => offer.fromOwnerId === sender.id && offer.status === "pending");

  assert.equal(service.wallet(sender.id).balance, senderBalance - 1200);
  assert.throws(() => service.enhanceS4Card(sender, offered.id, material.id), /交易报价/);
  const receiverView = service.view(receiver);
  const tradeMail = receiverView.inbox.find((message) => message.type === "trade-offer" && message.payload.tradeOfferId === pending.id);
  assert.ok(tradeMail);
  assert.equal(tradeMail.payload.tradeOffer.offeredCards[0].player.overall, REAL_PLAYER_BY_ID[senderPlayerId].overall);
  assert.equal(tradeMail.payload.tradeOffer.offeredCards[0].player.grade, REAL_PLAYER_BY_ID[senderPlayerId].grade);
  assert.equal(tradeMail.payload.tradeOffer.offeredCards[0].card.traits[0].name, VERSUS_TRAIT_CARDS[0].name);
  assert.equal(tradeMail.payload.tradeOffer.requestedCards[0].card.upgradeLevel, 6);
  const cleanedInbox = service.deleteInboxBatch(receiver, "all");
  assert.ok(cleanedInbox.inbox.some((message) => message.id === tradeMail.id));

  service.resolveCardTradeOffer(receiver, pending.id, "accept");

  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, receiver.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, sender.id);
  assert.equal(service.wallet(receiver.id).balance, receiverBalance + 1200);
  assert.equal(pending.status, "accepted");
  const senderResultMail = service.view(sender).inbox.find((message) => message.id === `card-trade-accepted:${pending.id}`);
  const receiverResultMail = service.view(receiver).inbox.find((message) => message.id === `card-trade-accepted:${pending.id}:receiver`);
  assert.equal(senderResultMail.type, "trade-result");
  assert.equal(receiverResultMail.type, "trade-result");
  assert.equal(senderResultMail.payload.tradeOffer.offeredCards[0].card.upgradeLevel, 5);
  assert.equal(receiverResultMail.payload.tradeOffer.requestedCards[0].card.upgradeLevel, 6);
  const publicMail = service.view(observer).inbox.find((message) => message.type === "trade-public" && message.payload.tradeOfferId === pending.id);
  assert.ok(publicMail);
  assert.equal(publicMail.payload.tradeOffer.offeredCards[0].card.upgradeLevel, 5);
  assert.equal(publicMail.payload.tradeOffer.offeredCards[0].card.traits[0].name, VERSUS_TRAIT_CARDS[0].name);
  assert.equal(publicMail.payload.tradeOffer.requestedCards[0].card.upgradeLevel, 6);
  assert.equal(service.view(sender).inbox.some((message) => message.type === "trade-public" && message.payload.tradeOfferId === pending.id), false);
  assert.equal(service.view(receiver).inbox.some((message) => message.type === "trade-public" && message.payload.tradeOfferId === pending.id), false);
});

test("双方最高仅+4的玩家交易不会发送重要转会公示", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("ordinary-trade-sender");
  const receiver = account("ordinary-trade-receiver");
  const observer = account("ordinary-trade-observer");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  join(service, observer);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 0);
  const offer = service.state.cardTradeOffers.at(-1);
  service.resolveCardTradeOffer(receiver, offer.id, "accept");

  assert.equal(offer.status, "accepted");
  assert.equal(service.view(observer).inbox.some((message) => message.type === "trade-public"), false);
});

test("拒绝玩家卡片交易会退款并保留双方资产", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-reject-sender");
  const receiver = account("trade-reject-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 900);
  const offer = service.state.cardTradeOffers.at(-1);
  service.resolveCardTradeOffer(receiver, offer.id, "reject");

  assert.equal(service.wallet(sender.id).balance, balanceBefore);
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, sender.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
  assert.equal(offer.status, "rejected");
});

test("发起方撤回玩家卡片交易会退款并通知接收方", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-withdraw-sender");
  const receiver = account("trade-withdraw-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 700);
  const offer = service.state.cardTradeOffers.at(-1);
  service.withdrawCardTradeOffer(sender, offer.id);

  assert.equal(service.wallet(sender.id).balance, balanceBefore);
  assert.equal(offer.status, "withdrawn");
  assert.ok(service.view(receiver).inbox.some((message) => message.id === `card-trade-withdrawn:${offer.id}`));
});

test("报价只锁定发起方卡片，接收方资产变化后接受会失败并退款", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-late-check-sender");
  const receiver = account("trade-late-check-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const senderBalance = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 600);
  const offer = service.state.cardTradeOffers.at(-1);

  assert.throws(() => service.listCard(sender, offered.id, 5000), /交易报价/);
  assert.doesNotThrow(() => service.listCard(receiver, requested.id, service.view(receiver).ownTeam.roster.find((player) => player.id === requested.playerId).cards.find((card) => card.id === requested.id).minimumListingPrice));
  service.resolveCardTradeOffer(receiver, offer.id, "accept");

  assert.equal(offer.status, "failed");
  assert.match(offer.failureReason, /挂牌/);
  assert.equal(service.wallet(sender.id).balance, senderBalance);
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, sender.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
  assert.ok(service.state.listings.some((listing) => listing.cardId === requested.id && listing.status === "active"));
  assert.ok(service.view(sender).inbox.some((message) => message.id === `card-trade-failed:${offer.id}:sender`));
});

test("接收方所有权变化不会被报价阻止，但接受时交易失败并退款", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-rights-sender");
  const receiver = account("trade-rights-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const receiverPlayerId = nonLegendBench(service, receiver);
  const requested = service.grantS4Card(receiverTeam, receiverPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const senderBalance = service.wallet(sender.id).balance;

  service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 800);
  const offer = service.state.cardTradeOffers.at(-1);

  assert.doesNotThrow(() => service.returnOwnership(receiver, receiverPlayerId));
  assert.equal(service.state.s4Assets.cards[requested.id].status, "active");
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
  service.resolveCardTradeOffer(receiver, offer.id, "accept");

  assert.equal(offer.status, "failed");
  assert.match(offer.failureReason, /所有权状态/);
  assert.equal(service.wallet(sender.id).balance, senderBalance);
  assert.equal(service.state.s4Assets.cards[offered.id].ownerId, sender.id);
  assert.equal(service.state.s4Assets.cards[requested.id].ownerId, receiver.id);
});

test("已挂牌单卡及所有权挂牌球员不能加入交易报价", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-listed-sender");
  const receiver = account("trade-listed-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const senderPlayerId = nonLegendBench(service, sender);
  const receiverPlayerId = nonLegendBench(service, receiver);
  const offered = service.grantS4Card(senderTeam, senderPlayerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, receiverPlayerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  service.listCard(sender, offered.id, service.view(sender).ownTeam.roster.find((player) => player.id === offered.playerId).cards.find((card) => card.id === offered.id).minimumListingPrice);
  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 0), /挂牌/);
  service.cancelListing(sender, service.state.listings.find((listing) => listing.cardId === offered.id && listing.status === "active").id);
  service.listOwnership(receiver, receiverPlayerId, 5000);
  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], 0), /挂牌/);
});

test("接收方卡可被多个报价索取，但其作为发起方资产锁定后不能成为新交易对象", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("multi-request-first");
  const second = account("multi-request-second");
  const target = account("multi-request-target");
  const firstTeam = join(service, first);
  const secondTeam = join(service, second);
  const targetTeam = join(service, target);
  const firstCard = service.grantS4Card(firstTeam, nonLegendBench(service, first), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const firstRequestedCard = service.grantS4Card(firstTeam, nonLegendBench(service, first), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const secondCard = service.grantS4Card(secondTeam, nonLegendBench(service, second), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const secondExtraCard = service.grantS4Card(secondTeam, nonLegendBench(service, second), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const targetCard = service.grantS4Card(targetTeam, nonLegendBench(service, target), { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const targetOfferCard = service.grantS4Card(targetTeam, nonLegendBench(service, target), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  assert.doesNotThrow(() => service.createCardTradeOffer(first, target.id, [firstCard.id], [targetCard.id], 0));
  assert.doesNotThrow(() => service.createCardTradeOffer(second, target.id, [secondCard.id], [targetCard.id], 0));
  service.createCardTradeOffer(target, first.id, [targetOfferCard.id], [firstRequestedCard.id], 0);

  assert.throws(() => service.createCardTradeOffer(second, target.id, [secondExtraCard.id], [targetOfferCard.id], 0), /其他交易/);
});

test("同一张接收方卡的多个报价中一笔成交后，其余报价立即失败退款并解锁发起方卡片", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("settle-first");
  const second = account("settle-second");
  const target = account("settle-target");
  const firstTeam = join(service, first);
  const secondTeam = join(service, second);
  const targetTeam = join(service, target);
  const firstCard = service.grantS4Card(firstTeam, nonLegendBench(service, first), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const secondCard = service.grantS4Card(secondTeam, nonLegendBench(service, second), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(targetTeam, nonLegendBench(service, target), { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const secondBalance = service.wallet(second.id).balance;

  service.createCardTradeOffer(first, target.id, [firstCard.id], [requested.id], 100);
  const accepted = service.state.cardTradeOffers.at(-1);
  service.createCardTradeOffer(second, target.id, [secondCard.id], [requested.id], 700);
  const superseded = service.state.cardTradeOffers.at(-1);

  service.resolveCardTradeOffer(target, accepted.id, "accept");

  assert.equal(accepted.status, "accepted");
  assert.equal(superseded.status, "failed");
  assert.match(superseded.failureReason, /另一笔交易/);
  assert.equal(service.wallet(second.id).balance, secondBalance);
  assert.equal(service.cardLockedByTrade(secondCard.id), false);
  assert.ok(service.view(second).inbox.some((message) => message.id === `card-trade-failed:${superseded.id}:sender`));
});

test("交易报价不能取走所有权持有人的最后一张锚点卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-anchor-sender");
  const receiver = account("trade-anchor-receiver");
  join(service, sender);
  const receiverTeam = join(service, receiver);
  const senderPlayerId = nonLegendBench(service, sender);
  const receiverCard = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const anchor = service.representativeCard(sender.id, senderPlayerId);
  anchor.upgradeLevel = 3;

  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [anchor.id], [receiverCard.id], 0), /锚点卡/);
  assert.equal(service.state.cardTradeOffers.length, 0);
});

test("交易附带金币必须非负且不能超过发起方余额", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const sender = account("trade-coins-sender");
  const receiver = account("trade-coins-receiver");
  const senderTeam = join(service, sender);
  const receiverTeam = join(service, receiver);
  const offered = service.grantS4Card(senderTeam, nonLegendBench(service, sender), { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const requested = service.grantS4Card(receiverTeam, nonLegendBench(service, receiver), { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });
  const balanceBefore = service.wallet(sender.id).balance;

  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], -1), /大于等于0/);
  assert.throws(() => service.createCardTradeOffer(sender, receiver.id, [offered.id], [requested.id], balanceBefore + 1), /金币不足/);
  assert.equal(service.wallet(sender.id).balance, balanceBefore);
  assert.equal(service.state.cardTradeOffers.length, 0);
});

test("非传奇+0卡不能进入单卡市场", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("last-card-seller");
  join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const card = service.representativeCard(seller.id, playerId);

  assert.throws(() => service.listCard(seller, card.id, 5000), /传奇卡或强化卡/);
  assert.equal(card.status, "active");
});

test("传奇+0卡和非传奇强化卡可以进入单卡市场", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("eligible-card-seller");
  const team = join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const enhanced = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const legendId = team.rosterIds.find((id) => REAL_PLAYER_BY_ID[id].grade === "S");
  const legend = service.representativeCard(seller.id, legendId);

  assert.ok(service.listCard(seller, enhanced.id, 5000).listings.some((entry) => entry.cardId === enhanced.id));
  service.cancelListing(seller, service.state.listings.find((entry) => entry.cardId === enhanced.id).id);
  assert.ok(service.listCard(seller, legend.id, 5000).listings.some((entry) => entry.cardId === legend.id));
});

test("强化卡参考价值和最低挂牌价随等级增长", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("enhanced-card-valuation");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const low = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:1, acquisitionSource:"repeat-pack" });
  const high = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const player = service.view(user).ownTeam.roster.find((entry) => entry.id === playerId);
  const lowView = player.cards.find((card) => card.id === low.id);
  const highView = player.cards.find((card) => card.id === high.id);

  assert.ok(highView.referenceValue > lowView.referenceValue);
  assert.ok(highView.minimumListingPrice > lowView.minimumListingPrice);
  assert.throws(() => service.listCard(user, high.id, lowView.minimumListingPrice), /卡片参考价值/);
  assert.doesNotThrow(() => service.listCard(user, high.id, highView.minimumListingPrice));
});

test("同名强化卡可以逐张独立挂牌，所有权挂牌仍锁定全部同名资产", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("multi-card-listing-seller");
  const team = join(service, seller);
  const playerId = nonLegendBench(service, seller);
  const first = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:8, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:7, acquisitionSource:"repeat-pack" });

  const firstMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === first.id).minimumListingPrice;
  const secondMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === second.id).minimumListingPrice;
  service.listCard(seller, first.id, firstMinimum);
  const view = service.listCard(seller, second.id, secondMinimum);

  assert.equal(view.listings.filter((entry) => entry.sellerId === seller.id && entry.playerId === playerId && entry.kind === "card").length, 2);
  assert.throws(() => service.listCard(seller, first.id, firstMinimum), /已经挂牌/);
  assert.throws(() => service.listOwnership(seller, playerId, 10000), /撤回.*挂牌/);
});

test("出售唯一一张+5单卡时卡片与所有权同步转移", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("single-plus-five-seller");
  const buyer = account("single-plus-five-buyer");
  join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const card = service.representativeCard(seller.id, playerId);
  card.upgradeLevel = 5;
  service.wallet(buyer.id).balance = 100000;

  const cardMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((entry) => entry.id === card.id).minimumListingPrice;
  const listing = service.listCard(seller, card.id, cardMinimum).listings.find((entry) => entry.cardId === card.id);
  assert.equal(listing.includesOwnership, true);
  service.buyListing(buyer, listing.id);

  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  assert.equal(service.playerCards(seller.id, playerId).length, 0);
  assert.equal(service.playerCards(buyer.id, playerId)[0].id, card.id);
  const buyerMail = service.view(buyer).inbox.find((message) => message.id === `transfer-buy:${listing.id}`);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(buyerMail.summary, /\+5单卡及所有权/);
  assert.match(buyerMail.body, /私有池归属已同步转移/);
  assert.equal(buyerMail.payload.transferredCardLevel, 5);
  assert.match(sellerMail.body, /最后一张.*卡片与所有权一并转移/);
  assert.equal(sellerMail.payload.totalSellerIncome, Math.floor(cardMinimum * .95));
});

test("市场获得的+5以上单卡在买家没有所有权时不占33人大名单额度", () => {
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

  const enhancedMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === enhanced.id).minimumListingPrice;
  const listing = service.listCard(seller, enhanced.id, enhancedMinimum).listings.find((entry) => entry.cardId === enhanced.id);
  service.buyListing(buyer, listing.id);
  const transferred = service.state.s4Assets.cards[enhanced.id];

  assert.equal(ownershipOwner(service.state, playerId), seller.id);
  assert.equal(transferred.ownerId, buyer.id);
  assert.equal(transferred.upgradeLevel, 5);
  assert.equal(service.view(buyer).ownTeam.roster.find((player) => player.id === playerId).cards[0].rosterExempt, true);
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
});

test("无所有权的外部+3单卡占一个名单名额，同名多卡不重复占位", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const owner = account("external-plus-three-owner");
  const buyer = account("external-plus-three-buyer");
  const ownerTeam = join(service, owner);
  const buyerTeam = join(service, buyer);
  const playerId = nonLegendBench(service, owner);
  const first = service.grantS4Card(ownerTeam, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(ownerTeam, playerId, { grantOwnership:false, upgradeLevel:3, acquisitionSource:"repeat-pack" });
  const slotsBefore = service.rosterSlotsUsed(buyer.id);

  service.grantS4Card(buyerTeam, playerId, { grantOwnership:false, externalAcquisition:true, upgradeLevel:3, acquisitionSource:"test-external" });
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore + 1);
  service.grantS4Card(buyerTeam, playerId, { grantOwnership:false, externalAcquisition:true, upgradeLevel:3, acquisitionSource:"test-external" });
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore + 1);
  assert.equal(service.state.s4Assets.cards[first.id].ownerId, owner.id);
  assert.equal(service.state.s4Assets.cards[second.id].ownerId, owner.id);
});

test("玩家直接交易获得的+5以上单卡同样不占名单额度", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("direct-card-seller");
  const buyer = account("direct-card-buyer");
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

  const enhancedMinimum = service.view(seller).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === enhanced.id).minimumListingPrice;
  service.wallet(buyer.id).balance = Math.max(service.wallet(buyer.id).balance, enhancedMinimum);
  service.directTradeCard(seller, buyer, enhanced.id, enhancedMinimum);

  const transferred = service.state.s4Assets.cards[enhanced.id];
  assert.equal(transferred.acquisitionSource, "direct-trade");
  assert.equal(service.rosterSlotsUsed(buyer.id), slotsBefore);
  assert.equal(service.view(buyer).ownTeam.roster.find((player) => player.id === playerId).cards[0].rosterExempt, true);
});

test("所有权出售保留卖家全部并列最高卡、给无卡买家系统基础锚点卡并回收低级卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("rights-seller");
  const buyer = account("rights-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const original = service.representativeCard(seller.id, playerId);
  const highestCards = Array.from({ length:3 }, () => service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" }));
  const middleCards = Array.from({ length:4 }, () => service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" }));
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  assert.equal(listing.retainedCardCount, 3);
  service.buyListing(buyer, listing.id);

  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  assert.deepEqual(service.playerCards(seller.id, playerId).map((card) => card.id).sort(), highestCards.map((card) => card.id).sort());
  const buyerCards = service.playerCards(buyer.id, playerId);
  assert.equal(buyerCards.length, 1);
  assert.equal(buyerCards[0].upgradeLevel, 0);
  assert.equal(buyerCards[0].acquisitionSource, "market-ownership-anchor");
  middleCards.forEach((card) => assert.equal(service.state.s4Assets.cards[card.id].status, "recycled"));
  assert.equal(service.state.s4Assets.cards[original.id].status, "recycled");
  assert.ok(service.state.listings.find((entry) => entry.id === listing.id).recoveryAmount > 0);
  const buyerMail = service.view(buyer).inbox.find((message) => message.id === `transfer-buy:${listing.id}`);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(buyerMail.body, /系统已向你发放一张\+0/);
  assert.equal(buyerMail.payload.buyerReceivedSystemAnchor, true);
  assert.match(sellerMail.body, /保留了3张最高等级\+5/);
  assert.match(sellerMail.body, /其余5张低等级卡已由系统回收/);
  assert.equal(sellerMail.payload.recoveredCardCount, 5);
  assert.doesNotThrow(() => assertS4AssetInvariants(service.state));
});

test("所有权出售只有一张+5卡时允许零回收并让卖家免名单占位", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("zero-rights-seller");
  const buyer = account("zero-rights-buyer");
  join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const retained = service.representativeCard(seller.id, playerId);
  retained.upgradeLevel = 5;
  const slotsBefore = service.rosterSlotsUsed(seller.id);
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  service.buyListing(buyer, listing.id);
  const sold = service.state.listings.find((entry) => entry.id === listing.id);

  assert.equal(sold.recoveryAmount, 0);
  assert.deepEqual(sold.recoveredCardIds, []);
  assert.equal(service.playerCards(seller.id, playerId)[0].id, retained.id);
  assert.equal(service.rosterSlotsUsed(seller.id), slotsBefore - 1);
  assert.equal(service.view(seller).ownTeam.roster.find((player) => player.id === playerId).rosterSlotUsed, false);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(sellerMail.summary, /实际到账8550金币/);
  assert.match(sellerMail.body, /没有低等级卡需要回收，回收补偿为0金币/);
  assert.match(sellerMail.body, /当前不占用33人大名单名额/);
  assert.equal(sellerMail.payload.recoveryAmount, 0);
});

test("所有权出售只有+0基础卡时不保留卖家锚点卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const seller = account("base-rights-seller");
  const buyer = account("base-rights-buyer");
  join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const baseCard = service.representativeCard(seller.id, playerId);
  service.wallet(buyer.id).balance = 100000;

  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  assert.equal(listing.retainedUpgradeLevel, null);
  assert.equal(listing.retainedCardCount, 0);
  service.buyListing(buyer, listing.id);

  assert.equal(service.state.s4Assets.cards[baseCard.id].status, "recycled");
  assert.equal(service.playerCards(seller.id, playerId).length, 0);
  assert.equal(service.playerCards(buyer.id, playerId).length, 1);
  assert.equal(service.playerCards(buyer.id, playerId)[0].upgradeLevel, 0);
  assert.equal(ownershipOwner(service.state, playerId), buyer.id);
  const sellerMail = service.view(seller).inbox.find((message) => message.id === `transfer-sale:${listing.id}`);
  assert.match(sellerMail.body, /没有强化过.*原有1张\+0基础锚点卡已由系统回收/);
  assert.equal(sellerMail.payload.retainedCardCount, 0);
});

test("失去所有权的+5卡降为+4后动态恢复名单占位", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 1 });
  const seller = account("downgrade-slot-seller");
  const buyer = account("downgrade-slot-buyer");
  const sellerTeam = join(service, seller);
  join(service, buyer);
  const playerId = nonLegendBench(service, seller);
  const main = service.representativeCard(seller.id, playerId);
  main.upgradeLevel = 5;
  const material = service.grantS4Card(sellerTeam, playerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  service.wallet(buyer.id).balance = 100000;
  const listing = service.listOwnership(seller, playerId, 9000).listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  service.buyListing(buyer, listing.id);
  const exemptSlots = service.rosterSlotsUsed(seller.id);

  const result = service.enhanceS4Card(seller, main.id, material.id, false);

  assert.equal(result.enhancementResult.success, false);
  assert.equal(result.enhancementResult.afterLevel, 4);
  assert.equal(service.rosterSlotsUsed(seller.id), exemptSlots + 1);
  assert.equal(service.view(seller).ownTeam.roster.find((player) => player.id === playerId).rosterSlotUsed, true);
});

test("已挂牌强化卡和所有权挂牌球员不能进入强化流程", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("listed-enhancement-owner");
  const team = join(service, user);
  const playerId = nonLegendBench(service, user);
  const main = service.representativeCard(user.id, playerId);
  main.upgradeLevel = 5;
  const material = service.grantS4Card(team, playerId, { grantOwnership:false, upgradeLevel:4, acquisitionSource:"repeat-pack" });

  let listing = service.listCard(user, main.id, service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === main.id).minimumListingPrice).listings.find((entry) => entry.cardId === main.id && entry.status === "active");
  assert.throws(() => service.enhanceS4Card(user, main.id, material.id), /撤回相关球员资产挂牌/);
  service.cancelListing(user, listing.id);

  listing = service.listCard(user, material.id, service.view(user).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === material.id).minimumListingPrice).listings.find((entry) => entry.cardId === material.id && entry.status === "active");
  assert.throws(() => service.enhanceS4Card(user, main.id, material.id), /撤回相关球员资产挂牌/);
  service.cancelListing(user, listing.id);

  service.listOwnership(user, playerId, 5000);
  assert.throws(() => service.enhanceS4Card(user, main.id, material.id), /撤回相关球员资产挂牌/);
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
  assert.equal(service.rosterSlotsUsed(user.id), 21);
});

test("主动返还所有权保留全部并列最高强化卡，只有基础卡时全部回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const enhancedUser = account("return-tied-highest");
  const enhancedTeam = join(service, enhancedUser);
  const enhancedPlayerId = nonLegendBench(service, enhancedUser);
  const original = service.representativeCard(enhancedUser.id, enhancedPlayerId);
  const first = service.grantS4Card(enhancedTeam, enhancedPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });
  const second = service.grantS4Card(enhancedTeam, enhancedPlayerId, { grantOwnership:false, upgradeLevel:5, acquisitionSource:"repeat-pack" });

  service.returnOwnership(enhancedUser, enhancedPlayerId);

  assert.deepEqual(service.playerCards(enhancedUser.id, enhancedPlayerId).map((card) => card.id).sort(), [first.id, second.id].sort());
  assert.equal(service.state.s4Assets.cards[original.id].status, "recycled");

  const baseUser = account("return-base-only");
  const baseTeam = join(service, baseUser);
  const basePlayerId = nonLegendBench(service, baseUser);
  const baseCard = service.representativeCard(baseUser.id, basePlayerId);

  service.returnOwnership(baseUser, basePlayerId);

  assert.equal(service.state.s4Assets.cards[baseCard.id].status, "recycled");
  assert.ok(!baseTeam.rosterIds.includes(basePlayerId));
  assert.equal(ownershipOwner(service.state, basePlayerId), null);
});

test("X级球员完成位置身高特性配置且全服唯一并免占名单", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("x-config-first");
  const second = account("x-config-second");
  service.beginDraft(first, "X First");
  service.autoDraft(first);
  const draft = service.state.drafts[first.id];
  const xPlayerId = draft.xPlayerId;
  service.configureXPlayer(first, { role:"GK", heightCm:186 });
  assert.throws(() => service.configureXPlayer(first, { role:"GK", secondaryRole:"CB", heightCm:180 }), /门将/);
  assert.throws(() => service.configureXPlayer(first, { role:"ST", secondaryRole:"LW", heightCm:187 }), /160-186/);
  const trait = service.eligibleXTraits("GK")[0];
  service.chooseXPlayerTrait(first, trait.id);
  service.finishDraft(first);

  const view = service.view(first);
  const xPlayer = view.ownTeam.roster.find((player) => player.id === xPlayerId);
  assert.equal(xPlayer.grade, "X");
  assert.equal(xPlayer.overall, 62);
  assert.equal(xPlayer.role, "GK");
  assert.equal(xPlayer.secondaryRole, null);
  assert.equal(xPlayer.heightCm, 186);
  assert.equal(xPlayer.cards[0].traits[0].id, trait.id);
  assert.equal(view.ownTeam.s4Assets.rosterSlotsUsed, 22);

  service.beginDraft(second, "X Second");
  service.autoDraft(second);
  assert.notEqual(service.state.drafts[second.id].xPlayerId, xPlayerId);
});

test("X级球员不会进入普通卡包且不可后台发卡、挂牌或回收", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("x-protected-owner");
  const team = join(service, user);
  const xPlayerId = team.rosterIds.find(isXPlayer);
  const xCard = service.representativeCard(user.id, xPlayerId);

  assert.ok(service.publicPackCandidates().every((player) => !isXPlayer(player)));
  assert.ok(service.privatePackCandidates(user.id, { pool:"MIXED" }).every((player) => !isXPlayer(player)));
  assert.throws(() => service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId:xPlayerId, upgradeLevel:0, quantity:1 }), /X级球员/);
  assert.throws(() => service.listCard(user, xCard.id, 10000), /不可挂牌/);
  assert.throws(() => service.listOwnership(user, xPlayerId, 10000), /不可挂牌所有权/);
  assert.throws(() => service.releaseCard(user, xCard.id, true), /不可回收/);
  assert.throws(() => service.releaseCards(user, [xCard.id]), /不可回收/);
  assert.throws(() => service.returnOwnership(user, xPlayerId), /不可回收/);
});

test("X级球员只能无金币一换一且成交后完整交换归属", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("x-trade-first");
  const second = account("x-trade-second");
  const firstTeam = join(service, first);
  const secondTeam = join(service, second);
  const firstXId = firstTeam.rosterIds.find(isXPlayer);
  const secondXId = secondTeam.rosterIds.find(isXPlayer);
  const firstCard = service.representativeCard(first.id, firstXId);
  const secondCard = service.representativeCard(second.id, secondXId);

  assert.throws(() => service.createCardTradeOffer(first, second.id, [firstCard.id], [secondCard.id], 1), /不能附带金币/);
  service.createCardTradeOffer(first, second.id, [firstCard.id], [secondCard.id], 0);
  const offer = service.state.cardTradeOffers.at(-1);
  assert.equal(offer.xTrade, true);
  service.resolveCardTradeOffer(second, offer.id, "accept");

  assert.equal(service.state.s4Assets.cards[firstCard.id].ownerId, second.id);
  assert.equal(service.state.s4Assets.cards[secondCard.id].ownerId, first.id);
  assert.equal(service.state.xPlayers.assignments[firstXId], second.id);
  assert.equal(service.state.xPlayers.assignments[secondXId], first.id);
  assert.equal(service.rosterSlotsUsed(first.id), 22);
  assert.equal(service.rosterSlotsUsed(second.id), 22);
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
