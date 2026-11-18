import {ATTRIBUTE_NAMES, PLAYER_OVERALL_ATTRIBUTE_KEYS, roleGroup} from '../shared/football/schema.js';
import {FINAL_GAME_ATTRIBUTE_BASIS, TARGET_SCALED_ATTRIBUTE_BASIS} from '../shared/football/player-source-attributes.js';

// User-authorized 2026-11-16 revision. Numerical profiles are game designs,
// not claimed historical EA ratings. Keep the 13 gameplay IDs and their OVRs.
export const DLC_PROFILE_REVISION = '20261116-profiles-1';
export const PRE_SCALED_DLC_IDS = Object.freeze([
  's4-dlc-20260731-048', 's4-dlc-20260731-049', 's4-dlc-20260731-052',
  's4-dlc-20260731-053', 's4-dlc-20260731-054',
]);
export const DUPLICATE_PROFILE_PAIRS = Object.freeze([
  ['s4-dlc-20260731-023','s4-dlc-20260731-038'],
  ['s4-dlc-20260731-028','s4-dlc-20260731-054'],
  ['s4-dlc-20260731-006','s4-dlc-20260731-025'],
  ['s4-dlc3-20260808-012','s4-dlc3-20260808-040'],
]);

// Order follows ATTRIBUTE_NAMES: passing, firstTouch, dribbling, crossing,
// finishing, longShots, heading, setPieces, tackling, marking, positioning,
// vision, decisions, composure, offBall, discipline, pace, acceleration,
// strength, stamina, agility, jumping, workRate, aggression, goalkeeping, reflexes.
function profile(name, overall, role, description, values, evidence=[]) {
  if(values.length!==ATTRIBUTE_NAMES.length||values.some(v=>!Number.isInteger(v)||v<1||v>96))throw Error(`Invalid revised attributes: ${name}`);
  const attributes=Object.fromEntries(ATTRIBUTE_NAMES.map((key,i)=>[key,values[i]]));
  const core=PLAYER_OVERALL_ATTRIBUTE_KEYS[roleGroup(role)];
  if(core.reduce((sum,key)=>sum+attributes[key],0)!==overall*core.length)throw Error(`Revised OVR must be exact: ${name}`);
  return {name,overall,role,description,attributes,evidence};
}

export const REBUILT_DLC_PROFILES = Object.freeze({
  's4-dlc-20260731-023':profile('Rui Costa',85,'AM','持球组织前腰：停球、盘带与灵活突出，防守与力量较弱。',
    [86,91,90,78,77,82,48,84,40,38,52,87,85,89,84,68,78,80,58,76,87,50,70,44,10,10]),
  's4-dlc-20260731-038':profile('Cesc Fàbregas',85,'AM','传球组织者：传球、视野和决策突出，速度及持球突破低于科斯塔。',
    [91,84,83,82,76,80,48,86,58,49,62,91,88,89,80,72,69,71,61,71,76,49,76,59,10,10]),
  's4-dlc-20260731-028':profile('Mario Kempes',89,'ST','冲击型前锋：推进速度、力量和远射突出，以部分无球、冷静换取冲击能力。',
    [73,84,88,67,90,88,84,72,35,31,47,72,82,88,88,64,91,90,86,81,84,84,80,77,10,10]),
  's4-dlc-20260731-054':profile('Raúl González',89,'ST','禁区终结者：无球、射门、冷静与接应突出，绝对速度及力量较低。',
    [78,90,86,64,92,80,84,74,35,33,50,81,91,92,94,78,81,83,74,82,86,77,84,54,9,9],
    ['https://www.realmadrid.com/es-ES/noticias/futbol/primer-equipo/actualidad/goles-con-historia-raul']),
  's4-dlc-20260731-006':profile('Martín Demichelis',84,'CB','正面对抗中卫：力量、头球和争顶突出，回追及转身灵活有限。',
    [70,65,48,38,33,40,87,40,87,87,86,62,80,78,42,68,72,66,88,78,58,86,81,80,11,11]),
  's4-dlc-20260731-025':profile('Ricardo Carvalho',84,'CB','预判补位中卫：站位、决策、转身与出球突出，力量低于德米凯利斯。',
    [74,70,58,38,34,39,80,38,89,89,90,68,87,84,42,75,76,76,76,77,74,82,78,69,10,10],
    ['https://www.chelseafc.com/en/news/article/team-of-120-the-shortlisted-defenders']),
  's4-dlc3-20260808-012':profile('Fernando Hierro',89,'CB','攻守中卫：力量、争顶、远射和定位球突出，转身与加速保留短板。',
    [81,75,58,48,70,84,92,88,93,93,94,76,87,86,63,72,73,65,92,79,58,90,82,84,11,11],
    ['https://www.realmadrid.com/es-ES/el-club/historia/leyendas-futbol/fernando-ruiz-hierro/']),
  's4-dlc3-20260808-040':profile('Leonardo Bonucci',89,'CB','后场组织中卫：传球、视野、决策与站位突出，射门、定位球与加速有限。',
    [90,79,62,44,38,51,84,48,94,95,96,84,90,89,45,78,72,64,88,79,60,82,80,73,13,13],
    ['https://www.juventus.com/en/news/articles/bonucci-extends-contract-until-2021']),
  's4-dlc-20260731-027':profile('Joaquín Sánchez Rodríguez',85,'RM','贝蒂斯2004/05时期右路边锋：盘带、传中、加速突出，力量、争顶和防守较弱。',
    [84,88,91,92,75,76,52,77,36,32,40,83,82,83,85,74,87,89,62,88,90,57,75,43,8,8],
    ['https://rfef.es/es/selecciones/jugadores/joaquin',
      'https://rfef.es/es/noticias/joaquin-sanchez-diestra-magica-seleccion-cumple-34-anos',
      'https://www.realbetisbalompie.es/news/current_news/joaquin-capitan-y-leyenda-del-real-betis-anuncia-su-retirada-28945',
      'https://as.com/resultados/ficha/deportista/joaquin/1892/']),
});

