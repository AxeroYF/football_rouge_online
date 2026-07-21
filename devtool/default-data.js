import { TRAIT_CARDS } from "../src/traits.js";
import { makeExampleTeams } from "../src/teams.js";
import { normalizePlayerSchema } from "../game/public/schema.js";
import { DEFAULT_GAME_CONFIG } from "../game/public/config.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePlayer(player, teamId, squadStatus, index) {
  return normalizePlayerSchema({
    ...clone(player),
    id: teamId + ":player:" + (index + 1),
    teamId,
    squadStatus,
    traitCards: player.traitCards ?? [],
    legacyTraits: player.traits ?? [],
  }, { index });
}

function normalizeTeam(team, id, playerOffset) {
  const lineup = team.lineup.map((player, index) =>
    normalizePlayer(player, id, "lineup", playerOffset + index),
  );
  const bench = (team.bench ?? []).map((player, index) =>
    normalizePlayer(player, id, "bench", playerOffset + lineup.length + index),
  );
  return {
    players: [...lineup, ...bench],
    team: {
      id,
      name: team.name,
      lineupIds: lineup.map((player) => player.id),
      benchIds: bench.map((player) => player.id),
      formation: clone(team.formation),
      tactics: clone(team.tactics),
      coach: clone(team.coach),
      chemistry: team.chemistry,
      morale: team.morale,
      form: team.form,
    },
  };
}

export function createDefaultDatabase() {
  const example = makeExampleTeams();
  const home = normalizeTeam(example.home, "river-athletic", 0);
  const away = normalizeTeam(example.away, "iron-city", 100);
  const now = new Date().toISOString();
  return {
    meta: {
      schemaVersion: 11,
      createdAt: now,
      updatedAt: now,
      title: "场边实验室",
    },
    traitCards: TRAIT_CARDS.map((trait) => ({ ...clone(trait), bondIds: [] })),
    traitDrafts: [],
    bonds: [],
    players: [...home.players, ...away.players],
    teams: [home.team, away.team],
    globalConfig: clone(DEFAULT_GAME_CONFIG),
    simulationPresets: [
      {
        id: "default-match",
        name: "默认测试赛",
        homeTeamId: home.team.id,
        awayTeamId: away.team.id,
        seed: "devtool-default",
        matches: 500,
        context: {
          minutes: 90,
          basePossessions: 160,
          homeAdvantage: 3.2,
          pitchQuality: 85,
          weather: {
            type: "sunny",
            precipitation: 10,
            wind: 10,
            temperature: 18,
            lightningChance: 0,
          },
          referee: {
            strictness: 50,
            penaltyBias: 50,
            homeBias: 50,
          },
        },
      },
    ],
  };
}
