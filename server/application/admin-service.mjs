import { emptyWonderConstruction, normalizeWonderConstruction, wonderRequirementOptions } from "../../shared/config/wonder-construction.mjs";
import { createPlayerCardInstance } from "../domain/player-card-instance.mjs";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import { normalizePlayerSquads } from "../../shared/config/player-squads.mjs";
import { S4_ENHANCEMENT } from "../../shared/config/enhancement.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROLES = ["readonly", "operator", "content", "superadmin"];
const WRITE_ROLES = new Set(["operator", "content", "superadmin"]);
const DEFAULT_ADMIN_PASSWORD = "local-dev-admin";

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export class AdminService {
  constructor({ dataPath, campaign, wonderCatalog = { items: [] }, wonderProposals = {}, playerCatalog = [], bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || DEFAULT_ADMIN_PASSWORD, now = Date.now } = {}) {
    this.dataPath = dataPath;
    this.campaign = campaign;
    this.wonderCatalog = wonderCatalog;
    this.wonderProposals = wonderProposals;
    this.wonderOptions = wonderRequirementOptions(playerCatalog, wonderProposals);
    this.now = now;
    this.bootstrapPassword = String(bootstrapPassword);
    this.state = this.load();
    this.ensureBootstrapAdmin();
  }

  load() {
    if (!this.dataPath || !fs.existsSync(this.dataPath)) return { version: 1, admins: {}, sessions: {}, audit: [], tasks: [] };
    try {
      const value = JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
      return { version: 1, admins: {}, sessions: {}, audit: [], tasks: [], ...value };
    } catch (cause) {
      throw new Error("后台存档读取失败，已停止加载以保留原始数据", { cause });
    }
  }

  save(state = this.state) {
    if (!this.dataPath) return;
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    const temporary = this.dataPath + "." + crypto.randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { flag: "wx", flush: true });
      fs.renameSync(temporary, this.dataPath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  wonderView(item, record = this.state.wonderDrafts?.[item.assetId]) {
    const proposal = this.wonderProposals[item.assetId];
    return {
      id: item.id, assetId: item.assetId, name: item.name, region: item.region,
      location: item.location, thumbnail: item.thumbnail,
      liveEffectText:this.campaign?.wonders?.catalog().find(w=>w.wonderId===item.assetId)?.effectText??null,
      effectText: record?.effectText ?? proposal?.effectText ?? "",
      construction: normalizeWonderConstruction(record?.construction ?? proposal?.construction ?? emptyWonderConstruction(), this.wonderOptions),
      suggestedConstruction: !Object.hasOwn(record ?? {}, "construction") && !!proposal,
      suggestedEffect: !record && !!proposal?.effectText,
      designNote: proposal?.note ?? "", dependency: proposal?.dependency ?? null,
      revision: record?.revision ?? 0,
      updatedAt: record?.updatedAt ?? null, updatedBy: record?.updatedBy ?? null,
      status: record ? "draft" : proposal ? "proposal" : "empty",
    };
  }

  wonderManagement(actor) {
    this.requireRole(actor);
    return { wonders: this.wonderCatalog.items.map(item => this.wonderView(item)), maxEffectLength: 20000, runtimeVersion:this.campaign?.wonders?.version??null, requirementOptions: this.wonderOptions };
  }

  saveWonderDraft(actor, assetId, input = {}) {
    this.requireRole(actor, ["content", "superadmin"]);
    const item = this.wonderCatalog.items.find(value => value.assetId === assetId);
    if (!item) throw Object.assign(new Error("奇观不存在"), { statusCode: 404 });
    if (!input || typeof input.effectText !== "string" || input.effectText.length > 20000) {
      throw Object.assign(new Error("效果须为文字，可留空，最多 20000 字符"), { statusCode: 400 });
    }
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
      throw Object.assign(new Error("缺少有效的草稿版本，请重新读取奇观"), { statusCode: 400 });
    }
    const before = this.state.wonderDrafts?.[assetId];
    const currentConstruction = this.wonderView(item).construction;
    const construction = input.construction === undefined ? normalizeWonderConstruction(currentConstruction, this.wonderOptions) : normalizeWonderConstruction(input.construction, this.wonderOptions);
    if (input.revision !== (before?.revision ?? 0)) {
      // A lost response can be retried without duplicating the revision or audit.
      if (before && input.revision < before.revision && input.effectText === before.effectText && JSON.stringify(construction) === JSON.stringify(normalizeWonderConstruction(currentConstruction, this.wonderOptions))) return { wonder: this.wonderView(item) };
      throw Object.assign(new Error("此奇观已在其他页面更新，请读取最新版本后再保存；当前输入仍保留"), { statusCode: 409 });
    }
    const record = { effectText: input.effectText, construction, revision: (before?.revision ?? 0) + 1, updatedAt: this.now(), updatedBy: actor.username };
    const entry = {
      adminActionId: "ACT-" + crypto.randomBytes(8).toString("hex"), adminId: actor.id,
      username: actor.username, action: "wonder.draft.save", createdAt: record.updatedAt,
      details: { assetId, wonderId: item.id, revision: record.revision, textLength: record.effectText.length },
    };
    const next = { ...this.state, wonderDrafts: { ...this.state.wonderDrafts, [assetId]: record }, audit: [entry, ...this.state.audit].slice(0, 1000) };
    // Draft and audit commit together; failed writes leave the live state unchanged.
    this.save(next);
    this.state = next;
    return { wonder: this.wonderView(item) };
  }

  ensureBootstrapAdmin() {
    const existing = Object.values(this.state.admins).find((admin) => admin.username === "admin");
    if (existing) {
      if (this.digest(this.bootstrapPassword, existing.salt) === existing.hash) return;
      existing.salt = crypto.randomBytes(16).toString("hex");
      existing.hash = this.digest(this.bootstrapPassword, existing.salt);
      this.state.sessions = {};
      this.save();
      return;
    }
    if (Object.keys(this.state.admins).length) return;
    const salt = crypto.randomBytes(16).toString("hex");
    const id = "ADM-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    this.state.admins[id] = { id, username: "admin", role: "superadmin", salt, hash: this.digest(this.bootstrapPassword, salt), createdAt: this.now() };
    this.save();
  }

  digest(password, salt) { return crypto.scryptSync(String(password), salt, 64).toString("hex"); }

  login(username, password) {
    const name = clean(username);
    const admin = Object.values(this.state.admins).find((value) => value.username === name);
    if (!admin || this.digest(password, admin.salt) !== admin.hash) throw Object.assign(new Error("管理员账号或密码错误"), { statusCode: 401 });
    const token = crypto.randomBytes(32).toString("base64url");
    this.state.sessions[token] = { adminId: admin.id, createdAt: this.now(), lastSeenAt: this.now() };
    this.save();
    return { token, profile: this.publicAdmin(admin) };
  }

  authenticate(token) {
    const session = this.state.sessions[clean(token)];
    const admin = session ? this.state.admins[session.adminId] : null;
    if (!admin) throw Object.assign(new Error("管理员登录已失效"), { statusCode: 401 });
    session.lastSeenAt = this.now();
    return admin;
  }

  publicAdmin(admin) { return { id: admin.id, username: admin.username, role: admin.role, createdAt: admin.createdAt }; }

  requireRole(admin, roles = ROLES) {
    if (!roles.includes(admin.role)) throw Object.assign(new Error("权限不足"), { statusCode: 403 });
  }

  audit(admin, action, details = {}) {
    this.state.audit.unshift({ adminActionId: "ACT-" + crypto.randomBytes(8).toString("hex"), adminId: admin.id, username: admin.username, action, details, createdAt: this.now() });
    this.state.audit = this.state.audit.slice(0, 1000);
    this.save();
  }

  listAudit(limit = 100) { return this.state.audit.slice(0, Math.max(1, Math.min(500, Number(limit) || 100))); }

  listTasks() { return this.state.tasks.slice().sort((a, b) => b.createdAt - a.createdAt); }

  createTask(admin, input = {}) {
    this.requireRole(admin, [...WRITE_ROLES]);
    const idempotencyKey = clean(input.idempotencyKey);
    if (idempotencyKey) {
      const existing = this.state.tasks.find((task) => task.idempotencyKey === idempotencyKey);
      if (existing) return existing;
    }
    const task = { id: "TASK-" + crypto.randomBytes(8).toString("hex"), type: clean(input.type, "generic"), status: "queued", payload: input.payload ?? {}, idempotencyKey: idempotencyKey || null, createdBy: admin.id, createdAt: this.now(), executeAt: Number(input.executeAt) || this.now() };
    this.state.tasks.push(task);
    this.audit(admin, "task.create", { taskId: task.id, type: task.type });
    this.save();
    return task;
  }

  completeTask(admin, taskId) {
    this.requireRole(admin, [...WRITE_ROLES]);
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw Object.assign(new Error("任务不存在"), { statusCode: 404 });
    task.status = "completed"; task.completedAt = this.now();
    this.audit(admin, "task.complete", { taskId });
    this.save();
    return task;
  }

  adjustPlayerGold(admin, accountId, delta, reason) {
    this.requireRole(admin, ["operator", "superadmin"]);
    const account = this.campaign?.accounts?.get(accountId);
    if (!account) throw Object.assign(new Error("玩家不存在"), { statusCode: 404 });
    const amount = Number(delta);
    if (!Number.isSafeInteger(amount) || amount === 0) throw new Error("金币变更必须是非零整数");
    const result = this.campaign.adjustGold(account, amount, `admin:${clean(reason, "manual adjustment")}`);
    this.audit(admin, "player.gold.adjust", { accountId, delta: amount, reason: clean(reason) });
    return { accountId, ...result };
  }

  cardManagement(admin) {
    this.requireRole(admin);
    this.campaign.settleDueChallenges();
    return this.campaign.cardManagement.adminView();
  }

  tradePlayerCard(admin, input) {
    this.requireRole(admin, ["operator", "superadmin"]);
    this.campaign.settleDueChallenges();
    const result = this.campaign.cardManagement.adminTrade(admin, input);
    // The canonical audit is committed with both accounts; audit-file failures can be retried.
    if (!this.state.audit.some(entry => entry.action === "player.card.trade" && entry.details.id === result.id)) this.audit(admin, "player.card.trade", result);
    return result;
  }

  configureCardManagement(admin, input) {
    this.requireRole(admin, ["operator", "superadmin"]);
    const config = this.campaign.cardManagement.updateConfig(input);
    this.audit(admin, "player.card.config", config);
    return { config };
  }

  playerPackManagement(admin) {
    this.requireRole(admin);
    return this.campaign.adminPlayerPackManagement();
  }

  playerGrantManagement(admin) {
    this.requireRole(admin);
    return {
      teams: [...this.campaign.accounts.values()].map((account) => ({ id:account.id, nickname:account.nickname, teamName:account.draft?.teamName ?? "尚未建队", setupComplete:account.setupComplete === true, playerCount:account.draft?.roster?.length ?? 0 })),
      players: this.campaign.playerLibrary.map((player) => ({ ...createPlayerCardViewModel(player), id:player.id })),
      maxGrantCount:999, maxUpgradeLevel:S4_ENHANCEMENT.maxLevel, abilityBonuses:S4_ENHANCEMENT.abilityBonuses,
    };
  }

  grantPlayers(admin, input = {}) {
    this.requireRole(admin, ["operator", "superadmin"]);
    const accountId = clean(input.accountId), playerId = clean(input.playerId);
    const count = Number(input.count), upgradeLevel = Number(input.upgradeLevel);
    const requestId = clean(input.requestId), reason = clean(input.reason, "后台球员发放").slice(0,120);
    const fail = (message, statusCode=400) => { throw Object.assign(new Error(message), {statusCode}); };
    if (typeof input.count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 999) fail("发放数量必须是 1 至 999 的整数");
    if (typeof input.upgradeLevel !== "number" || !Number.isInteger(upgradeLevel) || upgradeLevel < 0 || upgradeLevel > S4_ENHANCEMENT.maxLevel) fail("强化等级必须是 0 至 8 的整数");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) fail("发放请求标识无效");
    const account = this.campaign.accounts.get(accountId);
    if (!account) fail("目标球队不存在",404);
    if (!account.setupComplete || !Array.isArray(account.draft?.roster)) fail("目标账号尚未完成建队");
    const signature = JSON.stringify([admin.id, playerId, count, upgradeLevel, reason]);
    const previous = account.adminPlayerGrants?.[requestId];
    if (previous && previous.signature !== signature) fail("发放请求标识与原请求不一致",409);
    let result = previous?.result;
    if (!result) {
      const source = this.campaign.playerLibrary.find((player) => player.id === playerId);
      if (!source) fail("请选择已上线的球员",404);
      result = this.campaign.enhancement.transaction(account, () => {
        const cards = Array.from({length:count}, () => {
          const card = createPlayerCardInstance(source,0);
          this.campaign.enhancement.applyLevel(card,upgradeLevel);
          card.acquisitionSource = "admin"; card.acquiredAt = this.now();
          card.adminGrantRequestId = requestId;
          account.draft.roster.push(card);
          this.campaign.enhancement.offer(account,card);
          return card;
        });
        account.playerSquads = normalizePlayerSquads(account.playerSquads,account.draft.roster);
        for (const card of cards) account.playerSquads.assignments[card.id] = "garrison";
        const granted = { requestId, accountId, teamName:account.draft.teamName, nickname:account.nickname, playerId, playerName:source.name, count, upgradeLevel, reason, cardIds:cards.map((card) => card.id), rosterCount:account.draft.roster.length };
        account.adminPlayerGrants ??= {};
        account.adminPlayerGrants[requestId] = {signature,result:granted};
        return granted;
      });
    }
    if (!this.state.audit.some((entry) => entry.action === "player.card.grant" && entry.details.accountId === accountId && entry.details.requestId === requestId)) {
      this.audit(admin,"player.card.grant",result);
    }
    return {...structuredClone(result), replayed:Boolean(previous)};
  }

  grantPlayerPacks(admin, input = {}) {
    this.requireRole(admin,["operator","superadmin"]);
    const count = Number(input.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 999) throw new Error("单次卡包数量必须是 1 至 999 的整数");
    const reason = clean(input.reason,"后台运营发放").slice(0,120);
    const scope = clean(input.scope,"player");
    if (scope === "all") {
      const result = this.campaign.grantPlayerPacksToAllAccounts(input.packType,count);
      this.audit(admin,"player.pack.grant-all",{
        packType:result.grant.type,
        packName:result.grant.name,
        countPerPlayer:result.grant.count,
        recipientCount:result.recipientCount,
        totalPacksGranted:result.totalPacksGranted,
        reason,
      });
      return { ...result,scope,reason };
    }
    if (scope !== "player") throw new Error("卡包发放范围无效");
    const result = this.campaign.grantPlayerPacksToAccount(input.accountId,input.packType,count);
    this.audit(admin,"player.pack.grant",{
      accountId:result.player.id,
      nickname:result.player.nickname,
      packType:result.grant.type,
      packName:result.grant.name,
      count:result.grant.count,
      balance:result.player.packs.find((pack) => pack.type === result.grant.type)?.count ?? null,
      reason,
    });
    return { ...result,scope,reason };
  }
}

export { DEFAULT_ADMIN_PASSWORD, ROLES };
