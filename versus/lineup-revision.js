export function assertLineupRevision(team, submission = {}) {
  if (submission.lineupSchemeId && submission.lineupSchemeId !== team.activeLineupSchemeId) {
    throw new Error('阵容方案已切换，请刷新后重试');
  }
  const scheme = team.lineupSchemes?.find(s => s.id === team.activeLineupSchemeId);
  const revision = Math.max(0, Math.floor(Number(scheme?.revision ?? 0)));
  const submitted = submission.lineupSchemeRevision;
  const value = submitted == null || submitted === '' ? NaN : Number(submitted);
  if ((revision > 0 && !Number.isFinite(value)) || (Number.isFinite(value) && value !== revision)) {
    throw new Error('当前阵容方案已被其他设备更新，请刷新后重试');
  }
  return revision;
}
