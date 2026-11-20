// Presentation-only observer. Never samples randomness or writes simulation state.
import {isGoalEvent} from '../public/goal-event.js';
const UNSUPPORTED = new Set(['penalty', 'setPiece', 'freeKick', 'rebound']);
const point = p => ({x:Number(p.x), y:Number(p.y)});

export function capturePlayPlayers(shape) {
  return shape.teams.flatMap((team, teamIndex) => team.players.map(player => ({
    id:player.id, teamIndex, name:player.name ?? '', ...point(player.targetPosition),
  })));
}

export function recordKeyPlays(match, frames, events) {
  if (!match.keyPlaysEnabled || !frames?.length) return;
  const last = frames.at(-1);
  if (!['shoot', 'longShot'].includes(last.type) || !last.success) return;
  for (const event of events) {
    if (!isGoalEvent(event) || UNSUPPORTED.has(event.attackType)) continue;
    const side = event.attackingTeamIndex ?? event.teamIndex;
    const shooterId = event.actorId;
    // Crosses can select a different shooter during resolution. Until that touch
    // is recorded, show the event/card celebration rather than invent a pass.
    if (side !== last.teamIndex || shooterId !== last.toPlayerId) continue;
    const actions = frames.slice(-5);
    if (!actions.every(a => a.fromPlayerId && a.toPlayerId && a.before.length && a.after.length)) continue;
    const clip = {
      version:1, id:`play-${event.id}`, eventId:event.id, minute:event.minute,
      period:last.period, teamIndex:side, type:event.type, actorId:shooterId,
      zone:event.zone ?? null, attackType:event.attackType ?? null,
      assistId:event.assistId ?? null, defenderId:event.opponentId ?? null,
      xg:event.xg, score:[...match.teams.map(t=>t.score)], actions,
    };
    (match.keyPlays ??= []).push(clip);
  }
  // Bounded persisted archive also survives checkpoint/reconnect.
  if (match.keyPlays?.length > 32) match.keyPlays.splice(0, match.keyPlays.length - 32);
}
