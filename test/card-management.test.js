import test from "node:test";
import assert from "node:assert/strict";
import { CardManagementService } from "../server/application/card-management-service.mjs";
import { CARD_MANAGEMENT_DEFAULTS, recycleValue, minimumListingPrice } from "../shared/config/card-management.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import { AdminService } from "../server/application/admin-service.mjs";
import { createCampaignApiHandler } from "../server/http/campaign-api-handler.mjs";
import { createAdminApiHandler } from "../server/http/admin-api-handler.mjs";
import { CampaignService } from "../campaign-service.mjs";
import { EnhancementService } from "../server/application/enhancement-service.mjs";

const card = (id, grade = "C", more = {}) => ({ id, playerId: id, cardInstanceId: id, cardDefinitionId: id, name: id, grade, role: "ST", pool: "ATT", overall: 70,
  attributes: { passing: 60, finishing: 70 }, nationality: "法国", club: "里昂", upgradeLevel: 0, traits: [], state: { fitness: 94 }, ...more });
const account = (id, roster = []) => ({ id, nickname: id, gold: 100000, goldLedger: [], setupComplete: true,
  draft: { teamName: id, roster, offer: [] }, playerSquads: { schemaVersion: 2, assignments: Object.fromEntries(roster.map(card => [card.id, "garrison"])) } });
function fixture() {
  const seller = account("seller", Array.from({ length: 7 }, (_, index) => card(`c${index}`)));
  const buyer = account("buyer"), other = account("other");
  const accounts = new Map([seller, buyer, other].map(account => [account.id, account]));
  const world = { activeChallenges: {}, territories: {} };
  const catalog = [...seller.draft.roster, card("b-france", "B", { club: "巴黎" }), card("b-lyon", "B", { nationality: "巴西" }), card("b-both", "B"), card("b-out", "B", { nationality: "德国", club: "拜仁" }), card("a-france", "A"), card("s-france", "S")];
  let failure = false, snapshot, roll = 0;
  const service = new CardManagementService({ accounts, world, catalog, economy: new EconomyService({ now: () => 123 }), now: () => 123, random: () => roll,
    save: () => { if (failure) throw Error("disk failure"); snapshot = structuredClone({ accounts: [...accounts], world }); } });
  const preview = (kind, ids = ["c0"], extra = {}) => service.preview(seller, { kind, cardIds: ids, ...extra });
  const consume = (kind, ids = ["c0"], extra = {}) => {
    const quote = preview(kind, ids, extra);
    return service.consume(seller, { cardIds: quote.cardIds, quote: quote.quote, requestId: `request-${kind}`, ...extra }, kind);
  };
  const list = () => consume("list", ["c0"], { price: Math.max(700, minimumListingPrice(seller.draft.roster[0])) }).listing;
  return { service, accounts, world, catalog, seller, buyer, other, preview, consume, list, snapshot: () => snapshot, fail: value => { failure = value; }, roll: value => { roll = value; } };
}

test("confirmed recycling prices and enhancement multipliers use integer arithmetic", () => {
  for (const [grade, base] of [["C", 80], ["B", 400], ["A", 2000], ["S", 10000], ["X", 10000]]) {
    assert.equal(recycleValue(card("x", grade)), base);
    assert.equal(recycleValue(card("x", grade, { upgradeLevel: 8, trainingBonuses: { passing: 500 } })), base * 1.8);
  }
  assert.equal(recycleValue(card("x", "C", { upgradeLevel: 4 })), 112);
  assert.equal(recycleValue(card("x", "C", { upgradeLevel: 9 })), 0);
});

test("recycling quotes contain each independent card's exact price under the quoted configuration", () => {
  const f = fixture();
  f.seller.draft.roster[1].cardDefinitionId = "c0";
  f.seller.draft.roster[1].upgradeLevel = 4;
  f.seller.draft.roster[1].trainingBonuses = { passing: 30 };
  f.world.cardManagement = { config: { ...structuredClone(CARD_MANAGEMENT_DEFAULTS), recycleRatioBps: 2500 } };
  const before = structuredClone(f.seller);
  const q = f.preview("recycle", ["c0", "c1"]);
  assert.deepEqual(q.recycle, { ratioBps: 2500, upgradeBonusBps: 1000,
    lines: [{ cardId: "c0", valuation: 400, amount: 100 }, { cardId: "c1", valuation: 400, amount: 140 }] });
  assert.equal(q.amount, q.recycle.lines.reduce((sum, line) => sum + line.amount, 0));
  assert.deepEqual(f.seller, before, "preview does not change cards or gold");
  const result = f.service.consume(f.seller, { cardIds: q.cardIds, quote: q.quote, requestId: "recycle-detailed-quote" }, "recycle");
  assert.equal(result.amount, q.amount);
  assert.equal(f.seller.gold, before.gold + q.amount);
  assert.deepEqual(f.seller.draft.roster.map(card => card.id), ["c2", "c3", "c4", "c5", "c6"]);
});

