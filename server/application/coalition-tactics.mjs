import {repairSquadTactics} from '../../shared/config/tactics-repair.mjs';
import {initializePositionInheritance} from '../../shared/config/position-inheritance.mjs';
import {fitnessRedline} from '../../shared/config/fitness.mjs';
import {confirmedResearchFormation,matchesResearchFormation} from '../../shared/config/formation-research.mjs';
import {analyzeElevenBoardFormation,sanitizeFormationLines} from '../../formation-rules.js';
import {PLAYER_SQUAD_IDS} from '../../shared/config/player-squads.mjs';
function defaultTacticsPositions(players = []) {
  const groups = { GK:[], DEF:[], MID:[], ATT:[] };
  players.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const result = {};
  [["GK",90],["DEF",68],["MID",44],["ATT",20]].forEach(([group,y]) => groups[group].forEach((player,index) => {
    result[player.id] = { x:Math.round(((index + 1) / (groups[group].length + 1)) * 76 + 12), y };
  }));
  return result;
}

function sanitizeTacticsPositions(players, positions = {}) {
  const fallback = defaultTacticsPositions(players);
  return Object.fromEntries(players.map((player) => {
    const value = positions?.[player.id] ?? fallback[player.id];
    return [player.id, {
      x:Math.round(Math.max(8, Math.min(92, Number(value?.x) || 50))),
      y:Math.round(Math.max(6, Math.min(94, Number(value?.y) || 50))),
    }];
  }));
}

function defaultTacticsStarters(roster = []) {
  const available = [...roster].sort((left,right) => Number(right.effectiveOverall ?? right.overall ?? 0) - Number(left.effectiveOverall ?? left.overall ?? 0));
  const selected = [];
  const take = (pool,count) => available.filter((player) => player.pool === pool && !selected.includes(player)).slice(0,count).forEach((player) => selected.push(player));
  take("GK",1); take("DEF",4); take("MID",3); take("ATT",3);
  available.filter((player) => player.pool !== "GK" && !selected.includes(player)).forEach((player) => { if (selected.length < 11) selected.push(player); });
  return selected.slice(0,11).map((player) => player.id);
}


export function sanitizeCoalitionTactics(account,eligible,sourceValue={}) {
 const squadId="expedition";
      sourceValue = repairSquadTactics(sourceValue, eligible, { previousRoster:account.draft.roster });
      const eligibleIds = new Set(eligible.map((player) => player.id));
      const requested = [...new Set((Array.isArray(sourceValue.starters) ? sourceValue.starters : []).map(String).filter((id) => eligibleIds.has(id)))];
      const starters = requested.length ? requested : defaultTacticsStarters(eligible);
      if (starters.length !== 11) throw new Error(`${squadId === PLAYER_SQUAD_IDS.EXPEDITION ? "远征" : "留守"}编队必须选择恰好11名首发球员`);
      const players = starters.map((id) => eligible.find((player) => player.id === id));
      const planSnapshots = sourceValue.planSnapshots && typeof sourceValue.planSnapshots === "object" ? structuredClone(sourceValue.planSnapshots) : {};
      const embedded = planSnapshots.__s4V2 && typeof planSnapshots.__s4V2 === "object" ? planSnapshots.__s4V2 : {};
      const basePositions = sanitizeTacticsPositions(players, embedded.positionPresets?.position1 ?? sourceValue.positions);
      const baseLines = sanitizeFormationLines(embedded.formationLinePresets?.position1 ?? sourceValue.formationLines);
      const inherited = initializePositionInheritance({
        customPositionPresets:embedded.customPositionPresets,
        positionPresets:{position1:basePositions,position2:embedded.positionPresets?.position2,position3:embedded.positionPresets?.position3},
        formationLinePresets:{position1:baseLines,position2:sanitizeFormationLines(embedded.formationLinePresets?.position2 ?? baseLines),position3:sanitizeFormationLines(embedded.formationLinePresets?.position3 ?? baseLines)},
        researchFormationIds:embedded.researchFormationIds,
        researchFormationBackups:embedded.researchFormationBackups,
      }, {generatedPositions:defaultTacticsPositions(eligible),defaultLines:sanitizeFormationLines()});
      Object.assign(embedded,inherited);
      const presetKeys = ["position1","position2","position3"];
      const formationLinePresets = Object.fromEntries(presetKeys.map((key) => [key,sanitizeFormationLines(embedded.formationLinePresets?.[key] ?? sourceValue.formationLines)]));
      const positionPresets = Object.fromEntries(presetKeys.map((key) => {
        const source = embedded.positionPresets?.[key] ?? sourceValue.positions;
        const sanitized = sanitizeTacticsPositions(players,source);
        const formation = analyzeElevenBoardFormation(players,sanitized,formationLinePresets[key]);
        const validOutfieldLines = [formation.counts.DEF,formation.counts.MID,formation.counts.ATT].every((count) => count >= 1);
        if (formation.counts.GK !== 1 || (key === "position1" && !validOutfieldLines)) {
          const planLabel = key === "position1" ? "默认站位" : key === "position2" ? "领先站位" : "落后站位";
          const squadLabel = squadId === PLAYER_SQUAD_IDS.EXPEDITION ? "远征" : "留守";
          throw new Error(`${squadLabel}${planLabel}：门将必须且只能有一人${key === "position1" ? "，并保留前场、中场、后场三条外场线" : ""}`);
        }
        return [key,sanitized];
      }));
      const researchFormationIds=Object.fromEntries(presetKeys.map(key=>{
        const id=embedded.researchFormationIds?.[key]??null;
        if(id&&!matchesResearchFormation(confirmedResearchFormation(account,id),positionPresets[key],formationLinePresets[key]))throw new Error('研究阵型站位已锁定，请重新导入或解除使用');
        return [key,id];
      }));
      const captainId = String(embedded.captainId ?? "");
      if (captainId && !starters.includes(captainId)) throw new Error("队长必须来自当前11人首发阵容");
      planSnapshots.__s4V2 = { ...embedded,fitnessThreshold:fitnessRedline(embedded.fitnessThreshold),researchFormationIds,starters:[...starters],positionPresets,formationLinePresets,captainId:captainId || starters[0] };
      const bench = eligible.map((player) => player.id).filter((id) => !starters.includes(id));
      const openingFormation = analyzeElevenBoardFormation(players,positionPresets.position1,formationLinePresets.position1);
      return { formation:openingFormation.name,attackStyle:String(sourceValue.attackStyle || "balanced"),defenseStyle:String(sourceValue.defenseStyle || "possession"),starters,bench,positions:positionPresets.position1,formationLines:formationLinePresets.position1,tacticalBars:sourceValue.tacticalBars && typeof sourceValue.tacticalBars === "object" ? sourceValue.tacticalBars : {},planSnapshots,activePlan:String(sourceValue.activePlan || "opening"),updatedAt:Date.now() };
}
