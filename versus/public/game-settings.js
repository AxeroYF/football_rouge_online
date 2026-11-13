const STORAGE_KEY = 'yffm1_game_settings_v1';
const THEME_KEY = 'yellowdogs_league_desktop_theme_v1';
const MOTION_KEY = 'yffm1_pack_opening_motion_v1';

export const DEFAULT_GAME_SETTINGS = Object.freeze({
  theme:'light', uiMotion:'system', packMotion:'system', compactCards:true, stackCards:false,
  tacticsPieceDisplay:'magnets',
  chemistryLines:true, bondBonuses:false, positionZones:false,
});

export function normalizeGameSettings(value = {}) {
  const result = {...DEFAULT_GAME_SETTINGS};
  if (!value || typeof value !== 'object') return result;
  if (['light','dark'].includes(value.theme)) result.theme = value.theme;
  if (['system','on','off'].includes(value.uiMotion)) result.uiMotion = value.uiMotion;
  if (['system','on','off'].includes(value.packMotion)) result.packMotion = value.packMotion;
  if (['magnets','cards'].includes(value.tacticsPieceDisplay)) result.tacticsPieceDisplay = value.tacticsPieceDisplay;
  for (const key of ['compactCards','stackCards','chemistryLines','bondBonuses','positionZones']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  return result;
}

export function createGameSettings(env = globalThis) {
  function read() {
    try {
      const stored = JSON.parse(env.localStorage?.getItem(STORAGE_KEY) ?? 'null');
      if (stored && typeof stored === 'object') return normalizeGameSettings(stored);
    } catch { /* Fall back to existing preferences. */ }
    let theme, packMotion;
    try { theme = env.localStorage?.getItem(THEME_KEY); packMotion = env.localStorage?.getItem(MOTION_KEY); } catch { /* Storage is optional. */ }
    return normalizeGameSettings({theme, packMotion});
  }
  let value = read();
  const listeners = new Set();
  function publish(next) {
    const previous = value;
    value = next;
    if (JSON.stringify(previous) !== JSON.stringify(value)) {
      for (const listener of listeners) listener({...value}, {...previous});
    }
  }
  function update(patch) {
    const next = normalizeGameSettings({...value, ...patch});
    let saved = true;
    try {
      env.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
      env.localStorage?.setItem(THEME_KEY, next.theme);
      env.localStorage?.setItem(MOTION_KEY, next.packMotion);
      if (!env.localStorage) saved = false;
    } catch { saved = false; }
    publish(next);
    return {value:{...value}, saved};
  }
  function onStorage(event) {
    if (event.key === STORAGE_KEY || event.key === null) publish(read());
  }
  env.addEventListener?.('storage', onStorage);
  return {
    get value() { return {...value}; },
    update, reset:() => update(DEFAULT_GAME_SETTINGS),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { listeners.clear(); env.removeEventListener?.('storage', onStorage); },
  };
}

export function gameSettingsMarkup(value, {reducedMotion = false, showAccount = false} = {}) {
  const settings = normalizeGameSettings(value);
  const selected = (key, option) => settings[key] === option ? 'selected' : '';
  const checkbox = (key, title, note) => `<label class="game-setting-row"><span><b>${title}</b><small>${note}</small></span><input type="checkbox" data-game-setting="${key}" ${settings[key] ? 'checked' : ''}></label>`;
  return `<header><div><small>YFFM1 PREFERENCES</small><h2 id="game-settings-title">游戏设置</h2><p>调整显示与操作偏好，即时生效。</p></div><button type="button" class="icon-button" data-close-league-dialog aria-label="关闭游戏设置">×</button></header>
    <div class="game-settings-content">
      <section><h3>显示与主题</h3><label class="game-setting-row"><span><b>电脑端主题</b><small>手机端继续使用深色界面。</small></span><select data-game-setting="theme" aria-label="电脑端主题"><option value="light" ${selected('theme','light')}>浅色</option><option value="dark" ${selected('theme','dark')}>深色</option></select></label>
      ${checkbox('compactCards','紧凑球员卡','背包中同时显示更多球员卡。')}${checkbox('stackCards','叠放重复卡片','同名、同强化等级的卡片合并展示；回收时逐张显示。')}</section>
      <section><h3>界面动画</h3><label class="game-setting-row"><span><b>操作与比赛反馈</b><small>切页、弹窗、保存及直播事件动效。</small></span><select data-game-setting="uiMotion" aria-label="界面动画"><option value="system" ${selected('uiMotion','system')}>跟随系统</option><option value="on" ${selected('uiMotion','on')}>开启</option><option value="off" ${selected('uiMotion','off')}>关闭</option></select></label></section>
      <section><h3>开包动画</h3><label class="game-setting-row"><span><b>流星与卡片演出</b><small>控制流星背景、卡片入场和获卡动画。</small></span><select data-game-setting="packMotion" aria-label="开包动画"><option value="system" ${selected('packMotion','system')}>跟随系统</option><option value="on" ${selected('packMotion','on')}>开启</option><option value="off" ${selected('packMotion','off')}>关闭</option></select></label><p class="game-settings-motion-note" data-game-motion-note>${reducedMotion ? '系统当前已减弱动画；选择“开启”可播放完整开包演出。' : '跟随系统会自动使用设备的动画偏好。'}</p></section>
      <section><h3>战术板辅助显示</h3><label class="game-setting-row"><span><b>场上球员显示方式</b><small>切换磁贴或缩小版盾形球员卡，保留拖拽、换人与职责操作。</small></span><select data-game-setting="tacticsPieceDisplay" aria-label="场上球员显示方式"><option value="magnets" ${selected('tacticsPieceDisplay','magnets')}>磁贴</option><option value="cards" ${selected('tacticsPieceDisplay','cards')}>盾形球员卡</option></select></label>${checkbox('chemistryLines','默契连线','显示首发球员之间的默契关系。')}${checkbox('bondBonuses','羁绊增益','在战术板显示当前阵容激活的羁绊加成。')}${checkbox('positionZones','位置阴影','显示各条线与球员的位置区域。')}</section>
      ${showAccount ? '<section class="game-settings-account"><h3>账号与安全</h3><button type="button" class="button secondary" data-game-account-settings>修改登录密码</button></section>' : ''}
    </div><footer class="game-settings-footer"><span role="status" data-game-settings-status>偏好保存在当前浏览器</span><button type="button" class="button secondary" data-game-settings-reset>恢复默认设置</button><button type="button" class="button primary" data-close-league-dialog>完成</button></footer>`;
}