test("recycling removes exact independent instances, credits gold once and rejects a changed retry", () => {
  const f = fixture(); f.seller.draft.roster[1].cardDefinitionId = "c0";
  const q = f.preview("recycle"); const input = { cardIds: ["c0"], quote: q.quote, requestId: "recycle-once" };
  const result = f.service.consume(f.seller, input, "recycle");
  assert.equal(f.seller.gold, 100080); assert.ok(f.seller.draft.roster.some(card => card.id === "c1"));
  assert.deepEqual(f.service.consume(f.seller, input, "recycle"), result); assert.equal(f.seller.goldLedger.length, 1);
  assert.throws(() => f.service.consume(f.seller, { ...input, cardIds: ["c1"] }, "recycle"), /另一项/);
});

test("same-grade trade-up uses the deduplicated union of nationality and club, not intersections or weights", () => {
  const f = fixture(), ids = ["c0", "c1", "c2", "c3", "c4"];
  f.catalog.push(structuredClone(f.catalog.find(card => card.id === "b-both")));
  const q = f.preview("trade-up", ids);
  assert.deepEqual(q.candidates.map(card => card.id), ["b-both", "b-france", "b-lyon"]);
  for (const [roll, expected] of [[0, "b-both"], [.34, "b-france"], [.99, "b-lyon"]]) {
    const g = fixture(); g.roll(roll);
    g.seller.draft.roster[0].upgradeLevel = 4; g.seller.draft.roster[0].trainingBonuses = { passing: 40 };
    const result = g.consume("trade-up", ids);
    assert.equal(result.card.cardDefinitionId, expected); assert.equal(result.card.upgradeLevel, 0);
    assert.deepEqual(result.card.trainingBonuses, {}); assert.equal(g.seller.draft.roster.length, 3);
    assert.equal(g.seller.playerSquads.assignments[result.card.id], "garrison");
    assert.equal(g.seller.gold, 100000);
  }
});

test("trade-up covers B to A and A to S, never consumes legendary, mixed or duplicate materials", () => {
  for (const [grade, next] of [["B", "A"], ["A", "S"]]) {
    const f = fixture(); f.seller.draft.roster.forEach(card => { card.grade = grade; });
    assert.equal(f.consume("trade-up", ["c0", "c1", "c2", "c3", "c4"]).card.grade, next);
  }
  for (const grade of ["S", "X"]) {
    const f = fixture(); f.seller.draft.roster.forEach(card => { card.grade = grade; });
    assert.throws(() => f.preview("trade-up", ["c0", "c1", "c2", "c3", "c4"]), /传奇/);
  }
  const f = fixture(); f.seller.draft.roster[0].grade = "B";
  assert.throws(() => f.preview("trade-up", ["c0", "c1", "c2", "c3", "c4"]), /同评级/);
  assert.throws(() => f.preview("trade-up", ["c1", "c1", "c2", "c3", "c4"]), /不重复/);
  assert.throws(() => f.preview("trade-up", ["c1", "c2"]), /5 张/);
});

test("empty or changed pools never consume material; published affiliations take precedence over saved text", () => {
  const f = fixture(); f.seller.draft.roster = structuredClone(f.seller.draft.roster);
  f.seller.draft.roster.forEach(card => { card.nationality = "德国"; card.club = "拜仁"; });
  const ids = ["c0", "c1", "c2", "c3", "c4"];
  const q = f.preview("trade-up", ids);
  assert.ok(!q.candidates.some(card => card.id === "b-out"));
  f.catalog.push(card("b-new", "B"));
  assert.throws(() => f.service.consume(f.seller, { cardIds: ids, quote: q.quote, requestId: "pool-stale-1" }, "trade-up"), /变化/);
  f.catalog.splice(0, f.catalog.length, ...f.catalog.filter(card => card.grade !== "B"));
  const before = structuredClone(f.seller);
  assert.throws(() => f.preview("trade-up", ids), /没有高一级/); assert.deepEqual(f.seller, before);
});

test("locked, training, pending-trait and active-match accounts cannot transfer cards", () => {
  const changes = [f => { f.seller.draft.roster[0].locked = true; }, f => { f.seller.draft.roster[0].training = { taskId: "t" }; },
    f => { f.seller.training = { tasks: { t: { playerId: "c0" } } }; },
    f => { f.seller.enhancement = { offers: { o: { cardId: "c0", status: "pending" } } }; },
    f => { f.world.activeChallenges.m = { defenderId: "seller" }; }];
  for (const change of changes) {
    const f = fixture(); change(f); const before = structuredClone(f.seller);
    for (const kind of ["list", "recycle", "trade-up"]) assert.throws(() => f.preview(kind, kind === "trade-up" ? ["c0", "c1", "c2", "c3", "c4"] : ["c0"], { price: 100 }));
    assert.deepEqual(f.seller, before);
  }
});

