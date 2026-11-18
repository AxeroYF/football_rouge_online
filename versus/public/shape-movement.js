// Both the saved baseline and the single-preview player use the same V4 clock.
export function movementFrames(preview,evidenceTime=0){
  const frames=preview.frames;
  const at=frames.findLastIndex(f=>f.time<=evidenceTime+1e-6);
  const pivot=Math.max(0,at),focus=frames[pivot];
  const same=f=>!f.restart&&f.owner===focus.owner&&f.transitionId===focus.transitionId;
  let first=pivot,last=pivot;
  while(first>0&&focus.time-frames[first-1].time<=3&&same(frames[first-1]))first--;
  while(last+1<frames.length&&frames[last+1].time-frames[first].time<=4.00001&&same(frames[last+1]))last++;
  return frames.slice(first,last+1);
}

export function captureMovement(clip) {
  const frames = movementFrames(clip);
  const roster = new Map(clip.roster.filter(p => p.side === 0).map(p => [p.key, p]));
  const players = [];
  for (const [index, initial] of frames[0].players.entries()) {
    const meta = roster.get(initial.key);
    if (!meta || !initial.active) continue;
    // V4 keeps a player's frame slot stable within this single simulation.
    const points = frames.map(frame => {
      const {x, y} = frame.players[index];
      return [x, y];
    });
    players.push({id:meta.id, name:meta.name, role:meta.role, points});
  }
  const {scenario, scoreState, minute, engineVersion, opponent} = clip;
  return {scenario, scoreState, minute, engineVersion, opponent, times:frames.map(f => f.time), players};
}

// Board x crosses the 68 m pitch. Board y decreases towards the opposing goal.
const distance = (a, b) => Math.hypot((b[0] - a[0]) * .68, (b[1] - a[1]) * 1.05);
function displacement(a, b) {
  return {distance:distance(a, b), right:(b[0] - a[0]) * .68, forward:(a[1] - b[1]) * 1.05};
}
const runLength = points => points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);

export function compareMovements(before, after) {
  const conditions = ['scenario', 'scoreState', 'minute', 'engineVersion', 'opponent'];
  if (conditions.some(key => before[key] !== after[key])) throw new Error('两次预览的预案或场景条件不同');
  const limit = Math.min(before.times.length, after.times.length);
  let count = 0;
  while (count < limit && before.times[count] === after.times[count]) count++;
  if (!count) throw new Error('两次预览缺少共同采样时点');

  const old = new Map(before.players.map(p => [p.id, p]));
  const current = new Map(after.players.map(p => [p.id, p]));
  const ids = new Set([...current.keys(), ...old.keys()]);
  const players = Array.from(ids, id => {
    const previous = old.get(id)?.points.slice(0, count);
    const next = current.get(id)?.points.slice(0, count);
    const {name, role} = current.get(id) ?? old.get(id);
    const row = {id, name, role, previous, next};
    if (previous && next) {
      row.start = displacement(previous[0], next[0]);
      row.end = displacement(previous.at(-1), next.at(-1));
      row.beforeLength = runLength(previous);
      row.afterLength = runLength(next);
      row.peakGap = Math.max(...previous.map((point, i) => distance(point, next[i])));
    }
    return row;
  });
  return {duration:after.times[count - 1] - after.times[0], players};
}
