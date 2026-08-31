import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROLES = ["readonly", "operator", "content", "superadmin"];
const WRITE_ROLES = new Set(["operator", "content", "superadmin"]);
const DEFAULT_ADMIN_PASSWORD = "19971019";

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export class AdminService {
  constructor({ dataPath, campaign, bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || DEFAULT_ADMIN_PASSWORD, now = Date.now } = {}) {
    this.dataPath = dataPath;
    this.campaign = campaign;
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
    } catch {
      return { version: 1, admins: {}, sessions: {}, audit: [], tasks: [] };
    }
  }

  save() {
    if (!this.dataPath) return;
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2));
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
}

export { DEFAULT_ADMIN_PASSWORD, ROLES };