test("listing places the only instance in escrow and stale enhancement/material requests cannot use it", () => {
  const f = fixture(); const original = structuredClone(f.seller.draft.roster[0]); const listing = f.list();
  assert.ok(!f.seller.draft.roster.some(card => card.id === "c0"));
  assert.deepEqual(f.service.data(f.seller).listings[listing.id].card, original);
  assert.throws(() => f.preview("recycle"), /已转出/);
  const enhancement = new EnhancementService({ economy: new EconomyService() });
  assert.throws(() => enhancement.enhance(f.seller, f.world, { mainCardId: "c1", materialCardId: "c0", requestId: "enhance-stale" }), /有效的主卡/);
});

test("two buyers cannot buy the same listing; successful retry returns the original receipt", () => {
  const f = fixture(), listing = f.list();
  const input = { listingId: listing.id, expectedPrice: 700, requestId: "buy-once-1" };
  const result = f.service.buy(f.buyer, input);
  assert.equal(f.buyer.gold, 99300); assert.equal(f.seller.gold, 100700); assert.equal(f.buyer.draft.roster.length, 1);
  assert.throws(() => f.service.buy(f.other, { ...input, requestId: "buy-second-1" }), /已被购买/);
  assert.deepEqual(f.service.buy(f.buyer, input), result); assert.equal(f.seller.goldLedger.length, 1);
  assert.equal(f.other.gold, 100000); assert.equal(f.other.draft.roster.length, 0);
  assert.throws(() => f.service.cancel(f.seller, { listingId: listing.id, requestId: "cancel-sold" }), /成交/);
});

test("failed saves restore seller, buyer, listing, receipts and gold together", () => {
  for (const operation of ["buy", "admin", "cancel", "recycle", "trade-up", "list"]) {
    const f = fixture(), listing = ["buy", "cancel"].includes(operation) ? f.list() : null;
    const before = structuredClone([...f.accounts]); f.fail(true);
    assert.throws(() => {
      if (operation === "buy") f.service.buy(f.buyer, { listingId: listing.id, expectedPrice: 700, requestId: "buy-failure" });
      else if (operation === "admin") f.service.adminTrade({ id: "admin" }, { sellerId: "seller", buyerId: "buyer", cardId: "c0", price: 500, reason: "测试", requestId: "admin-failure" });
      else if (operation === "cancel") f.service.cancel(f.seller, { listingId: listing.id, requestId: "cancel-failure" });
      else f.consume(operation, operation === "trade-up" ? ["c0", "c1", "c2", "c3", "c4"] : ["c0"], { price: 700 });
    }, /disk failure/);
    assert.deepEqual([...f.accounts], before, operation);
  }
});

test("ownership, price changes, self purchases and insufficient funds leave assets untouched", () => {
  const f = fixture(), listing = f.list();
  assert.throws(() => f.service.cancel(f.other, { listingId: listing.id, requestId: "not-owner-1" }), /自己的/);
  assert.throws(() => f.service.buy(f.seller, { listingId: listing.id, expectedPrice: 700, requestId: "buy-own-card" }), /自己/);
  assert.throws(() => f.service.buy(f.buyer, { listingId: listing.id, expectedPrice: 100, requestId: "wrong-price" }), /价格/);
  f.buyer.gold = 10; const before = structuredClone([...f.accounts]);
  assert.throws(() => f.service.buy(f.buyer, { listingId: listing.id, expectedPrice: 700, requestId: "insufficient" }), /金币不足/);
  assert.deepEqual([...f.accounts], before);
});

test("cancel and transfer preserve full growth, traits and injury; legacy card IDs become independent", () => {
  const f = fixture(), source = f.seller.draft.roster[0];
  source.trainingBonuses = { passing: 9 }; source.upgradeLevel = 3; source.traits = [{ id: "existing", name: "特性" }]; source.state.injury = { matchesRemaining: 2 };
  delete source.cardInstanceId;
  const listing = f.list(); assert.notEqual(listing.card.id, "c0");
  f.service.cancel(f.seller, { listingId: listing.id, requestId: "return-legacy" });
  const returned = f.seller.draft.roster.find(card => card.id === listing.card.id);
  assert.deepEqual(returned.trainingBonuses, { passing: 9 }); assert.deepEqual(returned.traits, source.traits); assert.equal(returned.state.injury.matchesRemaining, 2);
  assert.equal(f.seller.playerSquads.assignments[returned.id], "garrison");
});

