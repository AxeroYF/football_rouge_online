const storageKey = id => 'yellowdogs-enhancement-protection-v1:' + encodeURIComponent(id);

export function createEnhancementSettingsController({ trigger, getState, campaignStore, showToast = () => {}, onChange = () => {}, storage }) {
  try { storage ??= globalThis.localStorage; } catch { storage = null; }
  let playerId = null, enabled = false;
  function render() {
    trigger.hidden = !playerId;
    trigger.textContent = `默认购买保卡：${enabled ? '开启' : '关闭'}`;
    trigger.setAttribute('aria-checked', String(enabled));
  }
  function update() {
    const state = getState(), nextId = state?.setupComplete ? state.playerId : null;
    if (nextId !== playerId) {
      playerId = nextId;
      enabled = false;
      try { enabled = Boolean(playerId) && storage?.getItem(storageKey(playerId)) === 'true'; } catch { /* Keep the default when storage is unavailable. */ }
    }
    render();
  }
  trigger.addEventListener('click', () => {
    update();
    if (!playerId) return;
    const next = !enabled;
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(storageKey(playerId), String(next));
    } catch {
      showToast('无法保存设置，请检查浏览器存储权限后重试。');
      return;
    }
    enabled = next;
    render();
    onChange();
  });
  campaignStore.subscribe(update);
  update();
  return { isDefaultProtectionEnabled: () => enabled };
}