export const REVISED_DLC_PLAYER_IDS=Object.freeze([...new Set([...PRE_SCALED_DLC_IDS,...Object.keys(REBUILT_DLC_PROFILES)])]);

export function reviseDlcProfile(player,id) {
  if(!REVISED_DLC_PLAYER_IDS.includes(id)||player.dataCorrections?.profileRevision?.revision===DLC_PROFILE_REVISION)return player;
  const design=REBUILT_DLC_PROFILES[id];
  const names={
    's4-dlc-20260731-048':'Didi', 's4-dlc-20260731-049':'Robinho',
    's4-dlc-20260731-052':'Zé Roberto', 's4-dlc-20260731-053':'Miroslav Klose',
  };
  const expected=design?.name??names[id];
  const joaquin=id==='s4-dlc-20260731-027';
  if(player.sourceName!==expected&&!(joaquin&&player.sourceName==='Joaquín'))throw Error(`Profile revision identity mismatch: ${id}`);
  if(design&&player.overall!==design.overall)throw Error(`Profile revision OVR mismatch: ${id}`);
  const before={source:structuredClone(player.source),attributes:{...player.attributes},attributeBasis:player.attributeBasis??'reference'};
  const correction={revision:DLC_PROFILE_REVISION,kind:design?'curated-game-profile':'remove-duplicate-scaling',
    description:design?.description??'源属性已做目标能力缩放，移除运行时第二次整体加成；仅校验核心总评。',
    preScaled:PRE_SCALED_DLC_IDS.includes(id),previous:before,evidence:design?.evidence??['devtool/finalize-player-dlc-workbook.mjs:adjustedAttributes']};
  const next={...player,attributeBasis:design?FINAL_GAME_ATTRIBUTE_BASIS:TARGET_SCALED_ATTRIBUTE_BASIS,
    attributes:{...(design?.attributes??player.attributes)},dataCorrections:{...player.dataCorrections,profileRevision:correction}};
  if(joaquin){
    correction.previous.identity={sourceName:player.sourceName,club:player.club,role:player.role,secondaryRole:player.secondaryRole,heightCm:player.heightCm,age:player.age,preferredFoot:player.preferredFoot,weakFoot:player.weakFoot,skillMoves:player.skillMoves};
    Object.assign(next,{sourceName:design.name,club:'皇家贝蒂斯',role:'RM',secondaryRole:'RW',heightCm:179,age:23,preferredFoot:'right',weakFoot:3,skillMoves:4});
    next.source={overall:85,version:'Real Betis 2004/05 — curated B85 game profile',type:'verified identity / curated game attributes',id:'joaquin-sanchez-rodriguez',
      url:design.evidence[0],datasetUrl:null,note:'用户确认贝蒂斯华金；身份与右路惯用脚有官方资料依据，26项能力及逆足/花式为游戏设计值，并非EA历史原卡。'};
  }
  if(id==='s4-dlc-20260731-052'&&player.attributes.composure===9){
    // 9 equals the legacy minimum 1 plus the earlier +8 scaling. Treat this as
    // an estimated missing-value repair, not a verified historic composure.
    next.attributes.composure=player.attributes.decisions;
    correction.missingComposure={kind:'estimated-legacy-missing',previous:9,replacement:player.attributes.decisions,
      basis:'同条已缩放的决策值；原始历史冷静档案未留存，明确作为估算补值。'};
  }
  return next;
}
