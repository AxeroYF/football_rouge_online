// Extracted from the S4 V2.1 adapter; shared shootout rules, without league-service dependencies.
import { activeCaptain } from "../public/captain-rules.js";
import { v2EngineAttributeValue } from "./match-parameters-v2.js";
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function adapterEvent(match, type, minute, teamIndex, text, details = {}) {
  const event = { id:`v2-${match.events.length + 1}`, minute, type, teamIndex, text, importance:details.importance ?? "major", ...details };
  match.events.push(event);
  return event;
}

const shootoutAbility = (player) => Number(player?.attributes?.finishing ?? player?.overall ?? 60) * 0.62
  + Number(player?.attributes?.composure ?? 60) * 0.38;

const shootoutEnginePlayer = (match, teamIndex, player) => match.snapshotTeams?.[teamIndex]?.players?.find((entry) => entry.id === player?.id) ?? {
  ...player,
  attributes:Object.fromEntries(Object.entries(player?.attributes ?? {}).map(([key, value]) => [key, v2EngineAttributeValue(value, match.parameters)])),
};

export function v2PenaltyShootout(match) {
  const scores = [0, 0];
  const active = match.teams.map((team) => team.players.filter((player) => player.active && !player.sentOff && !player.injury));
  const eligibleCount = Math.min(...active.map((players) => players.length));
  if (eligibleCount < 1) throw new Error("点球大战缺少可出场球员");
  const excluded = active.map((players, teamIndex) => players.length === eligibleCount ? [] : [...players]
    .sort((left, right) => Number((left.assignedRole ?? left.role) === "GK") - Number((right.assignedRole ?? right.role) === "GK") || shootoutAbility(shootoutEnginePlayer(match, teamIndex, left)) - shootoutAbility(shootoutEnginePlayer(match, teamIndex, right)))
    .slice(0, players.length - eligibleCount));
  const excludedIds = excluded.map((players) => new Set(players.map((player) => player.id)));
  const captainIds = match.teams.map((team) => activeCaptain(team)?.id ?? null);
  const takers = active.map((players, teamIndex) => players
    .filter((player) => !excludedIds[teamIndex].has(player.id))
    .sort((left, right) => Number(right.id === captainIds[teamIndex]) - Number(left.id === captainIds[teamIndex]) || shootoutAbility(shootoutEnginePlayer(match, teamIndex, right)) - shootoutAbility(shootoutEnginePlayer(match, teamIndex, left)) || left.id.localeCompare(right.id)));
  const keepers = match.teams.map((team) => team.players.find((player) => player.active && !player.sentOff && !player.injury && (player.assignedRole ?? player.role) === "GK") ?? team.players.find((player) => player.active && !player.sentOff && !player.injury));
  const goalTeamIndex = match.rng() < 0.5 ? 0 : 1;
  const firstTeamIndex = match.rng() < 0.5 ? 0 : 1;
  const attempts = [0, 0];
  const kicks = [];
  adapterEvent(match, "penaltyShootoutStart", 120, firstTeamIndex, `点球大战开始。掷硬币决定在${match.teams[goalTeamIndex].name}一侧球门进行，${match.teams[firstTeamIndex].name}选择先罚。`, {
    importance:"stage", goalTeamIndex, firstTeamIndex, eligiblePlayerIds:takers.map((players) => players.map((player) => player.id)), excludedPlayerIds:excluded.map((players) => players.map((player) => player.id)),
  });
  excluded.forEach((players, teamIndex) => {
    if (!players.length) return;
    adapterEvent(match, "penaltyShootoutEqualise", 120, teamIndex, `${match.teams[teamIndex].name}按规则将人数减至${eligibleCount}人，${players.map((player) => player.name).join("、")}不参加点球大战。`, {
      importance:"stage", eligibleCount, excludedPlayerIds:players.map((player) => player.id),
    });
  });
  const kick = (teamIndex, round, phase) => {
    const kickIndex = attempts[teamIndex];
    const taker = takers[teamIndex][kickIndex % takers[teamIndex].length];
    const keeper = keepers[1 - teamIndex];
    const finishing = shootoutAbility(shootoutEnginePlayer(match, teamIndex, taker));
    const engineKeeper = shootoutEnginePlayer(match, 1 - teamIndex, keeper);
    const keeping = Number(engineKeeper?.attributes?.goalkeeping ?? engineKeeper?.overall ?? 55) * 0.58 + Number(engineKeeper?.attributes?.reflexes ?? 55) * 0.42;
    const probability = clamp(0.74 + (finishing - keeping) / 300, 0.58, 0.9);
    const roll = match.rng();
    const scored = roll < probability;
    const saved = !scored && roll < probability + (1 - probability) * 0.72;
    attempts[teamIndex] += 1;
    if (scored) scores[teamIndex] += 1;
    const outcome = scored ? "命中" : saved ? `被${keeper?.name ?? "门将"}扑出` : "射偏";
    const entry = { teamIndex, round, phase, kickNumber:kickIndex + 1, takerId:taker.id, takerName:taker.name, goalkeeperId:keeper?.id ?? null, goalkeeperName:keeper?.name ?? null, scored, saved, probability:Number(probability.toFixed(3)), score:[...scores] };
    kicks.push(entry);
    adapterEvent(match, "penaltyShootoutKick", 120, teamIndex, `${phase === "suddenDeath" ? `突然死亡第${round}轮` : `点球大战第${round}轮`}，${taker.name}主罚${outcome}，比分${scores[0]}:${scores[1]}。`, { actorId:taker.id, opponentId:keeper?.id ?? null, ...entry });
  };
  let decided = false;
  for (let round = 1; round <= 5 && !decided; round += 1) {
    for (const teamIndex of [firstTeamIndex, 1 - firstTeamIndex]) {
      kick(teamIndex, round, "initial");
      if (scores[0] > scores[1] + (5 - attempts[1]) || scores[1] > scores[0] + (5 - attempts[0])) {
        decided = true;
        break;
      }
    }
  }
  let suddenDeathRound = 1;
  while (!decided && scores[0] === scores[1]) {
    if (suddenDeathRound > 100) throw new Error("V2点球大战超过100轮，随机源可能无效");
    kick(firstTeamIndex, suddenDeathRound, "suddenDeath");
    kick(1 - firstTeamIndex, suddenDeathRound, "suddenDeath");
    if (scores[0] !== scores[1]) decided = true;
    suddenDeathRound += 1;
  }
  const winnerIndex = scores[0] > scores[1] ? 0 : 1;
  adapterEvent(match, "penalties", 120, winnerIndex, `点球大战结束，${match.teams[winnerIndex].name}以${scores[0]}:${scores[1]}胜出。`, { importance:"stage", penalties:[...scores], winnerIndex });
  return { scores, winnerIndex, firstTeamIndex, goalTeamIndex, eligiblePlayerIds:takers.map((players) => players.map((player) => player.id)), excludedPlayerIds:excluded.map((players) => players.map((player) => player.id)), kicks };
}

