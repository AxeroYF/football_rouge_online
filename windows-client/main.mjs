import {app,BrowserWindow,Menu,session,ipcMain,dialog,screen} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ResourceCache,ORIGIN,contentType} from './resource-cache.mjs';
import {navigateUntilInteractive} from './navigation.mjs';
import {windowLayout} from './window-layout.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const analyticsSmoke=process.argv.includes('--analytics-smoke-test');
let skippedAnalytics=0;
const resourceSmoke=process.argv.includes('--resource-smoke-test');
const navigationSmoke=process.argv.includes('--navigation-smoke-test');
let navigationAttempts=0;
const liveSmoke=process.argv.includes('--live-smoke-test');
const startupSmoke=process.argv.includes('--startup-smoke-test');
let startupScenario='optional',startupOptionalDone=false;
const smoke=process.argv.includes('--smoke-test')||liveSmoke||navigationSmoke||resourceSmoke||analyticsSmoke||startupSmoke;
const smokeRoot=process.env.YDL_SMOKE_DIR??path.join(here,'.smoke-profile');
if(smoke){await fs.mkdir(smokeRoot,{recursive:true});app.setPath('userData',smokeRoot);}
const single=app.requestSingleInstanceLock();if(!single)app.quit();
let preparation=null,cacheReady=null,launchController=null,onlineOnly=false;
let game,launcher,cache,opening=null,gameReady=false,preparing=false,status={phase:'starting',message:'正在准备本地资源…'};
const report=value=>{status={...status,...value,version:app.getVersion(),connecting:Boolean(opening),onlineOnly};if(launcher&&!launcher.isDestroyed())launcher.webContents.send('desktop-status',status);};
const reportResource=value=>{const {stats,...resource}=value;report({...(stats?{stats}:{}),resourceMessage:resource.message??resource.path??status.resourceMessage,...(!opening&&!gameReady&&status.phase!=='error'?resource:{})});};
const secure={nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true};
function protect(w){w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-attach-webview',e=>e.preventDefault());}
async function openLauncher(){if(launcher&&!launcher.isDestroyed()){if(!smoke)launcher.show();return;}launcher=new BrowserWindow({...windowLayout(screen.getPrimaryDisplay().workArea,{},true),resizable:true,show:!smoke,backgroundColor:'#10231b',webPreferences:{...secure,preload:path.join(here,'preload.cjs')}});protect(launcher);launcher.webContents.on('will-navigate',e=>e.preventDefault());await launcher.loadFile(path.join(here,'ui/index.html'));report(status);}
async function openGame({online=false}={}){
 if(online&&opening){launchController?.abort(Error('已切换到在线资源模式'));await opening.catch(()=>{});return openGame({online:true});}
 if(opening)return opening;
 if(!online&&gameReady&&game&&!game.isDestroyed()){if(!smoke)game.show();game.focus();return;}
 opening=(async()=>{
  launchController?.abort(Error('已重新连接'));const controller=new AbortController();launchController=controller;onlineOnly=online;
  if(game&&!game.isDestroyed())game.destroy();gameReady=false;
  let saved={};try{saved=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'window-layout.json'),'utf8'));}catch{}
  const window=new BrowserWindow({show:false,...windowLayout(screen.getPrimaryDisplay().workArea,saved),backgroundColor:'#10231b',webPreferences:{...secure,partition:'persist:yellowdogs-game'}});game=window;protect(window);
  if(saved.maximized&&!smoke)window.maximize();
  window.on('close',()=>{if(smoke)return;const bounds=window.getNormalBounds();void fs.writeFile(path.join(app.getPath('userData'),'window-layout.json'),JSON.stringify({width:bounds.width,height:bounds.height,maximized:window.isMaximized()})).catch(()=>{});});
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==ORIGIN)event.preventDefault();});
  window.webContents.on('will-redirect',(event,url)=>{if(new URL(url).origin!==ORIGIN)event.preventDefault();});
  window.on('closed',()=>{controller.abort(Error('已关闭游戏窗口'));if(game===window){game=null;gameReady=false;}});
  const recover=message=>{if(game!==window||!gameReady)return;gameReady=false;controller.abort(Error(message));report({phase:'error',message});void openLauncher();};
  window.webContents.on('render-process-gone',()=>recover('游戏页面意外退出，请点击重试连接。登录信息已保留。'));
  window.on('unresponsive',()=>recover('游戏页面暂时没有响应，可以重试连接。'));
  try{
   report({phase:'connecting',message:online?'正在使用在线资源连接游戏…':'正在连接游戏服务器…',done:0,total:0});
   await navigateUntilInteractive(window,ORIGIN+'/versus/',{signal:controller.signal,timeoutMs:startupSmoke&&startupScenario==='timeout'?150:30000,onPhase:message=>report({phase:'connecting',message})});
   gameReady=true;report({phase:'ready',message:'游戏已打开，地图和卡画按需加载。'});if(!smoke)window.show();if(launcher&&!launcher.isDestroyed())launcher.hide();
  }catch(error){
   controller.abort(error);
   if(!window.isDestroyed())window.destroy();
   report({phase:'error',message:'游戏连接未完成，请点击“进入游戏”重试。'+error.message});await openLauncher();
   throw error;
  }
 })();try{return await opening;}finally{opening=null;report({});}
}
function prepare(){
 if(preparation)return preparation;
 preparing=true;reportResource({phase:'prepare',message:'后台检查资源版本，不影响进入游戏…'});
 preparation=(async()=>{
  try{await cacheReady;await cache.update({prefetch:false});reportResource({phase:'ready',message:'资源版本已同步，素材按需加载。'});}
  catch(error){reportResource({phase:'fallback',message:error.message+'。可继续进入游戏，未匹配资源在线加载。'});}
  finally{preparing=false;try{reportResource({stats:await cache.stats()});}catch{}}
 })().finally(()=>{preparation=null;});return preparation;
}

