import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForHealth } from '../deploy/hot-update/health.mjs';

function fixture(fetchImpl, overrides = {}) {
  let time = 0;
  const logs = [];
  return { logs, options: { fetchImpl, active: () => true, now: () => time,
    sleep: async ms => { time += ms; }, log: message => logs.push(message),
    timeoutMs: 180_000, ...overrides } };
}
const success = url => new Response(url.endsWith('/healthz') ? '{"status":"ok"}' : '<html>Game</html>');

test('waits through a startup taking longer than the old check window', async () => {
  let calls = 0;
  const { options, logs } = fixture(url => { if (++calls <= 40) throw Error('connection refused'); return success(url); });
  assert.equal(await waitForHealth(options), true);
  assert.match(logs.at(-1), /80s/);
});
for (const [name, response, expected] of [
  ['HTTP failure', () => new Response('Unavailable', { status: 503 }), /\/healthz: HTTP 503/],
  ['invalid status', () => new Response('{"status":"bad"}'), /status is not ok/],
  ['empty page', url => url.endsWith('/healthz') ? success(url) : new Response(''), /\/versus\/: Empty/],
  ['request timeout', () => { throw Error('The operation was aborted due to timeout'); }, /\/healthz:.*timeout/],
]) test(`reports ${name} and fails within the budget`, async () => {
  const { options, logs } = fixture(response, { timeoutMs: 4000 });
  assert.equal(await waitForHealth(options), false);
  assert.match(logs.at(-1), expected);
  assert.equal(logs.length, 3);
});
test('rejects a stopped service even when HTTP responds', async () => {
  let checks = 0;
  const { options, logs } = fixture(success, { active: () => ++checks === 1, timeoutMs: 2000 });
  assert.equal(await waitForHealth(options), false);
  assert.match(logs[0], /stopped during check/);
});
