// Work is measured in milliseconds at one unit of production capacity.
// Advancing across completion/start events keeps idle time out of storage and
// redistributes the same club capacity as soon as a project finishes.
const EPSILON = 1e-6;
export function advanceConstruction(projects, capacity, from, to) {
  if (!Number.isFinite(capacity) || capacity < 0 || !Number.isFinite(from) || !(to >= from)) throw new Error('建设产能或结算时间无效');
  const result = projects.map(project => {
    const { required, completed, updatedAt } = project;
    if (!Number.isFinite(required) || required <= 0 || !Number.isFinite(completed) || completed < 0 || completed > required || !Number.isFinite(updatedAt)) throw new Error('建设进度无效');
    return { ...project, completedAt: null, schedule: [] };
  });
  let time = from;
  while (time < to && capacity > 0) {
    const pending = result.filter(p => p.completed < p.required - EPSILON);
    if (!pending.length) break;
    const active = pending.filter(p => p.updatedAt <= time);
    const nextStart = Math.min(...pending.filter(p => p.updatedAt > time).map(p => p.updatedAt));
    if (!active.length) { time = Math.min(to, nextStart); continue; }
    const allocation = capacity / active.length;
    const smallestRemaining = Math.min(...active.map(p => p.required - p.completed));
    const nextFinish = time + smallestRemaining / allocation;
    const end = Math.min(to, nextStart, nextFinish);
    for (const p of active) {
      const remainingBefore = p.required - p.completed;
      p.schedule.push({ from: time, to: end, allocation });
      p.completed = Math.min(p.required, p.completed + (end - time) * allocation);
      if ((end === nextFinish && remainingBefore <= smallestRemaining + EPSILON) || p.required - p.completed <= EPSILON) { p.completed = p.required; p.completedAt = Math.ceil(end); }
    }
    if (end <= time && end !== nextFinish) break;
    time = end;
  }
  return result;
}
export function productionConstructionProgress(building, now) {
  const work = building.productionWork;
  if (!work || !Number.isFinite(work.required) || work.required <= 0) return null;
  let completed = work.completed;
  for (const phase of work.schedule ?? []) {
    completed += Math.max(0, Math.min(now, phase.to) - phase.from) * phase.allocation;
  }
  return {
    percent: Math.max(0, Math.min(100, completed / work.required * 100)),
    remaining: building.completesAt == null ? null : Math.max(0, building.completesAt - now),
  };
}
