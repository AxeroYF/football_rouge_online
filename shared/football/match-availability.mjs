// Persisted absence counters use completed match legs, not wall-clock time.
export function absenceMatches(player, kind) {
  const state = player?.state ?? {};
  const value = state[kind]?.matchesRemaining ?? state[`${kind}Matches`]
    ?? (kind === 'injury' ? state.injuryRounds : typeof state.suspension === 'number' ? state.suspension : null)
    ?? player?.status?.[`${kind}Matches`] ?? 0;
  return Math.max(0, Math.floor(Number(value) || 0));
}
export const healthUnavailable = player => Boolean(player?.medical) || absenceMatches(player,'injury') > 0 || absenceMatches(player,'suspension') > 0;
export function availabilitySnapshot(players) {
  return players.map(p => ({playerId:p.id,injury:absenceMatches(p,'injury'),suspension:absenceMatches(p,'suspension'),
    injurySource:p.state?.injury?.sourceLegId ?? null,suspensionSource:p.state?.suspension?.sourceLegId ?? null}));
}
export function setAbsence(player,kind,matches,details={}) {
  player.state ??= {};
  player.state[kind] = {...(typeof player.state[kind]==='object'?player.state[kind]:{}),...details,matchesRemaining:Math.max(0,matches)};
  if(Object.hasOwn(player.state,`${kind}Matches`))player.state[`${kind}Matches`]=Math.max(0,matches);
  if(kind==='injury'&&Object.hasOwn(player.state,'injuryRounds'))player.state.injuryRounds=Math.max(0,matches);
  if(player.status&&Object.hasOwn(player.status,`${kind}Matches`))player.status[`${kind}Matches`]=Math.max(0,matches);
}
