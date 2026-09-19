import { roleGroup } from '../../game/public/schema.js';
import { offlineAttributeMaximum, offlineDisplayAttributeValue } from '../offline-attribute-settings.js';
import { applyS4BondBonuses, evaluateS4LineupBonds, selectS4AppliedBonds } from '../public/bond-rules.js';
import { YDL_TRAIT_BY_ID } from '../trait-pool.js';

function traitIds(player) {
  return (player.traits ?? []).map((trait) => typeof trait === "string" ? trait : trait?.id).filter(Boolean);
}

function conditionMatches(condition = {}, context, assignedRole) {
  if (condition.weather && !(Array.isArray(condition.weather) ? condition.weather : [condition.weather]).includes(context.weather)) return false;
  if (condition.teamStyle && !(Array.isArray(condition.teamStyle) ? condition.teamStyle : [condition.teamStyle]).includes(context.style)) return false;
  if (condition.teamTactic && !(Array.isArray(condition.teamTactic) ? condition.teamTactic : [condition.teamTactic]).includes(context.tactic)) return false;
  if (condition.minuteGte != null && context.minute < condition.minuteGte) return false;
  if (condition.minuteLte != null && context.minute > condition.minuteLte) return false;
  if (condition.scoreState && !(Array.isArray(condition.scoreState) ? condition.scoreState : [condition.scoreState]).includes(context.scoreState)) return false;
  if (condition.activeRole && condition.activeRole !== assignedRole && condition.activeRole !== context.roleGroup) return false;
  if (condition.activeRoleNot && (condition.activeRoleNot === assignedRole || condition.activeRoleNot === context.roleGroup)) return false;
  if (condition.precipitationGte != null && context.precipitation < condition.precipitationGte) return false;
  if (condition.roleIsWide && !["LB", "LWB", "LM", "LW", "RB", "RWB", "RM", "RW"].includes(assignedRole)) return false;
  return true;
}

function applyTraitAttributes(player, assignedRole, context) {
  const attributes = { ...(player.attributes ?? {}) };
  let fixedFitness = null;
  let heightCm = Number.isFinite(Number(player.heightCm)) ? Number(player.heightCm) : 180;
  const eventHooks = [];
  for (const id of traitIds(player)) {
    const trait = YDL_TRAIT_BY_ID[id];
    for (const rule of trait?.rules ?? []) {
      if (!conditionMatches(rule.when, context, assignedRole)) continue;
      if (rule.hook === "attribute") for (const [key, value] of Object.entries(rule.add ?? {})) attributes[key] = Number(attributes[key] ?? 50) + Number(value);
      if (rule.hook === "allAttributes") for (const key of Object.keys(attributes)) attributes[key] *= Number(rule.multiply ?? 1);
      if (rule.hook === "fixedFitness") fixedFitness = Number(rule.value);
      if (rule.hook === "height") heightCm += Number(rule.addCm ?? 0);
      if (!["attribute", "allAttributes", "fixedFitness", "height"].includes(rule.hook)) eventHooks.push({ traitId:id, ...structuredClone(rule) });
    }
  }
  return {
    ...player,
    heightCm,
    attributes:Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, Number(offlineDisplayAttributeValue(value).toFixed(2))])),
    state:{ ...player.state, fitness:fixedFitness ?? player.state?.fitness ?? player.fitness ?? 100 },
    v2AppliedTraitIds:traitIds(player),
    v2TraitHooks:eventHooks,
    traitDefinitions:traitIds(player).map((id) => YDL_TRAIT_BY_ID[id]).filter(Boolean),
  };
}

function applyNearbyChemistry(players, positions) {
  const output = players.map((player) => ({ ...player, attributes:{ ...(player.attributes ?? {}) }, v2ChemistryLinkIds:[] }));
  const carriers = output.filter((player) => (player.v2TraitHooks ?? []).some((rule) => rule.hook === "chemistry" && rule.linkNearby));
  for (const carrier of carriers) {
    const carrierPosition = positions[carrier.id] ?? { x:50, y:50 };
    const value = Number(carrier.v2TraitHooks.find((rule) => rule.hook === "chemistry" && rule.linkNearby)?.value ?? 100);
    const bonus = Math.min(0.06, Math.max(0, value) / 100 * 0.06);
    for (const player of output) {
      const position = positions[player.id] ?? { x:50, y:50 };
      if (Math.hypot(Number(position.x ?? 50) - Number(carrierPosition.x ?? 50), Number(position.y ?? 50) - Number(carrierPosition.y ?? 50)) > 28) continue;
      player.attributes = Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [key, Number(offlineDisplayAttributeValue(Number(value) * (1 + bonus)).toFixed(2))]));
      player.v2ChemistryLinkIds = [...new Set([...(player.v2ChemistryLinkIds ?? []), carrier.id])];
    }
  }
  return output;
}


// Shared by the live engine and tactics board; never write derived bonuses into roster data.
export function buildV2TeamPlayerEffects(team,{roles={},minute=0,weather='sunny',precipitation=0,scoreState='level'}={}){
 const context={minute,weather,precipitation,scoreState,style:team.style,tactic:team.tactic};
 const traitPlayers=(team.players??[]).filter(p=>p.active!==false).map(player=>{
  const assignedRole=roles[player.id]??player.assignedRole??player.role;
  return {...applyTraitAttributes(player,assignedRole,{...context,roleGroup:roleGroup(assignedRole)}),assignedRole};
 });
 const chemistryPlayers=applyNearbyChemistry(traitPlayers,team.positions??{});
 const eligibleBonds=evaluateS4LineupBonds(chemistryPlayers,team.bondCatalog,{roles,heightsAdjusted:true});
 return {players:applyS4BondBonuses(chemistryPlayers,eligibleBonds,{maximumAttribute:offlineAttributeMaximum()}),bonds:selectS4AppliedBonds(eligibleBonds),eligibleBonds};
}
