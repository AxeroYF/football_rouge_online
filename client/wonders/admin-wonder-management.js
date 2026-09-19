import { copyConstruction, sameDraft, constructionEditor, readConstruction, constructionSummary } from "./admin-wonder-conditions.js?v=20260908-wonders-live-v1";
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function createAdminWonderManagement({ root, api, getProfile, isActive, toast }) {
  let view = null, selectedId = null, query = "", region = "", filter = "", readVersion = 0;
  const drafts = new Map(), pending = new Set(), messages = new Map();
  const $ = selector => root.querySelector(selector);
  const canWrite = () => ["content", "superadmin"].includes(getProfile()?.role);
  const selected = () => view?.wonders.find(item => item.assetId === selectedId);
  const draftFor = item => {
    if (!drafts.has(item.assetId)) drafts.set(item.assetId, { text: item.effectText, construction: copyConstruction(item), revision: item.revision });
    return drafts.get(item.assetId);
  };
  const dirty = item => drafts.has(item.assetId) && !sameDraft(drafts.get(item.assetId), item);
  const hasConditions = c => !!c && (c.totalProduction !== null || c.adjacentBuildings.length > 0 || c.terrain.anyOf.length > 0 || c.terrain.allOf.length > 0 || !!c.playerCollection);
  const label = item => dirty(item) ? "未保存" : item.status === "proposal" ? "参考草稿" : item.status === "empty" ? "待填写" : item.effectText.trim() ? "效果草稿" : hasConditions(item.construction) ? "条件草稿" : "空白暂存";
  window.addEventListener("beforeunload", event => {
    if (pending.size || view?.wonders.some(dirty)) { event.preventDefault(); event.returnValue = ""; }
  });

  async function open() {
    if (view) { render(); return; }
    await load();
  }

  async function load() {
    const version = ++readVersion;
    if (!view && isActive()) root.innerHTML = '<p class="loading">正在读取奇观目录…</p>';
    try {
      const next = await api("/api/admin/wonders");
      if (version !== readVersion) return;
      for (const item of next.wonders) {
        const old = view?.wonders.find(value => value.assetId === item.assetId);
        const draft = drafts.get(item.assetId);
        if (draft && !pending.has(item.assetId)) {
          if (sameDraft(draft, item) || (old && sameDraft(draft, old))) drafts.delete(item.assetId);
          else if (draft.revision !== item.revision) draft.conflict = true;
        }
      }
      view = next;
      selectedId ??= next.wonders[0]?.assetId;
      render();
    } catch (error) {
      if (!isActive() || version !== readVersion) return;
      if (view) toast(error.message, true);
      else {
        root.innerHTML = `<p class="empty">${esc(error.message)}</p><button data-wonder-retry>重新加载</button>`;
        $("[data-wonder-retry]").onclick = load;
      }
    }
  }

  function renderList() {
    if (!isActive() || !view) return;
    const keyword = query.trim().toLowerCase();
    const items = view.wonders.filter(item => (!keyword || `${item.id} ${item.name} ${item.location} ${item.assetId}`.toLowerCase().includes(keyword)) && (!region || item.region === region) && (!filter || (filter === "filled" ? !!item.effectText.trim() : filter === "dirty" ? dirty(item) : !item.effectText.trim())));
    $("[data-wonder-count]").textContent = `${items.length} / ${view.wonders.length} 座`;
    $("[data-wonder-list]").innerHTML = items.map(item => `<button class="wonder-row ${item.assetId === selectedId ? "active" : ""}" data-wonder-id="${esc(item.assetId)}" aria-pressed="${item.assetId === selectedId}">
      <img src="${esc(item.thumbnail)}" alt="" width="68" height="68" loading="lazy"><span><strong>${esc(item.name)}</strong><small>${esc(item.id)} · ${esc(item.location)}</small><em class="${dirty(item) ? "dirty" : ""}">${label(item)}</em></span></button>`).join("") || '<p class="empty">没有符合条件的奇观</p>';
    root.querySelectorAll("[data-wonder-id]").forEach(button => button.onclick = () => { selectedId = button.dataset.wonderId; renderList(); renderEditor(); });
    $("[data-wonder-filled]").textContent = `${view.wonders.filter(item => item.effectText.trim()).length} / ${view.wonders.length} 效果已填写`;
  }

  function renderEditor() {
    if (!isActive()) return;
    $("[data-wonder-refresh]").disabled = pending.size > 0;
    const item = selected();
    if (!item) { $("[data-wonder-editor]").innerHTML = '<p class="empty">选择一座奇观</p>'; return; }
    const draft = draftFor(item), busy = pending.has(item.assetId), writable = canWrite();
    $("[data-wonder-editor]").innerHTML = `<header class="wonder-identity"><div class="wonder-model-thumb"><img src="${esc(item.thumbnail)}" alt="${esc(item.name)}彩色模型" width="176" height="176"></div><div><small>${esc(item.id)} · ${esc(item.region)}</small><h2>${esc(item.name)}</h2><p>${esc(item.location)}</p><span class="wonder-badge" data-wonder-badge>${label(item)}</span></div></header>
      <form data-wonder-form><div class="wonder-input-area"><label for="wonder-effect">奇观效果 <span>可留空</span></label><textarea id="wonder-effect" name="effectText" maxlength="${view.maxEffectLength}" ${!writable || busy ? "readonly" : ""} placeholder="在这里填写你确定的效果，也可以留空保存。"></textarea><div class="wonder-text-meta"><span>${writable ? "" : "当前账号仅可查看"}</span><span data-wonder-length></span></div>
      ${item.suggestedEffect || item.suggestedConstruction ? `<p class="wonder-proposal-note">${item.suggestedEffect ? "效果为本轮参考草稿；" : ""}${item.suggestedConstruction ? "建设要求为本轮参考草稿；" : ""}可直接修改，点击保存暂存后记录到后台。</p>` : ""}
      ${constructionEditor(draft.construction, view.requirementOptions, !writable || busy, !!view.runtimeVersion)}
      ${item.liveEffectText!==null&&item.liveEffectText!==undefined?`<details class="wonder-design-note"><summary>当前游戏已接入效果${item.effectText!==item.liveEffectText?" · 草稿有待接入修改":""}</summary><p>${esc(item.liveEffectText)}</p><p>修改上方效果文字后，需要更新后端规则才会生效。建设条件保存后用于新开工项目。</p></details>`:""}
      ${item.designNote ? `<details class="wonder-design-note"><summary>本轮设计参考与效果口径</summary><p>${esc(item.designNote)}</p>${item.dependency ? `<p>待开发基础：${esc(item.dependency)}</p>` : ""}</details>` : ""}
      ${draft.conflict ? `<section class="wonder-conflict" role="alert"><b>已有更新的暂存内容，你的输入已保留</b><p>已存内容：</p><pre>${esc(item.effectText) || "（空白）"}</pre><p>已存建设条件：</p><pre>${esc(constructionSummary(item.construction, view.requirementOptions))}</pre><div><button type="button" data-wonder-use-saved ${busy ? "disabled" : ""}>使用已存内容</button><button type="button" data-wonder-overwrite ${!writable || busy ? "disabled" : ""}>保留我的内容并保存</button></div></section>` : ""}
      </div><footer class="wonder-savebar"><div><output data-wonder-save-status role="status">${esc(messages.get(item.assetId) ?? (dirty(item) ? "有未保存的修改" : item.updatedAt !== null ? `上次暂存：${new Date(item.updatedAt).toLocaleString()} · ${item.updatedBy}` : "尚未暂存"))}</output></div><button class="primary" type="submit" ${!writable || busy || draft.conflict ? "disabled" : ""}>${busy ? "保存中…" : "保存暂存"}</button></footer></form>`;
    const textarea = $("#wonder-effect");
    textarea.value = draft.text;
    const updateLength = () => { $("[data-wonder-length]").textContent = `${draft.text.length} / ${view.maxEffectLength}`; };
    updateLength();
    const changed = () => {
      draft.text = textarea.value; draft.construction = readConstruction(root); messages.delete(item.assetId); updateLength(); renderList();
      $("[data-wonder-badge]").textContent = label(item);
      $("[data-wonder-save-status]").textContent = dirty(item) ? "有未保存的修改" : "内容与已存版本一致";
    };
    textarea.oninput = changed;
    root.querySelectorAll(".wonder-requirements input").forEach(input => input.oninput = () => { changed(); if (input.id === "wonder-collection-enabled") renderEditor(); });
    $("[data-wonder-form]").onsubmit = event => { event.preventDefault(); save(item.assetId); };
    $("[data-wonder-use-saved]")?.addEventListener("click", () => { drafts.delete(item.assetId); messages.delete(item.assetId); renderList(); renderEditor(); });
    $("[data-wonder-overwrite]")?.addEventListener("click", () => save(item.assetId, true));
  }

  async function save(assetId, replaceConflict = false) {
    if (!canWrite() || pending.has(assetId)) return;
    const item = view.wonders.find(value => value.assetId === assetId), draft = draftFor(item);
    if (draft.conflict && !replaceConflict) return;
    const effectText = draft.text, construction = structuredClone(draft.construction), revision = replaceConflict ? item.revision : draft.revision;
    ++readVersion; // Ignore a list read started before this write.
    pending.add(assetId); messages.set(assetId, "保存中…"); renderEditor();
    try {
      const { wonder } = await api(`/api/admin/wonders/${encodeURIComponent(assetId)}`, { method: "POST", body: { effectText, construction, revision } });
      view.wonders[view.wonders.findIndex(value => value.assetId === assetId)] = wonder;
      drafts.set(assetId, { text: wonder.effectText, construction: copyConstruction(wonder), revision: wonder.revision });
      messages.set(assetId, effectText.trim() ? "效果草稿已暂存" : hasConditions(construction) ? "建设条件草稿已暂存" : "已保存空白暂存");
      if (isActive()) toast(`${item.name}已暂存`);
    } catch (error) {
      messages.set(assetId, `保存失败：${error.message}`);
      if (isActive()) toast(error.message, true);
      if (error.statusCode === 409) { draft.conflict = true; await load(); }
    } finally {
      pending.delete(assetId);
      if (isActive()) { renderList(); renderEditor(); }
    }
  }

  function render() {
    if (!isActive() || !view) return;
    root.innerHTML = `<header class="page-head"><div><small>WONDER COLLECTION</small><h1>奇观管理</h1><p>${view.runtimeVersion?"建设条件保存后用于新开工奇观；效果文字修改需另行更新后端。":"编辑效果与建设要求，保存为草稿；可选条件不填则不限。"}</p></div><div class="head-actions"><span class="wonder-summary" data-wonder-filled></span><button data-wonder-refresh>刷新列表</button></div></header>
      <div class="wonder-workspace"><section class="panel wonder-catalog"><header class="panel-head"><h2>奇观目录</h2><small data-wonder-count></small></header><div class="wonder-filters"><label class="wonder-search">搜索奇观<input type="search" data-wonder-search placeholder="名称、编号或所在地" value="${esc(query)}"></label><label>地区<select data-wonder-region><option value="">全部地区</option>${["欧洲", "南美洲"].map(value => `<option ${region === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>填写状态<select data-wonder-filter>${[["", "全部状态"], ["blank", "效果空白"], ["filled", "已填写"], ["dirty", "未保存"]].map(([value, name]) => `<option value="${value}" ${filter === value ? "selected" : ""}>${name}</option>`).join("")}</select></label></div><div class="wonder-list" data-wonder-list></div></section><section class="panel wonder-editor" data-wonder-editor></section></div>`;
    $("[data-wonder-refresh]").onclick = load;
    $("[data-wonder-search]").oninput = event => { query = event.target.value; renderList(); };
    $("[data-wonder-region]").onchange = event => { region = event.target.value; renderList(); };
    $("[data-wonder-filter]").onchange = event => { filter = event.target.value; renderList(); };
    renderList(); renderEditor();
  }
  return { open };
}
