export const ELITE_CHALLENGE_RULES=Object.freeze({fee:5000,upgradeLevel:5,rewardChoices:3});
// Use the displayed +5 starting-eleven average so preview and reward tiers agree.
export const ELITE_FAN_TIERS=Object.freeze([
 {minimum:99,fans:2000},{minimum:97,fans:1600},{minimum:95,fans:1200},
 {minimum:92,fans:900},{minimum:0,fans:600},
].map(Object.freeze));
export function eliteFanReward(average){
 const value=Number(average);
 if(!Number.isFinite(value)||value<0)throw new Error('豪门首发平均能力无效');
 return ELITE_FAN_TIERS.find(t=>value>=t.minimum).fans;
}
const entries=[
 ['real-madrid','皇家马德里','4-4-2','冠军韧性','counterAttack','positive',64,65,58,55,60],
 ['barcelona','巴塞罗那','4-3-3','传控渗透','possession','balanced',48,28,65,64,70],
 ['arsenal','阿森纳','3-5-2','技术配合与快速推进','possession','positive',60,40,60,60,68],
 ['bayern-munich','拜仁慕尼黑','4-2-3-1','高位压迫与边路压制','highPress','positive',72,50,72,70,80],
 ['manchester-united','曼联','3-4-3','边路突击与快速转换','direct','positive',74,70,78,56,60],
 ['juventus','尤文图斯','4-4-2','稳固防线与高效反击','counterAttack','defensive',46,65,48,38,44],
 ['inter-milan','国际米兰','5-3-2','三中卫双锋转换','counterAttack','balanced',58,62,60,44,56],
 ['ac-milan','AC米兰','5-3-2','防线协同与中路组织','possession','balanced',48,42,48,48,54],
 ['liverpool','利物浦','5-3-2','高强度压迫与纵向进攻','highPress','positive',78,66,62,67,84],
 ['chelsea','切尔西','4-3-1-2','紧凑防守与快速转换','counterAttack','balanced',60,64,45,43,58],
 ['atletico-madrid','马德里竞技','3-5-2','紧凑低位与双锋反击','lowBlock','defensive',44,70,48,30,46],
 ['manchester-city','曼城','4-2-3-1','阵地控制与高位夺回','possession','positive',52,30,66,72,76],
 ['paris-saint-germain','巴黎圣日耳曼','4-3-3','边锋突破与巨星配合','possession','positive',66,46,75,62,65],
 ['benfica','本菲卡','3-5-2','技术推进与边路冲击','possession','positive',64,48,68,55,60],
 ['newcastle-united','纽卡斯尔联','4-2-3-1','身体对抗与持续压迫','highPress','positive',70,62,62,58,76],
 ['borussia-dortmund','多特蒙德','3-5-2','高压抢回与纵向冲刺','highPress','positive',78,70,64,65,80],
 ['napoli','那不勒斯','4-3-1-2','中路创造与快速组合','possession','positive',68,42,50,57,62],
 ['tottenham-hotspur','托特纳姆热刺','4-3-1-2','纵向冲击与积极进攻','direct','positive',76,75,58,58,62],
];
export const ELITE_CLUBS=Object.freeze(entries.map(([id,name,formation,styleLabel,style,tactic,tempo,directness,attackingWidth,defensiveLine,pressing])=>Object.freeze({id,name,formation,styleLabel,style,tactic,tacticalDimensions:{tempo,directness,attackingWidth,defensiveLine,pressing,compactness:style==='lowBlock'?84:65,counterAttack:['counterAttack','direct'].includes(style)?80:45,timeWasting:15}})));
export const ELITE_CLUB_BY_ID=Object.fromEntries(ELITE_CLUBS.map(c=>[c.id,c]));
export const canonicalClubName=name=>({'曼彻斯特联':'曼联','曼彻斯特城':'曼城','巴黎圣日尔曼':'巴黎圣日耳曼','PSV埃因霍温':'埃因霍温','南安普顿':'南安普敦'}[name]??name);
export function applyEliteTerritoryRules(index){
 for(const t of index?.territories??[]){
  if(!Array.isArray(t.clubIds)||!(t.historicalClubIds??t.clubIds).length)continue;
  t.historicalClubIds??=[...t.clubIds];t.clubIds=t.historicalClubIds.filter(id=>ELITE_CLUB_BY_ID[id]);t.eliteClubIds=[...t.clubIds];if(Array.isArray(t.garrisonClubIds))t.garrisonClubIds=t.garrisonClubIds.filter(id=>ELITE_CLUB_BY_ID[id]);
  if(t.clubIds.length){t.spawnAllowed=false;t.initialOwner={type:'club',id:'club-garrison:'+t.territoryId,name:t.clubIds.map(id=>ELITE_CLUB_BY_ID[id].name).join(' / ')};}
  else if(t.initialOwner?.type==='club'){t.initialOwner={type:'neutral',id:null,name:'中立地区'};t.spawnAllowed=Boolean(t.playable);}
 }
 return index;
}
export const isEliteTerritory=t=>Boolean(t?.eliteClubIds?.length||t?.clubIds?.some(id=>ELITE_CLUB_BY_ID[id]));
