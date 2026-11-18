// Read-only peak-overall review. No importable gameplay patch is produced.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PLAYER_OVERALL_ATTRIBUTE_KEYS as core,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
import {s4BaseCardReferenceValue,s4OwnershipReferenceValue} from '../versus/s4-balance.js';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'outputs/s-peak-overall-review-20261116');fs.mkdirSync(out,{recursive:true});
const watched=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json','data/player-balance-a-20261116.json','data/player-balance-s-peak-20261116.json','shared/football/schema.js','versus/player-pool.js','versus/player-pool-s4-generated.js','versus/player-pool-s4-dlc-generated.js','versus/s4-balance.js'];
const sha=f=>fs.existsSync(path.join(root,f))?createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'):null;
const hashes=Object.fromEntries(watched.map(f=>[f,sha(f)]));
for(const [f,e] of [['ydl-content-overrides.json','YDL_CONTENT_OVERRIDES_PATH'],['ydl-player-card-studio.json','YDL_PLAYER_CARD_STUDIO_PATH']]){const p=path.join(out,'isolated-'+f);if(fs.existsSync(path.join(root,'data',f)))fs.copyFileSync(path.join(root,'data',f),p);else fs.writeFileSync(p,'{}');process.env[e]=p;}
const {REAL_PLAYERS}=await import('../versus/player-pool.js');const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const all=structuredClone(REAL_PLAYERS),s=all.filter(p=>p.grade==='S');
// Proposed reference windows do not change stored nationality, club or roles.
// A one-point debate is normal; ranges are judgment bands, not statistical CIs.
const definitions=[
 ['库尔图瓦',93,'2021–2022','最高级别比赛的门线扑救与稳定性应进入顶级门将层，90明显偏低。'],
 ['诺伊尔',94,'2013–2016','门线能力与清道夫、出球价值结合；不应按晚期现役快照定巅峰。'],
 ['布冯',94,'2003–2006','巅峰门线、位置与关键比赛稳定性达到历史顶级；不因生涯长短加分。'],
 ['卡西利亚斯',93,'2008–2012','巅峰反应和关键扑救突出；与布冯/诺伊尔的综合门将控制保留细微差异。'],
 ['卡恩',94,'2000–2002','门前统治与关键比赛峰值极高；不能只靠强硬性格来体现高档门将。'],
 ['儒利奥·塞萨尔',91,'2009–2010','具备冠军级峰值，建议略高于传奇入门档，但不与历史最高门将并档。'],
 ['维托尔·拜亚',90,'1994–1996（另参考2003–2004）','优秀传奇门将，保留S下限；两个窗口不能拼接各项最高值。'],
 ['雅辛',95,'1960–1963','历史门将标杆档；年代证据局限使94–95均可讨论，不直接拿现代扑救率横比。'],
 ['贝肯鲍尔',95,'1972–1976','防守与自由人出球的双重岗位价值，保留历史顶尖档。'],
 ['保罗马尔蒂尼',95,'1993–1995，按当前CB兼容定位取样','顶级防守判断、覆盖与对抗，91与巅峰定位差距过大；不合并青年LB和晚期CB的全部极值。'],
 ['巴雷西',94,'1988–1990','防线组织、预判与出球的岗位统治力，90显著低估。'],
 ['内斯塔',93,'2002–2004','顶级一对一、预判与位置，进入历史精英中卫档。'],
 ['卡纳瓦罗',93,'2005–2006','防守预判、爆发与争顶达到极高峰值；奖项用于佐证，不直接换算总评。'],
 ['普约尔',92,'2008–2011','防守覆盖、对抗与大赛贡献突出；保持与更高档中卫的处理球差异。'],
 ['费迪南德',93,'2006–2009','速度、阅读和出球兼备的巅峰中卫，90偏低。'],
 ['拉姆',93,'2012–2014','边卫本职、位置智慧和出球共同达到顶级，不靠纯力量定档。'],
 ['卡福',93,'1999–2002','往返覆盖、边路推进与进攻参与，按右后卫贡献评估。'],
 ['萨内蒂',92,'2008–2010','稳定覆盖、持球与攻守平衡；不把长期出勤全部计入单期峰值。'],
 ['马塞洛',92,'2015–2018','进攻创造达到顶级边卫水平，防守与覆盖短板仍需计入。'],
 ['罗伯特卡洛斯',93,'1997–2002','爆发、边路威胁和射门特色突出；不因定位球名气单独跳到95。'],
 ['马尔科·马特拉齐',90,'2005–2007','当前91不宜与历史顶级中卫并列。保留S身份时建议90；若纯按跨评级巅峰能力，88–89亦可讨论，降A需另作决定。'],
 ['齐达内',95,'1998–2002','控球、组织和关键阶段创造力达到历史顶尖；保留95。'],
 ['罗纳尔迪尼奥',95,'2004–2006','只看巅峰应充分承认持球与创造的统治力，不因巅峰较短扣分。'],
 ['克罗斯',93,'2016–2018','顶级组织与抗压调度，略高于优秀传奇中场，保留机动性短板。'],
 ['贝克汉姆',92,'1998–2001','传中、定位球和跑动输送达到顶级，但不按商业影响力定档。'],
 ['莫德里奇',94,'2016–2018','抗压推进、组织与覆盖的综合中场峰值，应与普通92档拉开。'],
 ['罗德里',93,'2022–2024','控制、站位和出球达到世界顶级，93–94可讨论；暂不以单一奖项直接定95。'],
 ['斯科尔斯',92,'2002–2003（组织版本另看2006–2007）','传球与后插上达到高水平，92基本合适；两个版本择一落地。'],
 ['兰帕德',92,'2004–2006','高强度中场参与与后插上产出，90偏低。'],
 ['维埃拉',93,'2000–2004','防守覆盖、对抗和推进的中场岗位支配力，91不足。'],
 ['马克莱莱',92,'2003–2006','防守中场专职贡献足以进92；不因进攻数据少降档，也不把他改成进攻核心。'],
 ['亚亚图雷',92,'2013–2014','持球推进、力量与得分峰值突出，90低估；保留防守取舍。'],
 ['卡卡',94,'2005–2007','突破、转移进攻和终结的短期极高峰值，应高于通用92档。'],
 ['路易斯菲戈',93,'1999–2001','持球创造、边路组织与传中达到顶级，建议93。'],
 ['内德维德',93,'2002–2003','覆盖、推进和远射结合，按巅峰而非生涯知名度可达93。'],
 ['西多夫',92,'2003–2007','高水平技术与中场连接；92合理，先修属性特色而不是继续升总评。'],
 ['里克尔梅',91,'2005–2007','组织上限突出，但适配和无球覆盖限制较明显，91合理。'],
 ['加图索',90,'2003–2007','顶级防守执行者，职责明确；保留90，不因队友地位或荣誉自动抬档。'],
 ['里杰卡尔德',93,'1988–1990','防守、组织、身体与位置理解兼备，90明显低于巅峰价值。'],
 ['古利特',94,'1987–1989','创造、身体、空中优势与多位置贡献结合；90是明显层级错位。'],
 ['里瓦尔多',94,'1998–2000','创造、持球和射门达到世界最高竞争层，90明显低估。'],
 ['迪迪',93,'1958–1962','组织、控制和定位球的核心价值，92可上调一档；历史定量证据较少，允许92–94讨论。'],
 ['里贝里',93,'2012–2013','突破、创造和边路协作达到顶级，91偏低。'],
 ['贝利',96,'1961–1963','最高峰值锚点；综合进攻与岗位统治力，不再突破96上限。'],
 ['马拉多纳',96,'1986–1987','最高峰值锚点；保留96，通过组织特色与其他96区分。'],
 ['大罗',96,'1996–1998','最高级别爆发、持球与终结峰值；不因后续伤病或巅峰长度降档。'],
 ['梅西',96,'2011–2012','最高峰值锚点；用户指定保留，本轮只确认96合理，不改任何数值。'],
 ['C罗',96,'2012–2015','巅峰终结、无球、纵深和空中威胁达到最高档；不拼接所有年龄段极值。'],
 ['姆巴佩',94,'2022–2026已实现表现，落地时选定单一窗口','已实现的纵深爆发与持续高端产出支持94；不预测未来，也不直接给96。'],
 ['哈兰德',93,'2022–2023，并复核截至2026的已实现表现','顶级终结与支点威胁，93合理；不因创造相对弱而忽视本职，也不抹去持球短板。'],
 ['本泽马',93,'2021–2022','组织、串联和终结同时达到高峰，91偏低。'],
 ['亨利',94,'2002–2004','高速持球、终结与创造兼具，93可上调一档。'],
 ['鲁尼',93,'2009–2011','推进、组织、终结与回防的综合峰值，90低估。'],
 ['德罗巴',92,'2009–2010','支点、对抗和终结达到顶级，92较合理；不将关键决赛名场面代替整个巅峰窗口。'],
 ['埃托奥',93,'2005–2006（另参考2008–2009）','速度、跑位、终结与前场投入，91偏低；不合并不同窗口所有优势。'],
 ['舍甫琴科',93,'2003–2005','顶级多路线终结与冲击，90低估巅峰。'],
 ['巴蒂斯图塔',93,'1998–2000','得分、射门与对抗的高峰值，不能因俱乐部奖杯较少停留90。'],
 ['博格坎普',92,'1997–1998','技术连接和创造鲜明，92合理；先补属性特点。'],
 ['尤西比奥',94,'1965–1966','历史顶尖爆发与终结者，94为建议中心，95亦有讨论空间。'],
 ['范巴斯滕',95,'1988–1992','技术型中锋的历史顶级峰值，不因伤病缩短生涯而限制在92。'],
 ['克鲁伊夫',95,'1971–1974','组织、持球、终结与攻防参与，保留历史顶尖档。'],
 ['乔治贝斯特',94,'1967–1968','盘带突破与创造的极高峰值，不因职业生涯后段影响而低估。'],
 ['罗马里奥',94,'1993–1994','禁区处理、摆脱和终结的历史高峰，91明显偏低。'],
 ['内马尔',94,'2015–2017','持球创造与得分兼备的峰值，92偏低；仍与96锚点保持距离。'],
 ['盖德·穆勒',95,'1970–1972','按中锋本职的终结与跑位统治力给历史顶尖档，不要求兼具组织大师能力。'],
 ['古德温',94,'彩蛋，不参与现实巅峰评级','按用户指定保留94，排除常规球员分布与均值。'],
 ['阿尔弗雷多·迪斯蒂法诺',95,'1956–1960','全场参与、组织和终结的历史顶级核心，93偏低。'],
 ['朱塞佩·梅阿查',93,'1933–1938','历史顶级技术前锋，当前93可保留；影像和逐项资料有限，92–94均存在讨论空间。'],
 ['普斯卡什',95,'1953–1954（皇马版本另看1959–1960）','射门、组合进攻与进攻主导的历史顶尖峰值；巅峰取样与数据库俱乐部标签分离，不修改羁绊。'],
 ['乌戈·桑切斯',92,'1986–1990','顶级禁区跑位与终结，91可小幅提高，不因创造有限否定本职。'],
 ['坎通纳',92,'1993–1996','背身连接、创造与终结兼具的核心前锋，92较合适。'],
 ['乔治维阿',93,'1994–1996','强力持球冲击与终结的世界级峰值，92可提升一档。'],
 ['梅老鼠',96,'梅西同一球员的别名卡','与梅西保持同值，按用户指定不动；不重复计入常规球员统计。'],
];
const byName=new Map(s.map(p=>[p.name,p]));assert.equal(s.length,73);assert.equal(definitions.length,73);assert.equal(new Set(definitions.map(x=>x[0])).size,73);
const revised=new Set(JSON.parse(fs.readFileSync(path.join(root,'data/player-balance-s-peak-20261116.json'),'utf8')).players.map(p=>p.id));
const excluded=new Set(['古德温','梅老鼠']);
const rows=definitions.map(([name,recommended,peakWindow,reason])=>{const p=byName.get(name);assert.ok(p,name);assert.equal(playerOverallFromAttributes(p.attributes,p.role),p.overall);
  const comparable=!excluded.has(name),locked=['古德温','梅西','梅老鼠'].includes(name),delta=recommended-p.overall;
  const ordinaryBand=[Math.max(90,recommended-1),Math.min(96,recommended+1)];
  const band=locked?[recommended,recommended]:name==='马尔科·马特拉齐'?[88,90]:name==='迪迪'?[92,94]:ordinaryBand;
  const coreKeys=core[roleGroup(p.role)],currentSum=coreKeys.reduce((a,k)=>a+p.attributes[k],0),targetSum=recommended*coreKeys.length;
  const priceBefore=s4BaseCardReferenceValue(p),priceAfter=s4BaseCardReferenceValue({...p,overall:recommended});
  return {id:p.id,name,role:p.role,secondaryRole:p.secondaryRole,nationality:p.nationality,club:p.club,current:p.overall,recommended,delta,peakWindow,reason,discussionRange:band,comparable,locked,previous18:revised.has(p.id),confidence:'editorial judgment; ±1 is debatable, not a statistical interval',coreKeys,currentCoreSum:currentSum,targetCoreSum:targetSum,requiredCoreSumChange:targetSum-currentSum,
    maximumForAnySingleCoreReduction:96*coreKeys.length-targetSum,cardReferenceBefore:priceBefore,cardReferenceAfter:priceAfter,ownershipReferenceBefore:s4OwnershipReferenceValue(p),ownershipReferenceAfter:s4OwnershipReferenceValue({...p,overall:recommended})};});
