const loopback = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveMatchEngines(env = process.env) {
  const engine = value => ['v1','v2','v3'].includes(String(value??'v3').toLowerCase())?String(value??'v3').toLowerCase():'v3';
  const fallback = engine(env.YFFM_MATCH_ENGINE ?? env.YDL_MATCH_ENGINE);
  return Object.freeze({
    default: fallback,
    league: engine(env.YFFM_LEAGUE_MATCH_ENGINE ?? env.YDL_LEAGUE_MATCH_ENGINE ?? fallback),
    cup: engine(env.YFFM_CUP_MATCH_ENGINE ?? env.YDL_CUP_MATCH_ENGINE ?? fallback),
    friendly: engine(env.YFFM_FRIENDLY_MATCH_ENGINE ?? env.YDL_FRIENDLY_MATCH_ENGINE ?? fallback),
  });
}

export function resolveAdminPassword(env = process.env) {
  const password = env.YFFM_ADMIN_PASSWORD ?? env.VERSUS_ADMIN_PASSWORD;
  const local = loopback.has(env.VERSUS_HOST ?? '127.0.0.1');
  const offline = env.YDL_OFFLINE_MODE === '1' && local;
  const production = env.NODE_ENV === 'production' || env.APP_ENV === 'production' || !local;
  if (production && !offline && String(password ?? '').length < 16) {
    throw new Error('YFFM1 production requires YFFM_ADMIN_PASSWORD (or VERSUS_ADMIN_PASSWORD) with at least 16 characters');
  }
  return password || (offline ? 'ydl-offline' : 'local-dev-admin');
}
