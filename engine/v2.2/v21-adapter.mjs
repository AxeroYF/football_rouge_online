import { tacticalDimensionsForPlan, tacticalDetailsForPlan } from '../s4-v2.1/versus/v2/match-engine-v2.js';
import { resolveV2TacticalDimensions } from '../s4-v2.1/versus/v2/spatial-model-v2.js';
import { V2_MATCH_PARAMETERS } from '../s4-v2.1/versus/v2/match-parameters-v2.js';
import { inferElevenBoardRoles } from '../s4-v2.1/versus/public/formation-rules.js';
import { OFFLINE_ATTRIBUTE_SETTINGS } from '../s4-v2.1/versus/offline-attribute-settings.js';

// One-time server/batch boundary. Accept the same seats as createV2Match.
// Attributes in seats already include enhancement: never apply enhancement again.
export function prepareV22Match(seats, { seed = 'v22-demo', duration = 360, extraTimeDuration = 120, knockout = false, allowShortHanded = false } = {}) {
  if (!Array.isArray(seats) || seats.length !== 2) throw new Error('V2.2 requires two V2.1 match seats');
  if (!Number.isFinite(duration) || duration < 30) throw new Error('Invalid match duration');
  if (!Number.isFinite(extraTimeDuration) || extraTimeDuration < 30) throw new Error('Invalid extra-time duration');
  const teams = structuredClone(seats).map((team, index) => {
    team.players = (team.players ?? []).filter(p => p.active !== false);
    if (team.players.length < (allowShortHanded ? 7 : 11) || team.players.length > 11 || new Set(team.players.map(p => p.id)).size !== team.players.length) throw new Error(`Team ${index}: requires ${allowShortHanded ? '7–11' : '11'} unique active players`);
    if (team.players.filter(p => p.pool === 'GK' || p.role === 'GK').length !== 1) throw new Error(`Team ${index}: requires one goalkeeper`);
    const rawPlans = { ...team.tacticalPlans, opening: { tactic: team.tactic, style: team.style, ...team.tacticalPlans?.opening, tacticalDimensions: { ...team.tacticalDimensions, ...team.tacticalPlans?.opening?.tacticalDimensions } } };
    const plans = Object.fromEntries(Object.entries(rawPlans).map(([key, rawPlan]) => {
      const plan = { tactic: team.tactic, style: team.style, ...rawPlan };
      const positions = team.positionPresets?.[plan.positionPreset] ?? team.positions;
      for (const player of team.players) {
        const point = positions?.[player.id];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`Missing V2.1 position: ${player.id}`);
      }
      const lines = team.formationLinePresets?.[plan.positionPreset] ?? team.formationLines;
      return [key, {
        ...plan, positions, formationLines: lines, roles: inferElevenBoardRoles(team.players.map(p => ({ id: p.id, position: positions[p.id] })), lines),
        ...tacticalDetailsForPlan(plan, team),
        tacticalDimensions: resolveV2TacticalDimensions(plan.tactic ?? team.tactic, plan.style ?? team.style, tacticalDimensionsForPlan(plan)),
        formationResearch: team.formationResearchPresets?.[plan.positionPreset ?? 'position1'] ?? {},
      }];
    }));
    return { ...team, plans };
  });
  return { version: '2.2-demo.2', seed, duration, extraTimeDuration, knockout: Boolean(knockout), teams, shapeConfig: structuredClone(V2_MATCH_PARAMETERS.dynamicShape), ability: { ...V2_MATCH_PARAMETERS.ability }, attributeSettings: { ...OFFLINE_ATTRIBUTE_SETTINGS } };
}
