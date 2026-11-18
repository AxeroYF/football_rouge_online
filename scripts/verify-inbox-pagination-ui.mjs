import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-inbox-ui-'));
const paths={VERSUS_ACCOUNTS_PATH:path.join(dir,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(dir,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(dir,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(dir,'studio.json')};
Object.assign(process.env,paths);
const out='outputs/inbox-pagination-ui-20261117';fs.mkdirSync(out,{recursive:true});
let server,browser;
async function start(){
  const child=spawn(process.execPath,['server.mjs'],{windowsHide:true,env:{...process.env,...paths,APP_ENV:'test',VERSUS_HOST:'127.0.0.1',DEVTOOL_PORT:'0',VERSUS_PUBLIC_ONLY:'0',YFFM_ADMIN_PASSWORD:'isolated-test-password-only'}});
  const exit=new Promise(resolve=>child.once('exit',resolve));let output='',timer;
  server={stop:async()=>{if(child.exitCode===null)child.kill();await exit;}};
  try{server.url=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('startup timeout '+output.slice(-1000))),20000);child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m)resolve(m[0]);});child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',c=>reject(new Error(`server exit ${c}: ${output.slice(-1000)}`)));});}
  finally{clearTimeout(timer);}
}
async function post(route,body){
  const response=await fetch(server.url+'/api/versus'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const value=await response.json();assert.ok(response.ok&&value.ok!==false,JSON.stringify(value).slice(0,500));return value;
}
try{
  await start();
  const account=await post('/register',{nickname:'收件箱界面验证',password:'isolated-only'});
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/league/draft/start',{...identity,teamName:'收件箱验证队'});await post('/league/draft/auto',identity);await post('/league/draft/finish',identity);
  await server.stop();
  const {YellowDogsLeagueService}=await import('../versus/league-service.js');
  const service=new YellowDogsLeagueService({statePath:paths.YELLOWDOGS_LEAGUE_PATH,backupDir:null});
  const team=service.accountTeam(identity.playerId),other=service.state.teams.find(t=>t.id!==team.id),now=Date.now();
  service.state.inbox[team.id]=[];
  const packages=service.grantS4Pack(team.ownerId,'private-mixed',2).map(p=>p.id);
  service.pushInbox(team,{id:'reward-ui',type:'reward',title:'礼包已到账',body:'两份礼包已经放入背包'});
  service.pushInbox(team,{id:'notice-ui',type:'admin-update',title:'保留的管理员公告',body:'其他分类邮件'});
  service.readInbox({id:team.ownerId},'notice-ui',{compact:true});
  const oldNotice=service.state.inbox[team.id].find(m=>m.id==='notice-ui');oldNotice.readAt=now-10000;
  service.pushInbox(team,{id:'notice-ui',type:'admin-update',title:'保留的管理员公告',body:'更新后的公告内容'});
  service.state.s4Assets.traitOffers['cancelled-ui']={id:'cancelled-ui',status:'cancelled',ownerId:team.ownerId};
  service.pushInbox(team,{id:'comp-ui',type:'trait-compensation',title:'失效补偿测试',payload:{offerId:'cancelled-ui',resolvedAt:null,playerName:'测试球员'}});
  for(let i=0;i<250;i++){
    const id=`pending-ui-${i}`;
    service.state.friendlyInvitations.push({id,status:'pending',fromTeamId:other.id,fromOwnerId:'fixture-other',toTeamId:team.id,toOwnerId:team.ownerId,createdAt:now,expiresAt:now+7200000});
    service.pushInbox(team,{id,type:'friendly-invite',title:`有效待办 ${i+1}`,payload:{friendlyInvitationId:id}});
  }
  service.state.friendlyInvitations.push({id:'accepted-ui',status:'accepted',fromTeamId:other.id,toTeamId:team.id,toOwnerId:team.ownerId,expiresAt:now-1000});
  service.pushInbox(team,{id:'accepted-mail',type:'friendly-invite',title:'已接受的历史邀请',payload:{friendlyInvitationId:'accepted-ui'}});
  const report=service.v2ReviewDemoDetail();report.teams[0].name='历史主队';report.teams[1].name='历史客队';
  service.state.matches.push({id:'archive-ui',competition:'league',round:1,homeId:team.id,awayId:other.id,score:[1,0],playedAt:now,report});
  service.pushInbox(team,{id:'archive-mail',type:'matchweek',title:'跨日归档战报',matchId:'archive-ui',payload:{results:[],next:{competitionName:'友谊赛',name:'测试对手',venue:'home',weather:null,referee:null}}});
  service.archiveSeason('inbox-ui-test');service.state.matches=[];
  service.pushInbox(team,{id:'missing-mail',type:'matchweek',title:'已清理的历史战报',matchId:'gone-match',payload:{results:[]}});
  service.save({skipDailyBackup:true});
  await start();
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],readChunks=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message);});
  page.on('request',request=>{if(request.url().endsWith('/inbox/read-batch'))readChunks.push(request.postDataJSON().messageIds.length);});
  await page.addInitScript(a=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(a));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:a.profile.id,mode:'league',leagueTab:'inbox'}));},account);
  await page.goto(server.url+'/versus/');await page.locator('.league-inbox').waitFor();
  let detailRequests=0;page.on('request',r=>{if(r.url().endsWith('/inbox/detail'))detailRequests++;});
  await page.locator('[data-league-inbox-message]').first().waitFor();
  assert.equal(await page.locator('[data-league-inbox-message]').count(),25);assert.equal(detailRequests,0);
  const boot=(await post('/league',identity)).league;assert.equal(boot.inbox,undefined);assert.equal(boot.inboxMeta.counts.action,250);
  const list=(await post('/league/inbox/list',identity)).inboxPage;
  assert.equal(list.messages.length,25);assert.ok(list.messages.every(m=>!('body' in m)&&!('payload' in m)&&!('report' in m)));
  await page.locator('[data-league-inbox-category="action"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.league-mail-item.needs-action').length===25&&!document.querySelector('[data-inbox-page="next"]').disabled);
  const firstIds=await page.locator('[data-league-inbox-message]').evaluateAll(nodes=>nodes.map(n=>n.dataset.leagueInboxMessage));
  await page.locator('[data-inbox-page="next"]').click();
  await page.waitForFunction(first=>document.querySelector('[data-league-inbox-message]')?.dataset.leagueInboxMessage!==first,firstIds[0]);
  const secondIds=await page.locator('[data-league-inbox-message]').evaluateAll(nodes=>nodes.map(n=>n.dataset.leagueInboxMessage));
  assert.ok(secondIds.every(id=>!firstIds.includes(id)));
  await page.locator('[data-inbox-page="previous"]').click();
  await page.waitForFunction(first=>document.querySelector('[data-league-inbox-message]')?.dataset.leagueInboxMessage===first,firstIds[0]);
  const receiptPromise=page.waitForResponse(r=>r.url().endsWith('/inbox/apply-selection'));
  await page.locator('[data-league-inbox-read-batch]').click();
  const receipt=await (await receiptPromise).json();assert.equal(receipt.inboxMutation.changed,250);assert.equal(receipt.league,undefined);
  await page.waitForFunction(()=>document.querySelectorAll('.league-mail-item.unread').length===0);
  assert.equal((await post('/league/inbox/list',{...identity,category:'action'})).inboxPage.meta.unread.action,0);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/paged-desktop.png'});
  const open=async id=>{await page.locator(`[data-league-inbox-message="${id}"]`).click();await page.locator('.league-mail-reader>header').waitFor();};
  await page.locator('[data-league-inbox-category="rewards"]').click();await open('comp-ui');
  assert.match(await page.locator('.league-mail-reader').innerText(),/已取消/);assert.equal(await page.locator('[data-enhancement-trait]').count(),0);
  await open('reward-ui');
  await page.waitForFunction(()=>!document.querySelector('[data-league-inbox-message="reward-ui"]')?.classList.contains('unread'));
  await page.locator('[data-league-inbox-delete-batch="read"]').click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-league-inbox-message="reward-ui"]'));
  const finalView=(await post('/league',identity)).league;assert.equal(finalView.inboxMeta.counts.action,250);assert.deepEqual(finalView.s4Packs.inventory.map(p=>p.id),packages);
  await page.locator('[data-league-inbox-category="announcements"]').click();
  await page.route('**/inbox/detail',route=>route.abort('failed'));
  await page.locator('[data-league-inbox-message="notice-ui"]').click();await page.locator('[data-inbox-detail-retry]').waitFor();
  await page.unroute('**/inbox/detail');await page.locator('[data-inbox-detail-retry]').click();await page.locator('.league-mail-reader>header').waitFor();
  assert.match(await page.locator('.league-mail-reader').innerText(),/更新后的公告/);
  await page.locator('[data-league-inbox-category="competition"]').click();
  // Keyset traversal locates retained historical messages beyond the first page.
  const locate=async id=>{for(let i=0;i<20;i++){if(await page.locator(`[data-league-inbox-message="${id}"]`).count())return;
    const next=page.locator('[data-inbox-page="next"]');await page.waitForFunction(()=>!document.querySelector('[data-inbox-page="refresh"]').disabled);if(await next.isDisabled())break;
    const old=await page.locator('[data-league-inbox-message]').first().getAttribute('data-league-inbox-message');await next.click();
    await page.waitForFunction(old=>document.querySelector('[data-league-inbox-message]')?.dataset.leagueInboxMessage!==old,old);
  }throw new Error('mail not found '+id);};
  const competitionFirst=(await post('/league/inbox/list',{...identity,category:'competition'})).inboxPage.messages[0].id;
  await page.waitForFunction(id=>document.querySelector('[data-league-inbox-message]')?.dataset.leagueInboxMessage===id,competitionFirst);
  await locate('accepted-mail');await open('accepted-mail');
  assert.match(await page.locator('.league-mail-reader').innerText(),/已接受并排期/);assert.doesNotMatch(await page.locator('.league-mail-reader').innerText(),/已超时/);
  await page.locator('[data-inbox-page="refresh"]').click();
  await page.waitForFunction(id=>document.querySelector('[data-league-inbox-message]')?.dataset.leagueInboxMessage===id,competitionFirst);
  await locate('archive-mail');await open('archive-mail');
  await page.getByRole('button',{name:'查看归档战报',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#league-dialog-overlay')?.textContent.includes('历史主队'));
  await page.screenshot({path:out+'/archive-detail.png'});
  await page.locator('#league-dialog-overlay [data-close-league-dialog]').first().click();
  await page.setViewportSize({width:390,height:844});await page.locator('[data-inbox-page="next"]').scrollIntoViewIfNeeded();await page.waitForTimeout(350);await page.locator('.toast.show').waitFor({state:'hidden',timeout:10000});await page.screenshot({path:out+'/paged-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  const result={pageSize:25,summaryOnly:true,detailsOnDemand:true,globalPendingCount:250,bulkReadAcrossPages:250,noOverlappingPages:true,retryDetailAfterNetworkFailure:true,compactDelete:true,rewardPackagesPreserved:2,validPendingPreserved:250,archivedDetail:true,acceptedInvitationAfterDeadline:true,mobileNoOverflow:true,pageErrors:errors};
  fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  await browser?.close();await server?.stop();
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-inbox-ui-'));
  fs.rmSync(dir,{recursive:true,force:true});
}
