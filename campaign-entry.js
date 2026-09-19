import { createCampaignApiClient } from "./client/core/campaign-api-client.js";
import { loadCampaignMapData } from "./client/map/campaign-map-data.js";
import { createDraftController } from "./client/draft/draft-controller.js?v=20260906-draft-v3";

const entry = document.querySelector("#campaign-entry");
const stage = document.querySelector(".map-stage");
const campaignApi = createCampaignApiClient();
let state = null;
let authMode = "login";
let draftController = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const api = campaignApi.request;

function setBusy(container, busy) {
  container.querySelectorAll("button, input").forEach((element) => { element.disabled = busy; });
  container.classList.toggle("is-busy", busy);
}

function setAuthScreen(active) {
  document.body.classList.toggle("is-auth-screen", active);
  entry.classList.toggle("is-auth", active);
}

function renderAuth(mode = authMode, message = "") {
  setAuthScreen(true);
  draftController?.destroy(); draftController = null;
  authMode = mode;
  entry.hidden = false;
  entry.innerHTML = `
    <section class="entry-panel auth-panel" aria-labelledby="entry-title">
      <div class="auth-identity">
        <img src="./assets/yellowdog-logo-transparent.png" width="80" height="80" alt="" decoding="async">
        <h1 id="entry-title">黄狗风云</h1>
      </div>
      <form id="entry-auth-form" class="entry-form">
        <div class="entry-tabs" role="tablist" aria-label="账号入口">
          <button class="${mode === "login" ? "is-active" : ""}" type="button" data-mode="login" role="tab" aria-selected="${mode === "login"}">登录</button>
          <button class="${mode === "register" ? "is-active" : ""}" type="button" data-mode="register" role="tab" aria-selected="${mode === "register"}">注册</button>
        </div>
        <label><span>昵称</span><input name="nickname" minlength="${mode === 'register' ? 2 : 1}" maxlength="${mode === 'register' ? 16 : 128}" autocomplete="username" required></label>
        <label><span>密码</span><input name="password" type="password" minlength="${mode === "register" ? 6 : 1}" maxlength="${mode === 'register' ? 72 : 4096}" autocomplete="${mode === "register" ? "new-password" : "current-password"}" required></label>
        <button class="entry-primary" type="submit">${mode === "login" ? "进入游戏" : "创建账号"}</button>
        <small class="entry-error" aria-live="polite">${escapeHtml(message)}</small>
      </form>
    </section>`;
  entry.querySelectorAll("[data-mode]").forEach((button) => { button.onclick = () => renderAuth(button.dataset.mode); });
  entry.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(formElement, true);
    try {
      const value = await api(`/api/campaign/${mode}`, { method: "POST", body: { nickname: form.get("nickname"), password: form.get("password") } });
      campaignApi.setToken(value.token);
      state = value.state;
      renderNext();
    } catch (error) {
      formElement.querySelector(".entry-error").textContent = error.message;
      setBusy(formElement, false);
    }
  };
}

function renderTeamSetup() {
  setAuthScreen(false);
  draftController?.destroy(); draftController = null;
  entry.innerHTML = `<section class="entry-panel team-panel">
    <div class="entry-copy"><h1>为球队命名</h1></div>
    <form class="entry-form team-form"><label><span>球队名称</span><input name="teamName" minlength="2" maxlength="20" autocomplete="off" required autofocus></label><button class="entry-primary" type="submit">开始选择球员</button><small class="entry-error"></small></form>
  </section>`;
  entry.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(formElement, true);
    try {
      state = (await api("/api/campaign/draft/start", { method: "POST", body: { teamName: form.get("teamName") } })).state;
      renderNext();
    } catch (error) {
      formElement.querySelector(".entry-error").textContent = error.message;
      setBusy(formElement, false);
    }
  };
}

function renderDraft(draft) {
  setAuthScreen(false);
  draftController ??= createDraftController({ root: entry, request: api, onState(next) { state = next; renderNext(); } });
  draftController.render(draft);
}
function renderNext() {
  if (state.setupComplete) {
    setAuthScreen(false);
    // Start public map data while the larger game module is still loading.
    void loadCampaignMapData().catch(() => {});
    draftController?.destroy(); draftController = null;
    entry.hidden = true;
    stage.classList.remove("is-blocked");
    const detail = { state, request: api, clearSession: campaignApi.clearToken };
    window.campaignBootstrap = detail;
    window.dispatchEvent(new CustomEvent("campaign-ready", { detail }));
    return;
  }
  entry.hidden = false;
  if (!state.draft) renderTeamSetup();
  else renderDraft(state.draft);
}

async function boot() {
  stage.classList.add("is-blocked");
  if (!campaignApi.hasToken()) return renderAuth();
  try {
    state = (await api("/api/campaign/state")).state;
    renderNext();
  } catch {
    campaignApi.clearToken();
    renderAuth();
  }
}

boot();
