import {readFile} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const compress = promisify(gzip);
export function acceptsGzip(header = '') {
  const values = new Map(String(header).toLowerCase().split(',').map(item => {
    const [name, ...params] = item.trim().split(';');
    const quality = params.find(p => p.trim().startsWith('q='));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return (values.get('gzip') ?? values.get('*') ?? 0) > 0;
}

export function createStaticAssetCache({maxBytes = 16 * 1024 * 1024, read = readFile, zip = compress} = {}) {
  const entries = new Map();
  let retained = 0;
  return {
    async get(filePath, details, compressible) {
      const version = `${details.size}:${details.mtimeMs}:${details.ctimeMs}:${compressible}`;
      const previous = entries.get(filePath);
      if (previous?.version === version) {
        entries.delete(filePath); entries.set(filePath, previous);
        return previous.promise;
      }
      if (previous) { entries.delete(filePath); retained -= previous.bytes; }
      const entry = {version, bytes:0};
      entry.promise = (async () => {
        const content = await read(filePath);
        const compressed = compressible && content.length >= 1024 ? await zip(content) : null;
        const gzipped = compressed && compressed.length < content.length ? compressed : null;
        const asset = {content, gzip:gzipped, hash:createHash('sha256').update(content).digest('hex')};
        if (entries.get(filePath) === entry) {
          entry.bytes = content.length + (gzipped?.length ?? 0); retained += entry.bytes;
          while (retained > maxBytes && entries.size) {
            const [key, oldest] = entries.entries().next().value;
            entries.delete(key); retained -= oldest.bytes;
          }
        }
        return asset;
      })();
      entries.set(filePath, entry);
      try { return await entry.promise; }
      catch (error) { if (entries.get(filePath) === entry) entries.delete(filePath); throw error; }
    },
  };
}
