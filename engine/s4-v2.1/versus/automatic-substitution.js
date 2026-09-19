import { roleGroup, positionFamilyRoles } from "../game/public/schema.js";

function hasUtilityPlayerTrait(candidate) {
  if (candidate?.utilityPlayer === true) return true;
  const traits = [...(candidate?.traits ?? []), ...(candidate?.traitIds ?? [])];
  return traits.some((trait) => {
    const id = typeof trait === "string" ? trait : trait?.id;
    const name = typeof trait === "object" ? trait?.name : null;
    return id === "utility-player" || name === "全能战士";
  });
}

export function automaticSubstitutionRank(targetRole, candidate) {
  if (!targetRole || !candidate) return 0;
  if (positionFamilyRoles(candidate.role).includes(targetRole)) return 3;
  if (positionFamilyRoles(candidate.secondaryRole).includes(targetRole)) return 2;
  const targetGroup = roleGroup(targetRole);
  if (roleGroup(candidate.role) === targetGroup) return 1;
  if (candidate.secondaryRole && roleGroup(candidate.secondaryRole) === targetGroup) return 1;
  if (targetGroup !== "GK" && roleGroup(candidate.role) !== "GK" && hasUtilityPlayerTrait(candidate)) return 0.5;
  return 0;
}

export function compareAutomaticSubstitutes(
  targetRole,
  left,
  right,
  fitnessFor = (player) => player.state?.fitness ?? 100,
  overallFor = (player) => player.overall ?? 0,
) {
  return automaticSubstitutionRank(targetRole, right) - automaticSubstitutionRank(targetRole, left)
    || Number(overallFor(right) ?? 0) - Number(overallFor(left) ?? 0)
    || Number(fitnessFor(right) ?? 0) - Number(fitnessFor(left) ?? 0)
    || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

// Forced injury replacements may use another healthy outfielder as a last resort.
// Keep goalkeeper and outfield duties separate; redline rotations remain position-matched.
export function injurySubstitutionCandidate(targetRole,candidate){
 if(!targetRole||!candidate)return false;
 return automaticSubstitutionRank(targetRole,candidate)>0||(targetRole!=='GK'&&candidate?.role!=='GK');
}
