import {app,BrowserWindow,Menu,session,ipcMain,dialog} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ResourceCache,ORIGIN,contentType} from './resource-cache.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const analyticsSmoke=process.argv.includes('--analytics-smoke-test');
let skippedAnalytics=0;
const resourceSmoke=process.argv.includes('--resource-smoke-test');
const navigationSmoke=process.argv.includes('--navigation-smoke-test');
let navigationAttempts=0;
const liveSmoke=process.argv.includes('--live-smoke-test');
const smoke=process.argv.includes('--smoke-test')||liveSmoke||navigationSmoke||resourceSmoke||analyticsSmoke;
const smokeRoot=process.env.YDL_SMOKE_DIR??path.join(here,'.smoke-profile');
if(smoke){await fs.mkdir(smokeRoot,{recursive:true});app.setPath('userData',smokeRoot);}
const single=app.requestSingleInstanceLock();if(!single)app.quit();
let preparation=null;
let game,launcher,cache,opening=null,gameReady=false,preparing=false,status={phase:'starting',message:'正在准备本地资源…'};
const report=value=>{status={...status,...value};if(launcher&&!launcher.isDestroyed())launcher.webContents.send('desktop-status',status);};
const secure={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true};
function protect(w){w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-attach-webview',e=>e.preventDefault());}
async function openLauncher(){if(launcher&&!launcher.isDestroyed()){launcher.show();return;}launcher=new BrowserWindow({width:780,height:580,resizable:false,show:!smoke,backgroundColor:'#10231b',webPreferences:{...secure,preload:path.join(here,'preload.cjs')}});protect(launcher);launcher.webContents.on('will-navigate',e=>e.preventDefault());await launcher.loadFile(path.join(here,'ui/index.html'));report(status);}
async function openGame(){
 if(opening)return opening;
 if(gameReady&&game&&!game.isDestroyed()){game.show();game.focus();return;}
 opening=(async()=>{
  if(game&&!game.isDestroyed())game.destroy();gameReady=false;
  const window=new BrowserWindow({show:false,width:1440,height:940,minWidth:1000,minHeight:650,backgroundColor:'#10231b',webPreferences:{...secure,partition:'persist:yellowdogs-game'}});game=window;protect(window);
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==ORIGIN)event.preventDefault();});
  window.webContents.on('will-redirect',(event,url)=>{if(new URL(url).origin!==ORIGIN)event.preventDefault();});
  window.on('closed',()=>{if(game===window){game=null;gameReady=false;}});
  let timer;
  try{
   if(preparation)await preparation;
   report({phase:'prepare',message:'正在连接游戏服务器…'});
   await Promise.race([window.loadURL(ORIGIN+'/versus/'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('连接超过 30 秒')),30000);})]);
   gameReady=true;if(!smoke)window.show();if(launcher&&!launcher.isDestroyed())launcher.hide();
  }catch(error){
   if(!window.isDestroyed())window.destroy();
   report({phase:'error',message:'游戏连接未完成，请点击“进入游戏”重试。'+error.message});await openLauncher();
   throw error;
  }finally{clearTimeout(timer);}
 })();try{return await opening;}finally{opening=null;}
}
function prepare(){
 if(preparation)return preparation;
 preparing=true;report({phase:'prepare',message:'检查资源版本…'});
 preparation=(async()=>{
  try{await cache.update();report({phase:'ready',message:'本地资源已就绪，可以进入游戏。'});}
  catch(error){report({phase:'fallback',message:error.message+'。仍可进入游戏，已匹配版本的本地资源继续可用，其余资源在线加载。'});}
  finally{preparing=false;report({stats:await cache.stats()});}
 })().finally(()=>{preparation=null;});return preparation;
}

