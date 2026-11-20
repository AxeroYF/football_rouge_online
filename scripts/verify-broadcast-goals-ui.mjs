import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {startLocalServer} from '../test/helpers/local-server.js';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {publicFrame,publicEvent,encodeFrames} from '../versus/v4-stream/codec.js';
import {createBroadcastSummary} from '../versus/v4-host/broadcast-summary.js';

const match = createMatch(demoInput({seed:'broadcast-goals-ui',duration:5400}),{frameInterval:1});
while(!match.events.some(e=>e.type==='goal') && match.state.phase!=='finished') advanceMatch(match,100);
const goal = match.events.find(e=>e.type==='goal');
assert.ok(goal);
advanceMatch(match,20);
const frames = match.frames.map(f=>publicFrame(f)), events = match.events.map(e=>publicEvent(e)).filter(Boolean);
const release = time => ({
  frames:encodeFrames(frames.filter(f=>f.time>time[0] && f.time<=time[1])),
  events:events.filter(e=>e.time>time[0] && e.time<=time[1]),
});
const id='broadcast-goals-ui', summary=createBroadcastSummary(match.state.input);
const slices=[[-1,goal.time-3],[goal.time-3,goal.time],[goal.time,goal.time+3]];
const packets=slices.map(release), snapshots=[];
for(let n=1;n<=packets.length;n++){
  const value=await summary({read:i=>packets[i]},{matchId:id,segments:slices.slice(0,n),complete:false});
  snapshots.push(structuredClone(value));
}
assert.deepEqual(snapshots.map(b=>b.match.keyPlays.length),[0,0,1]);
const scorerId='v4-'+goal.id;
const server=await startLocalServer({publicOnly:false});
let browser;
try {
  const post=async(route,body)=>(await fetch(server.url+'/api/versus'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  const account=await post('/register',{nickname:'战况回放验证',password:'isolated-goal-test'});
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/league/draft/start',{...identity,teamName:'回放测试队'});await post('/league/draft/auto',identity);await post('/league/draft/finish',identity);
  const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_PATH??'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
  browser=await require('playwright').chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:2560,height:1440},reducedMotion:'no-preference'}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(account=>{
    localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));
    sessionStorage.setItem('football_test1_versus_browser_session_v1','1');
    localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'television'}));
  },account);
  let otherTeams=[];
  await page.route('**/api/versus/**',async route=>{
    const response=await route.fetch();
    let value;try{value=await response.json();}catch{return route.fulfill({response});}
    if(value.league?.schedule?.fixtures?.length){
      const league=value.league;
      Object.assign(league.schedule.fixtures[0],{status:'live',v4MatchId:id});
      otherTeams=league.teams.filter(t=>t.id!==league.ownTeam.id).slice(0,2);
    }
    if(Array.isArray(value.broadcasts)&&otherTeams.length===2){
      value.broadcasts.push({code:'YDL-ui-2',teams:otherTeams,score:[2,0],minute:35});
    }
    await route.fulfill({response,json:value});
  });
  let stage=0;
  // Hold release time so polling, late frames, a long feed and a manual replay are deterministic.
  const routine=Array.from({length:130},(_,i)=>({id:'scroll-'+i,type:'pass',minute:12.75,text:'中场传递 '+i,teamIndex:i%2}));
  await page.route('**/v4/matches/'+id+'/**',async route=>{
    const value=structuredClone(snapshots[stage]);
    value.match.events.unshift(...routine);
    await route.fulfill({json:route.request().url().endsWith('/scoreboard')?{score:value.match.score,minute:value.match.minute}:value});
  });
  await page.goto(server.url+'/versus/');
  const ownCard=page.locator('.broadcast-card.is-own-live'), otherCard=page.locator('[data-watch-room="YDL-ui-2"]');
  for(const width of [1500,390]){
    await page.setViewportSize({width,height:960});
    for(const card of [ownCard,otherCard]){
      await card.waitFor();
      const crest=card.locator('.tv-crest').first();
      assert.ok(await crest.evaluate(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(el).borderTopWidth==='0px'));
      assert.ok((await crest.boundingBox()).height>=56);
      assert.ok(await card.locator('.tv-card-score strong').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=40));
      assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    }
  }
  await page.locator('[data-watch-v4="'+id+'"]').first().click();
  const feed=page.locator('#broadcast-overlay .event-feed'), panel=page.locator('#broadcast-overlay .broadcast-v2-commentary');
  await feed.waitFor();
  const magnet=page.locator('.s4-broadcast-magnet').first();
  await magnet.hover();
  const tip=page.locator('#league-player-hover-card .lmt-card');
  await tip.waitFor();
  const playerId=await magnet.getAttribute('data-motion-player');
  const source=match.state.input.teams.flatMap(team=>team.players).find(p=>p.id===playerId);
  assert.ok(source.heightCm>0);
  assert.ok((await tip.innerText()).includes(source.heightCm+'cm'));
  assert.equal(await magnet.getAttribute('title'),null);
  await page.keyboard.press('Escape');
  assert.equal(await feed.locator('[data-render-key="scroll-0"] summary>b').textContent(),"12'");
  for(const width of [2560,1440,1024,390,2560]){
    await page.setViewportSize({width,height:width<500?844:1440});
    if(width>=821){
      const field=await page.locator('.broadcast-v2-field-column').boundingBox(), right=await panel.boundingBox();
      assert.ok(Math.abs(field.y-right.y)<1 && Math.abs(field.height-right.height)<1,'aligned pitch and commentary at '+width+': '+field.height+' / '+right.height);
    }
    assert.ok(await feed.evaluate(n=>n.clientHeight>0 && n.scrollHeight>n.clientHeight && getComputedStyle(n).overflowY==='auto'),'scrolling feed at '+width);
    for(const tab of ['details','overview']){
      await page.locator('[data-broadcast-data-tab="'+tab+'"]').click();
      const margins=await page.locator('.broadcast-data-row').first().evaluate(row=>{
        const r=row.getBoundingClientRect(), nums=row.querySelectorAll('b');
        return [nums[0].getBoundingClientRect().left-r.left,r.right-nums[1].getBoundingClientRect().right];
      });
      assert.ok(margins.every(gap=>gap>=12) && Math.abs(margins[0]-margins[1])<1,'comparison insets at '+width+': '+margins);
      assert.ok(await page.locator('.broadcast-data-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    }
  }
  const height=(await panel.boundingBox()).height;
  await mkdir('outputs/broadcast-goals-ui',{recursive:true});
  await page.locator('#broadcast-overlay .broadcast-data').screenshot({path:'outputs/broadcast-goals-ui/data-2k.png'});
  await feed.evaluate(n=>{n.scrollTop=600;});
  const anchor=await feed.evaluate(n=>[...n.children].find(el=>el.getBoundingClientRect().bottom>n.getBoundingClientRect().top+2)?.textContent);
  stage=1;
  await feed.getByText(snapshots[1].match.events.find(e=>e.id===scorerId).text,{exact:true}).first().waitFor({state:'attached'});
  assert.equal(await feed.locator('[data-live-replay]').count(),0);
  assert.equal((await panel.boundingBox()).height,height);
  assert.equal(await feed.evaluate(n=>[...n.children].find(el=>el.getBoundingClientRect().bottom>n.getBoundingClientRect().top+2)?.textContent),anchor);
  stage=2;
  const ball=page.locator('[data-kp-ball]');
  await ball.waitFor({state:'visible'});
  const changed=async()=>page.waitForFunction(()=>{
    const ball=document.querySelector('[data-kp-ball]');
    const progress=parseFloat(document.querySelector('[data-kp-progress]')?.style.width);
    if(!ball?.hasAttribute('cx') || progress>25)return false;
    const xy=ball.getAttribute('cx')+','+ball.getAttribute('cy');
    if(!ball.dataset.first){ball.dataset.first=xy;return false;}
    return xy!==ball.dataset.first;
  },null,{timeout:1800});
  await changed();
  const expectedMinute=String(Math.floor(snapshots[2].match.events.find(e=>e.id===scorerId).minute));
  const archiveReplay=page.locator('[data-kp-replay="'+scorerId+'"]');
  assert.ok((await archiveReplay.innerText()).startsWith(expectedMinute+'′'));
  assert.ok((await page.locator('.key-play-caption>span').innerText()).startsWith(expectedMinute+'′'));
  await page.locator('[data-kp-celebration].is-visible').waitFor();
  assert.ok((await page.locator('.key-play-goal-score').innerText()).startsWith(expectedMinute+'′'));
  await page.locator('[data-kp-stop]').click();
  const replay=feed.locator('[data-live-replay]');
  assert.equal(await replay.count(),1);assert.equal(await replay.getAttribute('data-live-replay'),scorerId);
  await replay.click();await ball.waitFor();await changed();
  await page.locator('[data-kp-stop]').click();
  await page.locator('[data-kp-view="plays"]').click();
  await archiveReplay.click();await changed();
  assert.deepEqual(errors,[]);
  console.log('PASS: released V4 goal autoplay, moving ball, celebration and manual replay; bounded scroll and stable reading position at 390–2560 px.');
}finally{await browser?.close();await server.stop();}
