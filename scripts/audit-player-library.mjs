// Read-only audit of the effective library. Content migrations run against copies.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {S4_PLAYER_DATABASE} from '../versus/player-pool-s4-generated.js';
import {S4_DLC_PLAYER_DATABASE} from '../versus/player-pool-s4-dlc-generated.js';
import {ATTRIBUTE_NAMES,ATTRIBUTE_LABELS,PLAYER_OVERALL_ATTRIBUTE_KEYS,playerOverallFromAttributes,roleGroup} from '../shared/football/schema.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'outputs',process.argv.includes('--after-repair')?'player-data-fix/audit':'player-audit');fs.mkdirSync(out,{recursive:true});
const sourceFiles=['versus/player-pool-s4-generated.js','versus/player-pool-s4-dlc-generated.js','data/ydl-content-overrides.json','data/ydl-player-card-studio.json'];
const hash=p=>fs.existsSync(path.join(root,p))?createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex'):null;
const hashes=Object.fromEntries(sourceFiles.map(p=>[p,hash(p)]));
for(const [file,variable] of [['ydl-content-overrides.json','YDL_CONTENT_OVERRIDES_PATH'],['ydl-player-card-studio.json','YDL_PLAYER_CARD_STUDIO_PATH']]) {
  const from=path.join(root,'data',file),to=path.join(out,file);
  if(fs.existsSync(from))fs.copyFileSync(from,to);
  else fs.writeFileSync(to,'{}');
  process.env[variable]=to;
}
const base=structuredClone(REAL_PLAYERS);
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const players=structuredClone(REAL_PLAYERS);
const sources=new Map([...S4_PLAYER_DATABASE,...S4_DLC_PLAYER_DATABASE].map(p=>[p.id,p]));
const median=values=>{const a=values.toSorted((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const group=(values,key)=>{const map=new Map();for(const p of values){const k=key(p);if(!map.has(k))map.set(k,[]);map.get(k).push(p);}return map;};
function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted&&c==='"'&&text[i+1]==='"'){cell+='"';i++;continue;}
    if(c==='"'){quoted=!quoted;continue;}
    if(!quoted&&c===','){row.push(cell);cell='';continue;}
    if(!quoted&&c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue;}
    cell+=c;
  }
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift();return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
const ea=new Map(parseCsv(fs.readFileSync(path.join(root,'data/sources/eafc26-player-database-20251124/EAFC26-Men.csv'),'utf8')).map(p=>[p.ID,p]));
const regular=players.filter(p=>p.grade!=='X');
const cohorts=group(regular,p=>p.role+':'+p.grade);
const identical=[...group(regular,p=>ATTRIBUTE_NAMES.map(k=>p.attributes[k]).join(',')).values()].filter(g=>g.length>1);
const rows=players.map(p=>{
  const s=sources.get(p.id),notes=[],flags=[],hard=[];
  const add=(code,text)=>{flags.push(code);notes.push(text);};
  const core=PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(p.role)];
  for(const k of ATTRIBUTE_NAMES)if(!Number.isFinite(p.attributes[k])||p.attributes[k]<1||p.attributes[k]>96)hard.push('属性范围:'+k);
  if(p.grade!=='X') {
    if(playerOverallFromAttributes(p.attributes,p.role)!==p.overall)hard.push('总评不一致');
    if(roleGroup(p.role)!==p.pool)hard.push('位置池不一致');
    const band={S:[90,96],A:[86,89],B:[80,85],C:[75,79]}[p.grade];
    if(!band||p.overall<band[0]||p.overall>band[1])hard.push('评级区间');
    if(!Number.isFinite(p.heightCm)||p.heightCm<140||p.heightCm>220)hard.push('身高');
    if(new Set(core.map(k=>p.attributes[k])).size===1)add('flat-core','总评核心属性全部相等（结构提示）');
    if(p.role!=='GK'&&Math.abs(p.attributes.pace-p.attributes.acceleration)>=25)add('pace-gap',`速度 ${p.attributes.pace} / 加速 ${p.attributes.acceleration}，差值≥25`);
    if(p.development?.potential<p.overall)add('potential',`潜力 ${p.development.potential} 低于总评 ${p.overall}（元数据）`);
  } else notes.push('保留 X 模板：固定 62、位置与身高由玩家配置，不作为常规球员异常');
  const eaId=String(s?.sourceId??'').match(/^\d+$/)?.[0]??s?.sourceUrl?.match(/player-ratings\/[^/]+\/(\d+)/)?.[1];
  const reference=ea.get(eaId);
  if(p.role==='GK'&&reference&&Number(reference.PAC)===Number(reference['GK Diving'])&&Number(reference.DRI)===Number(reference['GK Reflexes'])) {
    const adjustment=Number(s.attributes.acceleration)-Number(reference.Acceleration);
    if(s.attributes.pace===Number(reference.PAC)+adjustment&&s.attributes.dribbling===Number(reference.DRI)+adjustment)
      add('gk-mapping',`源 PAC/DRI 对应扑救/反应，被用于速度/盘带；现为 ${p.attributes.pace}/${p.attributes.dribbling}`);
  }
  if(s?.isDlc&&!['game-final','target-scaled'].includes(s.attributeBasis)&&Number(s.referenceOverall)>0&&playerOverallFromAttributes(s.attributes,s.role)===s.suggestedOverall&&s.referenceOverall!==s.suggestedOverall) {
    const delta=s.suggestedOverall-s.referenceOverall;
    const confirmedFinal=/^s4-dlc[23]-/.test(s.id);
    add(confirmedFinal?'dlc-renormalized':'dlc-reference-review',`源属性 OVR 恰与目标 ${s.suggestedOverall} 相同，参考 ${s.referenceOverall}，偏移 ${delta>0?'+':''}${delta}；${confirmedFinal?'该批已确认是最终属性':'仅为复核提示，首批参考属性不能据此认定已完成回归'}`);
  }
  if(p.id==='s4-dlc-20260731-009'){if(s?.dataCorrections?.composure?.kind==='estimated-missing-value')notes.push('冷静缺失已估算：历史原始值 0，以同条反应 72 补值；游戏内 '+p.attributes.composure+'，非实测值');else add('neville-composure','冷静缺失值待修复：当前 '+p.attributes.composure);}
  const caps=ATTRIBUTE_NAMES.filter(k=>p.attributes[k]===96);
  if(p.grade!=='S'&&p.grade!=='X'&&caps.length>=5)add('many-caps',`${caps.length} 项达到 96：${caps.map(k=>ATTRIBUTE_LABELS[k]).join('、')}`);
  const duplicate=identical.find(g=>g.some(q=>q.id===p.id));
  if(duplicate&&!duplicate.some(q=>q.id==='legend-messi-rat'))add('identical',`26 项属性完全相同：${duplicate.filter(q=>q.id!==p.id).map(q=>q.name).join('、')}`);
  if(p.id==='legend-messi-rat')notes.push('梅西的显式彩蛋复制，不判作重复录入');
  if(hard.length)add('structure',`结构检查：${hard.join('、')}；主位置 ${p.role} / 抽卡池 ${p.pool}`);
  const peers=cohorts.get(p.role+':'+p.grade)??[],outliers=[];
  if(peers.length>=10)for(const k of ATTRIBUTE_NAMES.filter(k=>p.role==='GK'||!['goalkeeping','reflexes'].includes(k))) {
    const values=peers.map(q=>q.attributes[k]),m=median(values),mad=median(values.map(v=>Math.abs(v-m))),z=Math.abs(p.attributes[k]-m)/Math.max(3,1.4826*mad);
    if(Math.abs(p.attributes[k]-m)>=15&&z>=3.5)outliers.push({attribute:k,value:p.attributes[k],median:m,robustZ:+z.toFixed(2),peers:peers.length});
  }
  return {id:p.id,name:p.name,sourceName:p.sourceName??'',grade:p.grade,role:p.role,pool:p.pool,overall:p.overall,
    sourceOverall:s?.suggestedOverall??null,referenceOverall:s?.referenceOverall??null,batch:p.dlcBatch??(p.grade==='X'?'X模板':'基础库'),
    heightCm:p.heightCm,potential:p.development?.potential,attributes:p.attributes,flags,notes,hard,outliers,
    changedByOverride:JSON.stringify(p.attributes)!==JSON.stringify(base.find(q=>q.id===p.id)?.attributes)};
});
const count=key=>Object.fromEntries([...group(rows,p=>p[key])].map(([k,v])=>[k,v.length]));
const flagCounts=Object.fromEntries([...new Set(rows.flatMap(r=>r.flags))].map(k=>[k,rows.filter(r=>r.flags.includes(k)).length]));
const duplicatedIds=[...group(rows,p=>p.id)].filter(([,v])=>v.length>1).map(([k])=>k);
const summary={date:'2026-11-16',total:rows.length,regular:regular.length,grades:count('grade'),pools:count('pool'),batches:count('batch'),
  hardErrors:rows.filter(p=>p.hard.length).length,duplicatedIds,flagCounts,outlierPlayers:rows.filter(p=>p.outliers.length).length,
  changedByOverride:rows.filter(p=>p.changedByOverride).length,sourceHashes:hashes};
