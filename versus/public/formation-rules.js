// Coordinates use the home-team view: attack at the top, own goal at the bottom.
export const FORMATION_LINE_KEYS = Object.freeze(["attack", "midfield", "defense", "goalkeeper"]);
export const DEFAULT_FORMATION_LINES = Object.freeze({ attack:20, midfield:44, defense:68, goalkeeper:90 });
export const FORMATION_LINE_MINIMUM_GAP = 8;
export const GOALKEEPER_LINE_MINIMUM_Y = 82;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function sanitizeFormationLines(value = DEFAULT_FORMATION_LINES) {
  const result = {};
  FORMATION_LINE_KEYS.forEach((key, index) => {
    const fallback = DEFAULT_FORMATION_LINES[key];
    const orderedMinimum = index === 0 ? 6 : result[FORMATION_LINE_KEYS[index - 1]] + FORMATION_LINE_MINIMUM_GAP;
    const minimum = key === "goalkeeper" ? Math.max(GOALKEEPER_LINE_MINIMUM_Y, orderedMinimum) : orderedMinimum;
    const remaining = FORMATION_LINE_KEYS.length - index - 1;
    const maximum = 94 - remaining * FORMATION_LINE_MINIMUM_GAP;
    result[key] = Math.round(clamp(Number.isFinite(Number(value?.[key])) ? Number(value[key]) : fallback, minimum, maximum));
  });
  return result;
}

export function moveFormationLine(lines, key, nextY) {
  const current = sanitizeFormationLines(lines);
  const index = FORMATION_LINE_KEYS.indexOf(key);
  if (index < 0) return current;
  const orderedMinimum = index === 0 ? 6 : current[FORMATION_LINE_KEYS[index - 1]] + FORMATION_LINE_MINIMUM_GAP;
  const minimum = key === "goalkeeper" ? Math.max(GOALKEEPER_LINE_MINIMUM_Y, orderedMinimum) : orderedMinimum;
  const maximum = index === FORMATION_LINE_KEYS.length - 1 ? 94 : current[FORMATION_LINE_KEYS[index + 1]] - FORMATION_LINE_MINIMUM_GAP;
  const requestedY = Number(nextY);
  current[key] = Math.round(clamp(Number.isFinite(requestedY) ? requestedY : current[key], minimum, maximum));
  return current;
}

function legacyInferElevenBoardRoles(entries) {
  const normalized = entries
    .filter((entry) => entry?.id && Number.isFinite(Number(entry?.position?.x)) && Number.isFinite(Number(entry?.position?.y)))
    .map((entry) => ({ id:entry.id, x:Number(entry.position.x), y:Number(entry.position.y) }));
  const roles = {};
  const midfielders = normalized.filter((entry) => entry.y >= 27 && entry.y < 59);
  const wideMidfielders = midfielders.filter((entry) => entry.x < 38 || entry.x > 62);
  const midfieldReferenceY = wideMidfielders.length
    ? wideMidfielders.reduce((sum, entry) => sum + entry.y, 0) / wideMidfielders.length
    : 46;
  for (const entry of normalized) {
    if (entry.y >= 82) roles[entry.id] = "GK";
    else if (entry.y >= 66) roles[entry.id] = entry.x < 30 ? "LB" : entry.x > 70 ? "RB" : "CB";
    else if (entry.y >= 52 && entry.x < 30) roles[entry.id] = "LWB";
    else if (entry.y >= 52 && entry.x > 70) roles[entry.id] = "RWB";
    else if (entry.y >= 59) roles[entry.id] = "CB";
    else if (entry.y < 27) roles[entry.id] = entry.x < 38 ? "LW" : entry.x > 62 ? "RW" : "ST";
    else if (entry.x < 38) roles[entry.id] = "LM";
    else if (entry.x > 62) roles[entry.id] = "RM";
    else roles[entry.id] = entry.y < midfieldReferenceY ? "AM" : "DM";
  }
  return roles;
}

export function deriveFormationLines(entries = []) {
  const normalized = entries
    .filter((entry) => entry?.id && Number.isFinite(Number(entry?.position?.x)) && Number.isFinite(Number(entry?.position?.y)))
    .map((entry) => ({ id:entry.id, position:{ x:Number(entry.position.x), y:Number(entry.position.y) } }));
  const roles = legacyInferElevenBoardRoles(normalized);
  const groups = { attack:[], midfield:[], defense:[], goalkeeper:[] };
  const groupForRole = (role) => role === "GK" ? "goalkeeper"
    : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "defense"
      : ["ST", "LW", "RW"].includes(role) ? "attack" : "midfield";
  normalized.forEach((entry) => groups[groupForRole(roles[entry.id])].push(entry.position.y));
  return sanitizeFormationLines(Object.fromEntries(FORMATION_LINE_KEYS.map((key) => [key, groups[key].length
    ? groups[key].reduce((sum, y) => sum + y, 0) / groups[key].length
    : DEFAULT_FORMATION_LINES[key]])));
}

export function inferElevenBoardRoles(entries = [], formationLines = null) {
  const normalized = entries
    .filter((entry) => entry?.id && Number.isFinite(Number(entry?.position?.x)) && Number.isFinite(Number(entry?.position?.y)))
    .map((entry) => ({ id:entry.id, x:Number(entry.position.x), y:Number(entry.position.y) }));
  if (!formationLines) return legacyInferElevenBoardRoles(entries);
  const lines = sanitizeFormationLines(formationLines);
  const roles = {};
  for (const entry of normalized) {
    const line = FORMATION_LINE_KEYS.reduce((closest, key) => Math.abs(entry.y - lines[key]) < Math.abs(entry.y - lines[closest]) ? key : closest, "attack");
    if (line === "goalkeeper") roles[entry.id] = "GK";
    else if (line === "attack") roles[entry.id] = entry.x < 38 ? "LW" : entry.x > 62 ? "RW" : "ST";
    else if (line === "defense") {
      if (entry.x < 30) roles[entry.id] = entry.y < lines.defense ? "LWB" : "LB";
      else if (entry.x > 70) roles[entry.id] = entry.y < lines.defense ? "RWB" : "RB";
      else roles[entry.id] = "CB";
    } else if (entry.x < 38) roles[entry.id] = "LM";
    else if (entry.x > 62) roles[entry.id] = "RM";
    else roles[entry.id] = entry.y < lines.midfield ? "AM" : "DM";
  }
  return roles;
}

export function analyzeElevenBoardFormation(players = [], positions = {}, formationLines = null) {
  const roles = inferElevenBoardRoles(players.map((player) => ({ id:player.id, position:positions[player.id] })), formationLines);
  const counts = { GK:0, DEF:0, MID:0, ATT:0 };
  const group = (role) => role === "GK"
    ? "GK"
    : ["CB", "LB", "RB", "LWB", "RWB"].includes(role)
      ? "DEF"
      : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";
  Object.values(roles).forEach((role) => { counts[group(role)] += 1; });
  return { roles, counts, name:`${counts.DEF}-${counts.MID}-${counts.ATT}` };
}
