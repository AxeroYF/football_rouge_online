import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildS4BalanceSeat } from "../versus/s4-balance-report.js";
import { simulateV2Match } from "../versus/v2/match-engine-v2.js";

const DEMO_MINUTES = 30;
const CHAIN_COUNT = 60;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "versus", "public", "v2-circle-demo-data.json");

const teamSpecs = [
  {
    label:"白队",
    color:"#f4f7f5",
    outline:"#12221d",
    archetype:"standard",
    side:"home",
    formation:"4-3-3",
    options:{ tactic:"positive", style:"possession", staticPlans:true },
  },
  {
    label:"红队",
    color:"#f04e59",
    outline:"#4b0810",
    archetype:"pressing",
    side:"away",
    formation:"4-2-3-1",
    options:{ tactic:"defensive", style:"longBall", staticPlans:true },
  },
];

const sourceTeams = teamSpecs.map((spec) => buildS4BalanceSeat(
  "circle-demo",
  spec.side,
  spec.archetype,
  { formation:spec.formation, ...spec.options },
));

const match = simulateV2Match(sourceTeams, {
  seed:"ydl-v2-circle-demo-30-v1",
  possessionChains:CHAIN_COUNT,
  weather:"sunny",
  referee:"standard",
});

const clamp = (value, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, Number(value)));
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const displayMinute = (engineMinute) => round(clamp(Number(engineMinute) / 90 * DEMO_MINUTES, 0, DEMO_MINUTES), 2);
const laneX = { farLeft:10, leftHalfSpace:30, center:50, rightHalfSpace:70, farRight:90 };
const bandY = { defensiveThird:84, buildUp:64, finalThird:31, box:9 };

function localZonePoint(zone, teamIndex) {
  const [band = "buildUp", lane = "center"] = String(zone ?? "buildUp:center").split(":");
  let x = laneX[lane] ?? 50;
  let y = bandY[band] ?? 52;
  if (teamIndex === 1) {
    x = 100 - x;
    y = 100 - y;
  }
  return { x:clamp(x, 4, 96), y:clamp(y, 3, 97) };
}

function displayPosition(position, teamIndex) {
  const x = Number(position?.x ?? 50);
  const y = Number(position?.y ?? 50);
  return teamIndex === 1
    ? { x:round(100 - x), y:round(100 - y) }
    : { x:round(x), y:round(y) };
}

const teams = sourceTeams.map((team, teamIndex) => ({
  name:teamSpecs[teamIndex].label,
  formation:team.simulationFormation,
  tactic:team.tactic,
  style:team.style,
  color:teamSpecs[teamIndex].color,
  outline:teamSpecs[teamIndex].outline,
  players:team.players.slice(0, 11).map((player, index) => ({
    id:player.id,
    name:player.name,
    shortName:String(player.name ?? "球员").replaceAll("·", "").slice(-2),
    role:player.role,
    number:index + 1,
    base:displayPosition(team.positions[player.id], teamIndex),
  })),
  stats:{ ...match.teams[teamIndex].stats },
}));

const keyframes = [{
  minute:0,
  chainIndex:-1,
  teamIndex:0,
  stage:"kickoff",
  actorId:null,
  defenderId:null,
  ball:{ x:50, y:50 },
  success:true,
  outcome:"kickoff",
}];

for (const [chainIndex, chain] of match.chains.entries()) {
  const stages = (chain.stages ?? []).filter((stage) => stage.actor?.id || stage.zone);
  const startMinute = chainIndex / CHAIN_COUNT * DEMO_MINUTES;
  const endMinute = (chainIndex + 1) / CHAIN_COUNT * DEMO_MINUTES;
  const usableStages = stages.length ? stages : [{ stage:"possession", zone:chain.startZone }];
  usableStages.forEach((stage, stageIndex) => {
    const progress = (stageIndex + 0.25) / Math.max(1, usableStages.length);
    keyframes.push({
      minute:round(startMinute + (endMinute - startMinute) * progress),
      chainIndex,
      teamIndex:chain.attackingTeamIndex,
      stage:stage.stage,
      actorId:stage.actor?.id ?? null,
      defenderId:stage.defender?.id ?? stage.turnover?.playerId ?? null,
      ball:localZonePoint(stage.zone ?? chain.endZone ?? chain.startZone, chain.attackingTeamIndex),
      success:Boolean(stage.success ?? true),
      outcome:stage.outcome ?? chain.terminalOutcome ?? "retained",
      possessionType:chain.possessionType,
      xg:round(stage.shot?.xg ?? chain.xg ?? 0, 3),
    });
  });
}

keyframes.push({
  minute:DEMO_MINUTES,
  chainIndex:CHAIN_COUNT,
  teamIndex:keyframes.at(-1).teamIndex,
  stage:"fulltime",
  actorId:null,
  defenderId:null,
  ball:keyframes.at(-1).ball,
  success:true,
  outcome:"fulltime",
});

const events = match.events.map((event, index) => ({
  id:event.id ?? `event-${index + 1}`,
  minute:event.type === "fulltime" ? DEMO_MINUTES : displayMinute(event.minute),
  type:event.type,
  teamIndex:Number.isInteger(event.teamIndex) ? event.teamIndex : null,
  text:event.type === "fulltime" ? `30 分钟比赛结束，比分 ${match.score[0]}:${match.score[1]}。` : event.text,
  importance:event.importance ?? "normal",
  actorId:event.actorId ?? null,
  opponentId:event.opponentId ?? null,
  score:Array.isArray(event.score) ? event.score : null,
})).sort((left, right) => left.minute - right.minute);

const payload = {
  generatedAt:new Date().toISOString(),
  engineVersion:match.engineVersion,
  modelVersion:match.modelVersion,
  seed:match.simulationSeed,
  durationMinutes:DEMO_MINUTES,
  chainCount:match.chains.length,
  weather:match.environment.weather,
  score:match.score,
  teams,
  keyframes,
  events,
};

if (teams.length !== 2 || teams.some((team) => team.players.length !== 11)) throw new Error("圆圈比赛必须包含两队各 11 名首发球员");
if (!keyframes.length || keyframes.at(-1).minute !== DEMO_MINUTES) throw new Error("回放时间轴没有覆盖 30 分钟");
for (const frame of keyframes) {
  if (![frame.ball.x, frame.ball.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) throw new Error("回放坐标超出球场范围");
}

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`V2 circle demo generated: ${outputPath}`);
console.log(`${match.chains.length} chains, ${events.length} events, score ${match.score.join(":")}`);
