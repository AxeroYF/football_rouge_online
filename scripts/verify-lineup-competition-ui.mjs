import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {startLocalServer} from '../test/helpers/local-server.js';
const require=createRequire('C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out='outputs/lineup-competition-ui-20261117';fs.mkdirSync(out,{recursive:true});
const server=await startLocalServer({publicOnly:false});let browser;
try{
  const post=async(path,body)=>{const r=await fetch(server.url+'/api/versus'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.ok(r.ok&&j.ok!==false,JSON.stringify(j));return j;};
  const account=await post('/register',{nickname:'赛前红线验证',password:'isolated-only'});
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/league/draft/start',{...identity,teamName:'轮换验证队'});await post('/league/draft/auto',identity);await post('/league/draft/finish',identity);
  await post('/league/team/lineup-scheme',{...identity,action:'create',name:'杯赛方案'});
  await post('/league/team/lineup-scheme',{...identity,action:'assign',lineupSchemeId:'lineup-2',competition:'cup'});
  await post('/league/team/lineup-scheme',{...identity,action:'create',name:'备用方案'});
  await post('/league/team/lineup-scheme',{...identity,action:'select',lineupSchemeId:'lineup-1'});
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:2560,height:1440}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(account=>{localStorage.setItem('football_test1_versus_account_v1',JSON.stringify(account));sessionStorage.setItem('football_test1_versus_browser_session_v1','1');localStorage.setItem('football_test1_versus_view_v1',JSON.stringify({playerId:account.profile.id,mode:'league',leagueTab:'squad'}));},account);
  let statePlayerIds=[],bondFixture=false,wildcardName='';
  await page.route('**/api/versus/**',async route=>{
    const response=await route.fetch();
    let value;try{value=await response.json();}catch{await route.fulfill({response});return;}
    if(value.league?.ownTeam?.roster){
      const l=value.league,roster=l.ownTeam.roster;statePlayerIds=roster.slice(0,3).map(p=>p.id);
      if(bondFixture){
        const starters=roster.filter(p=>p.starter);
        assert.equal(starters.length,11);
        for(const p of roster){
          const i=starters.indexOf(p);
          p.club=i>=0&&i<6?'巴塞罗那':'其他';p.nationality=i>=0&&i<4?'西班牙':'其他';
          p.heightCm=p.effectiveHeightCm=180; p.traits=[];for(const card of p.cards??[])card.traits=[];
          if(i===6){p.traits=['lone-finisher'];wildcardName=p.name;}
        }
      }
      for(const p of roster){p.state={...p.state,injuryRounds:0,suspension:0,cupSuspension:0,seasonFinalBanned:false,seasonFinalSuspension:0};}
      roster[0].state.cupSuspension=2;roster[1].state.suspension=1;roster[2].state.seasonFinalBanned=true;
      l.season.status='active';l.report??={};
      l.report.nextOpponent={competition:'cup',competitionName:'黄狗冠军杯',label:'第一回合',status:'scheduled',startsAt:Date.now()+3600000,name:'验证对手'};
    }
    await route.fulfill({response,json:value});
  });
  await page.goto(server.url+'/versus/');
  const binding=page.locator('[data-lineup-scheme-assignment]');
  const scheme=page.locator('[data-lineup-scheme-select]');
  const assigned=competition=>binding.locator(`option[value="${competition}"]`).textContent();
  await binding.waitFor();assert.equal(await binding.count(),1);
  for(const selector of ['[data-league-magnet]','[data-league-bench-magnet]']){
    const magnet=page.locator(selector).first();
    await magnet.hover();
    const tooltip=page.getByRole('tooltip');
    await tooltip.locator('.lmt-name-row').waitFor();
    assert.ok(await tooltip.locator('.lmt-stat').count()>=4);
    assert.ok(await tooltip.locator('.lmt-status').innerText());
    assert.equal(await tooltip.locator('.lmt-name-row>b').innerText(),JSON.parse(await magnet.getAttribute('data-tooltip-card')).name);
    if(selector==='[data-league-magnet]')await tooltip.screenshot({path:out+'/player-tooltip.png'});
    await page.keyboard.press('Escape');await tooltip.waitFor({state:'detached'});
  }
  assert.match(await assigned('cup'),/杯赛方案/);
  const next=page.locator('[data-next-lineup-scheme]');assert.match(await next.innerText(),/杯赛方案/);
  const act=async action=>{
    const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/league/team/lineup-scheme'));
    await action();const r=await response;assert.ok(r.ok(),await r.text());
    await page.waitForFunction(()=>!document.querySelector('[data-lineup-scheme-assignment]').disabled);
  };
  const magnet=id=>page.locator(`[data-league-magnet="${id}"], [data-league-bench-magnet="${id}"]`);
  await page.locator('[data-lineup-availability]').selectOption('cup');
  assert.match(await magnet(statePlayerIds[0]).getAttribute('class'),/unavailable/);
  assert.doesNotMatch(await magnet(statePlayerIds[1]).getAttribute('class'),/unavailable/);
  assert.doesNotMatch(await magnet(statePlayerIds[2]).getAttribute('class'),/unavailable/);
  await page.locator('[data-lineup-availability]').selectOption('league');
  assert.doesNotMatch(await magnet(statePlayerIds[0]).getAttribute('class'),/unavailable/);
  assert.match(await magnet(statePlayerIds[1]).getAttribute('class'),/unavailable/);
  await page.locator('[data-lineup-availability]').selectOption('friendly');
  assert.doesNotMatch(await magnet(statePlayerIds[1]).getAttribute('class'),/unavailable/);
  await page.getByRole('spinbutton',{name:'赛前体力红线'}).fill('72');
  await act(()=>scheme.selectOption('lineup-3'));
  await act(()=>binding.selectOption('league'));
  assert.match(await assigned('cup'),/杯赛方案/);
  await act(()=>scheme.selectOption('lineup-1'));
  await act(()=>binding.selectOption('all'));
  assert.match(await next.innerText(),/方案 1/);
  await act(()=>scheme.selectOption('lineup-3'));
  await act(()=>binding.selectOption('friendly'));
  assert.match(await assigned('cup'),/方案 1/);
  await act(()=>scheme.selectOption('lineup-2'));
  await act(()=>binding.selectOption('cup'));
  await page.locator('[data-lineup-scheme-delete]').click();
  assert.match(await page.locator('.league-dialog').innerText(),/杯赛将使用/);
  await act(()=>page.getByRole('button',{name:'删除方案',exact:true}).click());
  assert.match(await assigned('cup'),/方案 1/);assert.match(await assigned('friendly'),/备用方案/);
  await page.reload();await binding.waitFor();
  assert.equal(await page.getByRole('spinbutton',{name:'赛前体力红线'}).inputValue(),'72');
  assert.match(await assigned('cup'),/方案 1/);assert.match(await assigned('friendly'),/备用方案/);
  const controls=page.locator('.league-lineup-scheme-switcher');
  bondFixture=true;await page.reload();await binding.waitFor();
  const board=page.locator('.league-board-heading');
  const style=page.locator('#opening-principle-possessionStyle');
  await style.selectOption('possession');
  const badge=name=>board.getByRole('button',{name:new RegExp('^'+name+' ·')});
  const tooltip=page.locator('#league-bond-hover-card[role="tooltip"]');
  async function inspect(name){
    await badge(name).hover();
    await tooltip.waitFor();
    return tooltip.innerText();
  }
  assert.match(await inspect('巴塞罗那'),/7人档/);
  assert.equal(await tooltip.locator('.lmt-status').textContent(),'生效');
  assert.ok((await tooltip.innerText()).includes(wildcardName+'（变色龙）'));
  assert.deepEqual(await tooltip.locator('.lmt-stat').allTextContents(),['传球+5','停球+4']);
  assert.match(await inspect('西班牙'),/5人档/);
  await style.selectOption('vertical');
  assert.equal(await badge('巴塞罗那').count(),0);
  await page.keyboard.press('Escape');
  await tooltip.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('[data-league-autosave-status]')?.dataset.state==='saved');
  await page.reload();await binding.waitFor();
  assert.equal(await board.locator('[data-bond-slot]').count(),0);assert.equal(await style.inputValue(),'vertical');
  await style.selectOption('possession');assert.match(await inspect('巴塞罗那'),/7人档/);
  await controls.screenshot({path:out+'/desktop.png'});
  await page.setViewportSize({width:390,height:844});
  const box=await binding.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390);
  assert.equal(await controls.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await controls.screenshot({path:out+'/mobile.png'});
  await page.evaluate(()=>document.documentElement.dataset.leagueTheme='light');
  await badge('巴塞罗那').click();
  await tooltip.waitFor();
  const tipBox=await tooltip.boundingBox();
  assert.ok(tipBox.x>=0&&tipBox.x+tipBox.width<=390);
  assert.equal(await tooltip.locator('.lmt-card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  await controls.screenshot({path:out+'/mobile-light.png'});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/verification.json',JSON.stringify({passed:true,bindings:3,independentAssignments:true,assignAll:true,deleteFallback:true,reload:true,statusPreview:true,nextScheme:true,mobileNoOverflow:true,errors,rosterStatusFixtures:true,bondTiers:[7,5],automaticBonds:true,wildcardName},null,2));
  console.log('PASS: competition schemes, mobile layout, bond tiers, wildcard recipients, style changes and automatic activation.');
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}
finally{await browser?.close();await server.stop();}
