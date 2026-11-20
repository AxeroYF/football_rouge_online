import {assignedGroup, playerTraitIds, S4_BOND_WILDCARD_TRAIT_ID, S4_SHORT_PLAYER_MAX_HEIGHT, S4_TALL_PLAYER_MIN_HEIGHT} from './bond-rules.js';
import {resolveV2SplitTacticalPlan, V2_POSSESSION_STYLES, V2_DEFENSIVE_BLOCKS, V2_TRANSITION_STYLES, V2_DUEL_INTENSITIES} from './v2-tactical-profiles.js';

const definitions=[];
function identity(type,name,style,primary,secondary,key=name){
  definitions.push({id:type+':'+key,type,name,styles:[style],primary,secondary,minimum:5});
}
for(const row of [
  ['皇家马德里','counterAttack','pace','offBall'],['巴塞罗那','possession','passing','firstTouch'],
  ['拜仁慕尼黑','wingPlay','crossing','acceleration'],['尤文图斯','lowBlock','positioning','composure'],
  ['阿森纳','possession','offBall','passing'],['国际米兰','vertical','passing','offBall'],
  ['AC米兰','midBlock','positioning','decisions'],['曼联','longBall','offBall','pace'],
  ['马德里竞技','lowBlock','marking','tackling'],['曼城','possession','decisions','vision'],
  ['利物浦','highPress','workRate','stamina'],['巴黎圣日耳曼','wingPlay','dribbling','acceleration'],
  ['切尔西','midBlock','tackling','strength'],['那不勒斯','vertical','dribbling','offBall'],
  ['纽卡斯尔联','roughPlay','strength','workRate'],['多特蒙德','counterAttack','acceleration','finishing'],
  ['托特纳姆热刺','wingPlay','offBall','crossing'],['本菲卡','highPress','tackling','acceleration'],
  ['阿斯顿维拉','retain','composure','passing'],['加拉塔萨雷','roughPlay','aggression','heading'],
  ['勒沃库森','vertical','offBall','firstTouch'],['利雅得新月','wingPlay','heading','positioning']
])identity('club',...row);
for(const row of [
  ['西班牙','possession','vision','composure'],['法国','counterAttack','acceleration','firstTouch'],
  ['巴西','wingPlay','dribbling','agility'],['意大利','lowBlock','positioning','decisions'],
  ['阿根廷','possession','dribbling','passing'],['德国','vertical','decisions','passing'],
  ['荷兰','highPress','positioning','acceleration'],['葡萄牙','wingPlay','finishing','offBall'],
  ['英格兰','wingPlay','heading','strength'],['比利时','longBall','firstTouch','strength'],
  ['克罗地亚','retain','composure','firstTouch'],['哥伦比亚','counterAttack','vision','dribbling']
])identity('nationality',...row);
for(const row of [
  ['非洲','counterAttack','pace','dribbling','africa'],['亚洲大洋洲','vertical','offBall','workRate','asia-oceania'],
  ['中东欧','longBall','firstTouch','longShots','central-eastern-europe'],['北欧','longBall','heading','jumping','nordic'],
  ['中北美洲','midBlock','stamina','tackling','north-central-america']
])identity('nationality-region',...row);

for(const [key,name,styles,primary,secondary,minimum,points] of [
  ['united','团结起来',['balanced'],'workRate','discipline',11,5],
  ['small-quick-skillful','小快灵',['possession'],'agility','firstTouch',5,4],
  ['aerial-bombardment','高空轰炸',['longBall','wingPlay'],'heading','jumping',5,4],
  ['steel-defense','钢铁防线',['lowBlock'],'positioning','strength',6,5],
  ['blow-them-up','跟他们爆了',['vertical'],'finishing','offBall',5,5],
  ['mahjong-together','一起打麻将',['possession'],'passing','firstTouch',6,5]
])definitions.push({id:'structure:'+key,key,type:'structure',name,styles,primary,secondary,minimum,points});

