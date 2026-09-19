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
  let timer = null, started = false;
  function ready() { return loader.classList.contains('is-ready'); }
  function stop() { if (timer !== null) windowRef.clearTimeout(timer); timer = null; }
  function reveal(failed = false) {
    if (!started || ready()) return;
    controls.hidden = false;
    loader.querySelector('strong').textContent = failed ? '地图加载失败，请重试或切换兼容地图' : '地图加载较慢，可继续等待或切换兼容地图';
    if (failed) loader.classList.add('is-error');
  }
  function start() { if (started) return; started = true; timer = windowRef.setTimeout(() => reveal(), timeoutMs); }
  windowRef.addEventListener('campaign-ready', start);
  windowRef.addEventListener('campaign-map-error', () => { stop(); reveal(true); });
  windowRef.addEventListener('campaign-map-loaded', () => { stop(); controls.hidden = true; });
  windowRef.addEventListener('pagehide', stop);
  if (windowRef.campaignBootstrap) start();
  return {start, stop, reveal};
}
if (typeof document !== 'undefined') installMapLoadingRecovery();
