import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {openScheduledPreviewHost} from '../versus/v4-host/scheduled-preview-host.js';
import {dependencyHashes} from './v4-source-hashes.mjs';

const output=path.resolve('outputs/v4-cup-lifecycle-20261118'),sandbox=fs.mkdtempSync(path.join(output,'browser-'));
for(const [key,name] of Object.entries({VERSUS_ACCOUNTS_PATH:'accounts.json',YELLOWDOGS_LEAGUE_PATH:'league.json',YDL_CONTENT_OVERRIDES_PATH:'content.json',YDL_PLAYER_CARD_STUDIO_PATH:'studio.json',YDL_PLAYER_PROFILE_ROOT:'profiles'}))process.env[key]=path.join(sandbox,name);
const {VersusRoomService}=await import('../versus/room-service.js'),rooms=new VersusRoomService({accountsPath:process.env.VERSUS_ACCOUNTS_PATH,lineups:new Map()}),home=rooms.bindAccount('cup-preview-home'),spectator=rooms.bindAccount('cup-preview-watch');
const proof=JSON.parse(fs.readFileSync(path.join(output,'verification.json'),'utf8')),root=path.join(proof.root,'json'),state=JSON.parse(fs.readFileSync(path.join(root,'league.json'),'utf8')),rounds=Object.values(state.v4LocalCupEvents.events);
const fixtures=rounds.flatMap(round=>round.tasks.map(task=>({round,task,record:state.matches.find(match=>match.id===round.settled[task.fixture.id].matchId)})));
const selected=[fixtures.find(item=>item.round.event.leg===2),fixtures.find(item=>item.round.event.stage==='final')],shootout=fixtures.find(item=>item.record.penalties);
if(shootout&&!selected.some(item=>item.task.fixture.id===shootout.task.fixture.id))selected.push(shootout);
assert.ok(selected.every(Boolean));
const league={state:{teams:state.teams.map(team=>({id:team.id,ownerId:null}))}};let now=selected[0].round.startedAt;
const host=await openScheduledPreviewHost({root,rooms,league,enabled:true,now:()=>now});
for(const round of rounds){const tasks=selected.filter(item=>item.round.key===round.key).map(item=>item.task);if(tasks.length)host.registerRound({...round,tasks},{publicWatch:true});}
const server=http.createServer(async(req,res)=>{if(!await host.handle(req,res)){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`,packagePath=process.env.PLAYWRIGHT_PACKAGE_PATH??'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json',chromium=createRequire(packagePath)('playwright').chromium;
const entries=['scripts/verify-v4-cup-browser.mjs','versus/v4-host/public/index.html','versus/v4-host/public/app.js','versus/v4-host/public/style.css'],sources=dependencyHashes(entries),errors=[],checked=[];let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const [index,{round,task,record}] of selected.entries()){
    const id=task.fixture.id,manifest=JSON.parse(fs.readFileSync(path.join(root,'cup-queue-'+round.key,'jobs',id,'archive','manifest.json'),'utf8')),end=manifest.segments.at(-1).through;
    league.state.teams.forEach(team=>team.ownerId=team.id===task.envelope.input.teams[0].id?home.profile.id:null);now=round.startedAt;
    await page.goto(base+`/v4-preview/?match=${id}`);await page.evaluate(account=>localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account)),home);await page.reload();await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.locator('#score').innerText(),'— : —');assert.equal(await page.locator('#decision').innerText(),'');assert.equal(await page.locator('#aggregate').innerText(),'');
    now=round.startedAt+Math.max(7200000,Math.ceil(end*1000/round.releaseRate)+1000);await page.waitForFunction(end=>Number(document.querySelector('#timeline').max)>=end,end);
    await page.locator('#timeline').fill(String(end));await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('已结束'));assert.equal(await page.locator('#score').innerText(),record.score.join(' : '));
    if(round.event.leg===2)assert.equal(await page.locator('#aggregate').innerText(),'总比分 '+record.score.map((n,side)=>n+task.envelope.input.competition.aggregate[side]).join(' : '));
    if(record.penalties)assert.equal(await page.locator('#shootout').innerText(),'点球 '+record.penalties.join(' : '));
    assert.match(await page.locator('#decision').innerText(),round.event.stage==='final'?/夺冠/:/晋级/);
    await page.screenshot({path:path.join(sandbox,`desktop-${index}.png`),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(sandbox,`mobile-${index}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1400,height:1000});
    await page.locator('#timeline').fill('0');await page.waitForFunction(()=>Number(document.body.dataset.time)<1);assert.equal(await page.locator('#decision').innerText(),'');assert.equal(await page.locator('#shootout').innerText(),'');
    await page.selectOption('#speed','64');await page.uncheck('#slow');await page.click('#play');await page.waitForFunction(()=>Number(document.body.dataset.time)>30);await page.click('#play');
    const key='0:'+task.envelope.input.teams[0].players[0].id;await page.selectOption('#player',key);assert.match(await page.locator('#task').innerText(),/体能/);
    await page.evaluate(account=>localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account)),spectator);await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#player option').length>1);await page.selectOption('#player',key);assert.match(await page.locator('#task').innerText(),/公开位置/);
    checked.push({matchId:id,eventId:round.eventId,aggregate:round.event.leg===2,shootout:Boolean(record.penalties),final:round.event.stage==='final',rewindHidesWinner:true});
  }
  rooms.accounts.get(spectator.profile.id.toLowerCase()).loginCooldownUntil=Date.now()+60000;await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('无权'));assert.equal(await page.locator('#decision').innerText(),'');assert.equal(await page.locator('#events button').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(dependencyHashes(entries),sources);
  const report={passed:true,scope:'Actual isolated-account browser viewing full real cup archives; second-leg aggregate, final winner, shootout when present, mobile, owner/public privacy, rewind and revocation.',sandbox,checked,desktop:true,mobile:true,revocationClearsView:true,shootoutAvailable:Boolean(shootout),dependencyHashes:sources};fs.writeFileSync(path.join(output,'browser-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,sandbox,checked}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rooms.accountRepository.flush?.();}
