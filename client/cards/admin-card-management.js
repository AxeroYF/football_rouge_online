import { createRequestId } from "../core/request-id.js?v=20260906-release-v01";
import { playerCardMarkup, escapePlayerCardHtml as esc } from "../player-card/player-card.js?v=20260905-shield-v1";
import { goldAmountMarkup as gold } from "../ui/currency.js";
import { recycleValue } from "../../shared/config/card-management.mjs";

export function createAdminCardManagement({ root, api, getProfile, isActive, toast }) {
  let view = null, pending = false, readVersion = 0;
  const retries = new Map();
  const canWrite = () => ["operator", "superadmin"].includes(getProfile()?.role);
  const $ = selector => root.querySelector(selector);
  async function open() {
    const requestVersion = ++readVersion;
    root.innerHTML = '<p class="loading">正在读取球员卡管理…</p>';
    try {
      const value = await api("/api/admin/card-management");
      if (!isActive() || requestVersion !== readVersion) return;
      view = value; render();
    } catch (error) { if (isActive() && requestVersion === readVersion) { root.innerHTML = `<p class="empty">${esc(error.message)}</p><button data-admin-cards-refresh>重新加载</button>`; $("[data-admin-cards-refresh]").onclick = open; } }
  }
  function render() {
    if (!isActive() || !view) return;
    const config = view.config;
    root.innerHTML = `<header class="page-head"><div><h1>球员卡管理</h1><p>回收配置与管理员代办交易</p></div><button data-admin-cards-refresh>刷新</button></header>
      <section class="panel"><header class="panel-head"><h2>回收价格</h2></header><form data-admin-card-config><div class="form-grid">
        <label>回收功能<select name="recycleEnabled"><option value="true" ${config.recycleEnabled ? "selected" : ""}>开启</option><option value="false" ${!config.recycleEnabled ? "selected" : ""}>关闭</option></select></label>
        <label>回收比例（%）<input name="ratio" type="number" min="0" max="100" step="0.01" value="${config.recycleRatioBps / 100}" required></label>
        <label>每级强化加价（%）<input name="bonus" type="number" min="0" max="100" step="0.01" value="${config.upgradeBonusBps / 100}" required></label>
        ${["C", "B", "A", "S"].map(grade => `<label>${grade} 级估值<input name="value${grade}" type="number" min="1" max="${view.maxPrice}" step="1" value="${config.valuations[grade]}" required></label>`).join("")}</div>
        <div class="admin-card-price-preview" data-admin-price-preview></div><p>回收价 = 评级估值 × 回收比例 ×（1 + 强化等级 × 每级加价），向下取整。训练成长不加价，X 按传奇 S 计价。评级估值同时用于市场最低限价。</p>
        <button class="primary" type="submit" ${!canWrite() || pending ? "disabled" : ""}>保存回收配置</button></form></section>
      <section class="panel admin-card-trade"><header class="panel-head"><h2>后台代办球员交易</h2></header><form data-admin-card-trade><div class="player-grant-layout"><div class="player-grant-fields">
        <label>卖家<select name="sellerId" data-admin-seller required><option value="">选择卖家</option>${view.teams.map(team => `<option value="${esc(team.id)}">${esc(team.name)} · ${esc(team.id)}</option>`).join("")}</select></label>
        <label>搜索卖家球员<input data-admin-card-search type="search" placeholder="球员、国家、俱乐部或卡片 ID"></label>
        <label>转让球员卡<select name="cardId" data-admin-trade-card required><option value="">先选择卖家</option></select></label>
        <label>买家<select name="buyerId" data-admin-buyer required><option value="">选择买家</option>${view.teams.map(team => `<option value="${esc(team.id)}">${esc(team.name)} · ${Number(team.gold).toLocaleString()} 金币</option>`).join("")}</select></label>
        <label>交易价格<input name="price" type="number" min="1" max="${view.maxPrice}" step="1" required></label>
        <label>代办原因<input name="reason" maxlength="120" required></label><p>交易同时转卡和划转金币。卡片保留强化、训练成长、特性与伤停状态，加入买家留守名单。挂牌托管中的卡片需先下架。</p>
        <button class="primary" type="submit" ${!canWrite() || pending ? "disabled" : ""}>确认代办交易</button><output data-admin-trade-status role="status"></output></div>
        <aside class="grant-card-preview" data-admin-trade-preview><p>选择卡片后预览</p></aside></div></form></section>
      <section class="panel"><header class="panel-head"><h2>最近代办记录</h2></header><div class="audit-list">${view.history.map(event => `<article><strong>${esc(event.sellerName)} → ${esc(event.buyerName)} · ${esc(event.card.name)} +${event.card.upgradeLevel} · ${gold(event.amount)}</strong><p>${esc(event.reason)}</p><small>${esc(new Date(event.createdAt).toLocaleString())} · ${esc(event.adminId)} · ${esc(event.id)}</small></article>`).join("") || '<p class="empty">暂无代办记录</p>'}</div></section>`;
    $("[data-admin-cards-refresh]").onclick = open;
    const form = $("[data-admin-card-config]");
    const configInput = () => {
      const values = Object.fromEntries(new FormData(form));
      return { recycleEnabled: values.recycleEnabled === "true", recycleRatioBps: Math.round(Number(values.ratio) * 100), upgradeBonusBps: Math.round(Number(values.bonus) * 100), valuations: Object.fromEntries(["C", "B", "A", "S"].map(grade => [grade, Number(values[`value${grade}`])])) };
    };
    const updatePrices = () => {
      const value = configInput();
      if (![value.recycleRatioBps, value.upgradeBonusBps].every(Number.isSafeInteger)) return;
      $("[data-admin-price-preview]").innerHTML = `<table><thead><tr><th>评级</th><th>+0 回收</th><th>+4 回收</th><th>+8 回收</th></tr></thead><tbody>${["C", "B", "A", "S"].map(grade => `<tr><th>${grade}</th>${[0, 4, 8].map(upgradeLevel => `<td>${gold(recycleValue({ grade, upgradeLevel }, value))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    };
    form.addEventListener("input", updatePrices); updatePrices();
    form.onsubmit = async event => {
      event.preventDefault(); if (pending || !canWrite() || !form.reportValidity()) return;
      pending = true; form.querySelector("button[type=submit]").disabled = true;
      try { await api("/api/admin/card-management/config", { method: "POST", body: configInput() }); toast("回收配置已保存"); if (isActive()) await open(); }
      catch (error) { toast(error.message, true); }
      finally { pending = false; if (isActive()) root.querySelectorAll("button[type=submit]").forEach(button => { button.disabled = !canWrite(); }); }
    };
    const tradeForm = $("[data-admin-card-trade]");
    const seller = () => view.teams.find(team => team.id === $("[data-admin-seller]").value);
    const updateCard = () => {
      const card = seller()?.cards.find(card => card.id === $("[data-admin-trade-card]").value);
      $("[data-admin-trade-preview]").innerHTML = card ? playerCardMarkup(card, { variant: "compact", animated: false }) + `<p>${esc(card.blocked ?? "可交易")} · 训练累计 +${Object.values(card.trainingBonuses ?? {}).reduce((a, b) => a + Number(b), 0)}</p>` : '<p>选择卡片后预览</p>';
    };
    const updateCards = () => {
      const text = $("[data-admin-card-search]").value.trim().toLowerCase();
      const previous = $("[data-admin-trade-card]").value;
      $("[data-admin-trade-card]").innerHTML = '<option value="">选择独立球员卡</option>' + (seller()?.cards ?? []).filter(card => !text || `${card.name} ${card.sourceName ?? ""} ${card.club} ${card.nationality} ${card.id}`.toLowerCase().includes(text)).map(card => `<option value="${esc(card.id)}" ${card.id === previous ? "selected" : ""} ${card.blocked ? "disabled" : ""}>${esc(card.name)} · ${card.grade} +${card.upgradeLevel} · ${esc(card.id)}${card.blocked ? ` · ${esc(card.blocked)}` : ""}</option>`).join("");
      updateCard();
    };
    $("[data-admin-seller]").onchange = updateCards; $("[data-admin-card-search]").oninput = updateCards; $("[data-admin-trade-card]").onchange = updateCard;
    tradeForm.onsubmit = async event => {
      event.preventDefault(); if (pending || !canWrite() || !tradeForm.reportValidity()) return;
      const input = Object.fromEntries(new FormData(tradeForm)); input.price = Number(input.price);
      if (input.sellerId === input.buyerId) return toast("买家与卖家不能相同", true);
      const card = seller()?.cards.find(card => card.id === input.cardId), buyer = view.teams.find(team => team.id === input.buyerId);
      if (!card || card.blocked) return toast(card?.blocked ?? "请选择有效卡片", true);
      if (!globalThis.confirm(`卖家：${seller().name}\n买家：${buyer.name}\n球员：${card.name} ${card.grade} +${card.upgradeLevel}\n价格：${input.price.toLocaleString()} 金币\n\n转出后原首发将自动补位，替补不足保留空位。确认执行？`)) return;
      const signature = JSON.stringify([getProfile()?.id, input]);
      if (!retries.has(signature)) retries.set(signature, createRequestId());
      pending = true; const button = tradeForm.querySelector("button[type=submit]"); button.disabled = true;
      try {
        await api("/api/admin/card-management/trade", { method: "POST", body: { ...input, requestId: retries.get(signature) } });
        retries.delete(signature); toast("代办交易完成"); if (isActive()) await open();
      } catch (error) { toast(error.message, true); }
      finally { pending = false; if (isActive()) root.querySelectorAll("button[type=submit]").forEach(button => { button.disabled = !canWrite(); }); }
    };
  }
  return { open };
}
