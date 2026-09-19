import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { MAP_ASSET_HASHES, mapAssetUrl } from '../shared/config/map-assets.mjs';
import { loadCampaignMapData } from '../client/map/campaign-map-data.js';
import { loadReliefFields } from '../client/map-three/relief-field.js';
import { isEuropeanFeature, isSouthAmericanFeature } from '../client/map/campaign-map-geometry.js';
import { createStaticHandler } from '../server/http/static-handler.mjs';
import { createStaticAssetCache, acceptsGzip } from '../server/http/static-asset-cache.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = url => url.includes('countries') || url.includes('territories.geojson') ? { features: [] }
  : url.includes('territory-index') ? { territories: [] } : url.includes('regions') ? { regions: {} }
  : url.includes('coastlines') ? {} : [];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('country download retains every campaign feature and exact geometry; asset versions match source bytes', async () => {
  const original = JSON.parse(await readFile(new URL('../assets/data/natural-earth-countries-50m.geojson', import.meta.url)));
  const compact = JSON.parse(await readFile(new URL('../assets/data/campaign-countries.geojson', import.meta.url)));
  assert.deepEqual(compact.features, original.features.filter(f => isEuropeanFeature(f) || isSouthAmericanFeature(f)));
  assert.ok(compact.features.length < original.features.length);
  for (const [file, hash] of Object.entries(MAP_ASSET_HASHES)) {
    assert.equal(sha(await readFile(new URL('../' + file, import.meta.url))), hash, file);
    assert.equal(mapAssetUrl('./' + file), './' + file + '?v=sha256-' + hash);
  }
  assert.throws(() => mapAssetUrl('./data/campaign-accounts.json'), /Unknown/);
});

test('login warm-up and map entry share in-flight requests and parsed data, without forced revalidation', async () => {
  const gate = deferred(), requests = [];
  let parses = 0;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options }); await gate.promise;
    return { ok: true, json: async () => { parses++; return fixture(url); } };
  };
  const warm = loadCampaignMapData({ fetchImpl }), enter = loadCampaignMapData({ fetchImpl });
  assert.equal(warm, enter);
  assert.equal(requests.length, 9);
  assert.ok(requests.every(r => /[?]v=sha256-[a-f0-9]{64}$/.test(r.url) && r.options.cache === 'default'));
  gate.resolve();
  const data = await enter;
  assert.equal(await loadCampaignMapData({ fetchImpl }), data);
  assert.equal(parses, 9); assert.equal(requests.length, 9);
});

test('failed map downloads can retry and explicit content versions never reuse another version', async () => {
  let failing = true, calls = 0;
  const fetchImpl = async url => { calls++; return { ok: !failing, json: async () => fixture(url) }; };
  await assert.rejects(loadCampaignMapData({ fetchImpl }), /map data unavailable/);
  failing = false;
  await loadCampaignMapData({ fetchImpl });
  assert.equal(calls, 27);
  await loadCampaignMapData({ fetchImpl, version: 'new-map' });
  assert.equal(calls, 36);
});

test('all three elevation binaries start before any metadata finishes', async () => {
  const gate = deferred(), urls = [], controller = new AbortController();
  const pending = loadReliefFields({ signal: controller.signal, fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(options.signal, controller.signal); assert.equal(options.cache, 'default');
    if (url.includes('.json?')) await gate.promise;
    return { ok: true,
      json: async () => ({ schemaVersion: 1, width: 2, height: 2, step: 1, origin: [0, 0], file: 'https://invalid.test/redirect.bin' }),
      arrayBuffer: async () => new ArrayBuffer(12) };
  } });
  assert.equal(urls.length, 6);
  assert.equal(urls.filter(url => url.includes('.bin?')).length, 3);
  gate.resolve(); assert.equal((await pending).length, 3);
  assert.ok(urls.every(url => url.startsWith('./assets/map-relief/relief-mesh/')));
});

test('compression cache shares cold work, limits concurrency/memory and invalidates replaced files', async () => {
  let reads = 0, active = 0, peak = 0;
  const gate = deferred(), bytes = Buffer.alloc(1000, 7);
  const cache = createStaticAssetCache({ concurrency: 2, maxBytes: 600,
    read: async () => { reads++; active++; peak = Math.max(peak, active); await gate.promise; active--; return bytes; },
    encode: async source => gzipSync(source) });
  const info = { size: bytes.length, mtimeMs: 1, ctimeMs: 1, ino: 1 };
  const a = cache.get('a', info), again = cache.get('a', info);
  assert.equal(a, again);
  const b = cache.get('b', info), c = cache.get('c', info);
  await Promise.resolve(); assert.equal(reads, 2); assert.equal(cache.stats().queued, 1);
  gate.resolve(); await Promise.all([a, b, c]);
  assert.equal(peak, 2); assert.ok(cache.stats().bytes <= 600); assert.equal(cache.stats().entries, 2);
  const oldReads = reads;
  await cache.get('c', info); assert.equal(reads, oldReads);
  await cache.get('c', { ...info, ctimeMs: 2 }); assert.equal(reads, oldReads + 1);
  assert.equal(await cache.get('too-large', { ...info, size: 13 * 1024 * 1024 }), null);
});

