import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/http/static-handler.mjs';
import { createV22DemoInput } from '../engine/v2.2/demo-fixture.mjs';

export function createV22PreviewServer() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const serve = createStaticHandler(root);
  // Public catalog fixture only, generated once. No accounts, database or live matches.
  const payload = JSON.stringify(createV22DemoInput(undefined, { knockout: true }));
  return http.createServer((req, res) => {
    if (req.url === '/demo-input') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(payload); return; }
    if (req.url === '/') { res.writeHead(302, { location: '/v22-preview.html' }); res.end(); return; }
    serve(req, res);
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? 4394);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const server = createV22PreviewServer();
  server.listen(port, '127.0.0.1', () => console.log(`V2.2 demo: http://127.0.0.1:${server.address().port}/v22-preview.html`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
