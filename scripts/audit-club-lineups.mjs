import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {AI_FORMATIONS} from '../engine/territory-ai.mjs';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const all=read('assets/data/s4-player-catalog.json'),clubs=read('assets/data/europe-clubs.json'),index=read('assets/data/territory-index.json');
const valid=all.filter(p=>!p.isX&&!p.xPlayer&&['GK','DEF','MID','ATT'].includes(p.pool));
const aliases={'曼彻斯特联':'曼联','曼彻斯特城':'曼城','PSV埃因霍温':'埃因霍温','巴黎圣日尔曼':'巴黎圣日耳曼','南安普顿':'南安普敦'};
function fit(players,slots,secondary){
 const n=slots.length,size=1<<n,dp=Array(size).fill(null);dp[0]={score:0,lineup:[]};
 for(const p of players)for(let mask=size-1;mask>=0;mask--){
  if(!dp[mask])continue;
  for(let i=0;i<n;i++)if(!(mask&(1<<i))){const role=slots[i][0],primary=p.role===role;if(!primary&&(!secondary||p.secondaryRole!==role))continue;
   const score=dp[mask].score+(primary?1000:0)+Number(p.overall),next=mask|(1<<i);
   if(!dp[next]||score>dp[next].score)dp[next]={score,lineup:[...dp[mask].lineup,{slot:i,role,id:p.id,name:p.name,primaryRole:p.role,secondaryRole:p.secondaryRole,overall:p.overall,grade:p.grade,usesSecondary:!primary}]};
  }
 }
 const full=dp[size-1];if(!full)return null;
 return {lineup:full.lineup.sort((a,b)=>a.slot-b.slot),secondaryCount:full.lineup.filter(p=>p.usesSecondary).length,average:Number((full.lineup.reduce((n,p)=>n+p.overall,0)/11).toFixed(1))};
}
const groups=Map.groupBy(valid,p=>aliases[p.club]??p.club);
const results=clubs.map(club=>{
 const name=aliases[club.name]??club.name,raw=groups.get(name)??[];
 // Same real player's alternate artwork never fills two starting positions.
 const players=[...new Map(raw.map(p=>[p.sourceName?.trim().toLowerCase()||p.name,p])).values()];
 const formations=Object.entries(AI_FORMATIONS).map(([formation,slots])=>({formation,main:fit(players,slots,false),flex:fit(players,slots,true)}));
 const primary=formations.filter(f=>f.main),flex=formations.filter(f=>f.flex).sort((a,b)=>a.flex.secondaryCount-b.flex.secondaryCount||b.flex.average-a.flex.average);
 const preferred=flex[0];
 return {id:club.id,name:club.name,catalogName:name,reputation:club.reputation,cards:raw.length,rawClubLabels:Object.fromEntries([...Map.groupBy(raw,p=>p.club)].map(([label,ps])=>[label,ps.length])),distinctPlayers:players.length,positionCounts:Object.fromEntries(['GK','DEF','MID','ATT'].map(pool=>[pool,players.filter(p=>p.pool===pool).length])),mainFormations:primary.map(f=>f.formation),supportedFormations:flex.map(f=>f.formation),formation:preferred?.formation??null,lineup:preferred?.flex.lineup??[],secondaryCount:preferred?.flex.secondaryCount??null,average:preferred?.flex.average??null,territories:index.territories.filter(t=>t.clubIds?.includes(club.id)).map(t=>({id:t.territoryId,name:t.name,clubs:t.clubIds})),roster:players.map(p=>({id:p.id,name:p.name,role:p.role,secondaryRole:p.secondaryRole,overall:p.overall}))};
}).sort((a,b)=>b.cards-a.cards);
const ready=results.filter(r=>r.formation),notReady=results.filter(r=>!r.formation),outside=[...groups].filter(([name,p])=>p.length>=11&&!results.some(r=>r.catalogName===name)).map(([name,p])=>({name,count:p.length}));
for(const r of ready){assert.equal(r.lineup.length,11);assert.equal(new Set(r.lineup.map(p=>p.id)).size,11);assert.equal(r.lineup.filter(p=>p.role==='GK').length,1);assert.ok(r.lineup.every(p=>p.role===p.primaryRole||p.role===p.secondaryRole));}
const out={catalogSha256:crypto.createHash('sha256').update(fs.readFileSync('assets/data/s4-player-catalog.json')).digest('hex'),source:'assets/data/s4-player-catalog.json',total:all.length,valid:valid.length,clubs:clubs.length,clubTerritories:index.territories.filter(t=>t.initialOwner?.type==='club').length,readyCount:ready.length,primaryCount:ready.filter(r=>r.mainFormations.length).length,outside,results};
fs.mkdirSync('outputs/club-lineup-audit-20260909',{recursive:true});fs.writeFileSync('outputs/club-lineup-audit-20260909/report.json',JSON.stringify(out,null,2));
const md=['# 中立豪门首发可组建情况 · 2026-09-09','',`读取当前正式球员库 ${out.total} 张卡、地图豪门名录 ${out.clubs} 家（分布于 ${out.clubTerritories} 个初始豪门地块）。按卡片所属俱乐部统计，包含 S/A/B/C 及历史传奇，不按现实最新转会或生涯曾效力球队扩充。`,
'','口径：匹配当前 AI_FORMATIONS 的 11 种阵型，首发 11 名不同球员、1 名门将，主位置或已配置副位置可胜任，不允许陌生位置凑数。同一人物不同卡画合并（梅西与梅老鼠仅占一个名额）。同名俱乐部异写仅在本次统计归并，没有修改游戏数据。',
'',`结果：${ready.length} 家可组完整首发，其中 ${out.primaryCount} 家有全主位置方案，${ready.length-out.primaryCount} 家需要使用副位置。人数至少 11 的还有波尔图、阿斯顿维拉，但无法匹配现有阵型。`,
'','| 俱乐部 | 卡数 | 独立人物 | 门/后/中/前（按主位置） | 示例阵型 | 副位置人数 |','|---|---:|---:|---|---|---:|',
...ready.map(r=>`| ${r.name} | ${r.cards} | ${r.distinctPlayers} | ${Object.values(r.positionCounts).join('/')} | ${r.formation} | ${r.secondaryCount} |`),
'','## 每家可用的 11 人示例','',
...ready.flatMap(r=>[`### ${r.name} · ${r.formation}`,'',r.lineup.map(p=>`${p.role} ${p.name}${p.usesSecondary?'（副位置；主位置 '+p.primaryRole+'）':''}`).join('；'),'']),
'## 暂不满足的俱乐部','', '| 俱乐部 | 卡数 | 门/后/中/前 |','|---|---:|---|',...notReady.map(r=>`| ${r.name} | ${r.cards} | ${Object.values(r.positionCounts).join('/')} |`),
'','波尔图：14 人，但仅两名主位置后卫；科斯蒂尼亚副位置可踢 CB 后仍缺第三名中卫或右后卫。阿斯顿维拉：11 人，后卫为两 CB、两 LB；孔萨若改踢副位置 RB，则中卫只剩一人，三中卫也不足。',
'','## 命名与接入问题','',
'- 曼联/曼彻斯特联、曼城/曼彻斯特城为卡库与地图名录的名称差异。',
'- 巴黎圣日耳曼 20 张 + 巴黎圣日尔曼 1 张（蒂亚戈·席尔瓦）= 21 张；后者当前字符串不同，不能直接假设现有俱乐部羁绊会将其合并。',
'- PSV埃因霍温 2 张 + 埃因霍温 3 张 = 5 张；南安普敦地图名称对应卡库南安普顿 2 张。',
'- 巴塞罗那 48 张卡，但梅西与梅老鼠 sourceName 都为 Lionel Messi，本次保守按 47 名不同人物安排首发。游戏卡定义目前仍为两张，本报告不更改其上场规则。',
'- 当前 engine/territory-ai.mjs 的 selectPlayer 从传入全球员库按主位置选人；clubOwned 只影响难度/目标能力，没有按豪门 club 过滤。这里只证明卡库支持这些方案，不表示已经接入各豪门专属守军。副位置方案需在之后实施时扩展 AI 选人。',
'- 合并后的豪门地块可包含多家俱乐部，51 家名录对应 38 个初始豪门地块，不应把 18 家球队直接当作 18 个独立地块。',
'',`球员库 SHA256：${out.catalogSha256}`,'复现：node scripts/audit-club-lineups.mjs。完整机器可读结果：outputs/club-lineup-audit-20260909/report.json。',''];
fs.writeFileSync('handoff/CLUB_LINEUP_AUDIT_2026-09-09.md',md.join('\n'));
console.log(JSON.stringify({total:out.total,ready:out.readyCount,primary:out.primaryCount,clubs:ready.map(r=>({name:r.name,cards:r.cards,formation:r.formation,secondary:r.secondaryCount})),outside},null,2));
