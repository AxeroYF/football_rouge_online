import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES,ATTRIBUTE_LABELS} from '../shared/football/schema.js';
import {TIERS,TIER_RULES,ROLE_LABELS,PROFILES,METRICS,METRIC_LABELS,scoreProfiles,evaluate,best,round,isSpecial} from '../devtool/player-tier-model.js';
import {renderTierReport} from '../devtool/player-tier-report.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'outputs/player-tier-lists-20261116');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.mkdirSync(out,{recursive:true});
// Import content-store only after redirecting BOTH stores into the report folder.
const sources=[...fs.readdirSync(path.join(root,'data'),{recursive:true}).filter(p=>p.endsWith('.json')).map(p=>path.join('data',p)),
 'versus/player-pool.js','versus/player-pool-s4-generated.js','versus/player-pool-s4-dlc-generated.js',
 'versus/v2/match-parameters-v2.json','versus/v2/spatial-model-v2.js','versus/v2/match-engine-v2.js','versus/v2/team-snapshot-v2.js',
 'versus/s4-balance.js','shared/football/schema.js'];
const before=Object.fromEntries(sources.map(p=>[p,hash(path.join(root,p))]));
const content=path.join(out,'isolated-content.json'),studio=path.join(out,'isolated-studio.json');
fs.copyFileSync(path.join(root,'data/ydl-content-overrides.json'),content);
const liveStudio=path.join(root,'data/ydl-player-card-studio.json');
if(fs.existsSync(liveStudio))fs.copyFileSync(liveStudio,studio);
const script="import fs from 'node:fs';const {REAL_PLAYERS}=await import('./versus/player-pool.js');const {flushContentWrites}=await import('./versus/ydl-content-store.js');await flushContentWrites();fs.writeFileSync(process.env.TIER_OUTPUT,JSON.stringify(REAL_PLAYERS,null,2));";
execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:root,windowsHide:true,stdio:'pipe',env:{...process.env,YDL_CONTENT_OVERRIDES_PATH:content,YDL_PLAYER_CARD_STUDIO_PATH:studio,TIER_OUTPUT:path.join(out,'effective-players.json')}});
const all=read(path.join(out,'effective-players.json'));
assert.equal(all.length,733);assert.equal(new Set(all.map(p=>p.id)).size,733);
const previous=read(path.join(root,'outputs/s-player-final-applied-20261116/verified-effective.json'));
assert.deepEqual(all,previous,'Effective pool changed since the last approved S adjustment; review before ranking.');
const players=all.filter(p=>['A','B','C','S'].includes(p.grade));
assert.equal(players.length,723);
for(const p of players){assert.ok(p.role);for(const k of ATTRIBUTE_NAMES)assert.ok(Number.isFinite(p.attributes[k])&&p.attributes[k]>=1&&p.attributes[k]<=99,`${p.name}:${k}`);}
for(const p of PROFILES)assert.ok(Math.abs(Object.values(p.weights).reduce((a,b)=>a+b,0)-1)<1e-9,p.id);
for(const [k,w] of Object.entries(METRICS))assert.ok(Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)<1e-9,k);

const entries=players.map(p=>({id:p.id,name:p.name,grade:p.grade,overall:p.overall,role:p.role,secondaryRole:p.secondaryRole,
 nationality:p.nationality,club:p.club,heightCm:p.heightCm,preferredFoot:p.preferredFoot,attributes:p.attributes,special:isSpecial(p),
 specialNote:p.name==='古德温'?'彩蛋球员；参与展示，不参与普通球员标杆计算':p.name==='梅老鼠'?'梅西别名卡；独立展示，不重复计入常规人数':'',levels:{}}));