export const TACTICAL_BONDS=Object.freeze(definitions);
const categories=[['possessionStyle',V2_POSSESSION_STYLES],['defensiveBlock',V2_DEFENSIVE_BLOCKS],['transitionStyle',V2_TRANSITION_STYLES],['duelIntensity',V2_DUEL_INTENSITIES]];
// "balanced" on this card means balanced organization, even if other controls are balanced.
const groupFor=style=>categories.find(([,values])=>Object.hasOwn(values,style));
export const bondStyleLabel=style=>groupFor(style)[1][style];
function height(player,traits){
  if(Number.isFinite(player.effectiveHeightCm))return player.effectiveHeightCm;
  return Number(player.heightCm)+(traits.has('aerial-beacon')?20:0)-(traits.has('custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20')?5:0);
}
function qualifies(b,entry,p,traits,roles){
  const identity=p.bondIdentity??p;
  if(b.type==='structure'){
    switch(b.key){
      case 'united':return Number(identity.upgradeLevel??0)===0;
      case 'small-quick-skillful':return height(p,traits)<S4_SHORT_PLAYER_MAX_HEIGHT;
      case 'aerial-bombardment':return height(p,traits)>S4_TALL_PLAYER_MIN_HEIGHT;
      case 'steel-defense':return assignedGroup(p,roles)==='DEF';
      case 'blow-them-up':return assignedGroup(p,roles)==='ATT';
      case 'mahjong-together':return assignedGroup(p,roles)==='MID';
    }
  }
  if(traits.has(S4_BOND_WILDCARD_TRAIT_ID))return true;
  return b.type==='nationality-region'?entry.memberNationalities.includes(identity.nationality):identity[b.type]===b.name;
}

export function tacticalBondTierBonus(bond, tier) {
  const points = bond.points ?? (tier >= 9 ? 6 : tier >= 7 ? 5 : 4);
  return { [bond.primary]:points, [bond.secondary]:points - 1 };
}

export function evaluateTacticalBonds(players,catalog,plan={},roles={}){
  const lineup=players.filter(p=>p.active!==false),sources=new Map((catalog??[]).map(b=>[b.id,b]));
  const traits=new Map(lineup.map(p=>[p.id,playerTraitIds(p)])),style=resolveV2SplitTacticalPlan(plan);
  const rows=definitions.filter(b=>b.type==='structure'||sources.has(b.id)).map(b=>{
    const members=lineup.filter(p=>qualifies(b,sources.get(b.id),p,traits.get(p.id),roles));
    const count=members.length;
    const tier=count<b.minimum||b.type==='structure'&&lineup.length!==11?0:b.points?b.minimum:count>=9?9:count>=7?7:5;
    return {...b,count,tier,memberIds:members.map(p=>p.id),wildcardIds:b.type==='structure'?[]:members.filter(p=>traits.get(p.id).has(S4_BOND_WILDCARD_TRAIT_ID)).map(p=>p.id),
      fits:b.styles.some(key=>style[groupFor(key)[0]]===key),add:tier?tacticalBondTierBonus(b,tier):{},active:false};
  });
  const ready=rows.filter(b=>b.tier&&b.fits);
  // Higher bonuses and larger eligible groups take priority within the two slots.
  ready.sort((a,b)=>Object.values(b.add)[0]-Object.values(a.add)[0]||b.count-a.count||Number(a.type==='structure')-Number(b.type==='structure')||Number(a.type==='nationality-region')-Number(b.type==='nationality-region'));
  let slots=0,national=false;
  for(const b of ready){
    const isNational=b.type.startsWith('nationality');
    if(slots===2||isNational&&national)continue;
    b.active=true;slots++;national||=isNational;
  }
  return rows;
}

export function applyTacticalBondBonuses(players,rows,{maximumAttribute=99}={}){
  const active=rows.filter(b=>b.active);
  return players.map(p=>{
    const attributes={...p.attributes},ids=[];
    for(const bond of active){
      if(!bond.memberIds.includes(p.id))continue;
      ids.push(bond.id);
      for(const [key,points] of Object.entries(bond.add))if(Number.isFinite(attributes[key]))attributes[key]=Math.min(maximumAttribute,attributes[key]+points);
    }
    return {...p,attributes,ydlBondIds:ids};
  });
}
