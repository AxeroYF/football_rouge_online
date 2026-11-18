import { REGULAR_DURATION_MS, HALFTIME_ADJUSTMENT_MS } from "./match-engine.js";
import { advanceYdlLeagueV2Match, createYdlLeagueV2Match } from "./v2/ydl-league-engine-adapter.js";
import { V3_MATCH_PARAMETERS } from "./v3/match-parameters-v3.js";
import {createLiveV4Match,advanceLiveV4Match} from "./v4-adapter/live-match.js";
import {VERSION} from "./v4/world.js";

const useV4 = process.env.YDL_V4_SCHEDULE !== "0";
export const MIRROR_BATCH_WORKER_ENGINE_VERSION = useV4 ? VERSION : "v3.3-tactical-execution-r1";
export const MIRROR_BATCH_DIRECTOR_NODE = "director";
export const MIRROR_BATCH_CLOUD_NODE = "cloud";
export const MIRROR_BATCH_DIRECTOR_CONCURRENCY = 5;
export const MIRROR_BATCH_DIRECTOR_SURCHARGE_PER_MATCH = 0;
export const MIRROR_BATCH_DIRECTOR_OWNER_NAME = "Axero";
export const MIRROR_BATCH_WORKER_ONLINE_MS = 45_000;
export const MIRROR_BATCH_WORKER_LEASE_MS = 10 * 60_000;

function compactMirrorBatchWorkerReport(report) {
  const statisticKeys = ["xg", "shots", "shotsOnTarget", "possession", "possessionControl", "corners", "fouls", "saves", "tackles", "interceptions", "clearances", "pressuresWon"];
  return {
    engineVersion:report.engineVersion,
    modelVersion:report.modelVersion,
    engineProfile:report.engineProfile,
    score:[...report.score],
    teams:report.teams.map((team) => ({
      name:team.name,
      formation:team.formation ?? null,
      tactic:team.tactic ?? null,
      style:team.style ?? null,
      attackFocus:team.attackFocus ?? null,
      defenseFocus:team.defenseFocus ?? null,
      tacticalFit:Number(team.tacticalFit ?? Number(team.styleFit ?? 0) * 100),
      styleFit:Number(team.styleFit ?? 0),
      stats:Object.fromEntries(statisticKeys.map((key) => [key, Number(team.stats?.[key] ?? 0)])),
      players:(team.players ?? []).map((player) => ({
        id:player.id,
        name:player.name,
        rating:Number(player.rating ?? 0),
        stats:{
          goals:Number(player.stats?.goals ?? 0),
          assists:Number(player.stats?.assists ?? 0),
          shots:Number(player.stats?.shots ?? 0),
          shotsOnTarget:Number(player.stats?.shotsOnTarget ?? 0),
          tackles:Number(player.stats?.tackles ?? 0),
          interceptions:Number(player.stats?.interceptions ?? 0),
          saves:Number(player.stats?.saves ?? 0),
        },
      })),
    })),
  };
}
export function runMirrorBatchWorkerMatch(payload, specification) {
  const startedAt = Date.now();
  const create = useV4 ? createLiveV4Match : createYdlLeagueV2Match;
  const match = create(structuredClone([payload.callerSeat, payload.opponentSeat]), {
    parameters:V3_MATCH_PARAMETERS,
    now:startedAt,
    seed:specification.seed,
    weather:specification.weather,
    referee:specification.referee,
    regulationOnly:true,
    competitionMode:"friendly",
    recordEvents:false,
    matchEngine:useV4 ? "v4" : "v3",
  });
  if(useV4)advanceLiveV4Match(match,startedAt+3600000);
  else advanceYdlLeagueV2Match(match, startedAt + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1, { maximumChains:Infinity });
  if (!match.report) throw new Error(`mirror batch match ${specification.number} did not finish`);
  return { number:specification.number, seed:specification.seed, report:compactMirrorBatchWorkerReport(match.report) };
}
