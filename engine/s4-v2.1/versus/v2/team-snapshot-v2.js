import { buildV2TeamPlayerEffects } from './team-player-effects.js';
import { offlineDisplayAttributeValue } from "../offline-attribute-settings.js";
import { captainStyleModifiers } from "../public/captain-rules.js";
import { inferElevenBoardRoles } from "../public/formation-rules.js";
import { resolveV2MatchParameters, v2EngineAttributeValue, V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function buildV2TeamSnapshots(teams, options = {}) {
  const parameters = options.parameters ?? V2_MATCH_PARAMETERS;
  const minute = clamp(Number(options.state?.minute ?? 0), 0, parameters.state.regulationMinutes + parameters.state.extraTimeMinutes);
  const score = options.state?.score ?? [0, 0];
  const weather = options.environment?.weather ?? "sunny";
  const precipitation = Number(options.environment?.precipitation ?? (weather === "superStorm" ? 100 : ["rain", "storm"].includes(weather) ? 70 : weather === "snow" ? 45 : 0));
  return teams.map((team, teamIndex) => {
    const roles = inferElevenBoardRoles((team.players ?? []).filter(player=>player.active!==false).map((player) => ({ id:player.id, position:team.positions?.[player.id] })), team.formationLines);
    const scoreState = score[teamIndex] > score[1 - teamIndex] ? "leading" : score[teamIndex] < score[1 - teamIndex] ? "trailing" : "level";
    const {players:displayPlayers,bonds}=buildV2TeamPlayerEffects(team,{roles,minute,weather,precipitation,scoreState});
    const players = displayPlayers.map((player) => {
      const displayAttributes = Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key, value]) => [key, Number(offlineDisplayAttributeValue(value).toFixed(2))]));
      return {
        ...player,
        displayAttributes,
        captain:player.id === team.captainId,
        attributes:Object.fromEntries(Object.entries(displayAttributes).map(([key, value]) => [key, Number(v2EngineAttributeValue(value, parameters).toFixed(2))])),
      };
    });
    const captaincy = captainStyleModifiers({ ...team, players }, scoreState);
    return {
      ...team,
      players,
      v2Snapshot:{
        minute,
        scoreState,
        weather,
        captaincy,
        activeBonds:bonds.slice(0, 2).map((bond) => ({ id:bond.id, type:bond.type, name:bond.name, bonus:bond.bonus, memberIds:bond.memberIds })),
        sourcePolicy:{
          enhancementAttributes:true,
          traitRules:true,
          bondAttributes:true,
          legendBaseAttributes:true,
          legendSpecialAbility:false,
          xGrowthAttributes:true,
          xSelectedTraits:true,
          substitutions:Boolean(parameters.state.substitutionsEnabled),
          legendSpecialAbility:false,
        },
        sourceCounts:{ legends:players.filter((player) => player.grade === "S" || player.legendary).length, xPlayers:players.filter((player) => player.grade === "X" || player.xPlayer).length },
      },
    };
  });
}

export function resolveV2SnapshotParameters(overrides = {}) {
  return Object.keys(overrides).length ? resolveV2MatchParameters(overrides) : V2_MATCH_PARAMETERS;
}
