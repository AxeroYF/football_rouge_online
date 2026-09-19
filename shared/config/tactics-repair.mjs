import { positionFamiliarity } from '../../engine/s4-v2.1/game/public/schema.js';
import { inferElevenBoardRoles } from "../../formation-rules.js";
import { optimalLineupAssignment } from "../../tactics-lineup-rules.js";
import { representativePlayers, representativeTactics } from "./representative-players.mjs";
import { normalizePlayerSquads } from "./player-squads.mjs";

const idOf = player => String(player.id ?? player.playerId);
const poolFor = role => role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB", "DEF"].includes(role) ? "DEF" : ["ST", "LW", "RW", "ATT"].includes(role) ? "ATT" : "MID";
const playerMap = (key, path) => key === "positions" || key === "playerDuties" || (path.at(-2) === "positionPresets" && /^position[123]$/.test(key));
const unavailable = player => Boolean(player.training || player.coalitionLoan) || [
  player.state?.injury?.matchesRemaining, player.state?.injuryMatches, player.state?.injuryRounds, player.status?.injuryMatches,
  player.state?.suspension?.matchesRemaining, player.state?.suspensionMatches, player.status?.suspensionMatches,
  typeof player.state?.suspension === "number" ? player.state.suspension : player.state?.suspension === true ? 1 : 0,
].some(value => Number(value) > 0);

// Visit only known player references. Plan names and other settings are never remapped.
function visitReferences(value, callback, path = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "vacantSlots") continue;
    if (playerMap(key, [...path, key]) || key === "captainId") callback(value, key, [...path, key]);
    else visitReferences(item, callback, [...path, key]);
  }
}

function takeSlot(tactics, playerId, index, previousRoster) {
  const embedded = tactics.planSnapshots?.__s4V2 ?? {};
  const position = embedded.positionPresets?.position1?.[playerId] ?? tactics.positions?.[playerId];
  const previous = previousRoster.find(player => idOf(player) === playerId);
  const role = inferElevenBoardRoles([{ id:playerId, position }], embedded.formationLinePresets?.position1 ?? tactics.formationLines)[playerId] ?? previous?.role ?? previous?.pool ?? "MID";
  const references = [];
  visitReferences(tactics, (parent, key, path) => {
    if (key === "captainId") {
      if (parent[key] === playerId) { references.push({ path, captain:true }); parent[key] = null; }
    } else if (parent[key] && Object.hasOwn(parent[key], playerId)) {
      references.push({ path, value:structuredClone(parent[key][playerId]) });
      delete parent[key][playerId];
    }
  });
  return { index, role, pool:poolFor(role), references };
}

function fillSlot(tactics, slot, playerId) {
  for (const reference of slot.references ?? []) {
    // Paths come from saved tactics; never allow a path to escape its own object.
    if (!Array.isArray(reference.path) || reference.path.some(key => ["__proto__", "prototype", "constructor"].includes(key))) continue;
    let parent = tactics;
    for (const key of reference.path.slice(0, -1)) parent = parent[key] ??= {};
    const key = reference.path.at(-1);
    if (reference.captain) { if (!parent[key]) parent[key] = playerId; }
    else if (playerMap(key, reference.path)) (parent[key] ??= {})[playerId] = structuredClone(reference.value);
  }
}

