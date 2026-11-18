import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ATTRIBUTE_NAMES as keys,PLAYER_OVERALL_ATTRIBUTE_KEYS as core,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
import {applyS4Enhancement,s4EnhancementAbilityBonus,s4BaseCardReferenceValue,s4OwnershipReferenceValue} from '../versus/s4-balance.js';
import {createS4BondCatalog} from '../versus/public/bond-rules.js';
import {S_FINAL_CHARACTER} from '../devtool/s-player-final-profiles.js';
import {startLocalServer} from './helpers/local-server.js';
const read=f=>JSON.parse(fs.readFileSync(new URL(f,import.meta.url),'utf8'));
const ledger=read('../data/player-balance-s-final-20261116.json'),aLedger=read('../data/player-balance-a-20261116.json');
const live=new URL('../data/ydl-content-overrides.json',import.meta.url),bytes=fs.readFileSync(live),digest=b=>createHash('sha256').update(b).digest('hex'),hash=digest(bytes);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-s-final-')),content=path.join(dir,'content.json');fs.writeFileSync(content,bytes);
process.env.YDL_CONTENT_OVERRIDES_PATH=content;process.env.YDL_PLAYER_CARD_STUDIO_PATH=path.join(dir,'studio.json');
const {REAL_PLAYERS,REAL_PLAYER_BY_ID}=await import('../versus/player-pool.js');const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
test.after(()=>{assert.equal(digest(fs.readFileSync(live)),hash);assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-s-final-'));fs.rmSync(dir,{recursive:true,force:true});});
test('all 70 scoped profiles load exact final values, with 41 character revisions and 29 protected noncore profiles',()=>{
 assert.equal(ledger.players.length,70);assert.equal(new Set(ledger.players.map(p=>p.id)).size,70);
 assert.equal(ledger.players.filter(p=>p.preserveNoncore).length,29);assert.equal(Object.keys(S_FINAL_CHARACTER).length,41);
 let inc=0,dec=0,changed=0;
 for(const row of ledger.players){const p=REAL_PLAYER_BY_ID[row.id];assert.equal(p.overall,row.overall);assert.equal(p.baseOverall,row.overall);assert.equal(playerOverallFromAttributes(p.attributes,p.role),row.overall);assert.deepEqual(p.attributes,row.after);
  for(const k of ['grade','role','secondaryRole','nationality','club'])assert.equal(p[k],row[k]);
  for(const k of keys){assert.ok(Number.isInteger(p.attributes[k])&&p.attributes[k]>=1&&p.attributes[k]<=96);if(row.after[k]>row.before[k])inc++;if(row.after[k]<row.before[k])dec++;if(row.preserveNoncore&&!core[roleGroup(p.role)].includes(k))assert.equal(row.after[k],row.before[k]);}
  if(row.changed)changed++;
  for(const level of [0,4,8]){const q=applyS4Enhancement(p,level),bonus=s4EnhancementAbilityBonus(level);assert.equal(q.overall,row.overall+bonus);for(const k of keys)assert.equal(q.attributes[k],Math.min(99,row.after[k]+bonus));}
  assert.equal(s4BaseCardReferenceValue(p),row.referencePrices.cardAfter);assert.equal(s4OwnershipReferenceValue(p),row.referencePrices.ownershipAfter);
 }
 assert.equal(inc,427);assert.equal(dec,106);assert.equal(changed,65);
 for(const row of aLedger.players){const p=REAL_PLAYER_BY_ID[row.id];assert.equal(p.overall,row.afterOverall);assert.deepEqual(p.attributes,row.after);}
});
test('roles, bond membership and previously defined special cards stay consistent',()=>{
 const targets=new Map(ledger.players.map(p=>[p.id,p]));
 const before=REAL_PLAYERS.map(p=>targets.has(p.id)?{...p,overall:targets.get(p.id).beforeOverall,attributes:targets.get(p.id).before}:p);
 assert.deepEqual(createS4BondCatalog(REAL_PLAYERS),createS4BondCatalog(before));
 const messi=REAL_PLAYER_BY_ID['legend-messi'],rat=REAL_PLAYER_BY_ID['legend-messi-rat'];assert.deepEqual(messi.attributes,rat.attributes);assert.equal(messi.overall,96);assert.equal(rat.overall,96);
 assert.ok(!ledger.players.some(p=>['梅西','梅老鼠','古德温'].includes(p.name)));
 const s=REAL_PLAYERS.filter(p=>p.grade==='S'&&!['古德温','梅老鼠'].includes(p.name));
 assert.deepEqual(Object.fromEntries([90,91,92,93,94,95,96].map(n=>[n,s.filter(p=>p.overall===n).length])),{90:3,91:2,92:13,93:24,94:14,95:10,96:5});
});
test('new character profiles preserve role tradeoffs instead of applying blanket bonuses',()=>{
 const a=n=>REAL_PLAYERS.find(p=>p.name===n).attributes;
 assert.ok(a('诺伊尔').pace>=58&&a('诺伊尔').vision>=58&&a('诺伊尔').crossing<50);
 assert.ok(a('贝克汉姆').setPieces>a('路易斯菲戈').setPieces&&a('贝克汉姆').dribbling<a('路易斯菲戈').dribbling);
 assert.ok(a('卡卡').pace>a('克罗斯').pace&&a('卡卡').passing<a('克罗斯').passing);
 assert.ok(a('鲁尼').workRate>=92&&a('鲁尼').passing>=84);
 assert.ok(a('德罗巴').strength>a('罗马里奥').strength&&a('德罗巴').agility<a('罗马里奥').agility);
 assert.ok(a('乔治维阿').pace>a('范巴斯滕').pace&&a('乔治维阿').heading<a('范巴斯滕').heading);
 assert.ok(a('马拉多纳').passing>=92&&a('马拉多纳').heading<75);
 assert.ok(a('马塞洛').stamina<90&&a('马塞洛').dribbling>90);
 for(const k of core.ATT)assert.equal(a('C罗')[k],96);
});
test('all 70 scoped players complete V3 matches in their primary positions',async()=>{
 const {simulateV3Match}=await import('../versus/v3/match-engine-v3.js');const {makeAssessmentTeam,layouts}=await import('../scripts/engine-assessment-fixtures.mjs');
 const remaining=new Set(ledger.players.map(p=>p.id));let matches=0;
 while(remaining.size&&matches<12){const used=new Set(),teams=['4-3-3','3-5-2'].map((formation,side)=>{const team=makeAssessmentTeam(`Final ${matches} ${side}`,{formation,boardLines:true});
   team.players=layouts[formation].map(([role])=>{const p=REAL_PLAYERS.find(p=>remaining.has(p.id)&&p.role===role&&!used.has(p.id))??REAL_PLAYERS.find(p=>p.role===role&&p.grade==='S'&&p.id!=='legend-messi-rat'&&!used.has(p.id));assert.ok(p,role);used.add(p.id);remaining.delete(p.id);return {...structuredClone(p),traits:[],state:{fitness:100}};});
   team.positions=Object.fromEntries(layouts[formation].map(([,x,y],i)=>[team.players[i].id,{x,y}]));return team;});
  const result=simulateV3Match(teams,{seed:'s-final-'+matches,weather:'sunny',referee:'standard'});assert.equal(result.engineVersion,'3.3.0');assert.ok(result.minute>=90);assert.ok(result.score.every(n=>Number.isInteger(n)&&n>=0));assert.ok(result.chains.length>0);matches++;
 }
 assert.equal(remaining.size,0,[...remaining].join(','));
});
test('runtime HTTP content exposes all final profiles and starts AI training',async t=>{
 const server=await startLocalServer({publicOnly:false,contentOverrides:JSON.parse(bytes)});t.after(()=>server.stop());
 const post=async(url,body)=>{const r=await(await fetch(server.url+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();assert.equal(r.ok,true,r.error);return r;};
 const login=await post('/api/admin/login',{password:'isolated-test-password-only'}),view=await(await fetch(server.url+'/api/admin/content',{headers:{authorization:'Bearer '+login.token}})).json();assert.equal(view.ok,true);
 for(const row of ledger.players){const p=view.content.players.find(p=>p.id===row.id);assert.equal(p.overall,row.overall);assert.deepEqual(p.attributes,row.after);}
 const account=await post('/api/versus/register',{nickname:'S Final Runtime',password:'s-final-test-only'}),identity={playerId:account.profile.id,accountToken:account.accountToken};
 await post('/api/versus/league/draft/start',{...identity,teamName:'S Final FC'});await post('/api/versus/league/draft/auto',identity);await post('/api/versus/league/draft/finish',identity);
 const created=await post('/api/versus/league/ai-training/start',{...identity,formation:'4-3-3',averageOverall:93});assert.equal(created.broadcast.match.engineVersion,'3.3.0');assert.equal(created.broadcast.match.teams.length,2);
});