test("listing retirement repairs only affected slots and retains empty slot coordinates", () => {
  const f = fixture();
  f.seller.tactics = { squads: { garrison: { starters: ["c0", "c1"], bench: ["c2"], positions: { c0: { x: 20, y: 20 }, c1: { x: 80, y: 20 } } } } };
  assert.deepEqual(f.preview("list", ["c0"], { price: 700 }).lineupAffected, ["garrison"]);
  f.list();
  assert.ok(f.seller.tactics.squads.garrison.starters.includes("c1"));
  assert.deepEqual(f.seller.tactics.squads.garrison.positions.c1, { x: 80, y: 20 });
  assert.ok(!f.seller.tactics.squads.garrison.starters.includes("c0"));
});

test("receipts and active escrow survive service restart without duplicating a purchase", () => {
  const f = fixture(), listing = f.list();
  const saved = f.snapshot(), accounts = new Map(saved.accounts);
  const restarted = new CardManagementService({ accounts, world: saved.world, catalog: f.catalog, economy: new EconomyService(), save: () => {} });
  assert.equal(restarted.details(accounts.get("buyer")).listings[0].id, listing.id);
  restarted.buy(accounts.get("buyer"), { listingId: listing.id, expectedPrice: 700, requestId: "restart-purchase" });
  const next = new Map(structuredClone([...accounts]));
  const again = new CardManagementService({ accounts: next, world: saved.world, catalog: f.catalog, economy: new EconomyService(), save: () => {} });
  again.buy(next.get("buyer"), { listingId: listing.id, expectedPrice: 700, requestId: "restart-purchase" });
  assert.equal(next.get("buyer").draft.roster.length, 1); assert.equal(next.get("seller").gold, 100700);
});

test("admin transfer is atomic, restricted to operation roles, logged and retryable", () => {
  const f = fixture();
  const campaign = { cardManagement: f.service, settleDueChallenges() {} };
  const admin = new AdminService({ campaign }); const actor = { id: "admin", username: "operator", role: "operator" };
  const input = { sellerId: "seller", buyerId: "buyer", cardId: "c0", price: 500, reason: "双方约定交易", requestId: "admin-trade-1" };
  for (const role of ["readonly", "content"]) assert.throws(() => admin.tradePlayerCard({ ...actor, role }, input), /权限/);
  const result = admin.tradePlayerCard(actor, input);
  assert.equal(f.seller.gold, 100500); assert.equal(f.buyer.gold, 99500);
  assert.deepEqual(admin.tradePlayerCard(actor, input), result); assert.equal(admin.listAudit().length, 1);
  assert.equal(f.service.adminView().history[0].adminId, "admin");
});

test("config changes invalidate recycling previews and failed saves restore previous settings", () => {
  const f = fixture(), q = f.preview("recycle");
  const config = structuredClone(CARD_MANAGEMENT_DEFAULTS); config.recycleRatioBps = 1000;
  f.service.updateConfig(config);
  assert.equal(f.preview("recycle").amount, 40);
  assert.throws(() => f.service.consume(f.seller, { cardIds: ["c0"], quote: q.quote, requestId: "old-quote-1" }, "recycle"), /变化/);
  f.fail(true); assert.throws(() => f.service.updateConfig({ ...config, recycleEnabled: false }), /disk failure/);
  assert.equal(f.service.config().recycleEnabled, true);
  f.fail(false); f.service.updateConfig({ ...config, recycleEnabled: false });
  assert.throws(() => f.preview("recycle"), /未开放/);
});

test("HTTP exposes public card operations but no player-to-player direct trade endpoint", async () => {
  const f = fixture();
  const campaign = { authenticate: () => f.seller, cardManagementDetails: account => f.service.details(account) };
  const handler = createCampaignApiHandler({ campaign });
  const response = () => ({ status: null, body: null, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });
  const read = response(); await handler({ method: "GET", headers: {} }, read, "/api/campaign/cards", "/api/campaign/cards"); assert.equal(read.status, 200);
  const hidden = response();
  await handler({ method: "POST", headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from("{}"); } }, hidden, "/api/campaign/cards/trade", "/api/campaign/cards/trade");
  assert.equal(hidden.status, 404);
  const adminHandler = createAdminApiHandler({ admin: { authenticate() { throw Object.assign(Error("未登录"), { statusCode: 401 }); } }, players: {} });
  await assert.rejects(() => adminHandler({ method: "GET", headers: {} }, response(), "/api/admin/card-management", "/api/admin/card-management"), /未登录/);
});

