import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function writeAtomic(file, source) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, source);
  fs.renameSync(temporary, file);
}
function update(relative, transform) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after === before) return;
  writeAtomic(file, after);
}
function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`无法定位 Admin 登录更新点：${label}`);
  return source.replace(before, after);
}

update("admin-v2.html", (source) => {
  const oldLogin = `  <div id="login-view" class="login-shell">
    <section class="login-brand">
      <span class="brand-square">YD</span><small>YELLOWDOGS CHRONICLES</small>
      <h1>黄狗风云<br>内容运营后台</h1>
      <p>统一维护 YDL 引入球员、球员数值、制卡任务、卡画资产与生产目录。</p>
      <footer><span>PLAYER DATA</span><span>CARD STUDIO</span><span>OPERATIONS</span></footer>
    </section>
    <form id="login-form" class="login-card">
      <small>SECURE ADMIN ACCESS</small><h2>管理员登录</h2><p>请输入已配置的后台账号与密码。</p>
      <label>管理员账号<input name="username" value="admin" autocomplete="username" required></label>
      <label>登录密码<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="primary">进入工作台</button><output id="login-error"></output>
    </form>
  </div>`;
  const newLogin = `  <div id="login-view" class="login-shell">
    <form id="login-form" class="login-card">
      <div class="login-identity">
        <img src="./assets/yellowdog-logo-transparent.png" alt="黄狗风云">
        <small>YELLOWDOGS CHRONICLES</small>
        <h1>黄狗风云</h1>
        <p>内容运营后台</p>
      </div>
      <h2>管理员登录</h2><p class="login-copy">输入后台账号与密码进入工作台。</p>
      <label>管理员账号<input name="username" value="admin" autocomplete="username" required></label>
      <label>登录密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入登录密码" required></label>
      <button type="submit" class="primary">进入工作台</button>
      <p class="login-hint">默认账号 <b>admin</b> · 默认密码 <b>19971019</b></p>
      <output id="login-error" role="alert"></output>
    </form>
  </div>`;
  let text = replaceRequired(source, oldLogin, newLogin, "单列登录结构");
  text = text.replace(/admin-v2\.css\?v=[^"]+/, "admin-v2.css?v=20260830-admin-login-v2");
  text = text.replace(/admin-v2\.js\?v=[^"]+/, "admin-v2.js?v=20260830-admin-login-v2");
  return text;
});

update("admin-v2.css", (source) => {
  const marker = "/* Compact YellowDogs admin login */";
  if (source.includes(marker)) return source;
  return `${source.trimEnd()}\n${marker}
.login-shell{min-height:100vh;padding:32px;display:grid;grid-template-columns:1fr;place-items:center;background:radial-gradient(circle at 50% 10%,rgba(113,217,208,.1),transparent 34%),var(--bg)}
.login-card{align-self:auto;width:min(420px,100%);margin:0;padding:34px;border:1px solid var(--line);border-radius:14px;background:rgba(10,29,23,.96);box-shadow:0 28px 90px rgba(0,0,0,.48)}
.login-identity{margin-bottom:26px;display:grid;justify-items:center;text-align:center}
.login-identity img{width:92px;height:92px;object-fit:contain;filter:drop-shadow(0 10px 24px rgba(0,0,0,.36))}
.login-identity small{margin-top:14px;color:var(--cyan);font-size:9px;font-weight:850;letter-spacing:.18em}
.login-identity h1{margin:5px 0 0;font-size:30px;line-height:1.1}
.login-identity p{margin:5px 0 0;color:var(--muted);font-size:12px}
.login-card>h2{margin:0 0 3px;font-size:22px}.login-copy{margin:0 0 22px!important;font-size:12px}
.login-hint{margin:13px 0 0!important;color:var(--muted);font-size:10px;text-align:center}.login-hint b{color:var(--lime)}
@media(max-width:520px){.login-shell{padding:16px}.login-card{padding:26px 22px}.login-identity img{width:78px;height:78px}}
`;
});

update("server/application/admin-service.mjs", (source) => {
  const oldMethod = `  ensureBootstrapAdmin() {
    if (Object.keys(this.state.admins).length) return;
    const salt = crypto.randomBytes(16).toString("hex");
    const id = "ADM-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    this.state.admins[id] = { id, username: "admin", role: "superadmin", salt, hash: this.digest(this.bootstrapPassword, salt), createdAt: this.now() };
    this.save();
  }`;
  const newMethod = `  ensureBootstrapAdmin() {
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
  }`;
  return replaceRequired(source, oldMethod, newMethod, "默认 admin 密码校准");
});

console.log(JSON.stringify({ layout:"single-column", logo:"yellowdog-logo-transparent.png", defaultAdmin:"admin", defaultPassword:"19971019" }, null, 2));