test('failed compression work is evicted so a transient read error can retry', async () => {
  let fail = true;
  const cache = createStaticAssetCache({ read: async () => { if (fail) throw new Error('temporary'); return Buffer.alloc(1000); } });
  const info = { size: 1000, mtimeMs: 1 };
  await assert.rejects(cache.get('map', info), /temporary/);
  fail = false; assert.ok((await cache.get('map', info)).gzip);
});

function request(port, url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, headers, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

test('HTTP map serving compresses losslessly, caches content versions, and preserves validation/HEAD/encoding semantics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ydl-map-http-'));
  const file = 'assets/map-relief/relief-mesh/europe.bin', source = Buffer.alloc(10000, 3);
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), source);
  const serve = createStaticHandler(root);
  const server = http.createServer(serve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, url = '/' + file + '?v=sha256-' + sha(source);
  try {
    const first = await request(port, url, { 'Accept-Encoding': 'gzip' });
    assert.equal(first.status, 200); assert.equal(first.headers['content-encoding'], 'gzip');
    assert.equal(first.headers.vary, 'Accept-Encoding'); assert.match(first.headers['cache-control'], /immutable/);
    assert.deepEqual(gunzipSync(first.body), source); assert.ok(first.body.length < source.length / 10);
    assert.equal(Number(first.headers['content-length']), first.body.length);
    const unchanged = await request(port, url, { 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers.etag });
    assert.equal(unchanged.status, 304); assert.equal(unchanged.body.length, 0);
    assert.equal(unchanged.headers.etag, first.headers.etag); assert.match(unchanged.headers['cache-control'], /immutable/);
    const head = await request(port, url, { 'Accept-Encoding': 'gzip' }, 'HEAD');
    assert.equal(head.body.length, 0); assert.equal(head.headers['content-length'], first.headers['content-length']);
    const raw = await request(port, url, { 'Accept-Encoding': 'gzip;q=0, *;q=1', 'If-None-Match': first.headers.etag });
    assert.equal(raw.status, 200); assert.equal(raw.headers['content-encoding'], undefined); assert.deepEqual(raw.body, source);
    assert.notEqual(raw.headers.etag, first.headers.etag);
    assert.equal((await request(port, '/' + file)).headers['cache-control'], 'no-cache');
    const changed = Buffer.alloc(10001, 8);
    await writeFile(path.join(root, file), changed);
    const fresh = await request(port, url, { 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers.etag });
    assert.equal(fresh.status, 200); assert.equal(fresh.headers['cache-control'], 'no-cache');
    assert.deepEqual(gunzipSync(fresh.body), changed);
    assert.notEqual(fresh.headers.etag, first.headers.etag);
    for (const privatePath of ['/data/campaign-accounts.json', '/seed/campaign-accounts.json', '/server.mjs']) {
      assert.equal((await request(port, privatePath, { 'Accept-Encoding': 'gzip' })).status, 404);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('gzip negotiation respects explicit rejection and malformed qualities', () => {
  for (const value of ['', 'br', 'gzip;q=0', '*;q=1,gzip;q=0', 'gzip;q=NaN', 'gzip;q=2']) assert.equal(acceptsGzip(value), false, value);
  for (const value of ['gzip', 'br, gzip;q=0.8', '*;q=0.5', 'GZIP; q=1']) assert.equal(acceptsGzip(value), true, value);
});

test('startup has no unversioned duplicate preloads and runs data and renderer import together', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /rel="preload"[^>]*assets\/data\//);
  assert.match(app, /const \[data, threeModule\] = await Promise\.all/);
});


test('a stalled response body times out, reloads once, and can load again after both attempts fail', async () => {
  let stalled = true; const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url, options});
    return {ok:true, json:() => stalled ? new Promise(() => {}) : Promise.resolve(fixture(url))};
  };
  await assert.rejects(loadCampaignMapData({fetchImpl, timeoutMs:10}), /map data timeout/);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests.length,18);
  assert.ok(requests.slice(9).every(r => r.options.cache === 'reload'));
  assert.ok(requests.every(r => r.options.signal.aborted));
  stalled = false;
  assert.ok(await loadCampaignMapData({fetchImpl, timeoutMs:50}));
});

test('compatibility recovery stays on the deployed entry path and preserves other options', async () => {
  const {mapRecoveryUrl} = await import('../client/map/map-loading-recovery.js');
  for (const pathname of ['/versus/', '/game']) {
    const current='https://yellowdogsleague.online'+pathname+'?terrain=atlas#map';
    const url=new URL(mapRecoveryUrl(current,true));
    assert.equal(url.pathname,pathname);
    assert.equal(url.searchParams.get('renderer'),'leaflet');
    assert.equal(url.searchParams.get('terrain'),'atlas');
    assert.equal(mapRecoveryUrl(current),current);
  }
});
