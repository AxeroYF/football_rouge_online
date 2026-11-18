// Back up, stage and atomically apply the 18 authorized peak profiles.
// Does not load accounts, alter the overall formula or modify source imports.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES as keys,ATTRIBUTE_LABELS as labels,PLAYER_OVERALL_ATTRIBUTE_KEYS as core,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
import {S_PEAK_PROFILES,S_PEAK_PAIRS,S_PEAK_REVISION} from '../devtool/s-player-peak-profiles.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const backup=path.join(root,'outputs/backups/s-player-peak-before-20261116');
const out=path.join(root,'outputs/s-player-peak-applied-20261116');
const live=path.join(root,'data/ydl-content-overrides.json');
const ledgerFile=path.join(root,'data/player-balance-s-peak-20261116.json');
const manifestFile=path.join(backup,'manifest.json');
const candidate=path.join(out,'candidate-content.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const sha=f=>fs.existsSync(f)?createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null;
const protectedNames=['古德温','梅西','梅老鼠'];
function effective(content,destination){
  const script="import fs from 'node:fs';const {REAL_PLAYERS}=await import('./versus/player-pool.js');const {flushContentWrites}=await import('./versus/ydl-content-store.js');await flushContentWrites();fs.writeFileSync(process.env.S_PEAK_OUTPUT,JSON.stringify(REAL_PLAYERS,null,2)+'\\n');";
  execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:root,windowsHide:true,env:{...process.env,YDL_CONTENT_OVERRIDES_PATH:content,YDL_PLAYER_CARD_STUDIO_PATH:path.join(out,'studio-copy.json'),S_PEAK_OUTPUT:destination},stdio:'pipe'});
  return read(destination);
}
function verify(before,after,ledger){
  assert.equal(after.length,733);assert.equal(new Set(after.map(p=>p.id)).size,733);
  const old=new Map(before.map(p=>[p.id,p])),target=new Map(ledger.players.map(p=>[p.id,p]));
  let increases=0,decreases=0;
  for(const p of after){const previous=old.get(p.id);assert.ok(previous,p.id);const row=target.get(p.id);
    if(!row){assert.deepEqual(p,previous,`Out of scope: ${p.name}`);continue;}
    assert.deepEqual(p,{...previous,attributes:row.after,referenceAttributes:row.after},`Unexpected player change: ${p.name}`);
    assert.equal(p.overall,row.overall);assert.equal(playerOverallFromAttributes(p.attributes,p.role),row.overall);
    assert.equal(core[roleGroup(p.role)].reduce((n,k)=>n+p.attributes[k],0),row.overall*core[roleGroup(p.role)].length);
    for(const k of keys){assert.ok(Number.isInteger(p.attributes[k])&&p.attributes[k]>=1&&p.attributes[k]<=96);if(row.after[k]>row.before[k])increases++;if(row.after[k]<row.before[k])decreases++;}
  }
  for(const n of protectedNames){const p=after.find(p=>p.name===n);assert.ok(p,n);assert.deepEqual(p,old.get(p.id));}
  const pairs=S_PEAK_PAIRS.map(names=>{const prev=names.map(n=>before.find(p=>p.name===n)),next=names.map(n=>after.find(p=>p.name===n));const same=ps=>keys.filter(k=>ps[0].attributes[k]===ps[1].attributes[k]).length;
    const distinct=keys.filter(k=>!['goalkeeping','reflexes'].includes(k)&&next[0].attributes[k]!==next[1].attributes[k]).length;
    assert.ok(same(next)<same(prev),names.join('/'));assert.ok(distinct>=12,names.join('/'));
    return {names,sameBefore:same(prev),sameAfter:same(next),distinctOutfieldAttributes:distinct};});
  assert.equal(target.size,18);
  return {total:733,changedPlayers:18,unchangedPlayers:715,attributeChanges:increases+decreases,increases,decreases,overallChanges:0,identityChanges:0,protectedPlayers:protectedNames,pairs};
}
function report(ledger,checks){
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fs.writeFileSync(path.join(out,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S传奇巅峰调整</title><style>body{max-width:1100px;margin:32px auto;padding:0 22px;font:16px/1.7 system-ui;background:#f3f6f8;color:#193447}details{margin:18px 0;padding:18px;background:white;border:1px solid #ccd9e1;border-radius:10px}summary{cursor:pointer;font-weight:bold}table{border-collapse:collapse;width:100%}td,th{padding:6px;border-bottom:1px solid #dde5ea;text-align:left}.up{color:#087555}.down{color:#a34429}.muted{color:#677d8d}a{color:#126bb4}</style><h1>18名S球员 · 巅峰属性调整</h1><p>已应用 ${esc(ledger.revision)}。保留全部总评、身份、位置、评级、技能、强化规则和总评公式；古德温为彩蛋，梅西/梅老鼠为同一球员，均未修改。其余715人完整记录不变，包括前轮230名A球员。</p><p>${checks.attributeChanges}项变化：${checks.increases}项提高、${checks.decreases}项降低。全部为当前游戏尺度下的巅峰设计值，不冒称历史数据库精确还原。马特拉齐冷静78为明确设计估值；拜亚为模板重估，不宣称已证实映射错误。</p><p>公式约束：加图索保持S90仍需较高组织核心；贝肯鲍尔S95需较高力量/速度；大罗S96五项核心必须全96。报告逐项展示，不以提高总评制造差异。</p><h2>相似模板区分</h2><table><tr><th>组合</th><th>相同属性：之前 → 之后</th></tr>${checks.pairs.map(p=>`<tr><td>${esc(p.names.join(' / '))}</td><td>${p.sameBefore}/26 → ${p.sameAfter}/26</td></tr>`).join('')}</table><h2>26项前后对照</h2>${ledger.players.map(p=>`<details><summary>${esc(p.name)} · S${p.overall} · ${esc(p.role)}</summary><p>${esc(p.reason)}</p><p>${esc(p.nationality)} / ${esc(p.club)}；副位置 ${esc(p.secondaryRole??'无')}</p><table><tr><th>属性</th><th>之前</th><th>之后</th><th>变化</th></tr>${keys.map(k=>{const d=p.after[k]-p.before[k];return `<tr><td>${labels[k]}</td><td>${p.before[k]}</td><td>${p.after[k]}</td><td class="${d>0?'up':d<0?'down':'muted'}">${d>0?'+':''}${d||'—'}</td></tr>`;}).join('')}</table></details>`).join('')}<p><a href="applied.json">校验记录</a> · <a href="../backups/s-player-peak-before-20261116.zip">调整前备份</a></p></html>`);
}
if(process.argv.includes('--prepare')){
  assert.ok(!fs.existsSync(manifestFile),'Backup exists; use --apply/--verify.');assert.ok(!fs.existsSync(ledgerFile));
  fs.mkdirSync(out,{recursive:true});
  const files=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json','data/player-balance-a-20261116.json','data/s4-player-pool-s4.json','data/s4-player-pool-with-dlc.json','data/player-dlc-s4-final.json','data/player-dlc2-s4-final.json','data/player-dlc3-s4-final.json','data/s4-player-candidates-500.json','data/s4-retired-famous-players-50.json','versus/player-pool.js','versus/player-pool-s4-generated.js','versus/player-pool-s4-dlc-generated.js','versus/ydl-content-store.js','versus/player-data-migrations.js','shared/football/schema.js','versus/s4-balance.js'];
  const entries=files.map(file=>({file,sha256:sha(path.join(root,file))}));
  const beforeCopy=path.join(out,'before-content-copy.json');fs.copyFileSync(live,beforeCopy);
  const studio=path.join(root,'data/ydl-player-card-studio.json');if(fs.existsSync(studio))fs.copyFileSync(studio,path.join(out,'studio-copy.json'));else write(path.join(out,'studio-copy.json'),{});
  const before=effective(beforeCopy,path.join(out,'before-effective.json'));
  const players=S_PEAK_PROFILES.map(spec=>{const matches=before.filter(p=>p.name===spec.name);assert.equal(matches.length,1,spec.name);const p=matches[0];assert.equal(p.grade,'S');assert.ok(!protectedNames.includes(p.name));
    for(const k of Object.keys(spec.attributes))assert.ok(keys.includes(k),k);
    const after={...p.attributes,...spec.attributes};assert.equal(core[roleGroup(p.role)].reduce((n,k)=>n+after[k],0),p.overall*core[roleGroup(p.role)].length,`Core sum ${p.name}`);
    return {id:p.id,name:p.name,role:p.role,secondaryRole:p.secondaryRole,overall:p.overall,grade:p.grade,nationality:p.nationality,club:p.club,before:p.attributes,after,reason:spec.reason};});
  assert.equal(new Set(players.map(p=>p.id)).size,18);
  // Preserve live files and effective values before preparing an application.
  fs.mkdirSync(backup,{recursive:true});for(const entry of entries)if(entry.sha256){const dest=path.join(backup,entry.file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,entry.file),dest);assert.equal(sha(dest),entry.sha256);}
  write(path.join(backup,'effective-players-before.json'),before);
  const ledger={revision:S_PEAK_REVISION,date:'2026-11-16',attributeInterpretation:'peak-game-design',scope:'User-authorized first 8 and 5 pairs; unchanged overall and formula',exceptions:{goodwin:'intentional easter egg; unchanged',messiAndRat:'same player; unchanged'},applicationLayer:'data/ydl-content-overrides.json',players};
  const original=read(live),next=structuredClone(original);next.players??={};
  for(const p of players)next.players[p.id]={...(next.players[p.id]??{}),overall:p.overall,attributes:p.after,balanceRevision:S_PEAK_REVISION};next.updatedAt=new Date().toISOString();write(candidate,next);
  const after=effective(candidate,path.join(out,'candidate-effective.json')),checks=verify(before,after,ledger);
  const normalized=read(candidate),ids=new Set(players.map(p=>p.id));for(const [id,value] of Object.entries(original.players))if(!ids.has(id))assert.deepEqual(normalized.players[id],value);
  assert.deepEqual({...normalized,players:null,updatedAt:null},{...original,players:null,updatedAt:null});
  const candidateHash=sha(candidate);effective(candidate,path.join(out,'restart-effective.json'));assert.equal(sha(candidate),candidateHash);
  for(const entry of entries)assert.equal(sha(path.join(root,entry.file)),entry.sha256);
  write(ledgerFile,ledger);write(path.join(backup,'approved-profiles.json'),ledger);
  write(manifestFile,{revision:S_PEAK_REVISION,createdAt:new Date().toISOString(),files:entries,ledgerSha256:sha(ledgerFile),candidateSha256:candidateHash,checks,restore:{from:path.join(backup,'data/ydl-content-overrides.json'),to:live,note:'Stop the service, restore this override file, then restart. This restores the entire scheme at backup time, including the earlier A-player adjustment.'}});
  console.log(JSON.stringify({prepared:true,backup,...checks},null,2));
}else if(process.argv.includes('--apply')){
  const manifest=read(manifestFile),ledger=read(ledgerFile);assert.ok(fs.existsSync(backup+'.zip'),'Create the backup archive before applying.');
  assert.equal(sha(ledgerFile),manifest.ledgerSha256);assert.equal(sha(candidate),manifest.candidateSha256);
  const alreadyApplied=sha(live)===manifest.candidateSha256;
  if(!alreadyApplied){for(const entry of manifest.files)assert.equal(sha(path.join(root,entry.file)),entry.sha256,entry.file);const pending=live+'.s-peak-pending';assert.ok(!fs.existsSync(pending));fs.copyFileSync(candidate,pending,fs.constants.COPYFILE_EXCL);assert.equal(sha(pending),manifest.candidateSha256);fs.renameSync(pending,live);}
  fs.copyFileSync(live,path.join(out,'applied-content-copy.json'));const after=effective(path.join(out,'applied-content-copy.json'),path.join(out,'effective-players-after.json'));
  const checks=verify(read(path.join(backup,'effective-players-before.json')),after,ledger);
  for(const entry of manifest.files)if(path.join(root,entry.file)!==live)assert.equal(sha(path.join(root,entry.file)),entry.sha256,entry.file);
  write(path.join(out,'applied.json'),{revision:S_PEAK_REVISION,appliedAt:new Date().toISOString(),alreadyApplied,...checks});report(ledger,checks);console.log(JSON.stringify({applied:true,...checks},null,2));
}else if(process.argv.includes('--verify')){
  const ledger=read(ledgerFile),manifest=read(manifestFile);fs.copyFileSync(live,path.join(out,'verified-content-copy.json'));
  const checks=verify(read(path.join(backup,'effective-players-before.json')),effective(path.join(out,'verified-content-copy.json'),path.join(out,'verified-effective.json')),ledger);
  for(const entry of manifest.files)if(path.join(root,entry.file)!==live)assert.equal(sha(path.join(root,entry.file)),entry.sha256,entry.file);
  console.log(JSON.stringify(checks,null,2));
}else throw Error('Use --prepare, --apply or --verify.');
