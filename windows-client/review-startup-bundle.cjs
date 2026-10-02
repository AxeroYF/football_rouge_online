// Electron 0.1.7 navigation/cache compatibility with an isolated, local test server.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {pathToFileURL}=require('node:url');
const root=process.cwd(),out=path.join(root,'outputs/r48-startup-review/electron');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
app.whenReady().then(async()=>{
 const {createStaticHandler}=await import(pathToFileURL(path.join(root,'server/http/static-handler.mjs')));
 const {ResourceCache,ORIGIN,contentType}=await import(pathToFileURL(path.join(root,'windows-client/resource-cache.mjs')));
 const {navigateUntilInteractive}=await import(pathToFileURL(path.join(root,'windows-client/navigation.mjs')));
 const requests=[],errors=[],serve=createStaticHandler(root);
 const server=http.createServer((req,res)=>{requests.push(req.url);setTimeout(()=>serve(req,res),120);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const s=session.fromPartition('startup-bundle-review');
 const cache=new ResourceCache({directory:path.join(out,'cache'),seed:path.join(root,'windows-client/seed'),fetchImpl:(url,options)=>fetch(url.replace(ORIGIN,base),options)});await cache.init();
 await s.protocol.handle('https',async request=>{
  const entry=cache.entry(request.url);
  if(entry){try{return new Response(await cache.get(entry),{headers:{'content-type':contentType(entry.path)}});}catch(e){errors.push(e.message);return Response.error();}}
  return fetch(request.url.replace(ORIGIN,base));
 });
 const w=new BrowserWindow({show:false,webPreferences:{session:s,sandbox:true,contextIsolation:true}});
 const timeout=setTimeout(()=>{fs.writeFileSync(path.join(out,'failure.txt'),'Startup timeout');app.exit(1);},35000);
 try{
  const start=Date.now();await navigateUntilInteractive(w,ORIGIN+'/versus/');
  const body=await w.webContents.executeJavaScript('document.querySelector("#entry-auth-form")?.textContent');
  if(!body?.includes('进入游戏')||errors.length)throw Error('Startup failed '+JSON.stringify(errors));
  fs.writeFileSync(path.join(out,'login.png'),(await w.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,ms:Date.now()-start,errors,hits:cache.hits,downloads:cache.downloads,codeRequests:requests.filter(u=>/\.(?:js|css|mjs)(?:\?|$)/.test(u))},null,2));
 }finally{clearTimeout(timeout);w.destroy();await new Promise(r=>server.close(r));app.quit();}
}).catch(error=>{fs.writeFileSync(path.join(out,'failure.txt'),error.stack);app.exit(1);});
