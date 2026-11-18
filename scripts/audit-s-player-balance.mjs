// Read-only audit: all content migrations are confined to copied files.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES as keys,ATTRIBUTE_LABELS as labels,PLAYER_OVERALL_ATTRIBUTE_KEYS as core,playerOverallFromAttributes,roleGroup} from '../shared/football/schema.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'outputs/s-player-audit-20261116');fs.mkdirSync(out,{recursive:true});
const watched=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json','versus/player-pool-s4-generated.js','versus/player-pool-s4-dlc-generated.js'];
const hash=f=>fs.existsSync(path.join(root,f))?createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'):null;
const hashes=Object.fromEntries(watched.map(f=>[f,hash(f)]));
for(const [name,env] of [['ydl-content-overrides.json','YDL_CONTENT_OVERRIDES_PATH'],['ydl-player-card-studio.json','YDL_PLAYER_CARD_STUDIO_PATH']]){
  const src=path.join(root,'data',name),dest=path.join(out,'isolated-'+name);if(fs.existsSync(src))fs.copyFileSync(src,dest);else fs.writeFileSync(dest,'{}');process.env[env]=dest;
}
const {REAL_PLAYERS}=await import('../versus/player-pool.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const {S4_PLAYER_DATABASE}=await import('../versus/player-pool-s4-generated.js');
const {S4_DLC_PLAYER_DATABASE}=await import('../versus/player-pool-s4-dlc-generated.js');
const source=new Map([...S4_PLAYER_DATABASE,...S4_DLC_PLAYER_DATABASE].map(p=>[p.id,p]));
const all=structuredClone(REAL_PLAYERS),s=all.filter(p=>p.grade==='S'&&p.id!=='legend-messi-rat'),a=all.filter(p=>p.grade==='A');
const mean=vs=>vs.length?+(vs.reduce((x,y)=>x+y,0)/vs.length).toFixed(2):null;
const useful=p=>keys.filter(k=>p.role==='GK'||!['goalkeeping','reflexes'].includes(k));
const noncore=p=>useful(p).filter(k=>!core[roleGroup(p.role)].includes(k));
const profiles={GK:['goalkeeping','reflexes','positioning','composure','decisions','agility','jumping'],CB:['tackling','marking','positioning','heading','strength','pace','acceleration','decisions','composure'],LB:['tackling','marking','positioning','pace','acceleration','stamina','crossing','passing','dribbling'],RB:['tackling','marking','positioning','pace','acceleration','stamina','crossing','passing','dribbling'],DM:['tackling','marking','positioning','passing','vision','decisions','strength','stamina','workRate'],AM:['passing','vision','decisions','firstTouch','dribbling','composure','offBall','longShots'],LM:['passing','vision','firstTouch','dribbling','crossing','pace','acceleration','stamina'],RM:['passing','vision','firstTouch','dribbling','crossing','pace','acceleration','stamina'],LW:['dribbling','pace','acceleration','agility','finishing','offBall','firstTouch','composure'],RW:['dribbling','pace','acceleration','agility','finishing','offBall','firstTouch','composure'],ST:['finishing','offBall','composure','firstTouch','pace','acceleration','heading','strength']};
const roleScore=(p,role=p.role)=>mean(profiles[role].map(k=>p.attributes[k]));
// These are balancing recommendations, not measured historical ratings.
const recommendations={
 '马尔科·马特拉齐':['优先核对','冷静 16；源参考冷静已为 1，再加 15。疑似缺失值被当真值，但尚未找到原始空值证据。保留 S91，优先追溯；必要时明确标注估算补到 75–82，不能按侵略性推导冷静。'],
 '维托尔·拜亚':['优先核对','速度 75 / 加速 51、盘带 71 / 停球 40；来源为同位置回归模型，尚不能认定为已证实的 PAC/DRI 映射错误。保留 S90，复核原模板；若缺证据，速度 50–60、盘带 25–40 可作设计区间。'],
 '古德温':['特殊卡待定','源参考 73→目标 S94 产生全属性 +21，属于单次加成而非已证实的二次归一化。保留澳大利亚/阿德莱德联身份；先确认特殊卡定位。若保留 S94，建议重建为传中/定位球核心，削减防守、力量、弹跳等泛用能力，不直接降成 A。'],
 '贝肯鲍尔':['特色重建','S95，传球78/停球68/盘带49/视野68，与自由人定位不符。优先补出球、控球和推进，参考设计区间传球90–94、停球86–90、盘带82–88、视野88–92。防守核心另做预算约束。'],
 '罗伯特卡洛斯':['特色重建','S92，远射71、定位球69，招牌能力不足；建议远射90–94、定位球88–93，保留速度特色，避免连带增强所有非核心项。'],
 '古利特':['特色重建','S90，头球62、力量71、弹跳58、抢断54、盯人46、站位61。按全能中场重新分配，优先身体/争顶/攻守覆盖；首轮保留总评，不套普通前腰模板。'],
 '加图索':['特色重建','S90 的五项总评核心全为90；传球/视野过于组织型，侵略性75、防守覆盖不足。建议从组织属性向抢断、站位、耐力、投入转移；须处理现有中场总评公式约束。'],
 '亚亚图雷':['特色重建','S90，射门53、远射74、力量88、速度72，偏普通防守后腰模板。优先恢复推进、力量与后插上射门，适度收回不必要的组织核心补分。'],
 '迪迪':['特色重建','S92，定位球68、盘带72、远射70；五项总评核心全92。前轮重复增量已修复，本轮应独立重建组织/定位球特色，不恢复原重复加成。'],
 '拉姆':['特色重建','S90，力量89、速度93，但决策83、冷静75；建议重心转向判断、站位、出球、接应。保留总评时现有后卫公式会强迫力量或速度补分。'],
 '马塞洛':['特色重建','S90，盘带82/停球82/视野72，却速度95/耐力96/力量88；建议加强技术组织、降低过高的持续冲刺和防守泛用能力。'],
 '西多夫':['特色重建','S92，力量72、抢断55、盯人47、站位62，过度前腰化；建议强化力量、持球推进与中场对抗，避免仅增加传球总评。'],
 '卡卡':['特色重建','S92，传球/视野均96，速度87、力量62、射门81；建议减少满格组织属性，把预算转向推进、加速与终结。'],
 '德罗巴':['特色重建','S91，力量87、头球88、弹跳84，争顶支点特色不够突出；射门/无球均96，无需继续加，优先重分配支点相关项。'],
 '罗马里奥':['特色重建','S91，盘带84、灵活87、加速90，属于通用终结模板；建议优先小范围摆脱、灵活和第一步，不增加力量/头球来补全面性。'],
 '贝克汉姆':['特色重建','S91，盘带92、定位球89、远射77；建议适度回收盘带、灵活，将定位球和远射拉到特色区间，保留传中96。'],
 '克罗斯':['特色重建','S92，远射70、定位球73、视野90，但抢断88；优先检查调度、定位球与远射特色，避免通用后腰模板。'],
 '诺伊尔':['版本复核','S90，速度39、加速33、灵活55、视野19，与清道夫门将定位可能冲突。先明确这是现役版本还是巅峰传奇；不可把已修复的字段映射再改回 PAC/DRI。'],
 'C罗':['版本复核','S95，速度95/加速79，可能混用了现役年龄快照与传奇目标。应先明确版本，再校正加速和灵活，而非直接整体增强。'],
 '内斯塔':['模板区分','与普约尔24/26项完全相同；仅投入和侵略性不同。建议突出预判、位置、纪律、冷静与精准防守。'],
 '普约尔':['模板区分','与内斯塔24/26项相同；应补充速度/加速、争顶、身体与覆盖方面差异，不仅改投入/侵略性。'],
 '亨利':['模板区分','与尤西比奥22/26项相同；建议强调纵深速度、带球推进与边中结合，区分身体/远射型终结。'],
 '尤西比奥':['模板区分','与亨利22/26项相同；建议强调爆发、力量和远射，与亨利形成不同终结路线。'],
 '埃托奥':['模板区分','与舍甫琴科21/26项相同；建议区分第一步、无球、逼抢投入与小范围处理。'],
 '舍甫琴科':['模板区分','与埃托奥21/26项相同；建议区分直线冲刺、射门路线、头球与左右脚配置。'],
 '卡西利亚斯':['模板区分','与卡恩22/26项相同，守门/反应/站位完全相同；应在反应型与对抗型门将的灵活、力量、出击和稳定性之间建立区别，避免只改无关外场属性。'],
 '卡恩':['模板区分','与卡西利亚斯22/26项相同；建议重建力量、稳定性和门前控制，与反应型门将区分。'],
 '大罗':['模板区分','与盖德·穆勒20/26项相同，其中守门/反应占两项差异；需保留爆发、盘带和一对一特色。96总评约束下核心已封顶，先从其他属性区分。'],
 '盖德·穆勒':['模板区分','与大罗20/26项相同；建议突出抢点、禁区转身与近距离终结，减少通用高速盘带模板。'],
};
const pairs=[];
for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++){
 const p=s[i],q=s[j],same=keys.filter(k=>p.attributes[k]===q.attributes[k]).length;
 if(same>=20)pairs.push({players:[p.name,q.name],same,total:26,differences:keys.filter(k=>p.attributes[k]!==q.attributes[k]).map(k=>({key:k,label:labels[k],values:[p.attributes[k],q.attributes[k]]}))});
}
pairs.sort((x,y)=>y.same-x.same);
const rows=s.map(p=>{
 const origin=source.get(p.id),coreKeys=core[roleGroup(p.role)],candidate=a.filter(q=>q.role===p.role).sort((x,y)=>roleScore(y,p.role)-roleScore(x,p.role));
 const chosen=recommendations[p.name]??['暂缓调整','未在本轮发现需要优先修复的硬异常；保留当前值，随位置模板与版本校准复核，不代表已证明历史精确或实战平衡。'];
 const hard=[];for(const k of keys)if(!Number.isFinite(p.attributes[k])||p.attributes[k]<1||p.attributes[k]>96)hard.push('属性范围:'+k);
 if(playerOverallFromAttributes(p.attributes,p.role)!==p.overall)hard.push('总评不一致');if(roleGroup(p.role)!==p.pool)hard.push('位置池不一致');
 return {id:p.id,name:p.name,overall:p.overall,role:p.role,secondaryRole:p.secondaryRole,nationality:p.nationality,club:p.club,attributes:p.attributes,
   category:chosen[0],recommendation:chosen[1],hard,flatCore:new Set(coreKeys.map(k=>p.attributes[k])).size===1,
   capped:keys.filter(k=>p.attributes[k]===96).map(k=>labels[k]),noncoreMean:mean(noncore(p).map(k=>p.attributes[k])),roleScore:roleScore(p),
   nearestA:candidate.slice(0,3).map(q=>({name:q.name,overall:q.overall,score:roleScore(q,p.role),sMinusA:+(roleScore(p)-roleScore(q,p.role)).toFixed(2)})),
   source:{dataset:origin?.sourceDataset,basis:origin?.attributeBasis,referenceOverall:origin?.referenceOverall,url:origin?.sourceUrl,referenceAttributes:origin?.attributes},legendAbility:p.legendAbility??null};
});
const summary={date:'2026-11-16',scope:'当前生效库，排除梅老鼠彩蛋；不改游戏数值',totalPlayers:all.length,sCount:s.length,sWithEasterEgg:all.filter(p=>p.grade==='S').length,aCount:a.length,
  distribution:Object.fromEntries([...new Set(s.map(p=>p.overall))].sort().map(n=>[n,s.filter(p=>p.overall===n).length])),
  categories:Object.fromEntries([...new Set(rows.map(p=>p.category))].map(k=>[k,rows.filter(p=>p.category===k).length])),
  hardIssues:rows.filter(p=>p.hard.length),duplicatePairs:pairs.filter(p=>p.same===26),nearDuplicatePairs:pairs,
  flatCore:rows.filter(p=>p.flatCore).map(p=>({name:p.name,overall:p.overall,role:p.role})),
  roleScoreCaveat:'按主位置选取职责相关属性做等权诊断分，仅定位候选，不是引擎实际评分、胜率或羁绊/技能评估。未做比赛配对模拟。',
  lowerThanTopA:rows.filter(p=>p.nearestA[0]?.sMinusA<0).map(p=>({name:p.name,role:p.role,overall:p.overall,score:p.roleScore,bestA:p.nearestA[0]})),
  comparisons:['GK','DEF','MID','ATT'].map(g=>{const sp=s.filter(p=>p.overall<=92&&roleGroup(p.role)===g),ap=a.filter(p=>roleGroup(p.role)===g);return {group:g,s90to92Count:sp.length,aCount:ap.length,sOverall:mean(sp.map(p=>p.overall)),aOverall:mean(ap.map(p=>p.overall)),sNoncore:mean(sp.map(p=>mean(noncore(p).map(k=>p.attributes[k])))),aNoncore:mean(ap.map(p=>mean(noncore(p).map(k=>p.attributes[k]))))};}),
  sourceHashes:hashes};
