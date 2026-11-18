import fs from 'node:fs/promises';

// An exact allowlist exposes only the presentation client, never the engine,
// archives, producer, input snapshots or host configuration.
const files=new Map([
  ['/v4-preview/',['./public/index.html','text/html; charset=utf-8']],
  ['/v4-preview/app.js',['./public/app.js','text/javascript; charset=utf-8']],
  ['/v4-preview/style.css',['./public/style.css','text/css; charset=utf-8']],
  ...['account-playback.js','competition-presentation.js'].map(name=>[`/v4-preview/v4-host/${name}`,[`./${name}`,'text/javascript; charset=utf-8']]),
  ...['playback.js','publisher.js','codec.js'].map(name=>[`/v4-preview/v4-stream/${name}`,[`../v4-stream/${name}`,'text/javascript; charset=utf-8']]),
  ...['world.js','period-clock.js','replay.js'].map(name=>[`/v4-preview/v4/${name}`,[`../v4/${name}`,'text/javascript; charset=utf-8']]),
]);
export async function handlePreviewAssets(request,response){
  const url=new URL(request.url,'http://localhost'),entry=files.get(url.pathname);if(!entry)return false;
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{Allow:'GET, HEAD'});response.end();return true;}
  const bytes=await fs.readFile(new URL(entry[0],import.meta.url));
  response.writeHead(200,{'Content-Type':entry[1],'Content-Length':bytes.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"});
  response.end(request.method==='HEAD'?undefined:bytes);return true;
}