test("campaign persistence retains configuration and escrow through real world hydration", () => {
  const f = fixture(), territoryIndex = { territories: [] };
  let persisted = JSON.parse(JSON.stringify({ accounts: Object.fromEntries(f.accounts), world: {} }));
  const repository = { load: () => structuredClone(persisted), save: value => { persisted = JSON.parse(JSON.stringify(value)); } };
  const make = () => new CampaignService({ repository, catalog: f.catalog, territoryIndex, now: () => 1234 });
  let campaign = make(), seller = campaign.accounts.get("seller");
  const config = structuredClone(CARD_MANAGEMENT_DEFAULTS); config.valuations.C = 500;
  campaign.cardManagement.updateConfig(config);
  const q = campaign.previewCardManagement(seller, { kind: "list", cardIds: ["c0"], price: 400 });
  const listing = campaign.mutateCardManagement(seller, "list", { cardIds: q.cardIds, quote: q.quote, price: 400, requestId: "campaign-list-1" }).result.listing;
  campaign = make(); seller = campaign.accounts.get("seller");
  assert.equal(campaign.cardManagement.config().valuations.C, 500);
  assert.equal(campaign.cardManagementDetails(seller).listings[0].id, listing.id);
  assert.ok(!seller.draft.roster.some(card => card.id === "c0"));
  const buyer = campaign.accounts.get("buyer");
  const result = campaign.mutateCardManagement(buyer, "buy", { listingId: listing.id, expectedPrice: 400, requestId: "campaign-buy-1" });
  assert.equal(result.state.wallet.gold, 99600); assert.ok(result.state.draft.roster.some(card => card.id === "c0"));
  const restarted = make();
  assert.equal(restarted.accounts.get("seller").gold, 100400);
  assert.equal(restarted.cardManagementDetails(restarted.accounts.get("buyer")).listings.length, 0);
});



test("cards from either squad can be listed and cancellation restores their original squad, including legacy instance IDs", () => {
  for (const squad of ["expedition", "garrison"]) {
    const f = fixture(), source = f.seller.draft.roster[0];
    delete source.cardInstanceId;
    source.upgradeLevel = 4; source.trainingBonuses = { passing: 6 };
    f.seller.playerSquads.assignments.c0 = squad;
    assert.equal(f.service.details(f.seller).cards[0].blocked, null);
    assert.equal(f.preview("list", ["c0"]).sourceSquad, squad);
    const listing = f.list();
    assert.equal(listing.sourceSquad, squad);
    assert.equal(f.service.data(f.seller).listings[listing.id].sourceSquad, squad);
    assert.ok(!f.seller.playerSquads.assignments.c0, "escrow is removed from both squads");
    const input = { listingId: listing.id, requestId: "restore-squad-once" };
    const result = f.service.cancel(f.seller, input);
    assert.equal(result.squad, squad);
    assert.equal(f.seller.playerSquads.assignments[listing.card.id], squad);
    assert.deepEqual(f.seller.draft.roster.find(card => card.id === listing.card.id).trainingBonuses, { passing: 6 });
    assert.equal(f.seller.draft.roster.find(card => card.id === listing.card.id).upgradeLevel, 4);
    assert.deepEqual(f.service.cancel(f.seller, input), result);
    assert.equal(f.seller.draft.roster.length, 7);
  }
});

test("a squad change invalidates the listing quote before escrow", () => {
  const f = fixture(), quote = f.preview("list", ["c0"], { price: 700 });
  f.seller.playerSquads.assignments.c0 = "expedition";
  assert.throws(() => f.service.consume(f.seller, { cardIds: ["c0"], price: 700, quote: quote.quote, requestId: "changed-source-squad" }, "list"), /变化/);
  assert.equal(f.seller.draft.roster.length, 7);
  assert.equal(f.service.details(f.seller).listings.length, 0);
});

test("expedition source survives restart and restores the squad without displacing existing starters", () => {
  const f = fixture();
  f.seller.playerSquads.assignments.c0 = "expedition";
  f.seller.playerSquads.assignments.c1 = "expedition";
  f.seller.playerSquads.assignments.c2 = "expedition";
  f.seller.tactics = { squads: { expedition: { starters: ["c0", "c1"], bench: ["c2"], positions: { c0: { x: 20, y: 20 }, c1: { x: 80, y: 20 } } } } };
  const listing = f.list(), saved = f.snapshot(), accounts = new Map(saved.accounts), seller = accounts.get("seller");
  const starters = [...seller.tactics.squads.expedition.starters], positions = structuredClone(seller.tactics.squads.expedition.positions);
  const restarted = new CardManagementService({ accounts, world: saved.world, catalog: f.catalog, economy: new EconomyService(), save: () => {} });
  const result = restarted.cancel(seller, { listingId: listing.id, requestId: "restart-restore-squad" });
  assert.equal(result.squad, "expedition");
  assert.equal(seller.playerSquads.assignments[listing.card.id], "expedition");
  assert.deepEqual(seller.tactics.squads.expedition.starters, starters, "returning to the squad does not overwrite filled lineup slots");
  for (const id of starters) assert.deepEqual(seller.tactics.squads.expedition.positions[id], positions[id]);
});

