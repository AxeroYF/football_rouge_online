export const CORE_COUNTRY_CODES = Object.freeze(["GBR", "ESP", "DEU", "ITA", "FRA", "PRT", "NLD", "BRA", "ARG"]);

export const AI_FORMATIONS = Object.freeze({
  "4-3-3": [["GK",50,91],["LB",18,70],["CB",39,72],["CB",61,72],["RB",82,70],["DM",50,53],["AM",34,39],["AM",66,39],["LW",20,20],["ST",50,15],["RW",80,20]],
  "4-2-3-1": [["GK",50,91],["LB",18,70],["CB",39,72],["CB",61,72],["RB",82,70],["DM",39,53],["DM",61,53],["LW",21,34],["AM",50,34],["RW",79,34],["ST",50,15]],
  "4-4-2": [["GK",50,91],["LB",18,70],["CB",39,72],["CB",61,72],["RB",82,70],["LM",18,46],["DM",40,48],["AM",60,48],["RM",82,46],["ST",39,18],["ST",61,18]],
  "3-4-3": [["GK",50,91],["CB",27,70],["CB",50,72],["CB",73,70],["LM",18,48],["DM",40,50],["AM",60,50],["RM",82,48],["LW",20,20],["ST",50,15],["RW",80,20]],
  "5-3-2": [["GK",50,91],["LB",14,67],["CB",33,72],["CB",50,74],["CB",67,72],["RB",86,67],["DM",50,51],["AM",34,42],["AM",66,42],["ST",39,18],["ST",61,18]],
  "4-1-4-1": [["GK",50,91],["LB",18,70],["CB",39,72],["CB",61,72],["RB",82,70],["DM",50,56],["LM",18,40],["AM",40,42],["AM",60,42],["RM",82,40],["ST",50,16]],
  "4-3-1-2": [["GK",50,91],["LB",18,70],["CB",39,72],["CB",61,72],["RB",82,70],["DM",50,55],["AM",34,46],["AM",66,46],["AM",50,31],["ST",38,16],["ST",62,16]],
  "3-5-2": [["GK",50,91],["CB",27,71],["CB",50,74],["CB",73,71],["LM",15,49],["DM",39,53],["AM",50,42],["DM",61,53],["RM",85,49],["ST",39,17],["ST",61,17]],
  "3-4-2-1": [["GK",50,91],["CB",27,71],["CB",50,74],["CB",73,71],["LM",16,50],["DM",40,53],["DM",60,53],["RM",84,50],["AM",35,31],["AM",65,31],["ST",50,15]],
  "5-4-1": [["GK",50,91],["LB",13,67],["CB",32,72],["CB",50,75],["CB",68,72],["RB",87,67],["LM",18,43],["DM",40,47],["AM",60,47],["RM",82,43],["ST",50,16]],
  "4-2-2-2": [["GK",50,91],["LB",18,70],["CB",39,72],["CB",61,72],["RB",82,70],["DM",39,53],["DM",61,53],["AM",31,34],["AM",69,34],["ST",40,16],["ST",60,16]],
});

const AI_PROFILES = Object.freeze([
  { mentality:"控球主导", style:"密集短传", tactic:"balanced", engineStyle:"possession", formations:["4-3-3","4-2-3-1","4-3-1-2","3-4-2-1"], bars:{ tempo:48,directness:38,attackingWidth:58,defensiveLine:58,pressing:62,compactness:60,counterAttack:35,timeWasting:10 } },
  { mentality:"积极进取", style:"高位压迫", tactic:"positive", engineStyle:"highPress", formations:["4-3-3","3-4-3","3-4-2-1","4-2-2-2"], bars:{ tempo:68,directness:54,attackingWidth:62,defensiveLine:70,pressing:78,compactness:55,counterAttack:48,timeWasting:5 } },
  { mentality:"谨慎反击", style:"快速反击", tactic:"defensive", engineStyle:"counterAttack", formations:["4-2-3-1","5-3-2","3-5-2","4-1-4-1"], bars:{ tempo:61,directness:72,attackingWidth:52,defensiveLine:38,pressing:44,compactness:72,counterAttack:80,timeWasting:24 } },
  { mentality:"纵向冲击", style:"直接进攻", tactic:"positive", engineStyle:"direct", formations:["4-4-2","3-4-3","3-5-2","4-2-2-2"], bars:{ tempo:72,directness:82,attackingWidth:68,defensiveLine:52,pressing:60,compactness:50,counterAttack:66,timeWasting:8 } },
  { mentality:"稳守优先", style:"低位防守", tactic:"parkBus", engineStyle:"lowBlock", formations:["5-3-2","5-4-1","4-1-4-1","4-4-2"], bars:{ tempo:34,directness:62,attackingWidth:45,defensiveLine:28,pressing:34,compactness:82,counterAttack:64,timeWasting:36 } },
]);

