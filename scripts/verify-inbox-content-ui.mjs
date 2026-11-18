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
const out='outputs/inbox-content-ui-20261117';fs.mkdirSync(out,{recursive:true});
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
  service.state.season.startedAt=now;
  const player=team.rosterIds[0];team.playerState[player].injuryRounds=2;team.playerState[player].cupSuspension=1;
  const match={id:'settlement-ui',competition:'league',round:1,homeId:team.id,awayId:other.id,homeName:team.name,awayName:other.name,score:[2,1],playedAt:now,autoRotations:[[{outName:'轮休队员',inName:'替补队员',reason:'体能不足'}],[]]};
  service.state.matches.push(match);
  service.nextOpponent=()=>({name:'皇家马德里',competition:'cup',competitionName:'杯赛',label:'八分之一决赛 · 第1回合',venue:'away',startsAt:now+3600000});
  service.payRewards(1);service.createRoundInbox(1);service.updateDailyReports();
  const settlement=service.inbox(team).find(m=>m.matchId===match.id),daily=service.inbox(team).find(m=>m.type==='daily-report');
  for(let i=0;i<4;i++)service.pushActivityInbox(team,{id:`activity-${i}`,type:i===3?'friendly':'announcement',summary:i===3?'曼城 vs 阿森纳，19:00开赛。':`玩家${i+1}将罗纳尔迪尼奥强化至+6。`});
  const digest=service.inbox(team).find(m=>m.type==='activity-digest');
  service.pushInbox(team,{id:'card-ui',type:'reward',title:'球员卡已到账',summary:'1张球员卡',body:'球员卡已放入背包。',payload:{cardIds:['ui-card']}});
  service.pushInbox(team,{id:'admin-ui',type:'admin-update',title:'管理员公告',summary:'规则调整',body:'第一条规则。\n第二条规则。'});
  service.save({skipDailyBackup:true});
  await start();
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],readChunks=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error('PAGEERROR',error.message);});
  page.on('request',request=>{if(request.url().endsWith('/inbox/read-batch'))readChunks.push(request.postDataJSON().messageIds.length);});
  await page.addInitScript(a=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(a));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:a.profile.id,mode:'league',leagueTab:'inbox'}));},account);
  await page.goto(server.url+'/versus/');await page.locator('.league-inbox').waitFor();
  const inbox=async()=>{if(!await page.locator('.league-nav [data-league-tab="inbox"]').isVisible()) {const box=await page.locator('.league-sidebar-handle').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);}await page.locator('.league-nav [data-league-tab="inbox"]').click();};
  const mail=async id=>{await page.locator(`[data-league-inbox-message="${id}"]`).click();await page.locator(".league-mail-reader>header").waitFor();};
  await mail(settlement.id);
  const reader=page.locator('.league-mail-reader');
  assert.match(await reader.innerText(),/已自动到账/);assert.match(await reader.innerText(),/杯赛停赛1场/);
  assert.equal(await reader.locator('details[open]').count(),0);
  await reader.locator('summary').filter({hasText:'赛前轮换'}).click();
  assert.match(await reader.innerText(),/轮休队员 → 替补队员/);
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(350);
  await page.screenshot({path:out+'/match-desktop.png'});
  await reader.locator('[data-inbox-nav="packs"]').click();
  assert.ok(await page.locator('[data-backpack-page="packs"]').count());
  assert.equal(await page.locator('.league-mail-reader').count(),0);
  await inbox();await mail('card-ui');
  await page.locator('[data-inbox-nav="cards"]').click();
  assert.match(await page.locator('[data-backpack-page="cards"]').getAttribute('class'),/active/);
  await inbox();await mail(daily.id);
  assert.match(await reader.innerText(),/今日战绩/);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(350);await page.screenshot({path:out+'/daily-desktop.png'});
  await mail(digest.id);assert.equal(await reader.locator('.mail-activity-list li').count(),4);
  await reader.locator('[data-inbox-nav="television"]').click();
  assert.equal(await page.locator('.league-mail-reader').count(),0);
  await inbox();await mail(settlement.id);
  await reader.locator('[data-inbox-nav="squad"]').click();
  assert.equal(await page.locator('.league-mail-reader').count(),0);
  await inbox();await mail(settlement.id);
  await reader.locator('[data-inbox-nav="schedule"]').click();
  assert.equal(await page.locator('.league-mail-reader').count(),0);
  await inbox();await mail(settlement.id);
  await page.setViewportSize({width:390,height:844});
  await reader.scrollIntoViewIfNeeded();await page.waitForTimeout(350);await page.screenshot({path:out+'/match-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile has horizontal overflow');
  assert.ok(await reader.locator('[data-inbox-nav="packs"]').isVisible());
  await page.setViewportSize({width:1500,height:1000});await mail(digest.id);
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(350);
  await page.screenshot({path:out+'/digest-desktop.png'});
  assert.deepEqual(errors,[]);
  const result={functionalOnly:true,oneSettlement:true,automaticRewardVisible:true,cupAvailability:true,rotationExpand:true,packAndCardRoutes:true,tacticsAndScheduleRoutes:true,dailySummary:true,digest:true,mobileNoOverflow:true,pageErrors:errors};
  fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  await browser?.close();await server?.stop();
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-inbox-ui-'));
  fs.rmSync(dir,{recursive:true,force:true});
}