for(const p of sourceFiles)if(hash(p)!==hashes[p])throw Error('Source unexpectedly changed: '+p);
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({summary,rows},null,2));
const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const headers=['ID','姓名','英文名','评级','位置','总评','来源批次',...ATTRIBUTE_NAMES.map(k=>ATTRIBUTE_LABELS[k]),'复核说明','统计离群'];
fs.writeFileSync(path.join(out,'all-players.csv'),'\uFEFF'+[headers,...rows.map(p=>[p.id,p.name,p.sourceName,p.grade,p.role,p.overall,p.batch,...ATTRIBUTE_NAMES.map(k=>p.attributes[k]),p.notes.join('；'),p.outliers.map(o=>`${ATTRIBUTE_LABELS[o.attribute]} ${o.value}（同组中位 ${o.median}）`).join('；')])].map(r=>r.map(csvCell).join(',')).join('\r\n'));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pick=id=>rows.find(p=>p.id===id);
const examples=[['s4-dlc-20260731-009','冷静','composure','已记录缺失值估算依据'],['s4-dlc2-20260803-035','射门','finishing','DLC 最终属性口径复核'],['s4-dlc3-20260808-028','抢断','tackling','DLC 最终属性口径复核'],['legend-courtois','盘带','dribbling','按外场明细映射'],['s4-fc26-203263','速度','pace','复核速度与加速差值'],['s4-fc26-178509','速度','pace','复核速度与加速差值']].map(([id,label,key,reason])=>[id,label+' '+pick(id).attributes[key],reason]);
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YFFM1 全球员库审阅</title><style>body{font:15px/1.75 system-ui,sans-serif;max-width:1400px;margin:40px auto;padding:0 24px;color:#192d29;background:#f4f7f5}h1{font-size:30px}h2{margin-top:32px}.summary{padding:22px;background:#123e32;color:white;border-radius:16px}.summary b{font-size:28px}table{border-collapse:collapse;width:100%;background:white}th,td{padding:10px;border:1px solid #dfe8e3;text-align:left;vertical-align:top}th{background:#e7eee9;position:sticky;top:0}small{color:#61776c}.wide{overflow:auto;max-height:75vh}input,select{padding:10px;border:1px solid #b8cec1;border-radius:6px;margin:6px}a{color:#0d6d50}.attr{white-space:nowrap}#all td{font-size:12px}#all th{white-space:nowrap}li{margin:6px 0}</style><h1>YFFM1 全球员库审阅</h1><p>2026-11-16 · 实际运行名单＋后台覆盖 · 只读检查，未修改球员数值</p><div class="summary"><b>${rows.length} 名</b>：${regular.length} 名常规／传奇＋10 名 X 模板。属性越界、缺失、总评不一致、评级区间、位置池和重复 ID 检查：${summary.hardErrors} 名硬错误、${duplicatedIds.length} 个重复 ID。</div><h2>最值得处理的结论</h2><ol><li><b>DLC2/3 二次归一化：</b>当前 ${S4_DLC_PLAYER_DATABASE.filter(p=>['2026-08-03','2026-08-08'].includes(p.dlcBatch)&&p.attributeBasis==='game-final').length} 名显式标记最终游戏属性，跳过参考总评偏移。仍满足重复偏移规则的球员 ${flagCounts['dlc-renormalized']??0} 名。历史参考总评为 0 时旧代码会回退目标总评，因此不能按 0 计算额外偏移。</li><li><b>门将字段映射：</b>仍有 ${flagCounts['gk-mapping']??0} 名命中 PAC/DRI 误用规则；${S4_PLAYER_DATABASE.filter(p=>p.goalkeeperMappingVersion===1).length} 名已经使用 Sprint Speed/Dribbling 明细。历史门将原有外场能力保留，切赫、范德萨的低盘带不应因此上调。</li><li><b>单人异常：</b>加里·内维尔当前冷静 ${pick('s4-dlc-20260731-009').attributes.composure}；导入修正明确记录了以历史反应值补足冷静缺失的估算依据。未使用全库统一均值。</li><li><b>总评配平副作用：</b>${flagCounts['pace-gap']} 名非门将速度/加速相差至少 25；${flagCounts['flat-core']} 名核心属性完全相等。配平算法优先补最弱项、削最高项，容易消除特点。建议约束单属性偏移与速度/加速关系，而非强制全部核心属性收敛。</li><li><b>位置池：</b>法比奥·科恩特朗主位置 LB，当前池 ${pick('s4-dlc-20260731-024').pool}。当前结构硬检查项 ${summary.hardErrors} 人。</li><li><b>次要问题：</b>${flagCounts.potential} 名潜力低于当前总评，源自覆盖后元数据未同步；当前 ${flagCounts.identical??0} 人存在非彩蛋的26项完整重复属性。属于一致性和辨识度问题，不能单凭此认定竞技失衡。</li></ol><table><thead><tr><th>球员</th><th>现状</th><th>判断</th></tr></thead><tbody>${examples.map(([id,detail,reason])=>`<tr><td>${esc(pick(id).name)}<br><small>${esc(id)}</small></td><td>${esc(detail)}</td><td>${esc(reason)}</td></tr>`).join('')}</tbody></table><h2>建议处理顺序</h2><p>先验证导入语义和门将映射，再核实内维尔等单值；总评配平与重复模板需要独立平衡评估及固定种子的同阵容替换比赛。当前结论是静态数据与代码链路审阅，未把离群值直接当作胜率优势，也未进行真人现实能力重评。</p><h2>检查方法与范围</h2><p>基础库 550 条，DLC 175 条覆盖其中 3 条，再加梅老鼠 1 条、X 模板 10 条；加载本机后台覆盖（${summary.changedByOverride} 名属性发生变化），无本机已发布工作室自定义球员。复制覆盖文件到输出目录后调用同一加载代码，源文件 SHA-256 前后保持一致。EA 明细来自项目内 2025-11-24 数据快照，不代表最新球员状态。</p><p>统计复核采用同位置、同评级至少 10 人的分组：偏离中位数至少 15，且 |差值| / max(3, 1.4826×MAD) ≥ 3.5。共 ${summary.outlierPlayers} 人触发统计复核；低防守的攻击手、低盘带的门将等可能是合理特点。X 模板与显式梅西彩蛋单独识别。</p><p><a href="all-players.csv">下载完整 733 人属性表 CSV</a> · <a href="audit.json">结构化检查结果与源文件哈希</a></p><h2>完整名单与逐人检查</h2><input id="search" placeholder="搜索姓名、ID、异常说明"><select id="filter"><option value="all">全部球员</option><option value="flag">有结构复核项</option><option value="stat">有统计离群项</option><option value="gk-mapping">门将映射</option><option value="dlc-renormalized">二次归一化</option></select><span id="count"></span><div class="wide"><table id="all"><thead><tr><th>姓名／ID</th><th>评级／位置／OVR</th><th>批次</th><th>复核说明</th><th>统计离群（非错误判定）</th>${ATTRIBUTE_NAMES.map(k=>`<th>${ATTRIBUTE_LABELS[k]}</th>`).join('')}</tr></thead><tbody>${rows.map(p=>`<tr data-flags="${esc(p.flags.join(' '))}" data-stat="${Boolean(p.outliers.length)}"><td>${esc(p.name)}<br><small>${esc(p.id)}</small></td><td>${p.grade} / ${p.role??'待选'} / ${p.overall}</td><td>${p.batch}</td><td>${esc(p.notes.join('；')||'未触发结构规则')}</td><td>${esc(p.outliers.map(o=>`${ATTRIBUTE_LABELS[o.attribute]} ${o.value} / 中位 ${o.median}`).join('；'))}</td>${ATTRIBUTE_NAMES.map(k=>`<td class="attr">${p.attributes[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div><script>const rows=[...document.querySelectorAll('#all tbody tr')];function apply(){const q=document.querySelector('#search').value.toLowerCase(),f=document.querySelector('#filter').value;let n=0;for(const r of rows){const ok=r.textContent.toLowerCase().includes(q)&&(f==='all'||f==='flag'&&r.dataset.flags||f==='stat'&&r.dataset.stat==='true'||r.dataset.flags.split(' ').includes(f));r.hidden=!ok;if(ok)n++;}document.querySelector('#count').textContent=n+' 名';}document.querySelector('#search').oninput=apply;document.querySelector('#filter').onchange=apply;apply();</script></html>`;
fs.writeFileSync(path.join(out,'report.html'),html);
console.log(JSON.stringify(summary,null,2));
