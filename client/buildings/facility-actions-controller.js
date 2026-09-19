import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
import { createRequestId } from "../core/request-id.js?v=20260906-release-v01";
import { goldAmountMarkup } from "../ui/currency.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);

export function facilityActionsMarkup({ pending = false } = {}) {
  return `<button type="button" class="facility-upgrade" data-facility-upgrade ${pending ? "disabled" : ""}>升级设施</button>
    <button type="button" class="facility-demolish" data-facility-demolish ${pending ? "disabled" : ""}>拆除</button>`;
}

export function demolitionDialogMarkup(view, { pending = false, error = "" } = {}) {
  const building = view?.building;
  return `<header><h2 id="facility-demolition-title">拆除设施</h2><button type="button" data-demolition-close aria-label="关闭拆除确认" ${pending ? "disabled" : ""}>×</button></header>
    <div class="facility-dialog-body">
      ${building ? `<div class="facility-dialog-identity"><img src="${esc(facilityArtIcon(building.type, building.level) || building.iconPath)}" alt=""><div><strong>${esc(building.label)}</strong><span>LV.${Number(building.level) || 1}</span></div></div>
      <dl><div><dt>释放槽位</dt><dd>${Number(view.releasedSlots) || 1}</dd></div><div><dt>返还金币</dt><dd>${goldAmountMarkup(view.refundGold ?? 0)}</dd></div></dl>
      ${view.preservesScouts ? "<p>已招募球探及发掘任务保留。</p>" : ""}
      ${view.cancelsConstruction ? '<p>进行中的建设或升级将中止，已投入生产力不返还。</p>' : ''}
      <p>拆除后设施效果停止，需重新建造。</p>` : !error ? '<p role="status">正在读取设施…</p>' : ""}
      ${view?.blockedReason ? `<p class="facility-dialog-error" role="status">${esc(view.blockedReason)}</p>` : ""}
      ${error ? `<p class="facility-dialog-error" role="alert">${esc(error)}</p>` : ""}
    </div><footer><button type="button" data-demolition-close autofocus ${pending ? "disabled" : ""}>取消</button><button type="button" class="facility-demolish" data-demolition-confirm ${pending || !view?.canDemolish ? "disabled" : ""}>${pending ? "拆除中…" : "确认拆除"}</button></footer>`;
}

export function createFacilityActionsController({ dialog, campaignStore, getCampaignState = campaignStore.getState, getCampaignRequest, onState = () => {}, showToast = () => {} }) {
  let target = null, view = null, pending = false, error = "", version = 0, opener = null;
  const render = () => { dialog.innerHTML = demolitionDialogMarkup(view, { pending, error }); };
  function close(force = false) {
    if (pending && !force) return;
    version++; target = null; view = null; pending = false; error = "";
    if (dialog.open) dialog.close();
    if (opener?.isConnected) opener.focus?.();
    opener = null;
  }
  async function open(value, button) {
    if (pending || !value?.buildingId || !value?.territoryId) return;
    const playerId = getCampaignState()?.playerId;
    if (!playerId) return;
    const current = ++version;
    target = { territoryId: value.territoryId, buildingId: value.buildingId, playerId, requestId: createRequestId() };
    view = null; error = ""; opener = button ?? dialog.ownerDocument?.activeElement;
    render();
    if (!dialog.open) dialog.showModal();
    try {
      const result = await getCampaignRequest()(`/api/campaign/territory/buildings/demolish-preview?territoryId=${encodeURIComponent(value.territoryId)}&buildingId=${encodeURIComponent(value.buildingId)}`);
      if (current !== version || playerId !== getCampaignState()?.playerId) return;
      view = result;
    } catch (reason) {
      if (current !== version) return;
      error = reason.message || "设施读取失败，请重新打开";
    }
    if (current === version) { render(); dialog.querySelector("[data-demolition-close]")?.focus?.(); }
  }
  async function confirm() {
    if (pending || !target || !view?.canDemolish) return;
    const current = version, request = { ...target };
    pending = true; error = ""; render();
    try {
      const result = await getCampaignRequest()("/api/campaign/territory/buildings/demolish", {
        method: "POST", body: { territoryId: request.territoryId, buildingId: request.buildingId, requestId: request.requestId },
      });
      if (current !== version || request.playerId !== getCampaignState()?.playerId) return;
      // Close before publishing state; facility subscriptions can remove the original panel.
      close(true);
      campaignStore.setState(result.state, { source: "building-demolish" });
      onState(result.state);
      showToast("设施已拆除");
    } catch (reason) {
      if (current !== version) return;
      error = reason.message || "拆除失败，请重试";
    } finally {
      if (current === version) { pending = false; render(); }
    }
  }
  dialog.addEventListener("click", event => {
    const cancel = event.target.closest?.("[data-demolition-close]");
    if (cancel && !cancel.disabled) return close();
    const button = event.target.closest?.("[data-demolition-confirm]");
    if (button && !button.disabled) confirm();
  });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  });
  campaignStore.subscribe(({ state, previousState }) => {
    if (state?.playerId !== previousState?.playerId) close(true);
    if (!target || pending) return;
    const territory = state?.buildings?.territories?.[target.territoryId];
    if (!territory?.canManage || !territory.buildings?.some(entry => entry.id === target.buildingId)) close(true);
  });
  return { open, close };
}
