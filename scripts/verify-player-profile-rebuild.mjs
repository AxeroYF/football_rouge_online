// Compare this scoped revision with its pre-change snapshot. Never loads account saves.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {ATTRIBUTE_NAMES,ATTRIBUTE_LABELS} from '../shared/football/schema.js';
import {REVISED_DLC_PLAYER_IDS,REBUILT_DLC_PROFILES,DUPLICATE_PROFILE_PAIRS} from '../devtool/player-dlc-profile-revisions.js';
import {S4_DLC_PLAYER_DATABASE} from '../versus/player-pool-s4-dlc-generated.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const backup=path.join(root,'outputs/backups/player-profiles-before-20261116');
const out=path.join(root,'outputs/player-profile-rebuild');fs.mkdirSync(out,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const allowed=new Set(REVISED_DLC_PLAYER_IDS);
function compare(before,after,label){
  assert.equal(before.length,733);assert.equal(after.length,733);
  assert.equal(new Set(after.map(p=>p.id)).size,733);
  const byId=new Map(before.map(p=>[p.id,p])),changes=[];
  for(const p of after){
    const old=byId.get(p.id);assert.ok(old,`${label}: unexpected ID ${p.id}`);
    assert.equal(p.overall,old.overall,p.id);assert.equal(p.grade,old.grade,p.id);
    if(!allowed.has(p.id)){assert.deepEqual(p,old,`${label}: out-of-scope change ${p.id}`);continue;}
    assert.notDeepEqual(p,old,`${label}: requested player unchanged ${p.id}`);
    const attributes=ATTRIBUTE_NAMES.filter(k=>p.attributes[k]!==old.attributes[k]).map(k=>({key:k,label:ATTRIBUTE_LABELS[k],before:old.attributes[k],after:p.attributes[k]}));
    const metadata=Object.keys({...old,...p}).filter(k=>k!=='attributes'&&JSON.stringify(old[k])!==JSON.stringify(p[k])).map(k=>({key:k,before:old[k],after:p[k]}));
    changes.push({id:p.id,name:p.name,overall:p.overall,grade:p.grade,attributes,metadata});
  }
  assert.deepEqual(changes.map(p=>p.id).sort(),[...allowed].sort());
  return changes;
}
const baseChanges=compare(read(path.join(backup,'base-players.json')),structuredClone(REAL_PLAYERS),'base');
const protectedFiles=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json'];
const hashes=Object.fromEntries(protectedFiles.map(file=>[file,digest(path.join(root,file))]));
// Admin edits must remain byte-for-byte untouched; load only disposable copies.
assert.equal(hashes[protectedFiles[0]],digest(path.join(backup,protectedFiles[0])));
for(const [file,env] of [['ydl-content-overrides.json','YDL_CONTENT_OVERRIDES_PATH'],['ydl-player-card-studio.json','YDL_PLAYER_CARD_STUDIO_PATH']]){
  const source=path.join(root,'data',file),copy=path.join(out,file);
  if(fs.existsSync(source))fs.copyFileSync(source,copy);else fs.writeFileSync(copy,'{}');
  process.env[env]=copy;
}
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const effectiveChanges=compare(read(path.join(backup,'effective-players.json')),structuredClone(REAL_PLAYERS),'effective');
for(const [file,hash] of Object.entries(hashes))assert.equal(digest(path.join(root,file)),hash,file);

// Canonical input and generated records also stay inside the same 13-player scope.
let canonicalChanged=0;
for(const [file,prefix] of [['player-dlc-s4-final.json','s4-dlc-20260731-'],['player-dlc3-s4-final.json','s4-dlc3-20260808-']]){
  const before=read(path.join(backup,'data',file)),after=read(path.join(root,'data',file));
  assert.deepEqual({...before,players:null},{...after,players:null});assert.equal(before.players.length,after.players.length);
  after.players.forEach((p,i)=>{
    const id=p.id||prefix+String(i+1).padStart(3,'0');
    if(allowed.has(id)){assert.notDeepEqual(p,before.players[i]);canonicalChanged++;}
    else assert.deepEqual(p,before.players[i],`canonical out-of-scope: ${id}`);
  });
}
assert.equal(canonicalChanged,13);
const oldMerged=read(path.join(backup,'data/s4-player-pool-with-dlc.json')).players;
const newMerged=read(path.join(root,'data/s4-player-pool-with-dlc.json')).players;
assert.equal(oldMerged.length,newMerged.length);
const oldSource=new Map(oldMerged.map(p=>[p.id,p]));
for(const p of newMerged)if(!allowed.has(p.id))assert.deepEqual(p,oldSource.get(p.id),`generated out-of-scope: ${p.id}`);
const byId=new Map(REAL_PLAYERS.map(p=>[p.id,p]));
const pairs=DUPLICATE_PROFILE_PAIRS.map(([a,b])=>({players:[byId.get(a).name,byId.get(b).name],differentOutfieldAttributes:ATTRIBUTE_NAMES.slice(0,24).filter(k=>byId.get(a).attributes[k]!==byId.get(b).attributes[k]).length}));
const summary={total:733,changed:13,unchanged:720,overallChanges:0,gradeChanges:0,canonicalChanged,pairs,adminOverridesUnchanged:true};
fs.writeFileSync(path.join(out,'changes.json'),JSON.stringify({summary,baseChanges,effectiveChanges},null,2));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sources=new Map(S4_DLC_PLAYER_DATABASE.map(p=>[p.id,p]));
fs.writeFileSync(path.join(out,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>首批球员修正与重复属性重建</title><style>body{font:16px/1.8 system-ui;background:#f4f7f5;color:#18392d;max-width:1200px;margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #d7e5dd;padding:12px;text-align:left;vertical-align:top}th{background:#e8f0eb}small{color:#65776c}a{color:#14644b}input{padding:12px;width:90%;margin:20px 0}</style><h1>首批球员修正与重复属性重建</h1><p>2026-11-16 · 733人逐项比较：13人变动，720人完整记录不变。所有总评、评级、游戏ID保持原值，后台覆盖文件未修改。</p><ul><li>迪迪、罗比尼奥、泽·罗伯托、克洛泽：源值已经缩放，运行时仅配平核心总评，取消第二次全属性偏移。劳尔同时进入重复属性重建。</li><li>华金改为贝蒂斯的 Joaquín Sánchez Rodríguez，采用2004/05时期设计，B85、RM/RW、右脚、179cm。数值、逆足与花式是游戏重建值，并非EA历史原卡。</li><li>4组8人重建全部26项属性，保持总评与评级，突出各自特点。劳尔与首批5人重叠，因此本轮共13人。</li><li>泽·罗伯托源冷静9疑似早期缺失值加成的残留，采用同条决策79作明确标注的估算补值，非已核实历史冷静。</li><li>本报告验证静态数据、导入、运行与强化一致性，不代表已经完成长期胜率平衡测试。</li></ul><p><a href="changes.json">完整差异与范围检查JSON</a></p><input id="query" placeholder="搜索姓名或ID"><table><thead><tr><th>球员 / 总评</th><th>设计说明</th><th>运行属性变化</th></tr></thead><tbody>${effectiveChanges.map(p=>`<tr><td>${esc(p.name)} · ${p.grade}${p.overall}<br><small>${esc(p.id)}</small></td><td>${esc(REBUILT_DLC_PROFILES[p.id]?.description??sources.get(p.id).dataCorrections.profileRevision.description)}${(REBUILT_DLC_PROFILES[p.id]?.evidence??[]).map((url,i)=>`<br><a href="${esc(url)}">资料依据 ${i+1}</a>`).join('')}</td><td>${p.attributes.map(c=>`${esc(c.label)} ${c.before} → ${c.after}`).join('；')}</td></tr>`).join('')}</tbody></table><script>document.querySelector('#query').addEventListener('input',e=>{for(const row of document.querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase());});</script></html>`);
console.log(JSON.stringify(summary,null,2));
