// Run audit-player-library.mjs --after-repair first. Never reads account saves.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES,ATTRIBUTE_LABELS} from '../shared/football/schema.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const before=read('outputs/backups/player-data-before-20261116/effective-players.json');
const after=read('outputs/player-data-fix/audit/audit.json').rows;
const byId=new Map(before.map(p=>[p.id,p]));
assert.equal(before.length,733);assert.equal(after.length,733);
assert.equal(new Set(after.map(p=>p.id)).size,733);
const rows=after.map(p=>{
  const old=byId.get(p.id);assert.ok(old,p.id);
  for(const key of ['overall','grade','role'])assert.equal(p[key],old[key],`${p.id}:${key}`);
  const metadataChanges=p.pool===old.pool?[]:[{key:'pool',label:'位置池',before:old.pool,after:p.pool}];
  if(metadataChanges.length){assert.equal(p.id,'s4-dlc-20260731-024');assert.equal(old.pool,'MID');assert.equal(p.pool,'DEF');}
  const changes=ATTRIBUTE_NAMES.filter(k=>p.attributes[k]!==old.attributes[k]).map(k=>({key:k,label:ATTRIBUTE_LABELS[k],before:old.attributes[k],after:p.attributes[k]}));
  if(changes.length){
    if(p.id==='s4-dlc-20260731-009')assert.deepEqual(changes.map(c=>[c.key,c.before,c.after]),[['composure',11,82]]);
    else {
      assert.ok(p.role==='GK'||/^s4-dlc[23]-/.test(p.id),`unexpected change: ${p.id}`);
      if(!/^s4-dlc[23]-/.test(p.id))assert.ok(changes.every(c=>['pace','dribbling'].includes(c.key)),`GK ability changed: ${p.id}`);
    }
  }
  return {id:p.id,name:p.name,grade:p.grade,role:p.role,overall:p.overall,changes,metadataChanges};
});
const changed=rows.filter(p=>p.changes.length||p.metadataChanges.length);
const summary={total:rows.length,changed:changed.length,dlcChanged:changed.filter(p=>/^s4-dlc[23]-/.test(p.id)).length,goalkeepersChanged:changed.filter(p=>p.role==='GK'&&!/^s4-dlc[23]-/.test(p.id)).length,individualAttributeChanges:1,poolChanges:rows.filter(p=>p.metadataChanges.length).length,overallChanges:0,gradeChanges:0,unchanged:rows.length-changed.length};
assert.equal(summary.dlcChanged,83);assert.equal(summary.goalkeepersChanged,50);
const out=path.join(root,'outputs/player-data-fix');
fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify({summary,rows},null,2));
const csv=v=>'"'+String(v).replaceAll('"','""')+'"';
fs.writeFileSync(path.join(out,'changes.csv'),'\uFEFF'+[['ID','姓名','评级','总评','属性','修复前','修复后'],...changed.flatMap(p=>[...p.changes,...p.metadataChanges].map(c=>[p.id,p.name,p.grade,p.overall,c.label,c.before,c.after]))].map(r=>r.map(csv).join(',')).join('\r\n'));
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
fs.writeFileSync(path.join(out,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>球员数据修复前后对照</title><style>body{font:16px/1.8 system-ui;background:#f4f7f5;color:#18392d;max-width:1200px;margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%;background:white}td,th{padding:12px;border:1px solid #d7e5dd;text-align:left}th{background:#e8f0eb}small{color:#68776f}input{padding:12px;width:90%;margin:20px 0}a{color:#14644b}</style><h1>球员数据修复前后对照</h1><p>2026-11-16 · 733 人逐项对比，${summary.changed} 人数据变化，${summary.unchanged} 人不变。总评、评级、主副位置保持原值；科恩特朗位置池修正为 DEF。</p><ul><li>DLC2/3 共 121 人显式使用最终游戏属性，83 人实际数值恢复；其余人原本没有有效偏移。之前 110 人的估算包含 27 个空参考总评，旧代码对它们回退目标总评，所以并未再次偏移。</li><li>50 名门将仅修改速度、盘带，改取 Sprint Speed、Dribbling 明细；扑救、反应及其他属性不变。诺伊尔完整匹配旧错误值的后台覆盖同步修正，不覆盖其他人工修改。</li><li>保留已有强化规则。源文件、有效球员库及后台覆盖的修改前副本位于 outputs/backups/player-data-before-20261116。</li><li>单人修正：内维尔历史冷静 0 属缺失，以同条历史反应 72 作明确标注的估算补值，游戏内 11→82；科恩特朗位置池 MID→DEF，属性不变。</li></ul><p><a href="changes.csv">逐属性差异 CSV</a> · <a href="comparison.json">完整 733 人对比 JSON</a> · <a href="audit/report.html">修复后全库复核</a></p><input id="query" placeholder="搜索球员姓名或 ID"><table><thead><tr><th>球员</th><th>评级 / 总评</th><th>属性变化（原值 → 新值）</th></tr></thead><tbody>${changed.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.id)}</small></td><td>${esc(p.grade)} / ${p.overall}</td><td>${[...p.changes,...p.metadataChanges].map(c=>`${esc(c.label)} ${c.before} → ${c.after}`).join('；')}</td></tr>`).join('')}</tbody></table><script>document.querySelector('#query').addEventListener('input',e=>{for(const row of document.querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase());});</script></html>`);
console.log(JSON.stringify(summary,null,2));