// Existing players are pinned to their slots. Only vacancies participate in assignment.
export function repairSquadTactics(saved, eligibleRoster = [], { previousRoster = eligibleRoster } = {}) {
  if (!saved || typeof saved !== "object") return saved;
  const result = structuredClone(saved);
  const embedded = result.planSnapshots?.__s4V2;
  const sourceIds = embedded?.starters ?? result.starters;
  if (!Array.isArray(sourceIds)) return result;
  const eligible = new Map(eligibleRoster.map(player => [idOf(player), player]));
  const slots = [...new Set(sourceIds.map(String))].slice(0, 11).map(playerId => ({ playerId }));
  const pending = result.vacantSlots ?? embedded?.vacantSlots ?? [];
  for (const slot of [...pending].sort((a,b) => a.index - b.index)) slots.splice(Math.max(0, slot.index), 0, { vacancy:slot });
  slots.splice(11);
  slots.forEach((slot, index) => {
    if (slot.playerId && !eligible.has(slot.playerId)) { slot.vacancy = takeSlot(result, slot.playerId, index, previousRoster); delete slot.playerId; }
    if (slot.vacancy) slot.vacancy.index = index;
  });
  const retained = new Set(slots.map(slot => slot.playerId).filter(Boolean));
  const candidates = eligibleRoster.filter(player => !retained.has(idOf(player)) && !unavailable(player))
    .sort((a,b) => Number(b.effectiveOverall ?? b.overall ?? 0) - Number(a.effectiveOverall ?? a.overall ?? 0) || idOf(a).localeCompare(idOf(b)));
  for (const keeper of [true, false]) {
    const vacancies = slots.filter(slot => slot.vacancy && (slot.vacancy.pool === "GK") === keeper);
    const available = candidates.filter(player => (player.pool === "GK") === keeper);
    // Empty candidates let the same assignment preserve unfilled slots when the bench is short.
    const padded = [...available, ...Array.from({ length:Math.max(0, vacancies.length - available.length) }, () => null)];
    for (const { slot, player } of optimalLineupAssignment(vacancies, padded, (candidate, target) => {
      if (!candidate) return 0;
      const { role, pool } = target.vacancy;
      const fit = positionFamiliarity(candidate,role) === "primary" ? 1000000 : positionFamiliarity(candidate,role) === "secondary" ? 500000 : candidate.pool === pool ? 100000 : 0;
      return 1000 + fit + Number(candidate.effectiveOverall ?? candidate.overall ?? 0);
    })) {
      if (!player) continue;
      fillSlot(result, slot.vacancy, idOf(player));
      slot.playerId = idOf(player);
      delete slot.vacancy;
    }
  }
  const starters = slots.map(slot => slot.playerId).filter(Boolean);
  const vacantSlots = slots.flatMap(slot => slot.vacancy ? [slot.vacancy] : []);
  result.starters = starters;
  const bench = eligibleRoster.map(idOf).filter(id => !starters.includes(id));
  if (bench.length || Array.isArray(result.bench)) result.bench = bench;
  if (embedded) { embedded.starters = [...starters]; if ("bench" in embedded) embedded.bench = [...bench]; }
  for (const target of [result, embedded].filter(Boolean)) {
    if (vacantSlots.length) target.vacantSlots = structuredClone(vacantSlots);
    else delete target.vacantSlots;
  }
  visitReferences(result, (parent, key) => {
    if (key === "captainId") { if (!starters.includes(parent[key])) parent[key] = null; }
    else if (parent[key]) for (const id of Object.keys(parent[key])) if (!eligible.has(id)) delete parent[key][id];
  });
  return result;
}

export function repairTacticsLineups(tactics, roster = [], playerSquads, { previousRoster = roster } = {}) {
  if (!tactics) return tactics;
  const result = representativeTactics(tactics, roster);
  const players = representativePlayers(roster);
  const { assignments } = normalizePlayerSquads(playerSquads, roster);
  const repair = (saved, squadId) => repairSquadTactics(saved, players.filter(player => assignments[idOf(player)] === squadId), { previousRoster });
  if (!result.squads) return repair(result, "expedition");
  for (const squadId of ["expedition", "garrison"]) if (result.squads[squadId]) result.squads[squadId] = repair(result.squads[squadId], squadId);
  if (result.squads.expedition && Array.isArray(result.starters)) {
    if (!result.squads.expedition.vacantSlots) delete result.vacantSlots;
    Object.assign(result, result.squads.expedition);
  }
  return result;
}
