import { createCampaignApiClient } from "./client/core/campaign-api-client.js";
import { playerCardMarkup } from "./client/player-card/player-card.js";
import { LINE_LABELS } from "./shared/football/labels.js";

const entry = document.querySelector("#campaign-entry");
const stage = document.querySelector(".map-stage");
const campaignApi = createCampaignApiClient();
let state = null;
let authMode = "login";

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

function renderAuth(mode = authMode, message = "") {
  authMode = mode;
  entry.hidden = false;
  entry.innerHTML = `
    <section class="entry-panel auth-panel" aria-labelledby="entry-title">
      <div class="entry-brand"><span>YF</span><p>YELLOWDOGS CHRONICLES</p></div>
      <div class="entry-copy">
        <p class="entry-kicker">共享世界 · 足球战略</p>
        <h1 id="entry-title">黄狗风云</h1>
        <span>从 22 人初始阵容出发，在欧洲与南美建立属于你的足球版图。</span>
      </div>
      <form class="entry-form">
        <div class="entry-tabs" role="tablist" aria-label="账号入口">
          <button class="${mode === "login" ? "is-active" : ""}" type="button" data-mode="login" role="tab">登录</button>
          <button class="${mode === "register" ? "is-active" : ""}" type="button" data-mode="register" role="tab">注册</button>
        </div>
        <label><span>昵称</span><input name="nickname" minlength="2" maxlength="16" autocomplete="username" required></label>
        <label><span>密码</span><input name="password" type="password" minlength="${mode === "register" ? 6 : 1}" maxlength="72" autocomplete="${mode === "register" ? "new-password" : "current-password"}" required></label>
        <button class="entry-primary" type="submit">${mode === "login" ? "进入黄狗风云" : "创建账号"}</button>
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
  entry.innerHTML = `<section class="entry-panel team-panel">
    <div class="entry-copy"><p class="entry-kicker">黄狗风云 · 初始建队</p><h1>为球队命名</h1><span>随后完成 22 轮三选一。门将、后场、中场、前场各至少需要 2 人。</span></div>
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
  const picked = draft.roster.length;
  const progress = Math.round((picked / draft.totalPicks) * 100);
  entry.innerHTML = `<section class="entry-panel draft-panel">
    <header class="draft-header"><div><p class="entry-kicker">黄狗风云 · 初始建队</p><h1>${escapeHtml(draft.teamName)}</h1></div><div class="draft-round"><b>${draft.pickNumber}</b><span>/ ${draft.totalPicks} 轮</span></div></header>
    <div class="draft-progress"><i style="width:${progress}%"></i></div>
    <div class="line-requirements">${Object.entries(LINE_LABELS).map(([key, label]) => `<span class="${draft.counts[key] >= 2 ? "is-met" : ""}"><small>${label}</small><b>${draft.counts[key]}</b><i>/ 2</i></span>`).join("")}</div>
    <div class="draft-title"><h2>选择一名球员</h2><span>本轮选择将永久加入初始阵容</span></div>
    <div class="draft-offer">${draft.offer.map((player) => playerCardMarkup(player, { interactive:true, variant:"standard", action:"draft-select", ariaPrefix:"选择" })).join("")}</div>
    <small class="entry-error" aria-live="polite"></small>
  </section>`;
  entry.querySelectorAll('[data-player-card-action="draft-select"]').forEach((button) => {
    button.onclick = async () => {
      if (entry.classList.contains("is-choosing")) return;
      entry.classList.add("is-choosing");
      button.classList.add("is-selected");
      try {
        state = (await api("/api/campaign/draft/choose", { method: "POST", body: { playerId: button.dataset.playerCardId } })).state;
        renderNext();
      } catch (error) {
        entry.querySelector(".entry-error").textContent = error.message;
        button.classList.remove("is-selected");
      } finally {
        entry.classList.remove("is-choosing");
      }
    };
  });
}

function renderNext() {
  if (state.setupComplete) {
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
