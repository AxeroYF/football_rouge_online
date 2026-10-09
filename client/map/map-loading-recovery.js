// Independent of the large game module so recovery remains available if it fails to import.
export function mapRecoveryUrl(href, compatible = false) {
  const url = new URL(href);
  if (compatible) url.searchParams.set('renderer', 'leaflet');
  return url.href;
}
export function installMapLoadingRecovery({documentRef = document, windowRef = window, timeoutMs = 25000} = {}) {
  const loader = documentRef.querySelector('#map-loader');
  if (!loader) return;
  const controls = documentRef.createElement('div'); controls.className = 'map-loader-actions'; controls.hidden = true;
  const retry = documentRef.createElement('a'); retry.href = mapRecoveryUrl(windowRef.location.href); retry.textContent = '重新加载';
  const compatible = documentRef.createElement('a'); compatible.href = mapRecoveryUrl(windowRef.location.href, true); compatible.textContent = '打开兼容地图';
  controls.append(retry);
  if (new URL(windowRef.location.href).searchParams.get('renderer') !== 'leaflet') controls.append(compatible);
  loader.append(controls);
  let timer = null, started = false, progressText = '';
  windowRef.addEventListener('campaign-map-progress', event => {
    if (ready()) return;
    const detail=event.detail;
    progressText = detail.complete ? '已下载 ' + detail.label : '正在下载 ' + detail.label + (detail.bytes ? ' · ' + Math.round(detail.bytes / 1024) + ' KB' : '') + (detail.attempt ? ' · 重试中' : '');
    if (windowRef.campaignBootstrap) loader.querySelector('strong').textContent = progressText;
  });
  function ready() { return loader.classList.contains('is-ready'); }
  function stop() { if (timer !== null) windowRef.clearTimeout(timer); timer = null; }
  function reveal(failed = false) {
    if (!started || ready()) return;
    if (!windowRef.campaignBootstrap) {
      const entry=documentRef.querySelector('#campaign-entry');
      if (entry && !entry.querySelector('form, button')) {
        entry.hidden=false;
        const panel=documentRef.createElement('section');panel.className='entry-panel';
        const message=documentRef.createElement('strong');message.textContent='连接或页面资源加载较慢，请重新加载';
        panel.append(message,controls.cloneNode(true));panel.lastChild.hidden=false;entry.replaceChildren(panel);
      }
    }
    controls.hidden = false;
    loader.querySelector('strong').textContent = failed ? '地图加载失败，请重试或切换兼容地图' : (progressText || '地图加载较慢，可继续等待或切换兼容地图');
    if (failed) loader.classList.add('is-error');
  }
  function start() { if (started) return; started = true; timer = windowRef.setTimeout(() => reveal(), timeoutMs); }
  windowRef.addEventListener('campaign-ready', start);
  windowRef.addEventListener('campaign-map-error', () => { stop(); reveal(true); });
  windowRef.addEventListener('campaign-map-loaded', () => { stop(); controls.hidden = true; });
  windowRef.addEventListener('pagehide', stop);
  start();
  return {start, stop, reveal};
}
if (typeof document !== 'undefined') installMapLoadingRecovery();
