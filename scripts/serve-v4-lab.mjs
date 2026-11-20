import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../versus/v4/',import.meta.url));
export async function startV4Lab({port=4314}={}) {
  const server=http.createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    try {
      const url=new URL(req.url,'http://localhost');
      let name=decodeURIComponent(url.pathname);if(name==='/')name='/lab/index.html';
      const shared=['/public/bond-rules.js','/public/tactical-bonds.js','/public/v2-tactical-profiles.js','/public/spirit-form.js'].includes(name)?fileURLToPath(new URL('../versus'+name,import.meta.url)):null;
      const file=shared??path.resolve(root,'.'+name),relative=shared?'bond-rules.js':path.relative(root,file);
      if(relative.startsWith('..')||path.isAbsolute(relative)||!['.js','.html','.css'].includes(path.extname(file))) {res.writeHead(404);res.end();return;}
      const data=await readFile(file);
      res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[path.extname(file)]+'; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"});
      res.end(req.method==='HEAD'?undefined:data);
    } catch {res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,stop:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const port=Number(process.argv.find(x=>x.startsWith('--port='))?.split('=')[1]??4314);
  const lab=await startV4Lab({port});console.log(`V4 独立实验室：${lab.url} · 仅合成阵容，无正式存档访问`);
}
