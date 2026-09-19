import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { MAP_ASSET_HASHES, mapAssetUrl } from '../shared/config/map-assets.mjs';
import { createStaticHandler } from '../server/http/static-handler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer(createStaticHandler(root));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: url.slice(1), headers: { 'Accept-Encoding': 'gzip', ...headers } }, response => {
      const chunks = [];
      response.on('data', data => chunks.push(data));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    }).on('error', reject);
  });
}
try {
  const rows = await Promise.all(Object.entries(MAP_ASSET_HASHES).map(async ([file, hash]) => {
    const result = await request(mapAssetUrl(file));
    assert.equal(result.status, 200, file);
    const raw = result.headers['content-encoding'] === 'gzip' ? gunzipSync(result.body) : result.body;
    assert.equal(createHash('sha256').update(raw).digest('hex'), hash, file);
    assert.match(result.headers['cache-control'], /immutable/);
    const revalidated = await request(mapAssetUrl(file), { 'If-None-Match': result.headers.etag });
    assert.equal(revalidated.status, 304); assert.equal(revalidated.body.length, 0);
    return { file, rawBytes: raw.length, wireBytes: result.body.length, encoding: result.headers['content-encoding'] ?? 'identity' };
  }));
  const oldMain = ['assets/data/natural-earth-countries-50m.geojson', 'assets/data/europe-cities.json',
    'assets/data/south-america-cities.json', 'assets/data/europe-clubs.json', 'assets/data/campaign-territories.geojson',
    'assets/data/territory-index.json', 'assets/data/campaign-coastlines.json', 'shared/config/map-relief-regions.json'];
  const oldAdditional = Object.keys(MAP_ASSET_HASHES).filter(file => !file.includes('campaign-countries') && !oldMain.includes(file));
  // Estimate the old deployment's response bodies using its Nginx gzip level 2.
  // It did not compress .bin and requested seven unversioned HTML preloads again
  // with a different ?v= URL. This is a byte model, not a live-server timing claim.
  async function oldBytes(files) {
    let total = 0;
    for (const file of files) {
      const raw = await readFile(new URL('../' + file, import.meta.url));
      total += raw.length < 1024 || file.endsWith('.bin') ? raw.length : gzipSync(raw, { level: 2 }).length;
    }
    return total;
  }
  const beforeWithoutDuplicatePreloads = await oldBytes([...oldMain, ...oldAdditional]);
  const duplicatePreloadBytes = await oldBytes(oldMain.slice(0, 7));
  const afterBytes = rows.reduce((sum, row) => sum + row.wireBytes, 0);
  const binary = rows.filter(row => row.file.endsWith('.bin'));
  const report = {
    platform: process.platform, node: process.version, files: rows.length,
    before: { estimate: true, withoutDuplicatePreloadsBytes: beforeWithoutDuplicatePreloads,
      duplicatePreloadBytes, withDuplicatePreloadsBytes: beforeWithoutDuplicatePreloads + duplicatePreloadBytes },
    after: { measuredLoopbackHttpBytes: afterBytes, allBodiesMatchSource: true,
      allVersionedResponsesImmutable: true, conditionalRequests: 16, conditionalBodyBytes: 0,
      binaryRawBytes: binary.reduce((s, r) => s + r.rawBytes, 0), binaryWireBytes: binary.reduce((s, r) => s + r.wireBytes, 0) },
    savingsWithoutPreloadsPercent: Math.round((1 - afterBytes / beforeWithoutDuplicatePreloads) * 1000) / 10,
    savingsIncludingPreloadsPercent: Math.round((1 - afterBytes / (beforeWithoutDuplicatePreloads + duplicatePreloadBytes)) * 1000) / 10,
    remoteServerContacted: false, realSavesModified: false, browserTimingMeasured: false, rows,
  };
  const output = new URL('../outputs/map-loading-review/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('transfer-report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
