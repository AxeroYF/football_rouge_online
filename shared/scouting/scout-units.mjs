import { canUseTerritory } from '../config/diplomacy.mjs';
import { unitArtIcon } from '../config/facility-art.mjs';
export const SCOUT_TOKEN_URL = unitArtIcon("scout");
export const SCOUT_NAME_MAX_LENGTH = 24;
export function normalizeScoutName(value){
 if(typeof value!=="string")throw new Error("请输入球探名字");
 const name=value.trim();
 if(!name||[...name].length>SCOUT_NAME_MAX_LENGTH)throw new Error("球探名字需要 1～24 个字符");
 if(/[\p{Cc}\p{Cf}]/u.test(name))throw new Error("球探名字不能包含控制字符或换行");
 return name;
}
export const SCOUT_STEP_DURATION_MS = 60_000;

const FIRST_NAMES = ["Oliver", "James", "Henry", "William", "Jack", "Thomas", "George", "Arthur", "Charlie", "Harry", "Oscar", "Leo", "Noah", "Ethan", "Lucas", "Daniel", "Samuel", "Benjamin", "Alexander", "Max", "Edward", "Luke", "Nathan", "Adam"];
const LAST_NAMES = ["Bennett", "Walker", "Hayes", "Reed", "Parker", "Brooks", "Miller", "Clarke", "Morgan", "Foster", "Hughes", "Turner", "Collins", "Cooper", "Bailey", "Ward", "West", "Wright", "Griffin", "Reynolds", "Carter", "Hayward", "Ellis", "Taylor"];

export function scoutEnglishName(existingNames = [], random = Math.random) {
  const used = new Set(existingNames);
  const count = FIRST_NAMES.length * LAST_NAMES.length;
  const start = Math.floor(Math.max(0, Math.min(.999999, Number(random()) || 0)) * count);
  for (let offset = 0; offset < count; offset++) {
    const index = (start + offset) % count;
    const name = FIRST_NAMES[Math.floor(index / LAST_NAMES.length)] + " " + LAST_NAMES[index % LAST_NAMES.length];
    if (!used.has(name)) return name;
  }
  throw new Error("暂无可用球探姓名");
}

export function ownsScoutTerritory(account, world, id) {
  const territory = world?.territories?.[id];
  return Boolean(territory && territory.ownerType === "player" && territory.ownerId === account?.id);
}

export const canDiscoverScoutTerritory=(account,world,id)=>canUseTerritory(world,account?.id,id);
export const canVisitScoutTerritory=(account,world,id)=>canDiscoverScoutTerritory(account,world,id)||world?.territories?.[id]?.ownerType==="neutral";
export function scoutMoveTargets(account, world, sourceId) {
  if (!canVisitScoutTerritory(account, world, sourceId)) return [];
  return Object.keys(world?.territories ?? {}).filter(id => id !== sourceId && canVisitScoutTerritory(account, world, id));
}

// Both map animation and the server use the same path timeline.
export function scoutMovementFrame(movement, now) {
  const path = movement?.path ?? [];
  if (path.length < 2) return null;
  const stepMs = Math.max(1, Number(movement.stepDurationMs) || SCOUT_STEP_DURATION_MS);
  const progress = Math.max(0, Math.min(path.length - 1, (Number(now) - movement.startedAt) / stepMs));
  const index = Math.min(path.length - 2, Math.floor(progress));
  return {
    fromTerritoryId: path[index], toTerritoryId: path[index + 1],
    progress: Math.min(1, progress - index),
    reachedTerritoryId: path[Math.min(path.length - 1, Math.floor(progress))],
  };
}

export function settleScoutUnits(account, world, now) {
  let changed = false;
  for (const scout of Object.values(account.scouting?.units ?? {})) {
    const movement = scout.movement;
    if(movement?.transport==='airport')continue;
    if (movement) {
      const frame = scoutMovementFrame(movement, now);
      // A route that lost an owned tile stops at the last safe position.
      if (!frame || movement.path.some(id => !canVisitScoutTerritory(account, world, id))) {
        scout.movement = null; changed = true;
      } else {
        if (scout.territoryId !== frame.reachedTerritoryId) {
          scout.territoryId = frame.reachedTerritoryId; changed = true;
        }
        if (Number(now) >= movement.arrivesAt) { scout.movement = null; changed = true; }
      }
    }
    if (!canVisitScoutTerritory(account, world, scout.territoryId)) {
      const origin = scout.originTerritoryId;
      const fallback = ownsScoutTerritory(account, world, origin) ? origin
        : ownsScoutTerritory(account, world, account.homeTerritoryId) ? account.homeTerritoryId
        : Object.keys(world?.territories ?? {}).find(id => ownsScoutTerritory(account, world, id)) ?? null;
      if (scout.territoryId !== fallback || scout.movement) {
        scout.territoryId = fallback; scout.movement = null; changed = true;
      }
    }
  }
  return changed;
}