test("buying an expedition listing adds the card to the buyer's garrison", () => {
  const f = fixture(); f.seller.playerSquads.assignments.c0 = "expedition";
  const listing = f.list();
  const result = f.service.buy(f.buyer, { listingId: listing.id, expectedPrice: 700, requestId: "buy-expedition-card" });
  assert.equal(f.buyer.playerSquads.assignments[result.card.id], "garrison");
  assert.ok(!f.seller.playerSquads.assignments[result.card.id]);
  assert.equal(f.seller.gold, 100700);
});

test("failed expedition cancellation rolls back the original squad and escrow and can retry", () => {
  const f = fixture(); f.seller.playerSquads.assignments.c0 = "expedition";
  const listing = f.list(), before = structuredClone(f.seller), input = { listingId: listing.id, requestId: "failed-expedition-return" };
  f.fail(true); assert.throws(() => f.service.cancel(f.seller, input), /disk failure/);
  assert.deepEqual(f.seller, before);
  f.fail(false); f.service.cancel(f.seller, input);
  assert.equal(f.seller.playerSquads.assignments[listing.card.id], "expedition");
  assert.equal(f.seller.draft.roster.filter(card => card.id === listing.card.id).length, 1);
});

test("old escrow records without a source squad keep the legacy garrison return", () => {
  const f = fixture(), listing = f.list();
  delete f.seller.cardManagement.listings[listing.id].sourceSquad;
  assert.equal(f.service.details(f.seller).listings[0].sourceSquad, "garrison");
  const result = f.service.cancel(f.seller, { listingId: listing.id, requestId: "cancel-legacy-escrow" });
  assert.equal(result.squad, "garrison");
  assert.equal(f.seller.playerSquads.assignments[listing.card.id], "garrison");
});


test("listing floors separate base overall from enhancement and round upward to 10 gold", () => {
  for (const [grade, overall, expected] of [["C", 75, 200], ["B", 80, 1000], ["A", 86, 5000], ["S", 90, 25000], ["X", 90, 25000]]) {
    assert.equal(minimumListingPrice(card("floor", grade, { overall })), expected);
    assert.ok(minimumListingPrice(card("floor", grade, { overall: overall + 1 })) > expected);
  }
  for (const [upgradeLevel, expected] of [[0, 5500], [4, 33000], [8, 154000]]) {
    assert.equal(minimumListingPrice(card("floor", "A", { baseOverall: 88, overall: 88, upgradeLevel })), expected);
  }
  assert.equal(minimumListingPrice(card("inferred-base", "A", { overall: 93, upgradeLevel: 4 })), 33000);
  assert.equal(minimumListingPrice(card("trained", "A", { baseOverall: 88, overall: 93, upgradeLevel: 4, trainingBonuses: { passing: 50 }, state: { fitness: 10 } })), 33000);
  const config = { ...CARD_MANAGEMENT_DEFAULTS, valuations: { ...CARD_MANAGEMENT_DEFAULTS.valuations, C: 401 } };
  assert.equal(minimumListingPrice(card("round", "C", { overall: 76 }), config), 220);
  for (const more of [{ grade: "Z" }, { overall: NaN }, { overall: 0 }, { upgradeLevel: -1 }, { upgradeLevel: 9 }]) assert.equal(minimumListingPrice(card("invalid", "C", more)), null);
});

test("the price editor gets an authoritative floor without choosing a price, while listing requires an explicit legal price", () => {
  const f = fixture(), initial = f.preview("list");
  assert.equal(initial.minimumPrice, 200); assert.equal(initial.amount, 200);
  assert.equal(initial.sourceSquad, "garrison"); assert.ok(initial.listingTerms);
  assert.equal(f.service.details(f.seller).cards[0].minimumListingPrice, 200);
  assert.equal(f.preview("list", ["c0"], { price: 700 }).listingTerms, initial.listingTerms);
  for (const value of [1, 199, 0, -1, 200.5, "200", 1000000001]) {
    assert.throws(() => f.preview("list", ["c0"], { price: value }), /价格/);
  }
  assert.throws(() => f.service.consume(f.seller, { cardIds: ["c0"], quote: initial.quote, requestId: "missing-final-price" }, "list"), /价格/);
  assert.throws(() => f.service.consume(f.seller, { cardIds: ["c0"], quote: initial.quote, price: 1, minimumPrice: 1, requestId: "forged-lowest-price" }, "list"), /不得低于/);
  assert.equal(f.seller.draft.roster.length, 7);
  const result = f.service.consume(f.seller, { cardIds: ["c0"], quote: initial.quote, price: 200, requestId: "exact-floor-listing" }, "list");
  assert.equal(result.listing.price, 200);
});

