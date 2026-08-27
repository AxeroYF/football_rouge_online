import { roleGroup } from "../game/public/schema.js";

export function automaticSubstitutionRank(targetRole, candidate) {
  if (!targetRole || !candidate) return 0;
  if (candidate.role === targetRole) return 3;
  if (candidate.secondaryRole === targetRole) return 2;
  const targetGroup = roleGroup(targetRole);
  if (roleGroup(candidate.role) === targetGroup) return 1;
  if (candidate.secondaryRole && roleGroup(candidate.secondaryRole) === targetGroup) return 1;
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
