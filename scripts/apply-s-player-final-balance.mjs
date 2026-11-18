import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES as keys,ATTRIBUTE_LABELS as labels,PLAYER_OVERALL_ATTRIBUTE_KEYS as cores,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
import {s4BaseCardReferenceValue,s4OwnershipReferenceValue} from '../versus/s4-balance.js';
import {S_FINAL_CORE,S_FINAL_CHARACTER,S_FINAL_CONSTRAINT_NOTES,S_FINAL_REVISION} from '../devtool/s-player-final-profiles.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'outputs/s-player-final-applied-20261116'),backup=path.join(root,'outputs/backups/s-player-final-before-20261116');
const live=path.join(root,'data/ydl-content-overrides.json'),ledgerFile=path.join(root,'data/player-balance-s-final-20261116.json');
const candidate=path.join(out,'candidate-content.json'),manifestFile=path.join(backup,'manifest.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),hash=f=>fs.existsSync(f)?createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null;
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
const protectedNames=['古德温','梅西','梅老鼠'];
function effective(content,file){
 const script="import fs from 'node:fs';const {REAL_PLAYERS}=await import('./versus/player-pool.js');const {flushContentWrites}=await import('./versus/ydl-content-store.js');await flushContentWrites();fs.writeFileSync(process.env.S_FINAL_OUTPUT,JSON.stringify(REAL_PLAYERS,null,2));";
 execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:root,windowsHide:true,env:{...process.env,YDL_CONTENT_OVERRIDES_PATH:content,YDL_PLAYER_CARD_STUDIO_PATH:path.join(out,'studio-copy.json'),S_FINAL_OUTPUT:file},stdio:'pipe'});return read(file);
}
function verify(before,after,ledger){
 assert.equal(before.length,733);assert.equal(after.length,733);assert.equal(new Set(after.map(p=>p.id)).size,733);
 const old=new Map(before.map(p=>[p.id,p])),targets=new Map(ledger.players.map(p=>[p.id,p]));let changed=0,inc=0,dec=0,up=0,down=0;
 for(const p of after){const prev=old.get(p.id),row=targets.get(p.id);assert.ok(prev,p.id);
  if(!row){assert.deepEqual(p,prev,`Outside scope: ${p.name}`);continue;}
  assert.deepEqual(p,{...prev,overall:row.overall,baseOverall:row.overall,attributes:row.after,referenceAttributes:row.after},`Unexpected change: ${p.name}`);
  assert.equal(playerOverallFromAttributes(p.attributes,p.role),row.overall);const core=cores[roleGroup(p.role)];assert.equal(core.reduce((n,k)=>n+p.attributes[k],0),core.length*row.overall,p.name);
  for(const k of keys){assert.ok(Number.isInteger(p.attributes[k])&&p.attributes[k]>=1&&p.attributes[k]<=96);if(p.attributes[k]>prev.attributes[k])inc++;if(p.attributes[k]<prev.attributes[k])dec++;if(row.preserveNoncore&&!core.includes(k))assert.equal(p.attributes[k],prev.attributes[k],`${p.name} protected noncore ${k}`);}
  if(JSON.stringify(p)!==JSON.stringify(prev))changed++;if(p.overall>prev.overall)up++;if(p.overall<prev.overall)down++;
 }
 for(const name of protectedNames){const p=after.find(p=>p.name===name);assert.deepEqual(p,old.get(p.id));}
 const s=after.filter(p=>p.grade==='S'&&!['古德温','梅老鼠'].includes(p.name));
 const distribution=Object.fromEntries([90,91,92,93,94,95,96].map(n=>[n,s.filter(p=>p.overall===n).length]));assert.deepEqual(distribution,{90:3,91:2,92:13,93:24,94:14,95:10,96:5});
 assert.equal(targets.size,70);assert.equal(up,56);assert.equal(down,1);
 const a=read(path.join(root,'data/player-balance-a-20261116.json'));for(const row of a.players){const p=after.find(p=>p.id===row.id);assert.equal(p.overall,row.afterOverall);assert.deepEqual(p.attributes,row.after);}
 return {total:733,reviewed:70,changedPlayers:changed,unchangedPlayers:733-changed,overallIncreases:up,overallDecreases:down,overallUnchangedInScope:70-up-down,attributeChanges:inc+dec,increases:inc,decreases:dec,regularSDistribution:distribution,protectedPlayers:protectedNames,identityChanges:0,aPlayersUnchanged:230};
}
function report(ledger,checks){
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S巅峰完整落地</title><style>body{font:16px/1.7 system-ui;color:#183447;background:#f3f6f8;max-width:1150px;margin:30px auto;padding:0 20px}details{background:white;border:1px solid #cbd9e2;border-radius:10px;padding:18px;margin:14px 0}summary{font-weight:bold;cursor:pointer}table{border-collapse:collapse;width:100%}td,th{padding:6px;text-align:left;border-bottom:1px solid #d9e3e9}.up{color:#08745e}.down{color:#a74b28}.note{background:#fff0d6;padding:12px}input{font:inherit;padding:10px;width:80%}a{color:#176db5}</style><h1>S传奇：总评与巅峰特点已应用</h1><p>${checks.changedPlayers}人实际变化，${checks.unchangedPlayers}人完整记录不变。总评56人提高、1人降低；${checks.attributeChanges}项属性变化（${checks.increases}升/${checks.decreases}降）。A球员230人保持，古德温/梅西/梅老鼠完整保持。</p><p>41人落实前轮特色建议；原18人及暂缓11人的非核心属性保持。全部为游戏设计值，非外部数据库精确测量。身份、位置、技能、强化和总评公式不改。</p><p class="note">高档总评必须由现有核心平均值支撑。C罗S96五项核心全96；S95前锋每项核心至少91。未全属性统一加点，具体公式取舍见各人。普通S档统计排除古德温和彩蛋别名卡梅老鼠。</p><p>分布：${Object.entries(checks.regularSDistribution).map(([n,v])=>n+'分 '+v+'人').join('；')}。</p><input id="q" placeholder="搜索球员、国家、俱乐部"><p id="count">70人完整记录（含保持不变者）</p>${ledger.players.map(p=>`<details data-search="${esc([p.name,p.nationality,p.club].join(' '))}"><summary>${esc(p.name)} · ${p.beforeOverall}→${p.overall} · ${esc(p.category)}${p.changed?'':' · 无变化'}</summary><p>${esc(p.peakWindow)}</p><p>${esc(p.reason)}</p>${p.constraintNote?`<p class="note">${esc(p.constraintNote)}</p>`:''}<p>基础卡参考价 ${p.referencePrices.cardBefore}→${p.referencePrices.cardAfter}；所有权参考价 ${p.referencePrices.ownershipBefore}→${p.referencePrices.ownershipAfter}。不改实际挂牌价格与玩家资产。</p><table><tr><th>属性</th><th>原值</th><th>新值</th><th>变化</th></tr>${keys.map(k=>{const d=p.after[k]-p.before[k];return `<tr><td>${labels[k]}</td><td>${p.before[k]}</td><td>${p.after[k]}</td><td class="${d>0?'up':'down'}">${d>0?'+':''}${d||'—'}</td></tr>`;}).join('')}</table></details>`).join('')}<p><a href="../backups/s-player-final-before-20261116.zip">修改前完整备份</a> · <a href="applied.json">应用校验</a></p><script>document.querySelector('#q').addEventListener('input',e=>{let n=0;for(const d of document.querySelectorAll('details')){d.hidden=!d.dataset.search.toLowerCase().includes(e.target.value.toLowerCase());if(!d.hidden)n++}document.querySelector('#count').textContent='显示 '+n+' 人'})</script></html>`;
 assert.equal((html.match(/<details /g)||[]).length,70);fs.writeFileSync(path.join(out,'report.html'),html);
}
if(process.argv.includes('--prepare')){
 assert.ok(!fs.existsSync(manifestFile),'Backup exists; do not overwrite.');assert.ok(!fs.existsSync(ledgerFile));fs.mkdirSync(out,{recursive:true});
 const overall=read(path.join(root,'outputs/s-peak-overall-review-20261116/review.json')),character=read(path.join(root,'outputs/s-player-remaining-review-20261116/review.json'));
 for(const [f,h] of Object.entries(overall.sourceHashes))assert.equal(hash(path.join(root,f)),h,'Review is stale: '+f);
 const previous=read(path.join(root,'data/player-balance-s-peak-20261116.json')),previousIds=new Set(previous.players.map(p=>p.id)),reviews=new Map(character.players.map(p=>[p.id,p]));
 const earlierManifest=read(path.join(root,'outputs/backups/s-player-peak-before-20261116/manifest.json'));
 const files=[...new Set([...earlierManifest.files.map(e=>e.file),'data/player-balance-s-peak-20261116.json','devtool/s-player-peak-profiles.js','devtool/s-player-final-profiles.js','outputs/s-peak-overall-review-20261116/review.json','outputs/s-player-remaining-review-20261116/review.json'])];
 const entries=files.map(file=>({file,sha256:hash(path.join(root,file))}));
 // The live scheme is backed up before any candidate is built or applied.
 fs.mkdirSync(backup,{recursive:true});for(const e of entries)if(e.sha256){const dest=path.join(backup,e.file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,e.file),dest);assert.equal(hash(dest),e.sha256);}
 fs.copyFileSync(live,path.join(out,'before-content-copy.json'));const studio=path.join(root,'data/ydl-player-card-studio.json');if(fs.existsSync(studio))fs.copyFileSync(studio,path.join(out,'studio-copy.json'));else write(path.join(out,'studio-copy.json'),{});
 const before=effective(path.join(out,'before-content-copy.json'),path.join(backup,'effective-players-before.json')),byId=new Map(before.map(p=>[p.id,p]));
 assert.equal(Object.keys(S_FINAL_CORE).length,70);assert.equal(Object.keys(S_FINAL_CHARACTER).length,41);
 const players=overall.players.filter(p=>!p.locked).map(proposal=>{const p=byId.get(proposal.id);assert.ok(p);assert.equal(p.overall,proposal.current);const review=reviews.get(p.id),isPrior=previousIds.has(p.id),core=cores[roleGroup(p.role)],values=S_FINAL_CORE[p.name];assert.equal(values.length,core.length,p.name);
  const patch=S_FINAL_CHARACTER[p.name]??{};for(const k of Object.keys(patch)){assert.ok(keys.includes(k),k);assert.ok(!core.includes(k),`${p.name} noncore patch contains ${k}`);}
  assert.equal(Boolean(Object.keys(patch).length),!isPrior&&review?.priority!==3,p.name);
  const after={...p.attributes,...patch,...Object.fromEntries(core.map((k,i)=>[k,values[i]]))};assert.equal(values.reduce((n,v)=>n+v,0),proposal.recommended*core.length,`Core sum: ${p.name}`);
  const changed=p.overall!==proposal.recommended||keys.some(k=>p.attributes[k]!==after[k]);
  const finalPlayer={...p,overall:proposal.recommended,attributes:after};
  return {id:p.id,name:p.name,grade:p.grade,role:p.role,secondaryRole:p.secondaryRole,nationality:p.nationality,club:p.club,beforeOverall:p.overall,overall:proposal.recommended,before:p.attributes,after,changed,preserveNoncore:isPrior||review?.priority===3,category:isPrior?'保留上轮特点并联动总评':review.category,reason:isPrior?previous.players.find(q=>q.id===p.id).reason:review.reason,overallReason:proposal.reason,peakWindow:proposal.peakWindow,constraintNote:S_FINAL_CONSTRAINT_NOTES[p.name]??null,referencePrices:{cardBefore:s4BaseCardReferenceValue(p),cardAfter:s4BaseCardReferenceValue(finalPlayer),ownershipBefore:s4OwnershipReferenceValue(p),ownershipAfter:s4OwnershipReferenceValue(finalPlayer)}};
 });
 assert.equal(players.length,70);assert.equal(new Set(players.map(p=>p.id)).size,70);
 const ledger={revision:S_FINAL_REVISION,date:'2026-11-16',basis:'user-approved overall + peak-character review; game-design values',applicationLayer:'data/ydl-content-overrides.json',supersedesForScope:'s-peak-20261116-v1',protectedNames,formulaUnchanged:true,sourceReviewHashes:{overall:hash(path.join(root,'outputs/s-peak-overall-review-20261116/review.json')),character:hash(path.join(root,'outputs/s-player-remaining-review-20261116/review.json'))},players};
 const original=read(live),next=structuredClone(original);for(const p of players.filter(p=>p.changed))next.players[p.id]={...(next.players[p.id]??{}),overall:p.overall,attributes:p.after,balanceRevision:S_FINAL_REVISION};next.updatedAt=new Date().toISOString();write(candidate,next);
 const checks=verify(before,effective(candidate,path.join(out,'candidate-effective.json')),ledger);
 const normalized=read(candidate),allowed=new Set(players.filter(p=>p.changed).map(p=>p.id));for(const [id,patch] of Object.entries(original.players))if(!allowed.has(id))assert.deepEqual(normalized.players[id],patch,id);
 assert.deepEqual({...normalized,players:null,updatedAt:null},{...original,players:null,updatedAt:null});
 const candidateHash=hash(candidate);effective(candidate,path.join(out,'restart-effective.json'));assert.equal(hash(candidate),candidateHash,'Repeated load modified the approved candidate');for(const e of entries)assert.equal(hash(path.join(root,e.file)),e.sha256);
 write(ledgerFile,ledger);write(path.join(backup,'approved-final-profiles.json'),ledger);
 write(manifestFile,{revision:S_FINAL_REVISION,createdAt:new Date().toISOString(),files:entries,candidateSha256:candidateHash,ledgerSha256:hash(ledgerFile),checks,restore:{from:path.join(backup,'data/ydl-content-overrides.json'),to:live,note:'Stop service, restore the saved override, restart; returns to the already applied A scheme and first 18 S profiles. Does not restore player accounts or listings.'}});
 console.log(JSON.stringify({prepared:true,backup,...checks},null,2));
}else if(process.argv.includes('--apply')){
 const manifest=read(manifestFile),ledger=read(ledgerFile);assert.ok(fs.existsSync(backup+'.zip'));assert.equal(hash(candidate),manifest.candidateSha256);assert.equal(hash(ledgerFile),manifest.ledgerSha256);
 const alreadyApplied=hash(live)===manifest.candidateSha256;
 if(!alreadyApplied){for(const e of manifest.files)assert.equal(hash(path.join(root,e.file)),e.sha256,e.file);const pending=live+'.s-final-pending';assert.ok(!fs.existsSync(pending));fs.copyFileSync(candidate,pending,fs.constants.COPYFILE_EXCL);assert.equal(hash(pending),manifest.candidateSha256);fs.renameSync(pending,live);}
 fs.copyFileSync(live,path.join(out,'applied-content-copy.json'));const checks=verify(read(path.join(backup,'effective-players-before.json')),effective(path.join(out,'applied-content-copy.json'),path.join(out,'effective-players-after.json')),ledger);
 for(const e of manifest.files)if(path.join(root,e.file)!==live)assert.equal(hash(path.join(root,e.file)),e.sha256,e.file);
 write(path.join(out,'applied.json'),{revision:S_FINAL_REVISION,appliedAt:new Date().toISOString(),alreadyApplied,...checks});report(ledger,checks);console.log(JSON.stringify({applied:true,...checks},null,2));
}else if(process.argv.includes('--verify')){
 const manifest=read(manifestFile),ledger=read(ledgerFile);fs.copyFileSync(live,path.join(out,'verified-content-copy.json'));const checks=verify(read(path.join(backup,'effective-players-before.json')),effective(path.join(out,'verified-content-copy.json'),path.join(out,'verified-effective.json')),ledger);
 for(const e of manifest.files)if(path.join(root,e.file)!==live)assert.equal(hash(path.join(root,e.file)),e.sha256,e.file);console.log(JSON.stringify(checks,null,2));
}else throw Error('Use --prepare, --apply or --verify.');