if(single)app.whenReady().then(async()=>{
 const ses=session.fromPartition('persist:yellowdogs-game');
 // Optional edge-injected analytics must never hold the launcher's load completion.
 ses.webRequest.onBeforeRequest({urls:['https://static.cloudflareinsights.com/beacon.min.js*']},(_details,callback)=>{skippedAnalytics++;callback({cancel:true});});
ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);ses.on('will-download',(event,item,contents)=>{
  // Only the game's generated PNG posters may open the native save dialog.
  const ownPoster=contents===game?.webContents&&item.getURL().startsWith('blob:'+ORIGIN+'/')&&item.getMimeType()==='image/png';
  if(!ownPoster){event.preventDefault();return;}
  item.setSaveDialogOptions({title:'保存阵容海报',filters:[{name:'PNG 图片',extensions:['png']}]});
 });
 cache=new ResourceCache({directory:path.join(app.getPath('userData'),'resources'),seed:app.isPackaged?path.join(process.resourcesPath,'seed'):path.join(here,'seed'),fetchImpl:(url,options)=>ses.fetch(url,{...options,bypassCustomProtocolHandlers:true}),report:reportResource});
 cacheReady=cache.init().catch(error=>{reportResource({phase:'fallback',message:'本地资源初始化失败，使用在线资源：'+error.message});});
 await ses.protocol.handle('https',async request=>{
  if(startupSmoke&&request.url===ORIGIN+'/versus/'){
   if(['timeout','cancel'].includes(startupScenario))await new Promise(r=>setTimeout(r,700));
   return new Response('<!doctype html><title>Startup verification</title><p>Ready</p>'+(startupScenario==='optional'?'<img src="/__startup_slow.png">':startupScenario==='online'?'<script src="/client/startup-probe.js?v=sha256-aaaaaaaaaaaaaaaaaaaa"></script>':''),{headers:{'content-type':'text/html'}});
  }
  if(startupSmoke&&request.url===ORIGIN+'/__startup_slow.png'){await new Promise(r=>setTimeout(r,2000));startupOptionalDone=true;return new Response('image');}
  if(analyticsSmoke&&request.url===ORIGIN+'/versus/')return new Response('<!doctype html><title>Analytics isolation</title><script defer src="https://static.cloudflareinsights.com/beacon.min.js/audit"></script><p>Game ready</p>',{headers:{'content-type':'text/html'}});
  if(navigationSmoke&&request.url===ORIGIN+'/versus/'){navigationAttempts++;return navigationAttempts===1?Response.error():new Response('<!doctype html><title>Navigation recovered</title><p>ready</p>',{headers:{'content-type':'text/html'}});}
  const signal=launchController?AbortSignal.any([request.signal,launchController.signal]):request.signal;
  if(!onlineOnly&&request.method==='GET'&&!request.headers.has('authorization')&&!request.headers.has('range')){const e=cache.entry(request.url);if(e){try{const bytes=await cache.get(e,{signal});return new Response(bytes,{headers:{'content-type':contentType(e.path),'cache-control':'no-cache','x-content-type-options':'nosniff','x-yellowdogs-cache':'verified-local'}});}catch(error){if(signal.aborted)return Response.error();reportResource({phase:'fallback',message:error.message});}}}
  if(startupSmoke&&request.url.includes('/client/startup-probe.js'))return new Response('window.probeLoaded=true',{headers:{'content-type':'text/javascript'}});
  return ses.fetch(request,{bypassCustomProtocolHandlers:true});
 });
 ipcMain.handle('desktop-action',async(event,action)=>{if(!launcher||event.sender!==launcher.webContents||event.senderFrame!==launcher.webContents.mainFrame)throw Error('Invalid sender');
  if(action==='status')return {...status,version:app.getVersion(),connecting:Boolean(opening)};
  if(action==='play'){await openGame();return null;}
  if(action==='online'){await openGame({online:true});return null;}
  if(action==='cancel'){launchController?.abort(Error('已取消连接，可重新进入'));return null;}
  if(action==='update'){await prepare();return status;}
  if(action==='clear'){if(preparing||(game&&!game.isDestroyed()))throw Error('请先关闭游戏窗口，并等待当前更新结束');await cache.clear();await ses.clearCache();report({phase:'ready',message:'下载缓存已清理，随包素材和登录信息保留。',stats:await cache.stats()});return status;}
  if(action==='repair'){if(preparing)throw Error('资源更新进行中');if(game&&!game.isDestroyed())throw Error('请先关闭游戏窗口再修复资源');const count=await cache.repair();await ses.clearCache();report({message:`已移除 ${count} 个损坏资源，正在检查更新。`});await prepare();return status;}
  if(action==='client-update'){await dialog.showMessageBox(launcher,{type:'info',title:'客户端更新',message:`当前客户端 ${app.getVersion()}`,detail:'游戏资源会自动更新。客户端程序更新需要运营方发布新版安装包，安装覆盖即可保留登录和资源缓存。'});return null;}
  throw Error('Unknown action');
 });
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'游戏',submenu:[{label:'进入游戏',click:()=>void openGame().catch(()=>{})},{label:'资源管理',click:()=>void openLauncher()},{type:'separator'},{role:'quit',label:'退出'}]},{label:'视图',submenu:[{role:'reload',label:'刷新页面'},{role:'togglefullscreen',label:'全屏'}]}]));
 await openLauncher();
 if(smoke)await cacheReady;
 if(startupSmoke){
  const checks=[],started=Date.now();preparation=new Promise(()=>{});
  await openGame();const firstMs=Date.now()-started;
  if(!gameReady||startupOptionalDone)throw Error('Interactive startup waited for optional resources');checks.push('Game opened while preparation and optional image were pending');preparation=null;
  game.destroy();startupScenario='timeout';let timedOut=false;try{await openGame();}catch{timedOut=true;}if(!timedOut||game)throw Error('Timeout did not release failed window');checks.push('Total navigation timeout destroys failed attempt');
  startupScenario='cancel';const attempt=openGame();setTimeout(()=>launchController.abort(Error('test cancellation')),40);let cancelled=false;try{await attempt;}catch{cancelled=true;}if(!cancelled||game)throw Error('Cancellation failed');checks.push('Cancellation releases old attempt');
  startupScenario='online';let cacheCalls=0;const originalGet=cache.get;cache.get=async()=>{cacheCalls++;throw Error('Cache must be bypassed');};
  await openGame({online:true});cache.get=originalGet;if(cacheCalls||!await game.webContents.executeJavaScript('window.probeLoaded'))throw Error('Online bypass failed');checks.push('Online retry bypasses custom cache and loads successfully');
  if(await game.webContents.executeJavaScript('typeof window.desktop')!=='undefined')throw Error('Game must not receive privileged launcher IPC');checks.push('Game renderer has no launcher privileges');
  game.webContents.forcefullyCrashRenderer();for(let i=0;i<100&&gameReady;i++)await new Promise(r=>setTimeout(r,20));if(gameReady||status.phase!=='error')throw Error('Crash recovery missing');checks.push('Renderer crash exposes recovery');
  startupScenario='success';await openGame();if(!gameReady)throw Error('Recovery failed');checks.push('Retry after renderer crash succeeds');
  await fs.writeFile(path.join(smokeRoot,'startup-result.json'),JSON.stringify({passed:true,clientVersion:app.getVersion(),firstInteractiveMs:firstMs,checks},null,2));app.quit();return;
 }
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
 void prepare();void openGame().catch(()=>{});
}).catch(async error=>{if(smoke){await fs.writeFile(path.join(smokeRoot,'failure.txt'),String(error.stack??error));app.exit(1);}else{dialog.showErrorBox('客户端启动失败',error.message);app.quit();}});
app.on('second-instance',()=>{const w=game&&!game.isDestroyed()?game:launcher;if(w&&!w.isDestroyed()){if(w.isMinimized())w.restore();w.show();w.focus();}});
app.on('window-all-closed',()=>app.quit());
