// Read-only editorial review against a hash-checked, isolated runtime snapshot.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ATTRIBUTE_NAMES as keys,ATTRIBUTE_LABELS as labels,PLAYER_OVERALL_ATTRIBUTE_KEYS as core,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
import {S4_PLAYER_DATABASE} from '../versus/player-pool-s4-generated.js';
import {S4_DLC_PLAYER_DATABASE} from '../versus/player-pool-s4-dlc-generated.js';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'outputs/s-player-remaining-review-20261116');
const snapshot=JSON.parse(fs.readFileSync(path.join(out,'snapshot.json'),'utf8'));
const hash=f=>fs.existsSync(path.join(root,f))?createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'):null;
const verifySources=()=>{for(const [f,h] of Object.entries(snapshot.sourceHashes))assert.equal(hash(f),h,'Snapshot is stale or live file changed: '+f);};verifySources();
const sources={
 neuer:['拜仁：诺伊尔的清道夫门将定位','https://fcbayern.com/en/news/2025/02/manuel-neuer-the-modern-day-goalkeeping-icon'],
 kaka:['米兰：卡卡的技术与冲刺速度','https://www.acmilan.com/en/club/legends/players/kaka'],
 seedorf:['米兰：西多夫的技术与战术理解','https://www.acmilan.com/en/club/legends/player/seedorf'],
 kroos:['皇马：克罗斯的视野与传球精度','https://www.realmadrid.com/en-US/football/first-team/players/toni-kroos'],
 beckham:['曼联：贝克汉姆任意球档案','https://www.manutd.com/en/mutv/videos/detail/united-archive-david-beckham-18-premier-league-free-kick-goals'],
 rooney:['曼联：鲁尼的跑动投入与回防','https://www.manutd.com/en/news/david-moyes-praises-wayne-rooney-performance-against-chelsea'],
 drogba:['英超：德罗巴的力量与技术','https://www.premierleague.com/en/news/1055992'],
 stefano:['皇马：迪斯蒂法诺的攻守全面性','https://www.realmadrid.com/en-US/the-club/history/football-legends/alfredo-di-stefano-laulhe'],
 maradona:['FIFA：马拉多纳不同阶段的持球与组织特点','https://www.fifa.com/en/articles/dribbles-diego-maradona-1982-1986-1990-1994'],
 puskas:['皇马：普斯卡什的左脚终结','https://www.realmadrid.com/en-US/the-club/history/football-legends/ferenc-puskas-biro'],
};
// Ranges are partial balancing directions, not finalized 26-attribute profiles.
// Peak windows are proposed coherent design references, not asserted rankings.
const important=[
 ['诺伊尔','2013–2016','现役快照混入巅峰定位：源记录age=40；速度39、加速33、灵活55、视野19。应恢复清道夫门将的移动、阅读与脚下处理，不恢复错误PAC/DRI映射。',{pace:[58,65],acceleration:[58,66],agility:[78,85],vision:[58,68]},{crossing:[30,45]},'neuer'],
 ['C罗','2012–2015','速度95但加速79，巅峰阶段不协调。按同一时期恢复爆发和灵活，不拼接青年边锋盘带与晚期中锋全部优势。',{acceleration:[90,94],agility:[86,90]},{setPieces:[84,88]},null],
 ['拉姆','2012–2014','力量89、速度93，决策83、冷静75、视野72；组织型边卫被做成冲刺力量型。防守核心必须联动分配。',{decisions:[92,95],composure:[88,92],vision:[84,88]},{strength:[80,84]},null],
 ['马塞洛','2015–2018','盘带/停球82，视野72，却耐力96、投入94、速度95。应恢复边路控球与组织，降低持续覆盖而非全面上调。',{dribbling:[91,94],firstTouch:[90,93],vision:[84,88]},{stamina:[86,90],workRate:[82,88]},null],
 ['贝克汉姆','1998–2001','盘带92、灵活88，而定位球89、远射77。改成传中/定位球/跑动输送路线，与菲戈区分。',{setPieces:[94,96],longShots:[85,90],stamina:[92,95]},{dribbling:[80,85],agility:[78,83]},'beckham'],
 ['克罗斯','2016–2018','远射70、定位球73、视野90，但抢断88、站位91。应加强调度和定位球，回收纯扫荡能力。',{longShots:[84,89],setPieces:[86,91],vision:[94,96]},{tackling:[72,79],marking:[68,76]},'kroos'],
 ['卡卡','2005–2007','传球/视野均96，力量62、速度87、射门81，更像纯组织前腰。预算应向长距离持球、爆发和终结倾斜。',{pace:[93,95],acceleration:[94,96],strength:[76,82],finishing:[87,91]},{passing:[90,94],vision:[90,94]},'kaka'],
 ['西多夫','2003–2007','力量72、抢断55、盯人47；停球95、视野94，过于轻型前腰化。优先恢复对抗、抗压推进与中场覆盖。',{strength:[87,92],tackling:[72,80],positioning:[73,81]},{vision:[88,92],firstTouch:[90,93]},'seedorf'],
 ['鲁尼','2009–2011','耐力76、投入80、力量82、传球78、视野71，过于普通终结者化。补全能前锋的组织、回防和高强度跑动。',{stamina:[88,93],workRate:[92,96],passing:[84,89],vision:[82,87]},{composure:[89,92]},'rooney'],
 ['德罗巴','2009–2010','力量87、头球88、弹跳84；射门/无球已96，不应继续加终结。重点为支点与争顶，适度收回灵巧型盘带。',{strength:[94,96],heading:[93,96],jumping:[89,93]},{dribbling:[80,83]},'drogba'],
 ['阿尔弗雷多·迪斯蒂法诺','1956–1959','传球78、视野76、耐力80、抢断35；射门/无球/冷静96，接近纯禁区中锋。应重建全场串联与攻守参与。',{passing:[89,94],vision:[89,94],stamina:[91,95],tackling:[55,65]},{finishing:[93,95],composure:[92,95]},'stefano'],
 ['乔治维阿','1994–1996','速度/加速88、力量82、盘带86，反而射门/无球96。优先恢复强力带球冲击，终结适度让出预算。',{pace:[92,95],acceleration:[92,95],strength:[89,93],dribbling:[90,93]},{finishing:[91,94],offBall:[89,93]},null],
 ['罗马里奥','1993–1994','盘带84、灵活87，而头球81、力量81。建议突出禁区小范围摆脱与第一步，保留顶级抢点，不做全面型前锋。',{dribbling:[90,94],agility:[94,96],acceleration:[93,96]},{strength:[71,77],longShots:[77,82]},null],
 ['马拉多纳','1986–1987','传球79、视野84、头球85；96级核心封顶，但创造力被普通中锋模板压低。应补组织、定位球，压低争顶；不动ST定位与总评。',{passing:[92,96],vision:[94,96],setPieces:[91,95]},{heading:[60,70],jumping:[65,74]},'maradona'],
 ['普斯卡什','1959–1961','速度92、远射87、定位球76、传球78。建议塑造左脚终结与组合进攻，回收纵深速度，不能在S94约束下把速度压成低速档。',{longShots:[93,96],setPieces:[88,93],passing:[84,89]},{pace:[86,90]},'puskas'],
 ['巴雷西','1988–1990','停球64、盘带45、视野59、冷静80、纪律74，但力量92。组织清道夫的出球/判断不足，应与力量型中卫拉开差异。',{passing:[83,88],firstTouch:[78,84],vision:[80,86],composure:[90,94]},{strength:[84,89]},null],
];
const local=[
 ['保罗马尔蒂尼','精准防守与补位','决策88、冷静81、加速68偏模板化；建议补冷静、补位反应和基础出球。防守三项96已有优势，不再加；按当前CB主位置，不拼接青年LB与晚期CB所有优点。'],
 ['卡纳瓦罗','预判与爆发争顶','力量96、灵活65、决策86；保留头球95/弹跳96，适度从纯力量转给启动与判断，受S92后卫核心约束。'],
 ['费迪南德','速度与持球出球型中卫','传球72、停球65、盘带46、加速68；建议补出球和启动，降低模板力量93的权重。'],
 ['卡福','往返进攻边卫','耐力/投入96已到位；决策75、冷静75、无球76偏低。优先改善接应和处理球，勿继续把速度、力量堆满。'],
 ['萨内蒂','稳定防守与持球推进','决策78、冷静75、盘带75不足；应补稳健处理和推进，与卡福的前插传中区分。'],
 ['齐达内','身体护球与组织','力量67、头球58缺乏特色；控球组织已接近封顶。建议局部补护球/头球，回收部分耐力或无球，而非继续加强所有技术项。S95中场耐力最低可行值受公式约束。'],
 ['罗纳尔迪尼奥','摆脱、创造和自由进攻','力量64、速度82偏保守，但耐力90、投入79较均衡；可改善持球对抗和推进，回收持续覆盖。S94中场不可无约束降低耐力。'],
 ['莫德里奇','抗压组织与覆盖','投入74偏低、传中93偏突出；建议补跑动和启动，传中回到较高而非招牌满级，保持力量短板。'],
 ['罗德里','站位控制与出球','抢断86、站位89尚可但未突出，传中85对角色价值有限；建议小幅向站位/夺球转移，速度66合理保留，不因巅峰就补成快后腰。'],
 ['斯科尔斯','组织与后插上','头球56、投入77较低；保留传球和远射，适度补后插上争顶。定位球90、灵活88可回收，不提高抢断到顶级。'],
 ['兰帕德','持续后插上得分','头球54、耐力85、力量67，视野93；建议身体/耐力/争顶获得更多预算，降低过高纯组织项。'],
 ['维埃拉','大范围覆盖与持球推进','速度73、加速71、盘带71、力量88；建议提升推进与覆盖，适度降低视野90等组织核心，保持与加图索/亚亚图雷的区别。'],
 ['马克莱莱','位置纪律与保护防线','抢断/站位/投入96已体现特色，五项中场核心却全91；可把传球/视野向判断/耐力转移，不必增强防守上限。'],
 ['路易斯菲戈','盘带创造与传中','盘带94/传中96已合理；冷静83、射门74可小补，减少不必要的耐力91；与贝克汉姆区分更重要。'],
 ['内德维德','持续跑动与远射','耐力95/投入94已合理；远射84、力量70较低，可补远射、力量，回收传中92一部分。'],
 ['里杰卡尔德','防守组织与身体','头球78、力量86、速度73；适度补争顶/对抗/覆盖，减少普通组织中场补分，避免变成另一个维埃拉。'],
 ['贝利','全面终结与配合','传球83、视野76、灵活86、弹跳82，可补配合与身体协调，防守不必全面抬高。96核心固定，通过非核心与马拉多纳区分。'],
 ['本泽马','回撤串联与禁区终结','源记录age=38；速度91、传中90，视野79、加速78，存在核心补分与现役快照混用。建议向视野/串联转移，保持巅峰稳定终结。'],
 ['巴蒂斯图塔','强力射门与对抗','射门/远射93明确；力量86、头球83可小幅加强，回收灵活82或技术泛用项，不必全面重建。'],
 ['博格坎普','停球与第二前锋创造','停球96已到位，视野81/传球84不够突出；建议加强连接与最后一传，速度87可回收但须保持S92核心总和。'],
 ['范巴斯滕','技术型中锋与多方式终结','停球94、终结96合理，头球87/弹跳79可补，适度降低加速88；与维阿的冲击路线区分。'],
 ['克鲁伊夫','持球组织与全场参与','视野83、投入78、耐力80，较像终结型ST；建议加强创造和跑动，回收头球84/力量84一部分，保留总评核心约束。'],
 ['朱塞佩·梅阿查','技术与创造兼备的前锋','视野77、传球80、灵活86较普通；建议局部补创造/灵活，降低头球86或力量85的泛化。历史逐项证据不足，优先级低于有明确模板冲突者。'],
 ['乌戈·桑切斯','禁区跑位与空中终结','弹跳83、灵活83、头球84尚未体现空中终结；可以补协调与争顶，回收传球/视野的泛用预算。'],
 ['坎通纳','背身支点与创造','传球77、视野78、力量84、停球88；建议补背身组织和力量，回收射门/无球96的纯终结预算。'],
];
const hold=[
 ['库尔图瓦','高大门将与门线扑救','反应92、站位90、冷静89已有明确门线优势。低盘带不等于错误；视野16、停球25先留待门将脚下与出球场景验证，不统一抬高所有门将非核心。'],
 ['布冯','稳定门线与位置','守门90、反应91、站位91，结构连贯；决策82可观察，但当前不列优先。'],
 ['儒利奥·塞萨尔','敏捷反应型门将','守门/反应94、冷静82形成取舍；不因为冷静低于其他S就补齐。'],
 ['雅辛','顶级门线防守','守门95、反应/站位96已建立高档优势；灵活74不能单独证明失真，历史具体数值证据有限。'],
 ['里克尔梅','慢节奏组织核心','技术/视野/冷静突出，速度73、耐力79形成合理短板；不补速度与体能。'],
 ['里瓦尔多','技术与远射','盘带94、远射92、冷静96，体能80形成取舍；可以保留现状。'],
 ['里贝里','爆发和小范围盘带','加速/盘带/灵活96，力量64、防守低，角色鲜明；不继续加强。'],
 ['姆巴佩','纵深爆发','加速96、速度94、盘带94符合已实现的爆发型峰值路线，不预测未来巅峰。停球/灵活96和弹跳93只列封顶监控。'],
 ['哈兰德','禁区终结与力量','射门/无球/力量96，视野61、灵活74有明显代价；不统一补齐短板，不预测未来巅峰。'],
 ['乔治贝斯特','高速盘带与摆脱','盘带94、加速95、灵活94，力量66合理；当前无需优先调整。'],
 ['内马尔','持球突破与创造','盘带/停球/速度/加速/灵活96已偏强，力量65、防守低是合理短板；避免进一步整体增强。'],
];
const records=new Map();
for(const [name,stage,reason,up,down,source] of important)records.set(name,{priority:1,category:'优先重建',peakReference:stage,reason,up,down,source:source?sources[source]:null});
for(const [name,role,reason] of local)records.set(name,{priority:2,category:'局部复核',peakReference:role,reason,up:{},down:{},source:null});
for(const [name,role,reason] of hold)records.set(name,{priority:3,category:'暂缓调整',peakReference:role,reason,up:{},down:{},source:null});
assert.equal(records.size,52);assert.equal(snapshot.players.length,52);
const imported=new Map([...S4_PLAYER_DATABASE,...S4_DLC_PLAYER_DATABASE].map(p=>[p.id,p]));
const rows=snapshot.players.map(p=>{assert.ok(records.has(p.name),p.name);const review=records.get(p.name),src=imported.get(p.id);return {...p,...review,sourceMetadata:{dataset:src?.sourceDataset,age:src?.age,referenceOverall:src?.referenceOverall,attributeBasis:src?.attributeBasis},directions:[...Object.entries(review.up).map(([k,range])=>({key:k,label:labels[k],before:p.attributes[k],range,direction:'提高'})),...Object.entries(review.down).map(([k,range])=>({key:k,label:labels[k],before:p.attributes[k],range,direction:'回收'}))]};}).sort((a,b)=>a.priority-b.priority||a.role.localeCompare(b.role));
const hard=[];for(const p of rows){if(playerOverallFromAttributes(p.attributes,p.role)!==p.overall)hard.push(p.name+'总评不一致');if(roleGroup(p.role)!==p.pool)hard.push(p.name+'位置池不一致');for(const k of keys)if(!Number.isInteger(p.attributes[k])||p.attributes[k]<1||p.attributes[k]>96)hard.push(p.name+':'+k);}
const pairs=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],same=keys.filter(k=>a.attributes[k]===b.attributes[k]).length;if(same>=17)pairs.push({names:[a.name,b.name],same,differing:keys.filter(k=>a.attributes[k]!==b.attributes[k]).map(k=>labels[k])});}pairs.sort((a,b)=>b.same-a.same);
const result={date:'2026-11-16',status:'review-only; no values applied',scope:{remaining:52,excludedPriorRevision:18,excludedNames:['古德温','梅西','梅老鼠']},counts:{priority:important.length,localReview:local.length,hold:hold.length},hardIssues:hard,nearPairs:pairs,sourceHashes:snapshot.sourceHashes,
 methodology:'当前项目26项为事实；风格建议为设计判断。选取一致巅峰阶段，不叠加职业生涯每项最大值。官方资料仅支持部分风格描述，不提供本报告数值区间。未逐人获取完整巅峰赛季26项参考库，未做实战胜率验证。',
 constraints:'未来若应用，保留总评、身份、主副位置、公式和既有18人/A球员调整。区间仅为局部方向，尚不是可直接导入的完整26项方案；核心属性须联动求和并验证封顶和强化。',players:rows,sources};
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(result,null,2));
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剩余52名S传奇巅峰审阅</title><style>body{max-width:1120px;margin:32px auto;padding:0 22px;font:16px/1.7 system-ui;color:#193447;background:#f3f6f8}details{background:white;border:1px solid #cfdae3;border-radius:10px;padding:18px;margin:14px 0}summary{cursor:pointer;font-weight:bold}table{border-collapse:collapse;width:100%}th,td{padding:8px;text-align:left;border-bottom:1px solid #d8e3eb}.attrs{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.attrs span{background:#f3f6f8;padding:5px}.muted{color:#677c8b}input,select{padding:10px;font:inherit;margin:5px 10px 5px 0}a{color:#176bb6}</style><h1>剩余52名S传奇 · 巅峰定位审阅</h1><p>仅建议，未修改任何游戏数值。排除已完成18人以及古德温、梅西、梅老鼠。</p><p><b>16人优先重建，25人局部复核，11人暂缓。</b>局部复核不等于必须改动。结构检查未发现总评不匹配、属性越界或位置池错误。</p><p>${esc(result.methodology)}</p><p>${esc(result.constraints)}</p><h2>关键判断</h2><ul><li>诺伊尔源记录age=40，本泽马age=38，现役快照不能直接充当巅峰传奇。C罗的速度由总评核心抬升，加速等非核心仍保留源值，形成不协调。</li><li>不将力量、耐力、视野全部补到90以上；重点补角色优势，并回收不符合定位的高项。</li><li>门将脚下能力不能由门线扑救字段代替；守门员的低盘带、低射门本身不是错误。</li><li>96级前锋五项核心已封顶，通过非核心和既有技能区分；当前公式保持不变。</li><li>建议先审定诺伊尔、C罗、拉姆、马塞洛、贝克汉姆、克罗斯、卡卡、西多夫、鲁尼、德罗巴、迪斯蒂法诺、乔治维阿这12人；罗马里奥、马拉多纳、普斯卡什、巴雷西作为优先组的第二小批，补齐阶段取样。</li></ul><h2>仍相似的模板</h2><p>以下是17/26项以上完全相同，不是整套重复。相关技术本就相近、96封顶和外场门将字段也会提高重合，不能仅按相同项数判定错误。</p><table><tr><th>球员</th><th>完全相同项</th></tr>${pairs.map(p=>`<tr><td>${esc(p.names.join(' / '))}</td><td>${p.same}/26</td></tr>`).join('')}</table><h2>52人逐项审阅</h2><input id="q" placeholder="球员 / 位置 / 国家 / 俱乐部"><select id="priority"><option value="">全部优先级</option><option>优先重建</option><option>局部复核</option><option>暂缓调整</option></select><p id="count">52人</p>${rows.map(p=>`<details data-category="${p.category}" data-search="${esc([p.name,p.role,p.nationality,p.club].join(' '))}"><summary>${esc(p.name)} · S${p.overall} · ${esc(p.role)} · ${p.category}</summary><p>建议参照：${esc(p.peakReference)}。此阶段为设计取样建议，不是已完成的逐季数据库匹配。</p><p>${esc(p.reason)}</p>${p.directions.length?`<table><tr><th>属性</th><th>当前</th><th>设计方向区间</th></tr>${p.directions.map(d=>`<tr><td>${d.label}</td><td>${d.before}</td><td>${d.range.join('–')}（${d.direction}）</td></tr>`).join('')}</table><p class="muted">区间尚未联合解算成保持总评的26项方案，不可直接全量套用。</p>`:''}<div class="attrs">${keys.map(k=>`<span>${labels[k]} <b>${p.attributes[k]}</b></span>`).join('')}</div><p class="muted">国家/俱乐部：${esc(p.nationality)} / ${esc(p.club)}；副位置：${esc(p.secondaryRole??'无')}。源：${esc(p.sourceMetadata.dataset)}；参考总评：${esc(p.sourceMetadata.referenceOverall)}。</p>${p.source?`<p><a href="${esc(p.source[1])}">${esc(p.source[0])}</a>：支持风格判断，不直接支持建议区间。</p>`:'<p class="muted">本条为项目属性结构审阅和设计建议，尚未补齐逐赛季数值证据。</p>'}</details>`).join('')}<p><a href="review.json">完整审阅数据</a> · <a href="snapshot.json">生效库快照</a></p><script>const apply=()=>{let n=0;for(const d of document.querySelectorAll('details')){d.hidden=!d.dataset.search.toLowerCase().includes(document.querySelector('#q').value.toLowerCase())||!!document.querySelector('#priority').value&&d.dataset.category!==document.querySelector('#priority').value;if(!d.hidden)n++}document.querySelector('#count').textContent='显示 '+n+' 人'};document.querySelector('#q').addEventListener('input',apply);document.querySelector('#priority').addEventListener('change',apply)</script></html>`;
fs.writeFileSync(path.join(out,'report.html'),html);
assert.equal((html.match(/<details /g)||[]).length,52);assert.equal(rows.length*keys.length,1352);assert.equal(hard.length,0);assert.equal(new Set(rows.map(p=>p.id)).size,52);
verifySources();fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({reviewed:52,attributes:1352,counts:result.counts,hardIssues:0,liveFilesUnchanged:true,sourceHashes:snapshot.sourceHashes},null,2));
console.log(JSON.stringify({counts:result.counts,hardIssues:hard,nearPairs:pairs,liveFilesUnchanged:true},null,2));
