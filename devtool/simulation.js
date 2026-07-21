import { simulateMany, simulateMatch } from "../src/model.js";
import { computeTeamBonds, sumBondBonuses } from "../game/public/bonds.js";

const PHYSICAL_ATTRIBUTES = new Set([
  "pace",
  "acceleration",
  "strength",
  "stamina",
  "agility",
  "jumping",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isWideRole(role) {
  return ["LB", "RB", "FB", "WB", "LM", "RM", "WM", "LW", "RW", "W"].includes(role);
}

function stableConditionMatches(when, player, team, context) {
  if (!when) return { supported: true, matches: true };
  const stableKeys = new Set([
    "roleIsWide",
    "roleIsCentral",
    "precipitationGte",
    "teamDefensiveLineGte",
    "teamDefensiveLineLte",
  ]);
  if (Object.keys(when).some((key) => !stableKeys.has(key))) {
    return { supported: false, matches: false };
  }
  const line = team.tactics?.defensiveLine ?? 50;
  const precipitation = context.weather?.precipitation ?? 0;
  return {
    supported: true,
    matches:
      (when.roleIsWide === undefined || when.roleIsWide === isWideRole(player.role)) &&
      (when.roleIsCentral === undefined || when.roleIsCentral === !isWideRole(player.role)) &&
      (when.precipitationGte === undefined || precipitation >= when.precipitationGte) &&
      (when.teamDefensiveLineGte === undefined || line >= when.teamDefensiveLineGte) &&
      (when.teamDefensiveLineLte === undefined || line <= when.teamDefensiveLineLte),
  };
}

function applyTraitRules(player, traitCatalog, team, context, audit) {
  const output = clone(player);
  output.attributes = { ...output.attributes };
  for (const traitId of output.traitCards ?? []) {
    const trait = traitCatalog.get(traitId);
    if (!trait) continue;
    for (const rule of trait.rules ?? []) {
      const condition = stableConditionMatches(rule.when, output, team, context);
      if (!condition.supported) {
        audit.pending += 1;
        continue;
      }
      if (!condition.matches) continue;
      if (rule.hook === "attribute" && rule.add) {
        for (const [name, amount] of Object.entries(rule.add)) {
          output.attributes[name] = Math.max(1, Math.min(99, (output.attributes[name] ?? 50) + amount));
        }
        audit.applied += 1;
      } else if (rule.hook === "topAttributes" && rule.add) {
        const candidates = Object.entries(output.attributes)
          .filter(([name]) => rule.exclude !== "physical" || !PHYSICAL_ATTRIBUTES.has(name))
          .sort((left, right) => right[1] - left[1])
          .slice(0, rule.count ?? 3);
        for (const [name] of candidates) {
          output.attributes[name] = Math.max(1, Math.min(99, output.attributes[name] + rule.add));
        }
        audit.applied += 1;
      } else {
        audit.pending += 1;
      }
    }
  }
  return output;
}

export function buildTeamFromDatabase(state, teamId, override = {}, context = {}) {
  const team = state.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new Error("unknown team: " + teamId);
  const players = new Map(state.players.map((player) => [player.id, player]));
  const traits = new Map(state.traitCards.map((trait) => [trait.id, trait]));
  const audit = { applied: 0, pending: 0 };
  const merged = {
    ...clone(team),
    ...clone(override),
    formation: { ...clone(team.formation), ...clone(override.formation ?? {}) },
    tactics: { ...clone(team.tactics), ...clone(override.tactics ?? {}) },
    coach: { ...clone(team.coach), ...clone(override.coach ?? {}) },
  };
  const prepare = (playerId) => {
    const player = players.get(playerId);
    if (!player) throw new Error("team references missing player: " + playerId);
    return applyTraitRules(player, traits, merged, context, audit);
  };
  const preparedLineup = merged.lineupIds.map(prepare);
  const preparedBench = merged.benchIds.map(prepare);
  const bonds = computeTeamBonds(preparedLineup, state.traitCards, state.bonds ?? []);
  const bondBonus = sumBondBonuses(bonds);
  const lineup = preparedLineup.map((player) => {
    if (player.role !== "GK" || !bondBonus.goalkeeping) return player;
    return {
      ...player,
      attributes: {
        ...player.attributes,
        goalkeeping: Math.min(99, player.attributes.goalkeeping + bondBonus.goalkeeping),
        reflexes: Math.min(99, player.attributes.reflexes + Math.ceil(bondBonus.goalkeeping * 0.6)),
      },
    };
  });
  audit.bonds = bonds.filter((bond) => bond.active).map((bond) => ({ id: bond.id, name: bond.name, tier: bond.tier, bonus: bond.bonus, effectText: bond.effectText }));
  return {
    team: {
      id: merged.id,
      name: merged.name,
      formation: merged.formation,
      tactics: { ...merged.tactics, tempo: Math.min(100, (merged.tactics.tempo ?? 50) + bondBonus.tempo) },
      coach: {
        ...merged.coach,
        attack: Math.min(100, (merged.coach.attack ?? 50) + bondBonus.attack),
        defense: Math.min(100, (merged.coach.defense ?? 50) + bondBonus.defense),
      },
      chemistry: Math.min(100, (merged.chemistry ?? 50) + bondBonus.midfield),
      morale: merged.morale,
      form: merged.form,
      lineup,
      bench: preparedBench,
    },
    audit,
  };
}

export function runSimulation(state, request = {}) {
  const preset = request.presetId
    ? state.simulationPresets.find((candidate) => candidate.id === request.presetId)
    : state.simulationPresets[0];
  const context = { ...(preset?.context ?? {}), ...(request.context ?? {}) };
  context.weather = { ...(preset?.context?.weather ?? {}), ...(request.context?.weather ?? {}) };
  context.referee = { ...(preset?.context?.referee ?? {}), ...(request.context?.referee ?? {}) };
  const homeTeamId = request.homeTeamId ?? preset?.homeTeamId;
  const awayTeamId = request.awayTeamId ?? preset?.awayTeamId;
  const home = buildTeamFromDatabase(state, homeTeamId, request.homeOverride, context);
  const away = buildTeamFromDatabase(state, awayTeamId, request.awayOverride, context);
  const matches = Math.max(10, Math.min(10000, Number(request.matches ?? preset?.matches ?? 500)));
  const seed = String(request.seed ?? preset?.seed ?? "devtool");
  const startedAt = performance.now();
  const single = simulateMatch(home.team, away.team, { seed, context, recordEvents: true });
  const batch = simulateMany(home.team, away.team, { matches, seed, context });
  return {
    single,
    batch,
    meta: {
      durationMs: Math.round(performance.now() - startedAt),
      traitRulesApplied: home.audit.applied + away.audit.applied,
      traitRulesPending: home.audit.pending + away.audit.pending,
      activeBonds: { home: home.audit.bonds, away: away.audit.bonds },
    },
  };
}
