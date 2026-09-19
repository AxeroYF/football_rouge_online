import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import crypto from "node:crypto";
import { CARD_MANAGEMENT_DEFAULTS, MAX_CARD_PRICE, TRADE_UP_GRADES, TRADE_UP_HISTORY_LIMIT, recycleValue, minimumListingPrice } from "../../shared/config/card-management.mjs";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import { createPlayerCardInstance } from "../domain/player-card-instance.mjs";
import { normalizePlayerSquads, expeditionPlayerCount, EXPEDITION_MAX_PLAYERS } from "../../shared/config/player-squads.mjs";
import { repairTacticsLineups } from "../../shared/config/tactics-repair.mjs";

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const cardId = card => String(card.id ?? card.playerId);
const clone = value => structuredClone(value);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const identity = card => String(card.cardDefinitionId ?? card.id);
const squadId = value => value === "expedition" ? "expedition" : "garrison";
const publicCard = card => ({ ...createPlayerCardViewModel(card), id: cardId(card), trainingBonuses: clone(card.trainingBonuses ?? {}),
  traits: clone(card.traits ?? []), heightCm: card.heightCm, preferredFoot: card.preferredFoot,
  state: { fitness: card.state?.fitness, form: card.state?.form, injury: clone(card.state?.injury ?? {}), suspension: clone(card.state?.suspension ?? {}) } });
const restore = (target, before) => { for (const name of Object.keys(target)) delete target[name]; Object.assign(target, before); };
const price = value => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_CARD_PRICE) fail(`价格必须是 1 至 ${MAX_CARD_PRICE.toLocaleString("en-US")} 的整数`);
  return value;
};

export class CardManagementService {
  constructor({ accounts, world, catalog, economy, save, now = Date.now, random = Math.random }) {
    Object.assign(this, { accounts, world, catalog, economy, save, now, random });
  }

  config() { return clone(this.world?.cardManagement?.config ?? CARD_MANAGEMENT_DEFAULTS); }
  data(account) { return account.cardManagement ?? { requests: {}, listings: {}, history: [] }; }
  ensure(account) { return account.cardManagement ??= { requests: {}, listings: {}, history: [] }; }
  ready(account) {
    if (!account?.setupComplete || !Array.isArray(account.draft?.roster)) fail("请先完成初始建队");
  }
  account(id) {
    const account = this.accounts.get(id);
    if (!account) fail("球队不存在", 404);
    this.ready(account);
    return account;
  }

  blocked(account, card) {
    if(raidMatchForAccount(this.world,account.id))return '豪门远征比赛进行中';
    if(card.coalitionLoan)return "已借调联军，归队后才能操作";
    if(card.medical)return "治疗中，请先完成或取消治疗";
    if (card.locked || card.state?.locked || card.card?.status?.locked) return "球员卡已锁定";
    if (card.training || Object.values(account.training?.tasks ?? {}).some(task => task.playerId === cardId(card) && task.completedAt == null && task.cancelledAt == null)) return "训练中，请先完成或取消训练";
    if (Object.values(account.enhancement?.offers ?? {}).some(offer => offer.cardId === cardId(card) && offer.status === "pending")) return "请先绑定强化特性";
    // Keep both legs of a challenge bound to their original owner's cards.
    if (this.world?.eliteChallenges?.[account.id] || Object.values(this.world?.activeChallenges ?? {}).some(match => match.attackerId === account.id || match.defenderId === account.id)) return "球队比赛进行中，结束后才能转出球员卡";
    return null;
  }

