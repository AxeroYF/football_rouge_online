import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/http/static-handler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]??4391);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid preview port');
const serve=createStaticHandler(root);
const server=http.createServer((req,res)=>{if(req.url==='/'){res.writeHead(302,{location:'/wonder-preview.html'});res.end();return;}serve(req,res);});
server.listen(port,'127.0.0.1',()=>console.log('Wonder asset preview: http://127.0.0.1:'+server.address().port+'/wonder-preview.html'));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));

