import {attackCurfewState,DAILY_NEUTRAL_CONQUEST_LIMIT} from '../../shared/config/conquest.mjs';
export function createConquestHud({ root, store, now = Date.now }) {
  let state = null, receivedAt = now();
  const count = root.querySelector('[data-conquest-count]');
  const cooldown = root.querySelector('[data-conquest-cooldown]');
  function render() {
    root.hidden = !state;
    if (!state) return;
    const time = state.serverNow + Math.max(0, now() - receivedAt);
    const remaining = time >= state.resetsAt ? state.limit : state.remaining;
    count.textContent = `${remaining}/${state.limit}`;
    root.classList.toggle('is-exhausted', remaining === 0);
    root.title = `今日还可征服 ${remaining} 个中立地块；北京时间 08:00 刷新。每日 00:00–08:00 宵禁，禁止进攻。失败不扣次数，远征队休整 20 分钟。${state.limit > DAILY_NEUTRAL_CONQUEST_LIMIT ? '含奇观额外次数。' : ''}`;
    const seconds = Math.max(0, Math.ceil((state.cooldownUntil - time) / 1000));
    const curfew=attackCurfewState(time);
    cooldown.hidden = !seconds&&!curfew.active;
    cooldown.textContent = curfew.active ? '宵禁中 · 08:00 开战' : seconds ? `休整 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : '';
  }
  function update(value) {
    state = value?.setupComplete && value?.homeTerritoryId ? value.conquest : null;
    receivedAt = now();
    render();
  }
  update(store.getState());
  const unsubscribe = store.subscribe(change => update(change.state));
  const timer = setInterval(render, 1000);
  return { destroy() { clearInterval(timer); unsubscribe?.(); } };
}