const regular=rows.filter(p=>p.comparable),hist=(ps,key)=>Object.fromEntries([90,91,92,93,94,95,96].map(n=>[n,ps.filter(p=>p[key]===n).length]));
const mean=(ps,key)=>+(ps.reduce((n,p)=>n+p[key],0)/ps.length).toFixed(2);
const summary={records:73,regularPlayers:71,excludedFromDistribution:['古德温（彩蛋）','梅老鼠（梅西别名）'],locked:['古德温','梅西','梅老鼠'],up:regular.filter(p=>p.delta>0).length,down:regular.filter(p=>p.delta<0).length,unchanged:regular.filter(p=>p.delta===0).length,distributionBefore:hist(regular,'current'),distributionProposed:hist(regular,'recommended'),meanBefore:mean(regular,'current'),meanProposed:mean(regular,'recommended'),previous18Total:rows.filter(p=>p.previous18).length,previous18WithNewOverall:rows.filter(p=>p.previous18&&p.delta!==0).length,
 groups:['GK','DEF','MID','ATT'].map(g=>{const ps=regular.filter(p=>roleGroup(p.role)===g);return {group:g,count:ps.length,before:mean(ps,'current'),proposed:mean(ps,'recommended')};})};
const references=[
 ['诺伊尔的2014峰值背景（FIFA）','https://inside.fifa.com/tournaments/mens/confederationscup/russia2017/news/neuer-great-hospitality-and-wonderful-moments-2864176'],
 ['大罗的1996–1998表现与个人荣誉（巴萨）','https://players.fcbarcelona.com/en/player/764-ronaldo-ronaldo-luis-nazario-da-lima'],
 ['罗纳尔迪尼奥的2004–2006阶段（巴萨）','https://www.fcbarcelona.com/en/card/648040/ronaldo-de-assis-moreira-ronaldinho'],
 ['历届金球奖名单，仅作交叉证据，不换算分数（UEFA）','https://www.uefa.com/ballondor/'],
 ['卡卡的2007峰值背景（AC米兰）','https://www.acmilan.com/en/news/articles/history/2022-12-02/onthisday-kaka-wins-the-ballon-d-or'],
 ['罗德里2023/24与2024欧洲杯表现（UEFA）','https://www.uefa.com/uefachampionsleague/news/0292-1c33aa864c69-d47a84004f4d-1000--rodri-wins-2024-mens-ballon-dor/'],
 ['姆巴佩2025/26赛季表现（皇马）','https://www.realmadrid.com/en-US/news/football/first-team/latest-news/mbappe-jugador-mahou-cinco-estrellas-de-la-temporada-27-05-2026'],
 ['哈兰德2025/26表现复核（曼城）','https://www.mancity.com/news/mens/erling-haaland-2026-ballon-dor-recognition-63928638'],
];
const result={status:'review-only; not applied',asOf:'2026-11-16',summary,methodology:['比较已实现且连贯的巅峰窗口，通常2–3季；部分历史球员列较宽取样范围，落地前再选单一版本。','先评价本职岗位统治力，再考虑对整体比赛的贡献；不以进球数压低门将/后卫/防守中场。','短暂但真实的巅峰不因生涯短或伤病扣分；不把各阶段各项最高值拼在一起。','奖项、统计、官方档案用于交叉检验，不把奖杯数量、名气、身价或国家俱乐部羁绊直接换算成总评。','最终分数是项目尺度下的编辑建议，不是EA/FM官方评级，也不是客观历史排名；多数一分差可讨论。','保留现有S90–96区间作为可落地方案；马特拉齐的纯实力88–89观点单列，不暗中改评级。'],constraints:['本轮不改总评公式、游戏数据、身份、俱乐部、国家、主副位置、既有A方案或彩蛋。','上轮18人保留总评是当时实施约束；本轮对其总评重新审阅，但不会自动撤销属性重建。','总评由核心属性计算，不能只写标签；未来须联合求解26项，保留已建立的优缺点，禁止全属性按总评分差整体加点。','96级外场前锋的五项核心在当前归一化下必须全96。升C罗到96会提升盘带/速度等核心，不只是显示变化；接受不了这一代价时应保留95，或单独评估公式（本轮不改）。','S涨分将影响参考卡价、强化封顶与同羁绊强度；价格栏只计算现行基础参考价，非实际成交价。尚未跑胜率平衡模拟。','本表仅审S卡巅峰版本。A库中历史名将的卡片定位是另一问题，不据本表直接重分全库评级。'],references,sourceHashes:hashes,players:rows};
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'effective-snapshot.json'),JSON.stringify(all,null,2));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bands={96:'最高峰值锚点',95:'历史顶尖核心',94:'历史精英／极高峰值',93:'世界顶级核心',92:'顶级传奇',91:'优秀传奇',90:'S入门／保留评级下限'};
const table=(heads,data)=>`<div class="scroll"><table><thead><tr>${heads.map(v=>`<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${data.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S传奇巅峰总评统一审阅</title><style>body{max-width:1240px;margin:32px auto;padding:0 24px;font:16px/1.7 system-ui;background:#f3f6f8;color:#183447}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;border-bottom:1px solid #dae4e9;text-align:left}th{white-space:nowrap}.scroll{overflow:auto}details{background:white;border:1px solid #cad8e1;border-radius:9px;padding:16px;margin:12px 0}summary{cursor:pointer;font-weight:bold}input,select{font:inherit;padding:9px;margin:6px}a{color:#176db5}.note{background:#fff0d6;padding:16px;border-radius:10px}.up{color:#08745e}.down{color:#a74b28}</style><h1>所有S球员 · 巅峰总评统一审阅</h1><p>2026-11-16 · 仅建议，未应用。73条S记录＝71名常规球员＋古德温彩蛋＋梅老鼠别名卡；梅西计一次，按用户要求保持96。</p><p><b>${summary.up}人建议上调，${summary.down}人下调，${summary.unchanged}人保持。</b>常规球员平均 ${summary.meanBefore} → ${summary.meanProposed}。这是重新整理S内部层级，不应变成全属性普涨。</p><h2>审阅口径</h2><ul>${result.methodology.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><h2>档位与分布</h2>${table(['总评','定位','当前人数','建议人数'],[96,95,94,93,92,91,90].map(n=>[n,bands[n],summary.distributionBefore[n],summary.distributionProposed[n]]))}${table(['位置组','人数','当前均值','建议均值'],summary.groups.map(p=>[p.group,p.count,p.before,p.proposed]))}<h2>实施前必须保留的边界</h2><ul>${result.constraints.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p class="note">马特拉齐：可落地S方案建议91→90；若允许按纯峰值跨评级，88–89是另一种建议，需独立决定是否退出S池。此报告不改变评级。诺伊尔94/雅辛95、古利特94/95、尤西比奥94/95、罗德里93/94等属于可讨论的一分差，不伪装成精确事实。</p><h2>全部73条逐人建议</h2><input id="q" placeholder="球员、国家、俱乐部"><select id="filter"><option value="">全部</option><option value="up">上调</option><option value="down">下调</option><option value="same">保持</option><option value="previous">已重建18人</option></select><p id="count">显示73条</p>${rows.map(p=>`<details data-search="${esc([p.name,p.nationality,p.club,p.role].join(' '))}" data-change="${p.delta>0?'up':p.delta<0?'down':'same'}" data-previous="${p.previous18}"><summary>${esc(p.name)} · ${esc(p.role)} · ${p.current} → <span class="${p.delta>0?'up':p.delta<0?'down':''}">${p.recommended}</span> ${p.delta?'（'+(p.delta>0?'+':'')+p.delta+'）':'（保持）'}${p.locked?' · 指定保留':''}</summary><p>${esc(p.reason)}</p><p>建议巅峰参照：${esc(p.peakWindow)}。讨论区间：${p.discussionRange.join('–')}，不是统计置信区间。国家/俱乐部：${esc(p.nationality)} / ${esc(p.club)}，本轮不变。</p><p>现有核心：${p.coreKeys.join('、')}；核心和 ${p.currentCoreSum} → ${p.targetCoreSum}（差 ${p.requiredCoreSumChange>0?'+':''}${p.requiredCoreSumChange}）。这仅是将来联合分配的约束，未生成新属性。</p><p>基础卡参考价 ${p.cardReferenceBefore} → ${p.cardReferenceAfter}；所有权参考价 ${p.ownershipReferenceBefore} → ${p.ownershipReferenceAfter}。不代表实际成交价或已有挂牌迁移。</p></details>`).join('')}<h2>参考资料</h2><p>只用于支持巅峰窗口、岗位特征和历史表现，不直接给出本表的精确分数。未为所有71人获取完整逐季数值库。</p><ul>${references.map(([n,u])=>`<li><a href="${esc(u)}">${esc(n)}</a></li>`).join('')}</ul><p><a href="review.json">完整审阅JSON</a> · <a href="effective-snapshot.json">当前生效快照</a></p><script>function filter(){let n=0;const q=document.querySelector('#q').value.toLowerCase(),f=document.querySelector('#filter').value;for(const d of document.querySelectorAll('details')){d.hidden=!d.dataset.search.toLowerCase().includes(q)||(f==='previous'?d.dataset.previous!=='true':f&&d.dataset.change!==f);if(!d.hidden)n++}document.querySelector('#count').textContent='显示'+n+'条'}document.querySelector('#q').addEventListener('input',filter);document.querySelector('#filter').addEventListener('change',filter)</script></html>`;
fs.writeFileSync(path.join(out,'report.html'),html);
for(const f of watched)assert.equal(sha(f),hashes[f],'Live file changed: '+f);assert.equal(regular.length,71);assert.equal(rows.filter(p=>p.locked&&p.delta!==0).length,0);assert.equal((html.match(/<details /g)||[]).length,73);assert.ok(rows.every(p=>p.recommended>=90&&p.recommended<=96));
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({liveFilesUnchanged:true,completeCoverage:73,regularUniquePlayers:71,sourceHashes:hashes,summary},null,2));console.log(JSON.stringify(summary,null,2));