function hash(value) { let result=2166136261; for (const character of String(value)) { result^=character.charCodeAt(0); result=Math.imul(result,16777619); } return result>>>0; }
const overall = (player) => Number(player.effectiveOverall ?? player.overall ?? 0);

function selectPlayer(catalog, role, target, seed, used) {
  const exact = catalog.filter((player) => player.role === role && player.isX !== true && !used.has(player.id));
  if (!exact.length) throw new Error(`球员库缺少主位置 ${role}，无法生成地块守军`);
  const ranked = exact.sort((left,right) => (Math.abs(overall(left)-target)*10000+hash(`${seed}:${left.id}`)%10000) - (Math.abs(overall(right)-target)*10000+hash(`${seed}:${right.id}`)%10000));
  const player = ranked[hash(`${seed}:${role}:pick`) % Math.min(4, ranked.length)];
  used.add(player.id);
  return player;
}

export function createTerritoryAiGarrison({ catalog, territory, territoryState, seasonId="season-01", generationSeed="yellowdogs" }) {
  const seed=`${generationSeed}:${seasonId}:${territory.territoryId}`;
  const clubOwned=territoryState.ownerType === "club";
  const coreCountry=CORE_COUNTRY_CODES.includes(territory.countryCode);
  const difficulty=Math.min(5, 1+hash(`${seed}:difficulty`)%5+(clubOwned?1:0));
  const targetAverageOverall=Math.min(92,69+difficulty*3+(coreCountry?4:0)+(clubOwned?3:0));
  const profile=AI_PROFILES[hash(`${seed}:profile`)%AI_PROFILES.length];
  const formation=profile.formations[hash(`${seed}:formation`)%profile.formations.length];
  const used=new Set();
  const lineup=AI_FORMATIONS[formation].map(([role,x,y],index)=>{ const source=selectPlayer(catalog,role,targetAverageOverall,`${seed}:${index}`,used); return {playerId:source.id,role,x,y,overall:overall(source)}; });
  const averageOverall=Number((lineup.reduce((sum,player)=>sum+player.overall,0)/lineup.length).toFixed(1));
  return { schemaVersion:2,territoryId:territory.territoryId,generatedForSeason:seasonId,coreCountry,difficulty,targetAverageOverall,averageOverall,formation,mentality:profile.mentality,playStyle:profile.style,tactic:profile.tactic,engineStyle:profile.engineStyle,tacticalDimensions:{...profile.bars},lineup,generatedAt:Date.now() };
}

export function publicTerritoryAiIntel(garrison, catalog) {
  const byId=new Map(catalog.map((player)=>[player.id,player]));
  return { territoryId:garrison.territoryId,coreCountry:garrison.coreCountry,difficulty:garrison.difficulty,targetAverageOverall:garrison.targetAverageOverall,averageOverall:garrison.averageOverall,formation:garrison.formation,mentality:garrison.mentality,playStyle:garrison.playStyle,lineup:garrison.lineup.map((slot)=>({id:slot.playerId,name:byId.get(slot.playerId)?.name??"未知球员",role:slot.role,overall:slot.overall})) };
}
