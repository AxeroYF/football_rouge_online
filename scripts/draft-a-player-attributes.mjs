// Proposal only. Load admin content from isolated copies, never write live player data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ATTRIBUTE_NAMES,ATTRIBUTE_LABELS,PLAYER_OVERALL_ATTRIBUTE_KEYS,roleGroup,playerOverallFromAttributes} from '../shared/football/schema.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'outputs/a-player-adjustment-20261116');fs.mkdirSync(out,{recursive:true});
const protectedFiles=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json','data/player-dlc-s4-final.json','data/player-dlc2-s4-final.json','data/player-dlc3-s4-final.json','data/s4-player-pool-s4.json','data/s4-player-pool-with-dlc.json','versus/player-pool-s4-generated.js','versus/player-pool-s4-dlc-generated.js'];
const hash=file=>fs.existsSync(path.join(root,file))?createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'):null;
const hashes=Object.fromEntries(protectedFiles.map(file=>[file,hash(file)]));
for(const [name,env] of [['ydl-content-overrides.json','YDL_CONTENT_OVERRIDES_PATH'],['ydl-player-card-studio.json','YDL_PLAYER_CARD_STUDIO_PATH']]){
  const target=path.join(out,'isolated-'+name),source=path.join(root,'data',name);
  if(fs.existsSync(source))fs.copyFileSync(source,target);else fs.writeFileSync(target,'{}');process.env[env]=target;
}
const {REAL_PLAYERS}=await import('../versus/player-pool.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const all=structuredClone(REAL_PLAYERS),players=all.filter(p=>p.grade!=='X'&&p.id!=='legend-messi-rat'),aPlayers=players.filter(p=>p.grade==='A');
assert.equal(all.length,733);assert.equal(aPlayers.length,230);
fs.writeFileSync(path.join(out,'before.json'),JSON.stringify(all,null,2));

// Explicit roster decisions. All other A players remain A86. No upward regrading.
const tiers={
  89:'阿利松|范戴克|阿什拉夫|因涅斯塔|贝林厄姆|萨拉赫|凯恩'.split('|'),
  88:'多纳鲁马|奥布拉克|迈尼昂|萨利巴|巴斯托尼|塞尔希奥·拉莫斯|蒂亚戈·席尔瓦|鲁本迪亚斯|努诺门德斯|贾琴托·法切蒂|利利安图拉姆|麦孔|基米希|皮尔洛|费尔南多·雷东多|佩德里|杰拉德|德布劳内|维蒂尼亚|拉菲尼亚|亚马尔|维尼修斯|阿扎尔|登贝莱|阿尔扬·罗本|莱万多夫斯基|劳塔罗马丁内斯|罗伯托·巴乔'.split('|'),
  87:'凯洛尔·纳瓦斯|索默|维克托巴尔德斯|大卫拉亚|特尔施特根|科贝尔|鲁伊·帕特里西奥|迪诺·佐夫|加布里埃尔|马尔基尼奥斯|塔|卢西奥|耶罗|博努奇|吕迪格|柯纳特|维迪奇|丹尼尔·帕萨雷拉|佩佩|加埃塔诺·西雷阿|萨穆埃尔|阿亚拉|特里|雅普·斯塔姆|迪马尔科|坎比亚索|儒尼奥尔|埃弗拉|利扎祖拉|孔德|阿诺德|赞布罗塔|卡瓦哈尔|马科斯略伦特|埃德加·戴维斯|罗伊基恩|施温施泰格|凯赛多|卡塞米罗|赖斯|哈维·阿隆索|迭戈·西蒙尼|吉尔伯托·席尔瓦|保罗·索萨|巴尔韦德|维尔茨|穆西亚拉|帕尔默|弗朗基德容|哈维|韦斯利·斯内德|大卫席尔瓦|麦卡利斯特|布鲁诺费尔南德斯|厄德高|巴雷拉|德科|詹尼·里维拉|巴拉克|哈梅斯·罗德里格斯|查拉纳|奥利赛|泽·罗伯托|赫苏斯纳瓦斯|克瓦拉茨赫利亚|孙兴慜|萨卡|加雷斯·贝尔|福登|普利希奇|伊萨克|罗宾·范佩西|克洛泽|劳尔·冈萨雷斯|鲁德·范尼斯特鲁伊|亚历山德罗·德尔·皮耶罗|阿尔瓦雷斯|格列兹曼|因扎吉|拉达梅尔·法尔考'.split('|'),
};
const targetById=new Map(aPlayers.map(p=>[p.id,86])),selected=new Set();
for(const [target,names] of Object.entries(tiers))for(const name of names){
  const matches=aPlayers.filter(p=>p.name===name);assert.equal(matches.length,1,`Ambiguous tier name ${name}`);
  const p=matches[0];assert.ok(!selected.has(p.id));assert.ok(p.overall>=Number(target));selected.add(p.id);targetById.set(p.id,Number(target));
}
assert.deepEqual(Object.fromEntries([86,87,88,89].map(n=>[n,[...targetById.values()].filter(v=>v===n).length])),{86:115,87:80,88:28,89:7});
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted&&c==='"'&&text[i+1]==='"'){cell+='"';i++;continue;}if(c==='"'){quoted=!quoted;continue;}if(!quoted&&c===','){row.push(cell);cell='';continue;}if(!quoted&&c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';continue;}cell+=c;}if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}const headers=rows.shift();return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(headers.map((k,i)=>[k,r[i]])));}
const ea=new Map(parseCsv(fs.readFileSync(path.join(root,'data/sources/eafc26-player-database-20251124/EAFC26-Men.csv'),'utf8')).map(p=>[p.ID,p]));
const normalized=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const avg=(...n)=>n.reduce((s,x)=>s+x,0)/n.length;
function reference(p){
  const r=ea.get(String(p.sourceId));if(!r||normalized(r.Name)!==normalized(p.sourceName))return null;
  const get=k=>r[k]===''||r[k]==null?null:Number(r[k]);
  const mapped={passing:avg(get('Short Passing'),get('Long Passing')),firstTouch:get('Ball Control'),dribbling:get('Dribbling'),crossing:get('Crossing'),finishing:get('Finishing'),longShots:get('Long Shots'),heading:get('Heading Accuracy'),setPieces:avg(get('Free Kick Accuracy'),get('Curve'),get('Penalties')),tackling:avg(get('Standing Tackle'),get('Sliding Tackle')),marking:get('Def Awareness'),positioning:p.role==='GK'?get('GK Positioning'):get('Def Awareness'),vision:get('Vision'),decisions:get('Reactions'),composure:get('Composure'),offBall:get('Positioning'),discipline:null,pace:get('Sprint Speed'),acceleration:get('Acceleration'),strength:get('Strength'),stamina:get('Stamina'),agility:get('Agility'),jumping:get('Jump'),workRate:null,aggression:get('Aggression'),goalkeeping:p.role==='GK'?avg(get('GK Diving'),get('GK Handling')):null,reflexes:p.role==='GK'?get('GK Reflexes'):null};
  return {name:r.Name,overall:get('OVR'),version:'FC26 / 2025-11-24 snapshot',id:r.ID,url:r.url,attributes:mapped};
}
const signatureOverrides={
  '阿利松':['goalkeeping','positioning'],'多纳鲁马':['reflexes','goalkeeping'],'奥布拉克':['goalkeeping','positioning'],'迈尼昂':['reflexes','passing'],
  '范戴克':['positioning','heading'],'萨利巴':['marking','pace'],'巴斯托尼':['passing','positioning'],'塞尔希奥·拉莫斯':['heading','tackling'],'蒂亚戈·席尔瓦':['positioning','decisions'],'鲁本迪亚斯':['positioning','strength'],
  '维迪奇':['heading','strength'],'特里':['positioning','heading'],'雅普·斯塔姆':['strength','tackling'],'卢西奥':['strength','dribbling'],'耶罗':['heading','setPieces'],'博努奇':['passing','vision'],'丹尼尔·帕萨雷拉':['heading','longShots'],'加埃塔诺·西雷阿':['positioning','decisions'],
  '努诺门德斯':['pace','acceleration'],'贾琴托·法切蒂':['stamina','heading'],'阿什拉夫':['pace','stamina'],'利利安图拉姆':['marking','strength'],'麦孔':['crossing','strength'],'阿诺德':['crossing','passing'],'迪马尔科':['crossing','setPieces'],'马科斯略伦特':['pace','stamina'],
  '基米希':['passing','vision'],'皮尔洛':['passing','setPieces'],'费尔南多·雷东多':['passing','firstTouch'],'罗伊基恩':['tackling','workRate'],'埃德加·戴维斯':['tackling','stamina'],'卡塞米罗':['tackling','positioning'],'赖斯':['tackling','stamina'],'哈维·阿隆索':['passing','vision'],'迭戈·西蒙尼':['tackling','workRate'],'吉尔伯托·席尔瓦':['positioning','tackling'],
  '因涅斯塔':['firstTouch','dribbling'],'贝林厄姆':['offBall','stamina'],'佩德里':['passing','firstTouch'],'杰拉德':['longShots','workRate'],'德布劳内':['passing','vision'],'维蒂尼亚':['passing','decisions'],'哈维':['passing','vision'],'巴尔韦德':['stamina','longShots'],'维尔茨':['vision','dribbling'],'穆西亚拉':['dribbling','agility'],'帕尔默':['composure','vision'],'弗朗基德容':['firstTouch','dribbling'],'韦斯利·斯内德':['vision','longShots'],'大卫席尔瓦':['firstTouch','vision'],'巴拉克':['heading','longShots'],
  '厄德高':['vision','passing'],'麦卡利斯特':['passing','decisions'],'布鲁诺费尔南德斯':['vision','longShots'],'巴雷拉':['stamina','workRate'],'德科':['passing','vision'],'詹尼·里维拉':['vision','firstTouch'],'哈梅斯·罗德里格斯':['longShots','vision'],
  '拉菲尼亚':['offBall','crossing'],'亚马尔':['dribbling','vision'],'维尼修斯':['pace','dribbling'],'阿扎尔':['dribbling','agility'],'登贝莱':['dribbling','acceleration'],'阿尔扬·罗本':['dribbling','finishing'],'萨拉赫':['finishing','offBall'],'萨卡':['dribbling','crossing'],'加雷斯·贝尔':['pace','longShots'],'泽·罗伯托':['stamina','passing'],'赫苏斯纳瓦斯':['pace','crossing'],'克瓦拉茨赫利亚':['dribbling','agility'],
  '凯恩':['finishing','passing'],'莱万多夫斯基':['finishing','offBall'],'劳塔罗马丁内斯':['finishing','composure'],'罗伯托·巴乔':['dribbling','firstTouch'],'伊萨克':['pace','finishing'],'罗宾·范佩西':['finishing','firstTouch'],'克洛泽':['heading','offBall'],'劳尔·冈萨雷斯':['offBall','finishing'],'鲁德·范尼斯特鲁伊':['finishing','offBall'],'亚历山德罗·德尔·皮耶罗':['finishing','setPieces'],'格列兹曼':['offBall','vision'],'因扎吉':['offBall','finishing'],'拉达梅尔·法尔考':['heading','finishing'],
  '肯佩斯':['pace','strength'],'埃尔南·克雷斯波':['heading','finishing'],'克劳迪奥·卡尼吉亚':['pace','acceleration'],'阿德里亚诺':['strength','longShots'],'迭戈弗兰':['longShots','finishing'],'伊布拉希莫维奇':['strength','firstTouch'],'弗朗切斯科·托蒂':['passing','vision'],'大卫·比利亚':['finishing','offBall'],'曼朱基奇':['heading','workRate'],'吉鲁':['heading','strength'],
};
const roleCandidates={GK:['goalkeeping','reflexes','positioning','passing'],CB:['tackling','positioning','heading','strength','pace','marking'],LB:['crossing','pace','stamina','tackling','marking'],RB:['crossing','pace','stamina','tackling','marking'],DM:['passing','tackling','positioning','stamina','vision'],AM:['passing','vision','firstTouch','dribbling','longShots','offBall'],LM:['crossing','dribbling','pace','acceleration','vision'],RM:['crossing','dribbling','pace','acceleration','vision'],LW:['dribbling','pace','acceleration','finishing','agility'],RW:['dribbling','pace','acceleration','finishing','agility'],ST:['finishing','offBall','heading','pace','strength','composure']};
const identityGroups=[];
for(const field of ['nationality','club']){
  const map=new Map();for(const p of players){const n=p[field]?.trim();if(!n)continue;if(!map.has(n))map.set(n,[]);map.get(n).push(p);}
  for(const [name,ps] of map)if(ps.length>=10)identityGroups.push({field,name,players:ps,major:field==='nationality'?ps.length>=50:ps.length>=18});
}
function protectionFor(p){return identityGroups.filter(g=>p[g.field]===g.name).filter(g=>g.players.filter(q=>q.grade!=='S'&&q.overall>=85&&(q.role===p.role||q.secondaryRole===p.role)).length<=2).map(g=>`${g.name} ${p.role}稀缺候选`);}
const mean=vs=>vs.length?Number(avg(...vs).toFixed(2)):null;
const proposals=aPlayers.map(p=>{
  const ref=reference(p),target=targetById.get(p.id),core=PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(p.role)],before={...p.attributes},after={...before};
  const candidates=roleCandidates[p.role]??roleCandidates.ST;
  const signatures=signatureOverrides[p.name]??[...candidates].sort((a,b)=>(ref?.attributes[b]??before[b])-(ref?.attributes[a]??before[a])).slice(0,2);
  const protections=protectionFor(p),fieldReasons={};
  let sum=core.reduce((s,k)=>s+after[k],0),goal=target*core.length;
  // Normally exact. Permit already-rounded inputs without creating a stat increase.
  goal=Math.min(goal,sum);
  while(sum>goal){
    const keys=core.filter(k=>!signatures.includes(k)&&after[k]>1);
    assert.ok(keys.length,p.id);
    keys.sort((a,b)=>(before[a]-after[a])-(before[b]-after[b])||after[b]-after[a]);
    after[keys[0]]--;sum--;
  }
  for(const key of ATTRIBUTE_NAMES){
    if(core.includes(key)){fieldReasons[key]=after[key]===before[key]?(signatures.includes(key)?'保留岗位特长':'核心总评无需下调'):'按新总评分摊下调，保留专项';continue;}
    if(signatures.includes(key)){fieldReasons[key]='保留岗位特长';continue;}
    if(['goalkeeping','reflexes'].includes(key)&&p.role!=='GK'){fieldReasons[key]='外场门将字段保持';continue;}
    if(before[key]<70){fieldReasons[key]='原有短板保留';continue;}
    const referenceValue=ref?.attributes[key];
    const excess=Number.isFinite(referenceValue)?before[key]-referenceValue:null;
    const budgetCut=before[key]>=88?4:before[key]>=80?3:2;
    let cut=excess!==null&&excess>=5?Math.min(5,Math.max(budgetCut,Math.floor(excess/3))):budgetCut;
    if(protections.length&&['stamina','positioning','tackling','crossing','offBall','composure'].includes(key))cut=Math.min(cut,1);
    if(p.role==='GK')cut=Math.min(cut,2);
    after[key]=Math.max(1,before[key]-cut);
    fieldReasons[key]=excess!==null&&excess>=5?'回收相对FC26明细的过量增益':'本轮非核心属性预算下调';
    if(protections.length&&cut===1)fieldReasons[key]+='；稀缺位置限降1';
  }
  assert.equal(playerOverallFromAttributes(after,p.role),target,p.name);
  for(const k of ATTRIBUTE_NAMES){assert.ok(Number.isInteger(after[k])&&after[k]>=1&&after[k]<=96);assert.ok(after[k]<=before[k]);}
  assert.ok(core.every(k=>before[k]-after[k]<=8),`excessive core cut ${p.name}`);
  const changedKeys=ATTRIBUTE_NAMES.filter(k=>after[k]!==before[k]);
  const tierReason=target===89?'保留极少数顶尖A核心':target===88?'保留国家/俱乐部或专项核心':target===87?'保留稳定主力及羁绊骨架':'常规A主力，压缩同岗位高分堆积';
  return {id:p.id,name:p.name,sourceName:p.sourceName,role:p.role,secondaryRole:p.secondaryRole,group:roleGroup(p.role),nationality:p.nationality,club:p.club,grade:'A',beforeOverall:p.overall,afterOverall:target,before,after,delta:Object.fromEntries(ATTRIBUTE_NAMES.map(k=>[k,after[k]-before[k]])),changedCount:changedKeys.length,signatures,protections,reason:`${tierReason}；保留${signatures.map(k=>ATTRIBUTE_LABELS[k]).join('、')}${protections.length?'；'+protections.join('、'):''}`,fieldReasons,reference:ref?{...ref,kind:'FC26同ID及英文名参考；提案是游戏平衡设计值'}:{kind:'现有游戏档案；外部同阶段明细待核实',url:null,attributes:null}};
}).sort((a,b)=>b.afterOverall-a.afterOverall||['GK','DEF','MID','ATT'].indexOf(a.group)-['GK','DEF','MID','ATT'].indexOf(b.group)||a.name.localeCompare(b.name,'zh-CN'));
const byId=new Map(proposals.map(p=>[p.id,p]));
const afterAll=all.map(p=>byId.has(p.id)?{...p,overall:byId.get(p.id).afterOverall,baseOverall:byId.get(p.id).afterOverall,attributes:{...byId.get(p.id).after},referenceAttributes:{...byId.get(p.id).after}}:structuredClone(p));
for(let i=0;i<all.length;i++)if(all[i].grade!=='A')assert.deepEqual(afterAll[i],all[i]);
const formations={'4-3-3':['GK','LB','CB','CB','RB','DM','AM','AM','LW','ST','RW'],'4-2-3-1':['GK','LB','CB','CB','RB','DM','DM','LM','AM','RM','ST'],'4-4-2':['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST']};
const bitCount=n=>{let c=0;for(;n;n&=n-1)c++;return c;};
function lineup(ps,slots,proposed=false){
  const dp=Array(1<<slots.length).fill(null);dp[0]={score:0,node:null};
  for(const p of ps){const matches=slots.map((r,i)=>p.role===r||p.secondaryRole===r?i:-1).filter(i=>i>=0);if(!matches.length)continue;
    const ovr=proposed&&byId.has(p.id)?byId.get(p.id).afterOverall:p.overall;
    for(let mask=dp.length-1;mask>=0;mask--)if(dp[mask])for(const slot of matches)if(!(mask&(1<<slot))){
      const next=mask|(1<<slot),score=dp[mask].score+ovr+(p.role===slots[slot] ? .01 : 0);
      if(!dp[next]||score>dp[next].score)dp[next]={score,node:{previous:dp[mask].node,id:p.id,name:p.name,role:slots[slot],overall:ovr,slot}};
    }
  }
  let best=0;for(let i=1;i<dp.length;i++)if(dp[i]&&(bitCount(i)>bitCount(best)||bitCount(i)===bitCount(best)&&dp[i].score>dp[best].score))best=i;
  const chosen=[];let node=dp[best].node;while(node){chosen.push({id:node.id,name:node.name,role:node.role,overall:node.overall,slot:node.slot});node=node.previous;}
  assert.equal(new Set(chosen.map(p=>p.id)).size,chosen.length);
  return {count:chosen.length,mean:mean(chosen.map(p=>p.overall)),missingRoles:slots.filter((r,i)=>!(best&(1<<i))),players:chosen.sort((a,b)=>a.slot-b.slot)};
}
const coverage=identityGroups.map(g=>{
  const nonS=g.players.filter(p=>p.grade!=='S'&&p.overall>=83),aps=g.players.filter(p=>p.grade==='A');
  const old87=aps.filter(p=>p.overall>=87).length,new87=aps.filter(p=>byId.get(p.id).afterOverall>=87).length,new88=aps.filter(p=>byId.get(p.id).afterOverall>=88).length;
  const special=['巴黎圣日耳曼','利物浦','马德里竞技'].includes(g.name)&&g.field==='club';
  const minimum=g.major?(special?5:3):null;
  if(minimum!==null)assert.ok(new87>=minimum,`Major core coverage ${g.name}`);
  if(special)assert.ok(new88>=1);
  const layouts=Object.entries(formations).map(([formation,slots])=>{const before=lineup(nonS,slots),after=lineup(nonS,slots,true);assert.equal(before.count,after.count);return {formation,before,after};});
  const best=layouts.toSorted((a,b)=>b.after.count-a.after.count||b.after.mean-a.after.mean)[0];
  return {field:g.field,name:g.name,total:g.players.length,S:g.players.filter(p=>p.grade==='S').length,A:aps.length,major:g.major,minimum87:minimum,old87,new87,new88,nonS83:nonS.length,bestFormation:best.formation,matched:best.after.count,beforeMean:best.before.mean,afterMean:best.after.mean,missingRoles:best.after.missingRoles,bond5:best.after.count>=5,bond7:best.after.count>=7,bond9:best.after.count>=9,layouts};
});
const comparison=['GK','DEF','MID','ATT'].map(group=>{const ap=proposals.filter(p=>p.group===group),sp=players.filter(p=>p.grade==='S'&&p.overall<=92&&roleGroup(p.role)===group);const keys=ATTRIBUTE_NAMES.filter(k=>!PLAYER_OVERALL_ATTRIBUTE_KEYS[group].includes(k)&&(group==='GK'||!['goalkeeping','reflexes'].includes(k)));return {group,A:ap.length,S:sp.length,beforeOverall:mean(ap.map(p=>p.beforeOverall)),afterOverall:mean(ap.map(p=>p.afterOverall)),SOverall:mean(sp.map(p=>p.overall)),beforeNoncore:mean(ap.map(p=>avg(...keys.map(k=>p.before[k])))),afterNoncore:mean(ap.map(p=>avg(...keys.map(k=>p.after[k])))),SNoncore:mean(sp.map(p=>avg(...keys.map(k=>p.attributes[k]))))};});
const duplicates=phase=>{const groups=new Map();for(const p of proposals){const key=ATTRIBUTE_NAMES.map(k=>p[phase][k]).join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p.name);}return [...groups.values()].filter(g=>g.length>1);};
assert.ok(duplicates('after').length<=duplicates('before').length,'new duplicate profiles');
const summary={date:'2026-11-16',status:'拟定方案，未应用',count:230,attributesPerPlayer:26,attributeRows:230*26,distribution:Object.fromEntries([86,87,88,89].map(n=>[n,proposals.filter(p=>p.afterOverall===n).length])),beforeMean:mean(proposals.map(p=>p.beforeOverall)),afterMean:mean(proposals.map(p=>p.afterOverall)),changedAttributes:proposals.reduce((s,p)=>s+p.changedCount,0),fullyUnchangedA:proposals.filter(p=>!p.changedCount).length,externalReferenceMatches:proposals.filter(p=>p.reference.id).length,protectedPlayers:proposals.filter(p=>p.protections.length).length,untouchedNonA:all.length-230,comparison,duplicatesBefore:duplicates('before'),duplicatesAfter:duplicates('after'),allMajorCoreConstraintsMet:true,newPositionHoles:0,matchSimulation:'not run',sourceHashes:hashes};
const result={summary,attributes:ATTRIBUTE_NAMES.map(key=>({key,label:ATTRIBUTE_LABELS[key]})),players:proposals,coverage,method:{ratings:'逐人明确指定目标档位，不由旧属性均值排序；不升总评，不改评级/身份/位置。',core:'保持两项特长；其他核心属性均摊降幅，使位置总评严格匹配。',noncore:'非特长且原值≥70的属性定向回收1—5点；低属性及外场门将字段不动；GK非核心最多降2。',reference:'同来源ID和英文名关联本地FC26快照，仅用于判断非核心膨胀；并非逐人重新实测或EA原始新评分。',protection:'开放身份组内非S85+该主位置候选≤2，标记稀缺；相关非核心关键属性降幅限制1。',coverage:'9个≥50人的国家队、13个≥18人的俱乐部保留≥3名87+；巴黎/利物浦/马竞≥5名87+且≥1名88+。34个开放身份组检查3阵型唯一分配，限非S且83+，仅主/副位置。',limitations:'位置覆盖与均值为静态指标，不代表胜率。完整对局、强化及经济回归需在实施前验证。每一具体新值是平衡设计提案。'}};
for(const file of protectedFiles)assert.equal(hash(file),hashes[file],`Live data changed: ${file}`);
fs.writeFileSync(path.join(out,'proposal.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(summary,null,2));
console.log('Major coverage',coverage.filter(g=>g.major).map(g=>`${g.name}:87+ ${g.new87},83+阵型 ${g.matched}/11,均值 ${g.beforeMean}→${g.afterMean}`).join('\n'));
