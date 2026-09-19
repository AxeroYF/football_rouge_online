import { hydratePlayerTraits, traitAdjustedAttribute, traitPositionFit } from "../../engine/s4-v2.1/game/public/trait-runtime.js";
import { positionFitScore } from "../../engine/s4-v2.1/game/public/schema.js";
import { YDL_TRAIT_BY_ID, YDL_TRAIT_CARDS } from "../../engine/s4-v2.1/versus/trait-pool.js";

const TRAIT_CATALOG = new Map(YDL_TRAIT_CARDS.map((trait) => [trait.id,trait]));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function playerTraitDefinitions(player) {
  const source = Array.isArray(player?.traits) ? player.traits : Array.isArray(player?.card?.traits) ? player.card.traits : [];
  return source.map((entry) => {
    if (typeof entry === "string") return YDL_TRAIT_BY_ID[entry] ?? { id:entry, name:entry, summary:"" };
    return YDL_TRAIT_BY_ID[entry?.id] ?? entry;
  }).filter((entry) => entry?.name);
}

export function presentPlayerTraits(player, {
  assignedRole = player?.role,
  minute = 0,
  scoreState = "level",
  weather = "sunny",
  precipitation = 0,
  teamStyle = "possession",
  teamTactic = "balanced",
} = {}) {
  const sourceAttributes = player?.effectiveAttributes ?? player?.displayAttributes ?? player?.attributes ?? {};
  const source = { ...player, attributes:{ ...sourceAttributes }, assignedRole };
  const hydrated = hydratePlayerTraits(source,TRAIT_CATALOG,`frontend:${player?.id ?? player?.playerId ?? "player"}`);
  const context = { minute,scoreState,weather:{ type:weather,precipitation },precipitation,pitchQuality:100,teamStyle,teamTactic };
  const effectiveAttributes = Object.fromEntries(Object.entries(sourceAttributes).map(([key,value]) => [key,Number(traitAdjustedAttribute(hydrated,key,value,context).toFixed(2))]));
  const fitness = clamp(Number(hydrated.state?.fitness ?? player?.effectiveFitness ?? player?.state?.fitness ?? 100),0,100);
  return {
    ...player,
    effectiveAttributes,
    displayAttributes:effectiveAttributes,
    effectiveHeightCm:Number(hydrated.heightCm ?? player?.heightCm ?? 0),
    effectiveFitness:fitness,
    state:{ ...(player?.state ?? {}),fitness },
    positionFit:traitPositionFit(hydrated,positionFitScore(player,assignedRole),assignedRole),
    traitDefinitions:playerTraitDefinitions(player),
  };
}
