export const PLAYER_CARD_SCHEMA_VERSION = 1;

export const PLAYER_CARD_VARIANTS = Object.freeze(["mini", "compact", "standard", "detail", "art-only"]);

function text(value, fallback = "") {
  const result = String(value ?? fallback).trim();
  return result || fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = numberOrNull(value) ?? fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function publicAssetUrl(value) {
  const source = text(value);
  return source.startsWith("./") ? source.slice(1) : source;
}

function traitNames(player) {
  return (Array.isArray(player?.traits) ? player.traits : [])
    .map((trait) => typeof trait === "string" ? trait : trait?.name)
    .map((trait) => text(trait))
    .filter(Boolean);
}

function cardArt(player) {
  const existing = player?.art ?? player?.card?.art;
  const profile = player?.profile;
  const position = player?.portraitPosition;
  const url = publicAssetUrl(existing?.url ?? profile?.imageUrl ?? player?.portrait);
  if (!url) return null;
  return Object.freeze({
    url,
    x: boundedNumber(existing?.x ?? profile?.x ?? position?.x, 50, -50, 150),
    y: boundedNumber(existing?.y ?? profile?.y ?? position?.y, 52, -50, 150),
    width: boundedNumber(existing?.width ?? profile?.width ?? position?.width, 200, 40, 360),
  });
}

function normalizedAttributes(player) {
  const base = player?.attributes && typeof player.attributes === "object" ? player.attributes : {};
  const effective = player?.effectiveAttributes && typeof player.effectiveAttributes === "object"
    ? player.effectiveAttributes
    : player?.displayAttributes && typeof player.displayAttributes === "object"
      ? player.displayAttributes
      : {};
  return Object.freeze(Object.fromEntries(Object.entries({ ...base, ...effective })
    .map(([key, value]) => [key, integerOrNull(value)])));
}

/**
 * Canonical, read-only player-card contract used by the game, Admin and future features.
 * Callers provide a player record; this is the only place that resolves legacy portrait/profile fields.
 */
export function createPlayerCardViewModel(player) {
  if (!player || typeof player !== "object") throw new TypeError("Player card requires a player record");
  const playerId = text(player.playerId ?? player.id ?? player.card?.playerId);
  if (!playerId) throw new TypeError("Player card requires a stable playerId");
  const overall = integerOrNull(player.effectiveOverall ?? player.card?.overall ?? player.overall);
  const baseOverall = integerOrNull(player.baseOverall ?? player.card?.baseOverall ?? player.overall);
  const state = player.state && typeof player.state === "object"
    ? player.state
    : player.status && typeof player.status === "object" ? player.status : {};
  return Object.freeze({
    schemaVersion: PLAYER_CARD_SCHEMA_VERSION,
    playerId,
    cardDefinitionId: text(player.cardDefinitionId ?? player.card?.cardDefinitionId, playerId),
    cardInstanceId: text(player.cardInstanceId ?? player.card?.cardInstanceId) || null,
    name: text(player.name ?? player.card?.name, "未知球员"),
    overall,
    baseOverall,
    grade: text(player.grade ?? player.card?.grade, "C").toUpperCase(),
    role: text(player.role ?? player.card?.role ?? player.pool, "-").toUpperCase(),
    pool: text(player.pool ?? player.card?.pool),
    club: text(player.club ?? player.card?.club, "无俱乐部"),
    nationality: text(player.nationality ?? player.card?.nationality, "无国家队"),
    art: cardArt(player),
    upgradeLevel: Math.max(0, integerOrNull(player.upgradeLevel ?? player.card?.upgradeLevel) ?? 0),
    traits: Object.freeze(traitNames(player)),
    attributes: normalizedAttributes(player),
    status: Object.freeze({
      fitness: integerOrNull(state.fitness ?? player.card?.status?.fitness),
      form: integerOrNull(state.form ?? player.card?.status?.form),
      injuryMatches: Math.max(0, integerOrNull(state.injury?.matchesRemaining ?? state.injuryMatches ?? player.card?.status?.injuryMatches) ?? 0),
      suspensionMatches: Math.max(0, integerOrNull(state.suspension?.matchesRemaining ?? state.suspensionMatches ?? player.card?.status?.suspensionMatches) ?? 0),
      locked: Boolean(player.locked ?? state.locked ?? player.card?.status?.locked),
    }),
  });
}

export function isPlayerCardViewModel(value) {
  return Boolean(value
    && value.schemaVersion === PLAYER_CARD_SCHEMA_VERSION
    && typeof value.playerId === "string"
    && value.playerId.length > 0);
}
