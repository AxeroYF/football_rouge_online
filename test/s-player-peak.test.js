import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ATTRIBUTE_NAMES,playerOverallFromAttributes} from '../shared/football/schema.js';
import {applyS4Enhancement,s4EnhancementAbilityBonus,s4BaseCardReferenceValue,s4OwnershipReferenceValue} from '../versus/s4-balance.js';
import {startLocalServer} from './helpers/local-server.js';
const historical=JSON.parse(fs.readFileSync(new URL('../data/player-balance-s-peak-20261116.json',import.meta.url),'utf8'));
const latest=JSON.parse(fs.readFileSync(new URL('../data/player-balance-s-final-20261116.json',import.meta.url),'utf8'));
const firstBatchIds=new Set(historical.players.map(p=>p.id));
const ledger={players:latest.players.filter(p=>firstBatchIds.has(p.id))};
const livePath=new URL('../data/ydl-content-overrides.json',import.meta.url),bytes=fs.readFileSync(livePath);
const digest=b=>createHash('sha256').update(b).digest('hex'),liveHash=digest(bytes);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-s-peak-')),content=path.join(dir,'content.json');fs.writeFileSync(content,bytes);
process.env.YDL_CONTENT_OVERRIDES_PATH=content;process.env.YDL_PLAYER_CARD_STUDIO_PATH=path.join(dir,'studio.json');
const {REAL_PLAYERS,REAL_PLAYER_BY_ID}=await import('../versus/player-pool.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const byName=n=>REAL_PLAYERS.find(p=>p.name===n);
test.after(()=>{assert.equal(digest(fs.readFileSync(livePath)),liveHash);assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-s-peak-'));fs.rmSync(dir,{recursive:true,force:true});});

test('18 peak profiles retain their characteristics after the approved overall revision',()=>{
  assert.equal(ledger.players.length,18);assert.equal(new Set(ledger.players.map(p=>p.id)).size,18);
  for(const row of ledger.players){const p=REAL_PLAYER_BY_ID[row.id];assert.deepEqual(p.attributes,row.after,p.name);assert.equal(p.overall,row.overall);assert.equal(playerOverallFromAttributes(p.attributes,p.role),row.overall);
    for(const k of ['grade','role','secondaryRole','nationality','club'])assert.equal(p[k],row[k]);
    assert.equal(s4BaseCardReferenceValue(p),row.referencePrices.cardAfter);assert.equal(s4OwnershipReferenceValue(p),row.referencePrices.ownershipAfter);
    for(const level of [0,4,8]){const upgraded=applyS4Enhancement(p,level),bonus=s4EnhancementAbilityBonus(level);assert.equal(upgraded.overall,row.overall+bonus);for(const k of ATTRIBUTE_NAMES)assert.equal(upgraded.attributes[k],Math.min(99,row.after[k]+bonus));}
  }
});
test('peak roles have meaningful distinctions in their actual responsibilities',()=>{
  const a=n=>byName(n).attributes;
  assert.ok(a('贝肯鲍尔').dribbling>=85&&a('贝肯鲍尔').passing>=90);
  assert.ok(a('罗伯特卡洛斯').longShots>=90&&a('罗伯特卡洛斯').setPieces>=90);
  assert.ok(a('古利特').heading>=90&&a('古利特').strength>=90);
  assert.ok(a('加图索').tackling>a('迪迪').tackling&&a('加图索').passing<a('迪迪').passing);
  assert.ok(a('亚亚图雷').finishing>a('加图索').finishing);
  assert.ok(a('内斯塔').marking>a('普约尔').marking&&a('内斯塔').discipline>a('普约尔').discipline&&a('内斯塔').acceleration<a('普约尔').acceleration);
  assert.ok(a('卡西利亚斯').reflexes>a('卡恩').reflexes&&a('卡西利亚斯').agility>a('卡恩').agility&&a('卡西利亚斯').goalkeeping<a('卡恩').goalkeeping);
  assert.ok(a('亨利').dribbling>a('尤西比奥').dribbling&&a('亨利').longShots<a('尤西比奥').longShots);
  assert.ok(a('埃托奥').acceleration>a('舍甫琴科').acceleration&&a('埃托奥').heading<a('舍甫琴科').heading);
  assert.ok(a('大罗').pace>a('盖德·穆勒').pace&&a('大罗').heading<a('盖德·穆勒').heading);
});
test('repeat loads do not flatten or reapply the peak adjustment',()=>{
  const script="const {REAL_PLAYERS}=await import('./versus/player-pool.js');const {flushContentWrites}=await import('./versus/ydl-content-store.js');await flushContentWrites();console.log(JSON.stringify(REAL_PLAYERS));";
  const run=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,env:process.env,maxBuffer:8*1024*1024}));
  const snapshot=fs.readFileSync(content,'utf8'),first=run(),second=run();assert.deepEqual(first,second);assert.equal(fs.readFileSync(content,'utf8'),snapshot);
  for(const row of ledger.players)assert.deepEqual(first.find(p=>p.id===row.id).attributes,row.after);
});
test('every revised player can participate in full V3 matches in their primary position',async()=>{
  const {simulateV3Match}=await import('../versus/v3/match-engine-v3.js');
  const {makeAssessmentTeam,layouts}=await import('../scripts/engine-assessment-fixtures.mjs');
  const remaining=new Set(ledger.players.map(p=>p.id));
  for(let round=0;round<2;round++){
    const used=new Set(),teams=['4-4-2','3-5-2'].map((formation,side)=>{const team=makeAssessmentTeam('Peak '+round+' '+side,{formation,boardLines:true});
      team.players=layouts[formation].map(([role])=>{const p=REAL_PLAYERS.find(p=>remaining.has(p.id)&&p.role===role&&!used.has(p.id))??REAL_PLAYERS.find(p=>p.grade==='S'&&p.id!=='legend-messi-rat'&&p.role===role&&!used.has(p.id));assert.ok(p,role);used.add(p.id);remaining.delete(p.id);return {...structuredClone(p),traits:[],state:{fitness:100}};});
      team.positions=Object.fromEntries(layouts[formation].map(([,x,y],i)=>[team.players[i].id,{x,y}]));return team;});
    const result=simulateV3Match(teams,{seed:'s-peak-regression-'+round,weather:'sunny',referee:'standard'});assert.equal(result.engineVersion,'3.3.0');assert.ok(result.minute>=90);assert.ok(result.score.every(n=>Number.isInteger(n)&&n>=0));assert.ok(result.chains.length>0);
  }
  assert.equal(remaining.size,0,[...remaining].join(','));
});
test('admin API and AI training load the applied S profiles',async t=>{
  const server=await startLocalServer({publicOnly:false,contentOverrides:JSON.parse(bytes)});t.after(()=>server.stop());
  const post=async(url,body)=>{const r=await(await fetch(server.url+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();assert.equal(r.ok,true,r.error);return r;};
  const login=await post('/api/admin/login',{password:'isolated-test-password-only'});
  const view=await(await fetch(server.url+'/api/admin/content',{headers:{authorization:'Bearer '+login.token}})).json();assert.equal(view.ok,true);
  for(const row of ledger.players){const p=view.content.players.find(p=>p.id===row.id);assert.equal(p.overall,row.overall);assert.deepEqual(p.attributes,row.after);}
  const account=await post('/api/versus/register',{nickname:'S Peak Runtime',password:'s-peak-test-only'}),identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/api/versus/league/draft/start',{...identity,teamName:'S Peak FC'});await post('/api/versus/league/draft/auto',identity);await post('/api/versus/league/draft/finish',identity);
  const created=await post('/api/versus/league/ai-training/start',{...identity,formation:'4-3-3',averageOverall:90});assert.equal(created.broadcast.match.engineVersion,'3.3.0');assert.equal(created.broadcast.match.teams.length,2);
});
