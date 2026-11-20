import { isGoalEvent } from './goal-event.js';

const keyTypes = new Set([
  'nineDragonsWear','butterFingers','superWorldie','red','redCard','injury','matchInjury','weatherInjury',
  'substitution','replacementUnavailable','emergencyKeeper','penaltyAwarded','penalty',
  'penaltyGoal','penaltyShootoutKick','shootoutResult','abandoned','lightning','blackWhistle',
  'spiritPossession','traitActivated','captainBoost','bondActive','brawl','woodwork','keeperSpill','tactical',
]);

function chronology(minute) {
  const [base,added] = String(minute ?? '').replace(/[′']/g,'').split('+');
  const [minutes,seconds] = base.split(':').map(Number);
  if (!Number.isFinite(minutes)) return Infinity;
  // A first-half stoppage-time event precedes the next period.
  return minutes + (added ? 1 - 1 / (1 + Number(added)) : (seconds || 0) / 60);
}

export function historyTimelineEvents(detail) {
  const rows = new Map();
  for (const event of [...(detail.events ?? []), ...(detail.importantEvents ?? [])]) {
    if (!event || (!keyTypes.has(event.type) && !isGoalEvent(event))) continue;
    const key = event.id ?? JSON.stringify([event.type,event.minute,event.teamIndex,event.actorId,event.text]);
    rows.set(String(key), {...rows.get(String(key)), ...event});
  }
  return [...rows.values()].sort((a,b) => chronology(a.minute) - chronology(b.minute));
}
