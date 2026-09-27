export async function waitForHealth({
  fetchImpl = fetch,
  active,
  log = console.log,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 180_000,
  requestTimeoutMs = 10_000,
  intervalMs = 2_000,
} = {}) {
  const started = now(), deadline = started + timeoutMs;
  let attempt = 0, lastError = 'No response';
  while (now() < deadline) {
    attempt++;
    try {
      if (!active()) throw new Error('systemd service is not active');
      for (const route of ['/healthz', '/versus/']) {
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error('Health check deadline exceeded');
        try {
          const response = await fetchImpl(`http://127.0.0.1:4380${route}`, {
            signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remaining))),
            redirect: 'error',
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`HTTP ${response.status}`);
          }
          if (route === '/healthz') {
            if ((await response.json()).status !== 'ok') throw new Error('status is not ok');
          } else if (!(await response.text()).trim()) {
            throw new Error('Empty game page');
          }
        } catch (error) {
          throw new Error(`${route}: ${error.message}`);
        }
      }
      if (!active()) throw new Error('systemd service stopped during check');
      log(`Health check passed after ${Math.round((now() - started) / 1000)}s (${attempt} attempts)`);
      return true;
    } catch (error) {
      lastError = error.message;
      log(`Health check attempt ${attempt}: ${lastError}`);
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
  }
  log(`Health check failed after ${Math.round((now() - started) / 1000)}s: ${lastError}`);
  return false;
}
