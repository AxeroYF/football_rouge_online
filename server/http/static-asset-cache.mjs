import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);

export function acceptsGzip(value = '') {
  const qualities = new Map(String(value).toLowerCase().split(',').map(part => {
    const [encoding, ...parameters] = part.trim().split(';');
    const quality = parameters.find(p => p.trim().startsWith('q='));
    return [encoding, quality === undefined ? 1 : Number(quality.trim().slice(2))];
  }));
  const quality = qualities.get('gzip') ?? qualities.get('*') ?? 0;
  return Number.isFinite(quality) && quality > 0 && quality <= 1;
}

// Public map assets only. Limit compressed storage and concurrent source buffers.
export function createStaticAssetCache({ maxBytes = 16 * 1024 * 1024, maxSourceBytes = 12 * 1024 * 1024,
  concurrency = 2, read = readFile, encode = bytes => compress(bytes, { level: 6 }) } = {}) {
  const entries = new Map(), pending = new Map(), queue = [];
  let bytes = 0, active = 0;
  function schedule(job) {
    return new Promise((resolve, reject) => { queue.push({ job, resolve, reject }); pump(); });
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const { job, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(job).then(resolve, reject).finally(() => { active--; pump(); });
    }
  }
  function get(file, stat) {
    if (stat.size > maxSourceBytes) return Promise.resolve(null);
    const signature = [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':');
    const cached = entries.get(file);
    if (cached?.signature === signature) {
      entries.delete(file); entries.set(file, cached);
      return Promise.resolve(cached);
    }
    if (cached) { bytes -= cached.cost; entries.delete(file); }
    const key = file + ':' + signature;
    if (pending.has(key)) return pending.get(key);
    const promise = schedule(async () => {
      const source = await read(file);
      const packed = await encode(source);
      const entry = { signature, hash: createHash('sha256').update(source).digest('hex'),
        gzip: packed.length < source.length ? packed : null };
      entry.cost = (entry.gzip?.length ?? 0) + 256;
      if (entry.cost <= maxBytes) {
        const previous = entries.get(file);
        if (previous) { bytes -= previous.cost; entries.delete(file); }
        while (bytes + entry.cost > maxBytes && entries.size) {
          const oldest = entries.keys().next().value;
          bytes -= entries.get(oldest).cost; entries.delete(oldest);
        }
        entries.set(file, entry); bytes += entry.cost;
      }
      return entry;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }
  return { get, stats: () => ({ bytes, entries: entries.size, active, queued: queue.length }) };
}