if(single)app.whenReady().then(async()=>{
 const ses=session.fromPartition('persist:yellowdogs-game');
 // Optional edge-injected analytics must never hold the launcher's load completion.
 ses.webRequest.onBeforeRequest({urls:['https://static.cloudflareinsights.com/beacon.min.js*']},(_details,callback)=>{skippedAnalytics++;callback({cancel:true});});
ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);ses.on('will-download',event=>event.preventDefault());
 cache=new ResourceCache({directory:path.join(app.getPath('userData'),'resources'),seed:app.isPackaged?path.join(process.resourcesPath,'seed'):path.join(here,'seed'),fetchImpl:(url,options)=>ses.fetch(url,{...options,bypassCustomProtocolHandlers:true}),report});await cache.init();
 await ses.protocol.handle('https',async request=>{
  if(analyticsSmoke&&request.url===ORIGIN+'/versus/')return new Response('<!doctype html><title>Analytics isolation</title><script defer src="https://static.cloudflareinsights.com/beacon.min.js/audit"></script><p>Game ready</p>',{headers:{'content-type':'text/html'}});
  if(navigationSmoke&&request.url===ORIGIN+'/versus/'){navigationAttempts++;return navigationAttempts===1?Response.error():new Response('<!doctype html><title>Navigation recovered</title><p>ready</p>',{headers:{'content-type':'text/html'}});}
  if(request.method==='GET'&&!request.headers.has('authorization')&&!request.headers.has('range')){const e=cache.entry(request.url);if(e){try{const bytes=await cache.get(e);return new Response(bytes,{headers:{'content-type':contentType(e.path),'cache-control':'no-cache','x-content-type-options':'nosniff','x-yellowdogs-cache':'verified-local'}});}catch(error){report({phase:'fallback',message:error.message});}}}
  return ses.fetch(request,{bypassCustomProtocolHandlers:true});
 });
 ipcMain.handle('desktop-action',async(event,action)=>{if(!launcher||event.sender!==launcher.webContents||event.senderFrame!==launcher.webContents.mainFrame)throw Error('Invalid sender');
  if(action==='status')return {...status,stats:await cache.stats()};
  if(action==='play'){await openGame();return null;}
  if(action==='update'){await prepare();return status;}
  if(action==='clear'){if(preparing||(game&&!game.isDestroyed()))throw Error('请先关闭游戏窗口，并等待当前更新结束');await cache.clear();await ses.clearCache();report({phase:'ready',message:'下载缓存已清理，随包素材和登录信息保留。',stats:await cache.stats()});return status;}
  if(action==='repair'){if(preparing)throw Error('资源更新进行中');if(game&&!game.isDestroyed())throw Error('请先关闭游戏窗口再修复资源');const count=await cache.repair();await ses.clearCache();report({message:`已移除 ${count} 个损坏资源，正在检查更新。`});await prepare();return status;}
  if(action==='client-update'){await dialog.showMessageBox(launcher,{type:'info',title:'客户端更新',message:`当前客户端 ${app.getVersion()}`,detail:'游戏资源会自动更新。客户端程序更新需要运营方发布新版安装包，安装覆盖即可保留登录和资源缓存。'});return null;}
  throw Error('Unknown action');
 });
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'游戏',submenu:[{label:'进入游戏',click:()=>void openGame().catch(()=>{})},{label:'资源管理',click:()=>void openLauncher()},{type:'separator'},{role:'quit',label:'退出'}]},{label:'视图',submenu:[{role:'reload',label:'刷新页面'},{role:'togglefullscreen',label:'全屏'}]}]));
 await openLauncher();
 if(analyticsSmoke){const start=Date.now();await openGame();const result={loaded:gameReady,skippedAnalytics,elapsedMs:Date.now()-start,title:await game.webContents.executeJavaScript('document.title')};if(!result.loaded||result.skippedAnalytics!==1)throw Error('Optional analytics must be skipped');await fs.writeFile(path.join(smokeRoot,'analytics-result.json'),JSON.stringify(result));app.quit();return;}
 if(resourceSmoke){
  const manifest=JSON.parse(await fs.readFile(path.join(cache.seed,'manifest.json'),'utf8'));
  let network=0;
  cache.fetchImpl=async url=>{network++;if(url.endsWith('desktop-resources.json'))return Response.json({...manifest,entries:manifest.entries.filter(e=>!/[.](js|mjs|css)$/.test(e.path))});throw Error('Unexpected asset download '+url);};
  await cache.update();
  const categories=['assets/player-profiles/','assets/card-frames/','assets/club-badges/','assets/flags/','assets/facilities/','assets/expedition-units/','client/','styles/','assets/vendor/'];
  const results=[];
  for(const prefix of categories){
   const entry=manifest.entries.find(e=>e.path.startsWith(prefix)&&!e.path.includes('/admin/'));if(!entry)throw Error('Missing bundled category '+prefix);
   const suffix=/[.](js|mjs|css)$/.test(entry.path)?'?v=sha256-'+entry.sha256.slice(0,20):'';
   for(let repeat=0;repeat<2;repeat++){
    const response=await ses.fetch(ORIGIN+'/versus/'+encodeURI(entry.path)+suffix);
    const bytes=(await response.arrayBuffer()).byteLength;
    if(response.headers.get('x-yellowdogs-cache')!=='verified-local'||bytes!==entry.bytes)throw Error('Resource did not use verified local bytes '+entry.path);
   }
   results.push({category:prefix,bytes:entry.bytes});
  }
  const result={clientVersion:app.getVersion(),manifestRequests:network,assetDownloads:cache.downloads,localHits:cache.hits,results};
  if(network!==1||cache.downloads!==0)throw Error('Unexpected network activity');
  await fs.writeFile(path.join(smokeRoot,'resource-result.json'),JSON.stringify(result,null,2));app.quit();return;
 }
 if(navigationSmoke){let failed=false;try{await openGame();}catch{failed=true;}if(!failed||gameReady||game)throw Error('Failed navigation must close game and allow retry');await Promise.all([openGame(),openGame()]);const result={failedFirst:failed,recovered:gameReady,attempts:navigationAttempts,title:await game.webContents.executeJavaScript('document.title'),node:await game.webContents.executeJavaScript('typeof require')};if(!result.recovered||result.attempts!==2||result.node!=='undefined')throw Error('Navigation retry verification failed');await fs.writeFile(path.join(smokeRoot,'navigation-result.json'),JSON.stringify(result));app.quit();return;}
 if(liveSmoke){let result;try{await openGame();result={loaded:true,url:game.webContents.getURL(),title:await game.webContents.executeJavaScript('document.title')};}catch(error){result={loaded:false,error:error.stack};}await fs.writeFile(path.join(smokeRoot,'live-result.json'),JSON.stringify(result));app.quit();return;}
 if(smoke){const result=await launcher.webContents.executeJavaScript('({title:document.title,node:typeof require,buttons:document.querySelectorAll("button").length})');const entry=[...cache.known.values()].find(e=>e.core);const local=await ses.fetch(ORIGIN+'/'+entry.path+'?v=sha256-'+entry.sha256);const count=(await local.arrayBuffer()).byteLength;await fs.writeFile(path.join(smokeRoot,'smoke-result.json'),JSON.stringify({...result,version:process.versions.electron,clientVersion:app.getVersion(),localHeader:local.headers.get('x-yellowdogs-cache'),localBytes:count,expectedBytes:entry.bytes,cache:await cache.stats()}));try{await fs.writeFile(path.join(smokeRoot,'launcher.png'),(await launcher.webContents.capturePage()).toPNG());}catch{}finally{app.quit();}return;}
 void prepare();
}).catch(async error=>{if(smoke){await fs.writeFile(path.join(smokeRoot,'failure.txt'),String(error.stack??error));app.exit(1);}else{dialog.showErrorBox('客户端启动失败',error.message);app.quit();}});
app.on('second-instance',()=>{const w=game&&!game.isDestroyed()?game:launcher;if(w&&!w.isDestroyed()){if(w.isMinimized())w.restore();w.show();w.focus();}});
app.on('window-all-closed',()=>app.quit());
