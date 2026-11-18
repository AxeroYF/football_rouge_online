import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ATTRIBUTE_NAMES,playerOverallFromAttributes} from '../shared/football/schema.js';
import {applyS4Enhancement,s4EnhancementAbilityBonus,s4BaseCardReferenceValue,s4OwnershipReferenceValue} from '../versus/s4-balance.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {startLocalServer} from './helpers/local-server.js';
const ledger=JSON.parse(fs.readFileSync(new URL('../data/player-balance-a-20261116.json',import.meta.url),'utf8'));
const livePath=new URL('../data/ydl-content-overrides.json',import.meta.url);
const liveBytes=fs.readFileSync(livePath),liveHash=createHash('sha256').update(liveBytes).digest('hex');
const overrides=JSON.parse(liveBytes);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-a-balance-'));
const content=path.join(dir,'content.json');fs.writeFileSync(content,liveBytes);
process.env.YDL_CONTENT_OVERRIDES_PATH=content;process.env.YDL_PLAYER_CARD_STUDIO_PATH=path.join(dir,'studio.json');
const {REAL_PLAYERS,REAL_PLAYER_BY_ID}=await import('../versus/player-pool.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
test.after(()=>{
  assert.equal(createHash('sha256').update(fs.readFileSync(livePath)).digest('hex'),liveHash,'tests must never write live overrides');
  assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-a-balance-'));fs.rmSync(dir,{recursive:true,force:true});
});

test('effective runtime exactly matches all 230 approved profiles and the persisted application layer',()=>{
  assert.equal(ledger.players.length,230);assert.equal(new Set(ledger.players.map(p=>p.id)).size,230);
  let changed=0;
  for(const approved of ledger.players){const p=REAL_PLAYER_BY_ID[approved.id];
    assert.deepEqual(p.attributes,approved.after,p.name);assert.equal(p.overall,approved.afterOverall);assert.equal(p.baseOverall,p.overall);
    assert.equal(playerOverallFromAttributes(p.attributes,p.role),p.overall);
    for(const key of ['grade','name','role','secondaryRole','nationality','club'])assert.equal(p[key],approved[key]);
    assert.equal(overrides.players[p.id].balanceRevision,ledger.revision);
    for(const k of ATTRIBUTE_NAMES){assert.ok(p.attributes[k]<=approved.before[k]);assert.ok(p.attributes[k]>=1&&p.attributes[k]<=96);if(p.attributes[k]!==approved.before[k])changed++;}
    for(const k of approved.signatures)assert.equal(p.attributes[k],approved.before[k]);
  }
  assert.equal(changed,3220);
  assert.deepEqual(Object.fromEntries([86,87,88,89].map(n=>[n,REAL_PLAYERS.filter(p=>p.grade==='A'&&p.overall===n).length])),{86:115,87:80,88:28,89:7});
});

test('approved profiles reload without another normalization or cumulative reduction',()=>{
  const script="const {REAL_PLAYERS}=await import('./versus/player-pool.js');const {flushContentWrites}=await import('./versus/ydl-content-store.js');await flushContentWrites();console.log(JSON.stringify(REAL_PLAYERS.map(p=>({id:p.id,overall:p.overall,attributes:p.attributes}))));";
  const run=()=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,env:process.env}));
  const before=fs.readFileSync(content,'utf8'),first=run(),second=run();
  assert.equal(fs.readFileSync(content,'utf8'),before);assert.deepEqual(second,first);
  for(const p of ledger.players)assert.deepEqual(first.find(q=>q.id===p.id).attributes,p.after);
});

test('enhancement rules, identity bond membership and reference-price formulas remain consistent',()=>{
  const before=REAL_PLAYERS.map(p=>{const approved=ledger.players.find(q=>q.id===p.id);return approved?{...p,overall:approved.beforeOverall,attributes:approved.before}:p;});
  assert.deepEqual(createS4BondCatalog(REAL_PLAYERS),createS4BondCatalog(before));
  for(const approved of ledger.players){const p=REAL_PLAYER_BY_ID[approved.id],snapshot=structuredClone(p),old={...p,overall:approved.beforeOverall};
    for(const level of [3,4,8]){const upgraded=applyS4Enhancement(p,level),bonus=s4EnhancementAbilityBonus(level);
      assert.equal(upgraded.upgradeLevel,level);assert.equal(upgraded.overall,p.overall+bonus);
      for(const key of ATTRIBUTE_NAMES)assert.equal(upgraded.attributes[key],Math.min(99,approved.after[key]+bonus));
    }
    assert.deepEqual(p,snapshot);
    assert.equal(s4BaseCardReferenceValue(old)-s4BaseCardReferenceValue(p),(old.overall-p.overall)*200);
    assert.equal(s4OwnershipReferenceValue(old)-s4OwnershipReferenceValue(p),(old.overall-p.overall)*400);
  }
});

test('a full V3 match runs with the newly approved attributes',async()=>{
  const {simulateV3Match}=await import('../versus/v3/match-engine-v3.js');
  const {makeAssessmentTeam,layouts}=await import('../scripts/engine-assessment-fixtures.mjs');
  const used=new Set(),teams=['A','B'].map(name=>{
    const team=makeAssessmentTeam(name,{boardLines:true});
    team.players=layouts['4-3-3'].map(([role])=>{const p=REAL_PLAYERS.find(p=>p.grade==='A'&&p.role===role&&!used.has(p.id));assert.ok(p,role);used.add(p.id);return {...structuredClone(p),traits:[]};});
    team.positions=Object.fromEntries(layouts['4-3-3'].map(([,x,y],i)=>[team.players[i].id,{x,y}]));return team;
  });
  const result=simulateV3Match(teams,{seed:'approved-a-balance-full-match',weather:'sunny',referee:'standard'});
  assert.equal(result.engineVersion,'3.3.0');assert.ok(result.minute>=90);assert.ok(result.chains.length>0);
  assert.ok(result.score.every(n=>Number.isInteger(n)&&n>=0));
});

test('HTTP admin library and AI training start load the applied data',async t=>{
  const server=await startLocalServer({publicOnly:false,contentOverrides:overrides});t.after(()=>server.stop());
  const post=async(url,body)=>{const value=await (await fetch(server.url+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();assert.equal(value.ok,true,value.error);return value;};
  const login=await post('/api/admin/login',{password:'isolated-test-password-only'});
  const content=await (await fetch(server.url+'/api/admin/content',{headers:{authorization:'Bearer '+login.token}})).json();assert.equal(content.ok,true);
  for(const approved of ledger.players){const p=content.content.players.find(p=>p.id===approved.id);assert.equal(p.overall,approved.afterOverall);assert.deepEqual(p.attributes,approved.after);}
  const account=await post('/api/versus/register',{nickname:'A Balance Runtime',password:'a-balance-test-only'});
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  await post('/api/versus/league/draft/start',{...identity,teamName:'A Balance FC'});
  await post('/api/versus/league/draft/auto',identity);await post('/api/versus/league/draft/finish',identity);
  const created=await post('/api/versus/league/ai-training/start',{...identity,formation:'4-3-3',averageOverall:86});
  assert.equal(created.broadcast.match.engineVersion,'3.3.0');assert.equal(created.broadcast.match.teams.length,2);
});