const sources=[
 ['贝肯鲍尔的持球推进与自由人职责：拜仁官方分析','https://fcbayern.com/de/news/2024/02/feldherr-und-freigeist-franz-beckenbauer-in-der-analyse'],
 ['罗伯特卡洛斯的任意球特色：皇马官方视频','https://www.youtube.com/watch?v=MC97_I6VigI'],
 ['AC米兰传奇档案','https://www.acmilan.com/it/club/legends/tutti-i-giocatori']
 ,['迪迪的落叶球特色：皇马官方档案','https://www.realmadrid.com/en-US/the-club/history/football-legends/waldir-pereira']
];
fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({summary,diagnosticRoleKeys:profiles,players:rows,sources},null,2));
fs.writeFileSync(path.join(out,'effective-snapshot.json'),JSON.stringify(all,null,2));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,data)=>`<div class="scroll"><table><thead><tr>${heads.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S传奇审阅</title><style>body{font:16px/1.7 system-ui;margin:32px auto;padding:0 24px;max-width:1200px;color:#183344;background:#f3f6f8}h1{font-size:30px}h2{margin-top:32px}table{border-collapse:collapse;width:100%;background:white}td,th{border-bottom:1px solid #d8e2e8;padding:10px;text-align:left;white-space:nowrap}.scroll{overflow:auto}input{font:inherit;padding:12px;width:min(90%,600px)}details{background:white;border:1px solid #d8e2e8;border-radius:8px;padding:16px;margin:12px 0}summary{cursor:pointer;font-weight:bold}.muted{color:#617582}.attrs{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px}.attrs span{background:#f3f6f8;padding:6px}.tag{color:#a55012}a{color:#116aba}</style><h1>S 传奇球员审阅 · 2026-11-16</h1><p>${s.length}名正式S球员，另有梅老鼠彩蛋1张。当前A球员调整后基线；本轮仅审阅，不改数值。</p><p><b>结论：</b>优先修复疑似缺失值、特殊卡泛用膨胀与同位置模板失真，不建议统一上调S。建议区间是游戏设计值，不是外部数据库的逐项实测。历史风格抽样核验，未逐人锁定巅峰赛季。</p><p>结构硬错误 ${summary.hardIssues.length}；正式S之间完全重复 ${summary.duplicatePairs.length} 对。${esc(summary.roleScoreCaveat)}</p><h2>等级与同位置组对照</h2>${table(['总评','人数'],Object.entries(summary.distribution))}${table(['位置组','S90–92人数','A人数','S总评均值','A总评均值','S非核心均值','A非核心均值'],summary.comparisons.map(p=>[p.group,p.s90to92Count,p.aCount,p.sOverall,p.aOverall,p.sNoncore,p.aNoncore]))}<p class="muted">外场非核心均值排除守门/反应，门将保留全部非核心属性；跨职责均值不是可用性排名。</p><h2>根因与调整顺序</h2><ol><li>马特拉齐冷静源1→游戏16；拜亚速度/盘带疑似模板问题。先追溯来源，缺证据时明确估算。</li><li>古德温参考73→S94对全属性加21，先确定特殊卡定位，保留国家/俱乐部生态。</li><li>补齐贝肯鲍尔、卡洛斯、古利特、加图索、亚亚图雷、迪迪等招牌能力，同时压回不符合定位的属性。</li><li>拆开近重复模板。对现役快照抬成传奇的卡，先锁定版本。</li><li>现有中场总评只计传球、视野、决策、停球、耐力；防守中场无法靠抢断/站位体现总评。若保留当前公式，总评不变和真实特色之间存在约束。先设计主位置评分，再评估迁移、估值及评级影响，不在本轮改公式。</li><li>96总评前锋在上限96下，五项核心被迫全96，天然压平特色；暂用其他属性与技能区分，长期再评估评分模型。</li><li>落地前后用同阵容、同强化、同羁绊、多种子互换做对照；不能把等权诊断分当胜率。</li></ol><h2>近重复模板</h2>${table(['球员','完全相同项数','不同项'],pairs.map(p=>[p.players.join(' / '),p.same+'/26',p.differences.map(d=>d.label+':'+d.values.join('/')).join('；')]))}<h2>逐人审阅与26项当前值</h2><input id="query" placeholder="搜索球员、位置、国家、俱乐部或审阅类别"><p id="count">共 ${rows.length} 人</p>${rows.map(p=>`<details data-search="${esc([p.name,p.role,p.nationality,p.club,p.category].join(' '))}"><summary>${esc(p.name)} · S${p.overall} · ${esc(p.role)} <span class="tag">${esc(p.category)}</span></summary><p>${esc(p.nationality)} / ${esc(p.club)} · 副位置 ${esc(p.secondaryRole??'无')}</p><p>${esc(p.recommendation)}</p><div class="attrs">${keys.map(k=>`<span>${labels[k]} <b>${p.attributes[k]}</b></span>`).join('')}</div><p>96封顶：${esc(p.capped.join('、')||'无')}；非核心均值 ${p.noncoreMean}；职责诊断分 ${p.roleScore}。</p><p>同主位置A参考：${esc(p.nearestA.map(a=>a.name+' '+a.overall+'分 / 诊断'+a.score+' / S-A '+a.sMinusA).join('；'))}</p><p class="muted">源：${esc(p.source.dataset)}；属性基准 ${esc(p.source.basis)}；源参考总评 ${esc(p.source.referenceOverall)}。${p.legendAbility?'专属技能：'+esc(p.legendAbility.name):''}</p></details>`).join('')}<h2>参考与完整数据</h2><p>以下来源仅支撑球员风格判断，不直接提供本报告建议数值。</p><ul>${sources.map(([n,u])=>`<li><a href="${esc(u)}">${esc(n)}</a></li>`).join('')}</ul><p><a href="audit.json">完整审阅数据</a> · <a href="effective-snapshot.json">当前生效库快照</a></p><script>document.querySelector('#query').addEventListener('input',e=>{let n=0;for(const el of document.querySelectorAll('details')){el.hidden=!el.dataset.search.toLowerCase().includes(e.target.value.toLowerCase());if(!el.hidden)n++}document.querySelector('#count').textContent='显示 '+n+' 人'})</script></html>`;
fs.writeFileSync(path.join(out,'report.html'),html);
for(const f of watched)assert.equal(hash(f),hashes[f],'Audit mutated live source: '+f);
console.log(JSON.stringify(summary,null,2));