test("floor or player changes invalidate an existing editor quote and cannot bypass the minimum on submit", () => {
  const f = fixture(), first = f.preview("list", ["c0"], { price: 300 });
  f.world.cardManagement = { config: { ...structuredClone(CARD_MANAGEMENT_DEFAULTS), valuations: { C: 2000, B: 2000, A: 10000, S: 50000 } } };
  const updated = f.preview("list");
  assert.equal(updated.minimumPrice, 1000);
  assert.notEqual(updated.listingTerms, first.listingTerms);
  assert.throws(() => f.service.consume(f.seller, { cardIds: ["c0"], quote: first.quote, price: 300, requestId: "floor-raised-listing" }, "list"), /不得低于 1,000/);
  f.seller.draft.roster[0].baseOverall = 80;
  assert.notEqual(f.preview("list").listingTerms, updated.listingTerms);
  assert.equal(f.service.details(f.seller).listings.length, 0);
  assert.equal(f.seller.gold, 100000);
});

test("existing listings keep their advertised prices after the minimum price rule changes", () => {
  const f = fixture(), listing = f.list();
  f.world.cardManagement = { config: { ...structuredClone(CARD_MANAGEMENT_DEFAULTS), valuations: { C: 20000, B: 2000, A: 10000, S: 50000 } } };
  assert.equal(f.preview("list", ["c1"]).minimumPrice, 10000);
  const result = f.service.buy(f.buyer, { listingId: listing.id, expectedPrice: 700, requestId: "old-offer-unchanged" });
  assert.equal(result.amount, 700); assert.equal(f.buyer.gold, 99300);
});

test("trade-up retains only 20 server records and receipts, while old requests cannot consume twice", () => {
  const f = fixture();
  f.seller.draft.roster = Array.from({ length: 110 }, (_, i) => card("material-" + i));
  let firstInput, latestInput, latestResult;
  for (let round = 0; round < 22; round++) {
    const ids = Array.from({ length: 5 }, (_, i) => "material-" + (round * 5 + i));
    const quote = f.preview("trade-up", ids);
    const input = { cardIds: ids, quote: quote.quote, requestId: "retention-trade-" + round };
    const result = f.service.consume(f.seller, input, "trade-up");
    firstInput ??= input; latestInput = input; latestResult = result;
    assert.ok(f.service.data(f.seller).history.filter(entry => entry.kind === "trade-up").length <= 20);
    assert.ok(Object.values(f.service.data(f.seller).requests).filter(receipt => receipt.result.kind === "trade-up").length <= 20);
  }
  const data = f.service.data(f.seller), saved = new Map(f.snapshot().accounts).get("seller").cardManagement;
  assert.equal(data.history.length, 20); assert.equal(Object.keys(saved.requests).length, 20);
  assert.doesNotMatch(JSON.stringify(saved), /"material-0"|"material-5"/, "expired records and receipt snapshots are both erased");
  assert.equal(f.seller.draft.roster.length, 22, "obtained cards remain owned even when their history expires");
  const before = structuredClone(f.seller);
  assert.throws(() => f.service.consume(f.seller, firstInput, "trade-up"), /已转出|被消耗/);
  assert.deepEqual(f.seller, before);
  assert.deepEqual(f.service.consume(f.seller, latestInput, "trade-up"), latestResult);
  assert.equal(f.seller.gold, 100000);
});

function oldTradeHistory(f, count = 25) {
  const history = Array.from({ length: count }, (_, i) => ({ id: "old-trade-" + i, kind: "trade-up", createdAt: 1000 + i,
    cards: Array.from({ length: 5 }, (_, j) => card("expired-material-" + i + "-" + j)), card: card("won-" + i, "B") }));
  f.seller.cardManagement = { history, listings: {}, requests: Object.fromEntries(history.map((result, i) => ["old-request-" + i, { signature: "signature-" + i, result: structuredClone(result) }])) };
  return history;
}
test("startup migration persists cleanup of old trade-up history and receipt snapshots", () => {
  const f = fixture(); oldTradeHistory(f);
  const other = { id: "recycle-event", kind: "recycle", createdAt: 2000, cards: [card("keep-recycle")] };
  f.seller.cardManagement.history.push(other);
  f.seller.cardManagement.requests.other = { signature: "keep", result: other };
  let persisted = JSON.parse(JSON.stringify({ accounts: Object.fromEntries(f.accounts), world: {} })), saves = 0;
  const repository = { load: () => structuredClone(persisted), save(value) { saves++; persisted = JSON.parse(JSON.stringify(value)); } };
  const make = () => new CampaignService({ repository, catalog: f.catalog, territoryIndex: { territories: [] }, now: () => 1234 });
  const campaign = make(), data = campaign.accounts.get("seller").cardManagement;
  assert.equal(data.history.filter(entry => entry.kind === "trade-up").length, 20);
  assert.equal(data.history.filter(entry => entry.kind === "recycle").length, 1);
  assert.equal(Object.keys(data.requests).length, 21); assert.ok(data.requests.other);
  assert.ok(saves > 0); assert.doesNotMatch(JSON.stringify(persisted.accounts.seller.cardManagement), /old-trade-[0-4]"|old-request-[0-4]"|expired-material-[0-4]-/);
  const again = make(); assert.equal(again.cardManagement.migrateHistory(), false);
  assert.equal(again.accounts.get("seller").cardManagement.history.filter(entry => entry.kind === "trade-up").length, 20);
});
test("history cleanup rolls back with a failed trade-up save and does not let other activity evict its 20 entries", () => {
  const f = fixture(), history = oldTradeHistory(f, 20), before = structuredClone(f.seller);
  const ids = ["c0", "c1", "c2", "c3", "c4"], quote = f.preview("trade-up", ids);
  f.fail(true);
  assert.throws(() => f.service.consume(f.seller, { cardIds: ids, quote: quote.quote, requestId: "failed-retention" }, "trade-up"), /disk failure/);
  assert.deepEqual(f.seller, before, "expired snapshots and consumed cards both roll back");
  f.fail(false);
  for (let i = 0; i < 130; i++) f.service.record(f.seller, { id: "other-" + i, kind: "recycle", cards: [], createdAt: 3000 + i });
  assert.deepEqual(f.service.details(f.seller).history.filter(entry => entry.kind === "trade-up").map(entry => entry.id), [...history].reverse().map(entry => entry.id));
  assert.equal(f.service.data(f.seller).history.filter(entry => entry.kind !== "trade-up").length, 100);
  assert.equal(Object.keys(f.service.data(f.seller).requests).length, 20);
});