const byId=new Map(entries.map(p=>[p.id,p]));
const summary={},rankings={},positionRankings={};
const compact=(p,s,scores)=>({id:p.id,name:p.name,grade:p.grade,overall:p.overall,role:s.role,profile:s.profileName,tier:s.tier,pureTier:TIERS[Math.min(...scores.map(x=>TIERS.indexOf(x.pureTier)))],
 quality:round(s.quality),index:round(s.index),gap:round(s.gap),costBonus:round(s.bonus),leader:s.leader.name,leaderOverall:s.leader.overall});
const ordered=(evaluated,role=null)=>evaluated.map(({player,scores})=>({player,scores:scores.filter(s=>!role||s.role===role),s:best(scores,role)})).filter(x=>x.s)
 .sort((a,b)=>TIERS.indexOf(a.s.tier)-TIERS.indexOf(b.s.tier)||b.s.index-a.s.index||b.s.quality-a.s.quality).map(({player,s,scores})=>compact(player,s,scores));
for(const group of ['ABC','S']){
 const list=players.filter(p=>group==='S'?p.grade==='S':p.grade!=='S');
 for(const level of [0,4,8]){
  const evaluated=evaluate(list.map(player=>({player,scores:scoreProfiles(player,level)})),.5);
  for(const {player,scores} of evaluated){assert.ok(scores.length);byId.get(player.id).levels[level]=scores.map(s=>{
   assert.ok(Number.isFinite(s.quality));return {role:s.role,profile:s.profile,quality:s.quality,fit:s.fit,execution:s.execution,leader:s.leader,gap:s.gap};});}
  if(level===0){
   const sorted=ordered(evaluated);
   rankings[group]=sorted;
   summary[group]={total:list.length,regular:list.filter(p=>!isSpecial(p)).length,tiers:Object.fromEntries(TIERS.map(t=>[t,sorted.filter(p=>p.tier===t).length])),byGrade:Object.fromEntries([...new Set(list.map(p=>p.grade))].map(g=>[g,Object.fromEntries(TIERS.map(t=>[t,sorted.filter(p=>p.grade===g&&p.tier===t).length]))])),promoted:sorted.filter(p=>TIERS.indexOf(p.tier)<TIERS.indexOf(p.pureTier)).length};
   positionRankings[group]=Object.fromEntries(Object.keys(ROLE_LABELS).map(role=>[role,ordered(evaluated,role)]));
  }
 }
}
// Counterfactual checks catch reversed cost signs and enhancement regressions.
for(const p of entries){for(const score of p.levels[0]){const enhanced=p.levels[8].find(s=>s.role===score.role&&s.profile===score.profile);assert.ok(enhanced.quality>=score.quality-1e-9,p.name);}}
for(const p of players.filter(p=>!isSpecial(p))){const base=scoreProfiles(p),cheap=evaluate([{player:p,scores:base},{player:{...p,id:p.id+'-cheaper',overall:p.overall-1,name:p.name+'-test'},scores:base}],.5);assert.ok(best(cheap[1].scores).index>=best(cheap[0].scores).index);}
assert.deepEqual(Object.fromEntries(sources.map(p=>[p,hash(path.join(root,p))])),before,'Read-only analysis changed source data');
assert.equal(rankings.ABC.length,650);assert.equal(rankings.S.length,73);
for(const group of ['ABC','S'])assert.equal(new Set(rankings[group].map(p=>p.id)).size,rankings[group].length);
const payload={date:'2026-11-16',defaultCostWeight:.5,defaultEnhancement:0,tiers:TIERS,rules:TIER_RULES,roles:ROLE_LABELS,attributeLabels:ATTRIBUTE_LABELS,metricLabels:METRIC_LABELS,profiles:PROFILES,metrics:METRICS,summary,players:entries};
write('rankings.json',{date:payload.date,defaultCostWeight:.5,rules:TIER_RULES,profiles:PROFILES,metrics:METRICS,summary,total:rankings,byPosition:positionRankings,players:entries});
write('verification.json',{players:all.length,ranked:723,abc:650,s:73,excludedX:10,positionRows:Object.fromEntries(Object.entries(positionRankings).map(([g,v])=>[g,Object.values(v).reduce((a,b)=>a+b.length,0)])),sameAsApprovedPool:true,sourceFilesUnchanged:sources.length,checks:['unique complete coverage','all 26 attributes valid','weights sum to one','all role scores finite','enhancement monotonicity','lower overall never reduces value at equal attributes','current pool equals approved pool','source SHA-256 unchanged'],sourceHashes:before,modelHash:hash(path.join(root,'devtool/player-tier-model.js'))});
fs.writeFileSync(path.join(out,'report.html'),renderTierReport(payload));
// A printable, script-free companion keeps the complete lists accessible in
// viewers which do not execute the interactive report's JavaScript.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=rows=>'<table><tr><th>名次</th><th>球员</th><th>卡级／总评</th><th>综合等级</th><th>纯实力</th><th>最佳位置／踢法</th><th>模型实力</th><th>成本修正</th><th>国家／俱乐部</th></tr>'+rows.map((p,i)=>{const identity=byId.get(p.id);return `<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${p.grade} ${p.overall}</td><td>${p.tier}</td><td>${p.pureTier}</td><td>${ROLE_LABELS[p.role]} · ${p.profile}</td><td>${p.quality.toFixed(2)}</td><td>${p.costBonus>0?'+':''}${p.costBonus.toFixed(2)}</td><td>${esc(identity.nationality)}／${esc(identity.club)}</td></tr>`;}).join('')+'</table>';
const staticHtml='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>球员完整名单 · 总榜与分位置榜</title><style>body{font:14px/1.7 system-ui,"Microsoft YaHei";color:#243d45;max-width:1450px;margin:30px auto;padding:0 20px}a{color:#18745e}nav{background:#eef5f2;padding:16px;line-height:2.2}table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:32px}th,td{border-bottom:1px solid #dde5e6;text-align:left;padding:8px}th{background:#eaf1ef}h2{border-top:3px solid #31745f;padding-top:16px}tr{break-inside:avoid}@media print{h2{break-before:page}nav{display:none}}</style><h1>球员完整名单 · 2026-11-16</h1><p>默认 +0，适度考虑成本。ABC 与 S 各自取位置／打法标杆，毕业级为榜内定位，两个榜的等级不代表同等绝对实力。低总评每低 1 点折算 0.5 模型分，封顶 ±1.5；实力门槛优先。不可用指不宜作为后期主力培养。S 含古德温、梅老鼠，普通 S 为 71 人。</p><p><a href="report.html">交互版：完整 26 项、替代候选、强化和成本切换、方法说明</a> · <a href="rankings.json">完整 JSON</a></p><nav>'+['ABC','S'].map(g=>`<b>${g}：</b><a href="#${g}-total">总榜 (${summary[g].total})</a>　`+Object.keys(ROLE_LABELS).map(r=>`<a href="#${g}-${r}">${ROLE_LABELS[r]}</a>`).join(' · ')).join('<br>')+'</nav>'+['ABC','S'].map(g=>`<h2 id="${g}-total">${g} 总榜 · ${summary[g].total} 人</h2><p>${Object.entries(summary[g].tiers).map(([t,n])=>t+' '+n).join(' · ')}</p>`+table(rankings[g])+Object.entries(positionRankings[g]).map(([r,rows])=>`<h2 id="${g}-${r}">${g} · ${ROLE_LABELS[r]}榜 · ${rows.length} 人</h2><p>主副位置均可入榜，已计位置及惯用脚适配。</p>`+table(rows)).join('')).join('')+'</html>';
fs.writeFileSync(path.join(out,'lists.html'),staticHtml);
console.log(JSON.stringify({summary,s:rankings.S,abcGraduates:rankings.ABC.filter(p=>p.tier===TIERS[0]),cheapPromotions:rankings.ABC.filter(p=>p.grade!=='A'&&TIERS.indexOf(p.tier)<2).slice(0,20)},null,2));
