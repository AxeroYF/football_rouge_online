import { campaignRequestPath } from './public-entry.mjs';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { MAP_ASSET_HASHES } from '../../shared/config/map-assets.mjs';
import { acceptsGzip, createStaticAssetCache } from './static-asset-cache.mjs';

const types = new Map(Object.entries({
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.geojson':'application/geo+json; charset=utf-8',
  '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.bin':'application/octet-stream', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff',
}));
const folders = new Set(['assets', 'client', 'shared', 'styles', 'engine']);
const entries = new Map([['/versus','index.html'],['/versus/','index.html'],['/game','index.html'],['/game/','index.html'],['/admin','admin-v2.html'],['/admin/','admin-v2.html'],['/admin.html','admin-v2.html']]);

export function isPublicFile(relative) {
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part.startsWith('.')) || relative.includes('\0')) return false;
  if (!types.has(path.extname(relative).toLowerCase())) return false;
  if (parts.length === 1) return ['.js', '.css', '.html', '.ico'].includes(path.extname(relative).toLowerCase());
  return folders.has(parts[0]) && !relative.startsWith('shared/account-import/');
}

export function publicRequestPath(url) {
  try {
    const pathname = campaignRequestPath(decodeURIComponent(new URL(url, 'http://localhost').pathname));
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const relative = entries.get(pathname) ?? pathname.replace(/^\/+/, '');
    return isPublicFile(relative) ? relative : null;
  } catch { return null; }
}

export function createStaticHandler(root) {
  const mapAssets = createStaticAssetCache();
  return async function handleStatic(request, response) {
    const relative = publicRequestPath(request.url);
    if (!relative) { response.writeHead(404); response.end('Not found'); return; }
    try {
      const target = await realpath(path.join(root, relative));
      const canonical = path.relative(await realpath(root), target);
      if (!isPublicFile(canonical)) { response.writeHead(404); response.end('Not found'); return; }
      const details = await stat(target);
      if (!details.isFile()) { response.writeHead(404); response.end('Not found'); return; }
      const extension = path.extname(target).toLowerCase();
      const relativePath = canonical.replaceAll('\\', '/');
      const asset = Object.hasOwn(MAP_ASSET_HASHES, relativePath) ? await mapAssets.get(target, details) : null;
      const compressed = asset?.gzip && acceptsGzip(request.headers['accept-encoding']) ? asset.gzip : null;
      const version = new URL(request.url, 'http://localhost').searchParams.get('v');
      // Check the real bytes, so stale manifests cannot lock changed content into cache.
      const immutable = asset && version === 'sha256-' + asset.hash;
      const etag = asset ? 'W/"' + asset.hash + (compressed ? '-gzip' : '') + '"'
        : 'W/"' + details.size + '-' + details.mtimeMs + '-' + details.ctimeMs + '"';
      const headers = {
        'content-type':types.get(extension), 'x-content-type-options':'nosniff', etag,
        'cache-control':immutable ? 'public, max-age=31536000, immutable'
          : asset || ['.html','.js','.mjs','.css','.json','.geojson'].includes(extension) ? 'no-cache' : 'public, max-age=3600',
        ...(asset ? { vary: 'Accept-Encoding' } : {}),
        ...(compressed ? { 'content-encoding': 'gzip' } : {}),
      };
      if (request.headers['if-none-match']?.split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) {
        response.writeHead(304, headers); response.end(); return;
      }
      response.writeHead(200, { ...headers, 'content-length':compressed?.length ?? details.size });
      if (request.method === 'HEAD') { response.end(); return; }
      if (compressed) { response.end(compressed); return; }
      await pipeline(createReadStream(target), response);
    } catch (error) {
      if (response.headersSent) { if (!response.destroyed) response.destroy(); return; }
      response.writeHead(404); response.end('Not found');
    }
  };
}
