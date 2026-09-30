import { DAILY_LEAGUE, leagueSchedule } from './daily-league.mjs';

export const LEAGUE_DYNAMIC_ENGINE = 'v2.2';
export const LEAGUE_LIVE_MS = 360_000;
// Each human occupies three first-leg slots. The return fixtures mirror them.
const PAIRS = [[3,5],[4,3],[1,4],[2,1],[5,4],[2,5],[0,3],[2,0],[0,1]];

export function featuredLeagueSchedule(teams, day, rules = DAILY_LEAGUE) {
  const humans = teams.filter(t => t.kind === 'player').map(t => t.id).sort();
  const bots = teams.filter(t => t.kind === 'elite').map(t => t.id).sort();
  if (rules.dynamicFeatured === false || humans.length !== 6 || bots.length !== 4) return leagueSchedule(teams.map(t => t.id), day, rules);
  // A dated permutation changes featured opponents without depending on reads,
  // process order or random state. The persisted fixtures remain authoritative.
  let seed = [...day].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  for (let i = humans.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [humans[i], humans[j]] = [humans[j], humans[i]];
  }
  const slots = [...humans.slice(0, 5), bots[0], humans[5], ...bots.slice(1)];
  return leagueSchedule(slots, day, rules).map(f => {
    const pair = PAIRS[(f.round - 1) % 9].map(i => humans[i]);
    const dynamic = pair.includes(f.homeId) && pair.includes(f.awayId);
    return { ...f, engine: dynamic ? LEAGUE_DYNAMIC_ENGINE : 'v2.1', featured: dynamic, liveDurationMs: LEAGUE_LIVE_MS };
  });
}
