// Read-only proposal from an isolated effective-player snapshot; never edits game data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PLAYER_OVERALL_ATTRIBUTE_KEYS,roleGroup} from '../shared/football/schema.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'outputs/a-player-balance-plan');
const players=JSON.parse(fs.readFileSync(path.join(out,'players-snapshot.json'),'utf8'));
assert.equal(players.length,722);
const mean=values=>values.length?Number((values.reduce((s,v)=>s+v,0)/values.length).toFixed(2)):null;
const a=players.filter(p=>p.grade==='A'),s=players.filter(p=>p.grade==='S');
const histogram=ps=>Object.fromEntries([...new Set(ps.map(p=>p.overall))].sort((a,b)=>a-b).map(n=>[n,ps.filter(p=>p.overall===n).length]));
const proposed={86:115,87:80,88:28,89:7};
assert.equal(Object.values(proposed).reduce((s,v)=>s+v,0),a.length);
const distribution={current:histogram(a),proposed,currentMean:mean(a.map(p=>p.overall)),proposedMean:mean(Object.entries(proposed).flatMap(([v,n])=>Array(n).fill(Number(v))))};
const noncore=(p,group)=>{
  const keys=Object.keys(p.attributes).filter(k=>!PLAYER_OVERALL_ATTRIBUTE_KEYS[group].includes(k)&&(group==='GK'||!['goalkeeping','reflexes'].includes(k)));
  return keys.reduce((sum,k)=>sum+p.attributes[k],0)/keys.length;
};
const comparisons=['GK','DEF','MID','ATT'].map(group=>{
  const ap=a.filter(p=>roleGroup(p.role)===group),sp=s.filter(p=>p.overall<=92&&roleGroup(p.role)===group);
  return {group,aCount:ap.length,s90to92Count:sp.length,aOverall:mean(ap.map(p=>p.overall)),sOverall:mean(sp.map(p=>p.overall)),aNoncore:mean(ap.map(p=>noncore(p,group))),sNoncore:mean(sp.map(p=>noncore(p,group)))};
});
const roles=['GK','CB','LB','RB','DM','AM','LM','RM','LW','RW','ST'];
function identityRows(field){
  const groups=new Map();
  for(const p of players){const name=p[field]?.trim();if(!name)continue;if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p);}
  return [...groups].map(([name,ps])=>{
    const as=ps.filter(p=>p.grade==='A'),nonS=ps.filter(p=>p.grade!=='S');
    const positionCandidates=Object.fromEntries(roles.map(role=>[role,nonS.filter(p=>p.overall>=85&&(p.role===role||p.secondaryRole===role)).map(p=>({id:p.id,name:p.name,overall:p.overall,grade:p.grade}))]));
    return {field,name,total:ps.length,open:ps.length>=10,S:ps.filter(p=>p.grade==='S').length,A:as.length,A88plus:as.filter(p=>p.overall>=88).length,nonS83plus:nonS.filter(p=>p.overall>=83).length,nonS85plus:nonS.filter(p=>p.overall>=85).length,positionCandidates,thin85Roles:roles.filter(r=>positionCandidates[r].length<=1),aPlayers:as.map(p=>({id:p.id,name:p.name,overall:p.overall,role:p.role,secondaryRole:p.secondaryRole}))};
  }).sort((a,b)=>b.total-a.total);
}
const nationality=identityRows('nationality'),clubs=identityRows('club');
const proposal={
  status:'proposal-only; no game records changed; no match simulations performed',
  snapshot:'effective library including local admin overrides; excludes X templates and Messi easter egg',
  counts:{total:players.length,S:s.length,A:a.length,B:players.filter(p=>p.grade==='B').length,C:players.filter(p=>p.grade==='C').length},
  distribution,comparisons,nationality,clubs,
  rules:[
    'A仍为86—89，第一轮不改评级、身份、主副位置、卡包概率、羁绊或强化规则；目标人数允许因位置保护小幅浮动。',
    '保留单项特长。核心属性随目标总评调整，保留相对差异；非核心属性仅对来源薄弱或明显超标项建议回收2—5点，不作全字段统一扣分。',
    '主要国家队和俱乐部至少保留3名87+的A核心；无S且现有A充足的巴黎、利物浦、马竞优先保留至少5名87+，其中至少1名88+。这是待逐人分配验证的约束，不是已经完成的候选名单。',
    '同组唯一/稀缺的门将、边后卫、后腰、边路球员优先保留岗位关键属性；保护表示少降或不降，不增加虚构来源或修改身份。',
    '现存位置缺口与本次新增缺口分开登记，不能用稀缺S作为普通玩家阵容的唯一兜底。',
    '逐人方案需验证5/7/9人羁绊骨架、常见阵型唯一球员分配、替补与同级强化后表现；位置候选人数可重叠，不代表可同时排出完整首发。',
  ],
};
fs.writeFileSync(path.join(out,'analysis.json'),JSON.stringify(proposal,null,2));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(headers,rows)=>`<div class="scroll"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const identityTable=rows=>table(['国家 / 俱乐部','总人数','S','A','A88+','非S且83+','非S且85+','非S85+仅0—1候选的位置'],rows.filter(r=>r.open).map(r=>[r.name,r.total,r.S,r.A,r.A88plus,r.nonS83plus,r.nonS85plus,r.thin85Roles.map(role=>`${role}(${r.positionCandidates[role].length})`).join('、')]));
fs.writeFileSync(path.join(out,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A球员数值调整提案</title><style>body{font:16px/1.75 system-ui;background:#f4f7f5;color:#18392d;max-width:1200px;margin:32px auto;padding:0 20px}h2{margin-top:32px}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #d7e5dd;padding:10px;text-align:left;vertical-align:top}th{background:#e8f0eb}.scroll{overflow:auto}a{color:#14644b}li{margin:12px 0}</style><h1>A球员数值调整提案</h1><p>2026-11-16 · 只读测算，未修改正式球员库。使用含本机管理员覆盖的有效数据：722名，S72、A230、B237、C183；排除10个X模板和梅西彩蛋。人数不是卡包产出率，也不是实际玩家持有量。</p><h2>建议分布</h2>${table(['A总评','当前人数','当前占比','建议人数','建议占比'],[86,87,88,89].map(v=>[v,distribution.current[v],(distribution.current[v]/a.length*100).toFixed(1)+'%',proposed[v],(proposed[v]/a.length*100).toFixed(1)+'%']))}<p>88—89由113人（49.1%）收缩至35人（15.2%）；A均值87.52→86.68。目标允许小幅浮动，必须先满足位置与羁绊骨架保护，不按人数强行切档。直接所有A减2分会让117人跌到84—85，跨入现有B区间。</p><h2>属性结构证据</h2>${table(['位置组','A人数','90—92 S人数','A总评均值','S总评均值','A非核心均值','S非核心均值'],comparisons.map(r=>[r.group,r.aCount,r.s90to92Count,r.aOverall,r.sOverall,r.aNoncore,r.sNoncore]))}<p>非核心指未参与该位置组总评公式的属性；外场排除门将扑救和反应。均值用于描述属性结构，不等于引擎实力或胜率，不同具体角色仍需分别核查。</p><h2>调整和保护规则</h2><ol>${proposal.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ol><h2>国家队覆盖</h2>${identityTable(nationality)}<h2>俱乐部覆盖</h2>${identityTable(clubs)}<p>表中位置按主/副位置计算，同一球员可能计入两列；85分仅为较强非S候选的诊断阈值，不把低于85的B/C判为不可用。主要国家/俱乐部由现有规模和阵容定位确定，未读取用户使用频率。</p><h2>需优先保护的结构</h2><ul><li>巴黎A12/S0、利物浦A10/S0、马竞A9/S0：优先保留87—88分的跨线骨架，不把有限高分名额都给已有大量S的俱乐部。</li><li>AC米兰A6/S12、曼联A8/S6、英格兰A11/S5：需要检查低成本阵容，不能用S的数量掩盖普通球员位置缺口。</li><li>德国和英格兰目前非S85+左后卫为0；意大利非S85+右边锋为0。这些是已有缺口。热刺没有A/S，属于另一个基础阵容问题，本轮不能靠削A解决。</li></ul><h2>强化与羁绊</h2><p>现有强化+3为全属性+3，+4为+5；89A在+3时显示92。身份羁绊5人2%、7人3%、11人6%，按最强两条羁绊应用、仅作用成员；结构羁绊也参与选择。比较必须同时报告同强化同羁绊，以及投入接近但强化不同的场景，不能要求所有低强化S必胜高强化A。</p><h2>落地验收建议</h2><ul><li>为每人生成原值、建议值、来源和羁绊保护理由；不改S/B/C；管理员覆盖与源文件均纳入差异核对。</li><li>主要体系至少保留一个包含门将、双中卫、中场屏障和终结点的可用阵型；先排唯一球员，再评估5/7/9人同身份骨架。既有缺口单独列出，不宣称全部体系都已有11人完美覆盖。</li><li>同国家/俱乐部前后同条件配对模拟，换主客、固定种子，单独看射门、xG和阶段推进；主要体系若较全库平均退步额外超过2个百分点，进入复核，不能把模拟噪声当硬结论。</li><li>低段传奇与同位置A做同强化同羁绊替换测试；检查其关键职责是否稳定更强，同时允许A在专项上胜出。高强化和属性封顶场景另测。</li><li>卡片参考价依赖总评，落地时先列受影响的估值和已有挂牌处理方案；现有强化等级及卡片数量不变。</li></ul><p><a href="analysis.json">完整统计、逐位置候选和提案JSON</a></p></html>`);
console.log(JSON.stringify({counts:proposal.counts,distribution,comparisons,nationalities:nationality.filter(r=>r.open).length,clubs:clubs.filter(r=>r.open).length},null,2));