  select(account, ids, exactCount = null) {
    this.ready(account);
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) fail("请选择不重复的球员卡，单次最多 100 张");
    if (exactCount !== null && ids.length !== exactCount) fail(`必须选择 ${exactCount} 张球员卡`);
    return [...ids].sort().map(id => {
      const card = account.draft.roster.find(card => cardId(card) === id);
      if (!card) fail("球员卡已转出、被消耗或不属于当前球队，请刷新", 409);
      const reason = this.blocked(account, card);
      if (reason) fail(reason, 409);
      return card;
    });
  }

  pool(cards) {
    const grade = cards[0]?.grade;
    const targetGrade = TRADE_UP_GRADES[grade];
    if (!targetGrade || cards.some(card => card.grade !== grade || card.isX === true)) fail("汰换需要 5 张同评级的 C、B 或 A 卡；传奇卡不可作素材");
    // Use the published definition for affiliation, falling back only for retired definitions.
    const definitions = new Map(this.catalog.map(card => [identity(card), card]));
    const sources = cards.map(card => definitions.get(identity(card)) ?? card);
    const validAffiliation = value => value && !["未知", "无", "无俱乐部", "无国家队", "-", "—", "n/a", "unknown"].includes(value);
    const countries = new Set(sources.map(card => key(card.nationality)).filter(validAffiliation));
    const clubs = new Set(sources.map(card => key(card.club)).filter(validAffiliation));
    const candidates = [...new Map(this.catalog.filter(card => card.grade === targetGrade && !card.isX && card.status !== "draft" &&
      (countries.has(key(card.nationality)) || clubs.has(key(card.club)))).map(card => [identity(card), card])).values()]
      .sort((a, b) => identity(a).localeCompare(identity(b)));
    if (!candidates.length) fail("这些素材的国家／俱乐部池中没有高一级球员，请更换素材");
    return { targetGrade, candidates };
  }

  preview(account, input = {}, { includeCandidates = true } = {}) {
    const { kind } = input;
    if (!["recycle", "trade-up", "list"].includes(kind)) fail("球员卡操作不存在");
    const cards = this.select(account, input.cardIds, kind === "trade-up" ? 5 : kind === "list" ? 1 : null);
    const config = this.config();
    if (kind === "recycle" && !config.recycleEnabled) fail("球员卡回收暂未开放");
    const pool = kind === "trade-up" ? this.pool(cards) : null;
    const minimumPrice = kind === "list" ? minimumListingPrice(cards[0], config) : null;
    if (kind === "list" && (minimumPrice == null || minimumPrice > MAX_CARD_PRICE)) fail("该球员卡暂无有效挂牌限价，请联系管理员");
    const amount = kind === "recycle" ? cards.reduce((sum, card) => sum + recycleValue(card, config), 0) : kind === "list" ? price(input.price === undefined ? minimumPrice : input.price) : 0;
    if (kind === "list" && amount < minimumPrice) fail("挂牌价格不得低于 " + minimumPrice.toLocaleString("zh-CN") + " 金币");
    if (kind === "recycle" && (cards.some(card => recycleValue(card, config) <= 0) || !Number.isSafeInteger(amount))) fail("所选卡片尚无有效回收价格");
    const ids = new Set(cards.map(cardId));
    const squads = account.tactics?.squads ?? (account.tactics ? { expedition: account.tactics } : {});
    const lineupAffected = Object.entries(squads).filter(([, squad]) => (squad.starters ?? []).some(id => ids.has(String(id)))).map(([squad]) => squad);
    return {
      kind, cardIds: cards.map(cardId), cards: cards.map(publicCard), amount, lineupAffected,
      ...(kind === "list" ? { sourceSquad: squadId(account.playerSquads?.assignments?.[cardId(cards[0])]), minimumPrice,
        listingTerms: hash([cards, config, minimumPrice, account.tactics, account.playerSquads]) } : {}),
      recycle: kind === "recycle" ? { ratioBps: config.recycleRatioBps, upgradeBonusBps: config.upgradeBonusBps,
        lines: cards.map(card => ({ cardId: cardId(card), valuation: config.valuations[card.grade === "X" ? "S" : card.grade], amount: recycleValue(card, config) })) } : null,
      targetGrade: pool?.targetGrade ?? null,
      candidates: includeCandidates ? pool?.candidates.map(publicCard) ?? [] : [],
      quote: hash([account.id, kind, cards, config, amount, pool?.candidates ?? null, account.tactics, account.playerSquads]),
    };
  }

  request(actor, input, kind, signatureValues, participants, action) {
    this.ready(actor);
    if (typeof input.requestId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.requestId)) fail("操作请求标识无效");
    const signature = hash([kind, signatureValues]);
    const previous = this.data(actor).requests[input.requestId];
    if (previous) {
      if (previous.signature !== signature) fail("请求标识已用于另一项操作", 409);
      return clone(previous.result);
    }
    const targets = [...new Set([actor, ...participants])];
    const snapshots = targets.map(account => [account, clone(account)]);
    try {
      const result = action();
      this.ensure(actor).requests[input.requestId] = { signature, result: clone(result) };
      this.save();
      return clone(result);
    } catch (error) {
      for (const [target, before] of snapshots) restore(target, before);
      throw error;
    }
  }

  record(account, event) {
    const data = this.ensure(account);
    data.history = [...data.history, clone(event)];
    this.pruneHistory(account);
  }

  pruneHistory(account) {
    const data = account.cardManagement;
    if (!data) return false;
    const previous = data.history ?? [];
    let tradeCount = 0, otherCount = 0, changed = false;
    const history = [...previous].reverse().filter(event =>
      event.kind === "trade-up" ? ++tradeCount <= TRADE_UP_HISTORY_LIMIT : ++otherCount <= 100).reverse();
    if (history.length !== previous.length) { data.history = history; changed = true; }
    const retained = new Set(history.filter(event => event.kind === "trade-up").map(event => event.id));
    // Receipts also contain full card snapshots. Drop expired trade-up receipts with the history;
    // replaying an expired request cannot consume again because its exact material instances are gone.
    for (const [id, receipt] of Object.entries(data.requests ?? {})) {
      if (receipt.result?.kind === "trade-up" && !retained.has(receipt.result.id)) {
        delete data.requests[id]; changed = true;
      }
    }
    return changed;
  }

  migrateHistory() {
    let changed = false;
    for (const account of this.accounts.values()) changed = this.pruneHistory(account) || changed;
    return changed;
  }

  remove(account, ids) {
    const previousRoster = account.draft.roster;
    account.draft.roster = previousRoster.filter(card => !ids.has(cardId(card)));
    account.tactics = repairTacticsLineups(account.tactics, account.draft.roster, account.playerSquads, { previousRoster });
    account.playerSquads = normalizePlayerSquads(account.playerSquads, account.draft.roster);
    for (const task of Object.values(account.training?.tasks ?? {})) if (ids.has(task.playerId)) task.finishedAt ??= this.now();
  }

  transferable(card) {
    const result = clone(card);
    result.cardDefinitionId ??= cardId(card);
    // Initial draft cards predate independent instance IDs and can occur on both teams.
    result.id = result.cardInstanceId || `player-card:${crypto.randomUUID()}`;
    result.cardInstanceId = result.id;
    result.playerId = result.id;
    delete result.card;
    return result;
  }

  receive(account, card, squad = "garrison") {
    const previousRoster = [...account.draft.roster];
    if (account.draft.roster.some(existing => cardId(existing) === cardId(card))) fail("球员卡实例冲突，请联系管理员", 409);
    account.draft.roster.push(card);
    account.playerSquads = normalizePlayerSquads(account.playerSquads, account.draft.roster);
    account.playerSquads.assignments[cardId(card)] = squadId(squad);
    if (squadId(squad) === "expedition" && expeditionPlayerCount(account.playerSquads, account.draft.roster) > EXPEDITION_MAX_PLAYERS) {
      account.playerSquads.assignments[cardId(card)] = "garrison";
    }
    account.tactics = repairTacticsLineups(account.tactics, account.draft.roster, account.playerSquads, { previousRoster });
  }

  consume(account, input, kind) {
    return this.request(account, input, kind, [input.cardIds, input.quote, input.price], [], () => {
      if (kind === "list") price(input.price);
      const preview = this.preview(account, { ...input, kind }, { includeCandidates: false });
      if (typeof input.quote !== "string" || preview.quote !== input.quote) fail("卡片、阵容或价格已变化，请重新预览后确认", 409);
      const cards = this.select(account, preview.cardIds);
      const event = { id: `card-operation:${crypto.randomUUID()}`, kind, createdAt: this.now(), cards: cards.map(publicCard), amount: preview.amount };
      if (kind === "list") {
        const listing = { id: `listing:${crypto.randomUUID()}`, sellerId: account.id, sellerName: account.draft.teamName ?? account.nickname,
          card: this.transferable(cards[0]), sourceSquad: preview.sourceSquad, price: preview.amount, status: "active", createdAt: this.now() };
        this.remove(account, new Set(preview.cardIds));
        this.ensure(account).listings[listing.id] = listing;
        event.listing = this.publicListing(listing, account.id);
      } else if (kind === "trade-up") {
        const { candidates } = this.pool(cards);
        const roll = this.random();
        if (!Number.isFinite(roll) || roll < 0 || roll >= 1) fail("随机源异常，请重试", 500);
        const card = createPlayerCardInstance(candidates[Math.floor(roll * candidates.length)], 0);
        delete card.training; delete card.trainingBonuses;
        delete card.enhancementBaseAttributes; delete card.enhancementBaseEffectiveAttributes;
        delete card.enhancementTraitIds;
        card.acquisitionSource = "trade-up"; card.acquiredAt = this.now();
        this.remove(account, new Set(preview.cardIds));
        this.receive(account, card);
        event.card = publicCard(card);
      } else {
        this.economy.adjust(account, preview.amount, "player-card-recycle");
        this.remove(account, new Set(preview.cardIds));
      }
      this.record(account, event);
      return event;
    });
  }

  publicListing(listing, viewerId) {
    return { id: listing.id, sellerName: listing.sellerName, price: listing.price, status: listing.status, createdAt: listing.createdAt,
      mine: listing.sellerId === viewerId, sourceSquad: squadId(listing.sourceSquad), card: publicCard(listing.card) };
  }
  findListing(id) {
    for (const seller of this.accounts.values()) {
      const listing = this.data(seller).listings[id];
      if (listing) return { seller, listing };
    }
    fail("挂牌不存在", 404);
  }

  cancel(account, input) {
    return this.request(account, input, "cancel", [input.listingId], [], () => {
      const listing = this.data(account).listings[input.listingId];
      if (!listing || listing.sellerId !== account.id) fail("只能下架自己的球员卡", 403);
      if (listing.status !== "active") fail("该挂牌已经成交或下架", 409);
      this.receive(account, clone(listing.card), listing.sourceSquad);
      listing.status = "cancelled"; listing.closedAt = this.now();
      const event = { id: listing.id, kind: "cancel", createdAt: this.now(), card: publicCard(listing.card), squad: account.playerSquads.assignments[cardId(listing.card)] };
      this.record(account, event);
      return event;
    });
  }

  buy(buyer, input) {
    const { seller, listing } = this.findListing(input.listingId);
    return this.request(buyer, input, "buy", [input.listingId, input.expectedPrice], [seller], () => {
      if (seller.id === buyer.id) fail("不能购买自己的挂牌");
      if (listing.status !== "active") fail("球员卡已被购买或下架，请刷新市场", 409);
      if (input.expectedPrice !== listing.price) fail("挂牌价格已变化，请刷新", 409);
      this.economy.spend(buyer, listing.price, "player-card-market-buy");
      this.economy.adjust(seller, listing.price, "player-card-market-sell");
      this.receive(buyer, clone(listing.card));
      listing.status = "sold"; listing.buyerId = buyer.id; listing.closedAt = this.now();
      const event = { id: listing.id, kind: "buy", createdAt: this.now(), amount: listing.price, card: publicCard(listing.card), sellerName: listing.sellerName, buyerName: buyer.draft.teamName ?? buyer.nickname };
      this.record(buyer, event); this.record(seller, { ...event, kind: "sell" });
      return event;
    });
  }

  details(account) {
    this.ready(account);
    const config = this.config();
    return {
      config, maxPrice: MAX_CARD_PRICE,
      cards: account.draft.roster.map(card => ({ ...publicCard(card), blocked: this.blocked(account, card), recycleValue: recycleValue(card, config), minimumListingPrice: minimumListingPrice(card, config), squad: account.playerSquads?.assignments?.[cardId(card)] ?? "garrison" })),
      listings: [...this.accounts.values()].flatMap(owner => Object.values(this.data(owner).listings).filter(listing => listing.status === "active").map(listing => this.publicListing(listing, account.id))).sort((a, b) => b.createdAt - a.createdAt),
      history: [...this.data(account).history].reverse().map(clone),
    };
  }

  adminView() {
    return { config: this.config(), maxPrice: MAX_CARD_PRICE,
      teams: [...this.accounts.values()].filter(account => account.setupComplete).map(account => ({ id: account.id, name: account.draft.teamName ?? account.nickname, gold: account.gold,
        cards: account.draft.roster.map(card => ({ ...publicCard(card), blocked: this.blocked(account, card) })) })),
      history: [...this.accounts.values()].flatMap(account => this.data(account).history.filter(event => event.kind === "admin-trade").map(event => ({ ...clone(event), sellerId: account.id }))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
    };
  }

  adminTrade(actor, input) {
    const seller = this.account(input.sellerId), buyer = this.account(input.buyerId);
    const reason = String(input.reason ?? "").trim();
    if (!reason || reason.length > 120) fail("请填写 1 至 120 字的代办原因");
    return this.request(seller, input, "admin-trade", [actor.id, buyer.id, input.cardId, input.price, reason], [buyer], () => {
      if (seller === buyer) fail("买家与卖家不能相同");
      const amount = price(input.price), cards = this.select(seller, [input.cardId], 1);
      const card = this.transferable(cards[0]);
      this.economy.spend(buyer, amount, "player-card-admin-buy");
      this.economy.adjust(seller, amount, "player-card-admin-sell");
      this.remove(seller, new Set([input.cardId])); this.receive(buyer, card);
      const event = { id: `admin-trade:${crypto.randomUUID()}`, requestId: input.requestId, kind: "admin-trade", createdAt: this.now(), adminId: actor.id,
        sellerId: seller.id, buyerId: buyer.id, sellerName: seller.draft.teamName ?? seller.nickname, buyerName: buyer.draft.teamName ?? buyer.nickname, reason, amount, card: publicCard(card) };
      this.record(seller, event); this.record(buyer, { ...event, kind: "admin-purchase" });
      return event;
    });
  }

  updateConfig(input) {
    if (!this.world) fail("共享世界尚未初始化");
    if (typeof input.recycleEnabled !== "boolean") fail("回收开关无效");
    for (const field of ["recycleRatioBps", "upgradeBonusBps"]) if (!Number.isSafeInteger(input[field]) || input[field] < 0 || input[field] > 10000) fail("回收比例及每级强化加价须为 0% 至 100%");
    const valuations = Object.fromEntries(["C", "B", "A", "S"].map(grade => [grade, price(input.valuations?.[grade])]));
    const before = clone(this.world.cardManagement);
    try {
      this.world.cardManagement ??= {};
      this.world.cardManagement.config = { recycleEnabled: input.recycleEnabled, recycleRatioBps: input.recycleRatioBps, upgradeBonusBps: input.upgradeBonusBps, valuations };
      this.save(); return this.config();
    } catch (error) { if(before===undefined)delete this.world.cardManagement;else this.world.cardManagement=before; throw error; }
  }
}