test("cancelling an expedition listing returns to garrison when all 22 expedition places are filled", () => {
  const f = fixture();
  f.seller.playerSquads.assignments.c0 = "expedition";
  const listing = f.list();
  for (let i = 0; i < 22; i++) {
    const player = card(`full-expedition-${i}`);
    f.seller.draft.roster.push(player);
    f.seller.playerSquads.assignments[player.id] = "expedition";
  }
  const result = f.service.cancel(f.seller, {listingId:listing.id,requestId:"cancel-full-expedition"});
  assert.equal(result.squad,"garrison");
  assert.equal(f.seller.playerSquads.assignments[result.card.id],"garrison");
  assert.equal(Object.values(f.seller.playerSquads.assignments).filter(s=>s==="expedition").length,22);
});

test('trade-up and rollback ignore unrelated live-match random functions',()=>{
 const f=fixture(),rng=()=>.314;f.world.activeChallenges.foreign={attackerId:'x',defenderId:'y',live:{match:{random:rng}}};
 f.service.save=()=>{};const result=f.consume('trade-up',['c0','c1','c2','c3','c4']);assert.equal(result.card.grade,'B');assert.equal(f.world.activeChallenges.foreign.live.match.random,rng);
 const g=fixture();g.world.activeChallenges.foreign={attackerId:'x',defenderId:'y',live:{match:{random:rng}}};const before=structuredClone(g.seller);g.service.save=()=>{throw Error('disk failure');};
 assert.throws(()=>g.consume('trade-up',['c0','c1','c2','c3','c4']),/disk failure/);assert.deepEqual(g.seller,before);assert.equal(g.world.activeChallenges.foreign.live.match.random,rng);
 g.service.save=()=>{};g.service.updateConfig({...CARD_MANAGEMENT_DEFAULTS});assert.equal(g.world.activeChallenges.foreign.live.match.random,rng);
});

test('compact trade-up returns only the committed receipt without building map or warehouse state',()=>{
 const f=fixture(),q=f.preview('trade-up',['c0','c1','c2','c3','c4']);
 const campaign={settleDueChallenges(){},cardManagement:f.service,state(){throw Error('full state must not block the result');}};
 const original=f.service.details;f.service.details=()=>{throw Error('warehouse must not block the result');};
 const input={cardIds:q.cardIds,quote:q.quote,requestId:'compact-trade-up',resultOnly:true};
 const result=CampaignService.prototype.mutateCardManagement.call(campaign,f.seller,'trade-up',input);
 assert.deepEqual(Object.keys(result),['result']);assert.ok(f.snapshot());assert.ok(f.seller.draft.roster.some(c=>c.id===result.result.card.id));
 assert.deepEqual(CampaignService.prototype.mutateCardManagement.call(campaign,f.seller,'trade-up',input),result);
 f.service.details=original;
});
test('trade-up quote validation is identical without preparing candidate display cards',()=>{
 const f=fixture(),input={kind:'trade-up',cardIds:['c0','c1','c2','c3','c4']};
 const full=f.service.preview(f.seller,input),lean=f.service.preview(f.seller,input,{includeCandidates:false});
 assert.equal(lean.quote,full.quote);assert.ok(full.candidates.length);assert.deepEqual(lean.candidates,[]);
});
