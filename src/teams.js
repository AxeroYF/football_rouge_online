import { ATTRIBUTE_NAMES, normalizePlayerSchema, normalizePosition } from "../game/public/schema.js";

const ROLE_BIASES = {
  GK: {
    passing: -8,
    firstTouch: -10,
    dribbling: -25,
    crossing: -30,
    finishing: -38,
    longShots: -35,
    heading: -25,
    jumping: 5,
    tackling: -25,
    marking: -20,
    positioning: 7,
    vision: -10,
    offBall: -30,
    pace: -15,
    acceleration: -16,
    strength: 3,
    stamina: -8,
    agility: 1,
    workRate: -12,
    aggression: -8,
    discipline: 6,
    goalkeeping: 10,
    reflexes: 11,
    setPieces: -28,
  },
  CB: {
    passing: -3,
    firstTouch: -5,
    dribbling: -10,
    crossing: -14,
    finishing: -22,
    longShots: -15,
    heading: 8,
    jumping: 8,
    tackling: 9,
    marking: 10,
    positioning: 8,
    vision: -6,
    offBall: -9,
    pace: -4,
    acceleration: -5,
    strength: 8,
    stamina: 1,
    agility: -5,
    workRate: 4,
    aggression: 5,
    discipline: 3,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: -10,
  },
  FB: {
    passing: 0,
    firstTouch: 0,
    dribbling: 2,
    crossing: 8,
    finishing: -14,
    longShots: -7,
    heading: -4,
    jumping: -3,
    tackling: 6,
    marking: 5,
    positioning: 4,
    vision: -2,
    offBall: 3,
    pace: 7,
    acceleration: 6,
    strength: 0,
    stamina: 8,
    agility: 4,
    workRate: 8,
    aggression: 2,
    discipline: 1,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: -2,
  },
  DM: {
    passing: 4,
    firstTouch: 2,
    dribbling: -2,
    crossing: -4,
    finishing: -12,
    longShots: 0,
    heading: 1,
    jumping: 1,
    tackling: 8,
    marking: 6,
    positioning: 8,
    vision: 4,
    decisions: 7,
    composure: 5,
    offBall: -2,
    pace: -2,
    strength: 4,
    stamina: 7,
    workRate: 8,
    aggression: 4,
    discipline: 3,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: 0,
  },
  CM: {
    passing: 8,
    firstTouch: 6,
    dribbling: 2,
    crossing: 1,
    finishing: -5,
    longShots: 4,
    heading: -3,
    tackling: 2,
    marking: 0,
    positioning: 3,
    vision: 8,
    decisions: 6,
    composure: 4,
    offBall: 3,
    pace: -1,
    strength: -1,
    stamina: 8,
    agility: 2,
    workRate: 7,
    discipline: 3,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: 4,
  },
  AM: {
    passing: 7,
    firstTouch: 8,
    dribbling: 7,
    crossing: 3,
    finishing: 3,
    longShots: 6,
    heading: -6,
    tackling: -10,
    marking: -10,
    positioning: -2,
    vision: 10,
    decisions: 5,
    composure: 5,
    offBall: 7,
    pace: 3,
    acceleration: 4,
    strength: -5,
    stamina: 1,
    agility: 7,
    workRate: 1,
    aggression: -4,
    discipline: 2,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: 7,
  },
  W: {
    passing: 2,
    firstTouch: 6,
    dribbling: 10,
    crossing: 8,
    finishing: 2,
    longShots: 2,
    heading: -7,
    tackling: -10,
    marking: -9,
    positioning: -3,
    vision: 4,
    decisions: 0,
    composure: 1,
    offBall: 8,
    pace: 11,
    acceleration: 12,
    strength: -7,
    stamina: 4,
    agility: 10,
    workRate: 2,
    aggression: -3,
    discipline: 1,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: 3,
  },
  ST: {
    passing: -4,
    firstTouch: 4,
    dribbling: 3,
    crossing: -9,
    finishing: 12,
    longShots: 5,
    heading: 7,
    jumping: 6,
    tackling: -14,
    marking: -14,
    positioning: -4,
    vision: -3,
    decisions: 2,
    composure: 8,
    offBall: 11,
    pace: 5,
    acceleration: 5,
    strength: 4,
    stamina: -1,
    agility: 2,
    workRate: -1,
    aggression: 2,
    discipline: 0,
    goalkeeping: -55,
    reflexes: -35,
    setPieces: 1,
  },
};

function clamp(value, minimum = 1, maximum = 99) {
  return Math.max(minimum, Math.min(maximum, value));
}

function biasKey(role) {
  if (["LB", "RB", "WB"].includes(role)) return "FB";
  if (["LW", "RW", "LM", "RM", "WM"].includes(role)) return "W";
  if (role === "CF") return "ST";
  return role;
}

export function makePlayer(name, role, rating, overrides = {}) {
  const normalizedRole = normalizePosition(role, overrides.preferredFoot ?? "right");
  const biases = ROLE_BIASES[biasKey(normalizedRole)] ?? ROLE_BIASES.CM;
  const attributes = Object.fromEntries(
    ATTRIBUTE_NAMES.map((attribute) => [
      attribute,
      clamp(rating + (biases[attribute] ?? 0)),
    ]),
  );
  Object.assign(attributes, overrides.attributes ?? {});
  const secondaryDefaults = { CB: "DM", LB: "LM", RB: "RM", DM: "CB", LM: "LW", RM: "RW", ST: "LW", LW: "ST", RW: "ST" };
  return normalizePlayerSchema({
    id: overrides.id ?? name,
    name,
    role: normalizedRole,
    secondaryRole: overrides.secondaryRole ?? secondaryDefaults[normalizedRole] ?? null,
    preferredFoot: overrides.preferredFoot ?? "right",
    heightCm: overrides.heightCm ?? 180,
    attributes,
    state: {
      fitness: 96,
      form: 50,
      morale: 55,
      injuryProneness: 30,
      ...overrides.state,
    },
    traits: overrides.traits ?? [],
  });
}

const TACTIC_PRESETS = {
  balanced: {
    tempo: 55,
    directness: 50,
    width: 52,
    pressing: 55,
    defensiveLine: 52,
    risk: 50,
    tackleIntensity: 48,
    counterAttack: 52,
    crossing: 48,
    setPieceFocus: 50,
    timeWasting: 15,
  },
  possession: {
    tempo: 58,
    directness: 28,
    width: 60,
    pressing: 64,
    defensiveLine: 61,
    risk: 55,
    tackleIntensity: 45,
    counterAttack: 38,
    crossing: 42,
    setPieceFocus: 43,
    timeWasting: 10,
  },
  direct: {
    tempo: 68,
    directness: 78,
    width: 65,
    pressing: 48,
    defensiveLine: 43,
    risk: 56,
    tackleIntensity: 58,
    counterAttack: 67,
    crossing: 72,
    setPieceFocus: 64,
    timeWasting: 20,
  },
  counter: {
    tempo: 51,
    directness: 69,
    width: 55,
    pressing: 39,
    defensiveLine: 31,
    risk: 43,
    tackleIntensity: 52,
    counterAttack: 84,
    crossing: 51,
    setPieceFocus: 60,
    timeWasting: 27,
  },
  press: {
    tempo: 72,
    directness: 48,
    width: 58,
    pressing: 84,
    defensiveLine: 73,
    risk: 62,
    tackleIntensity: 66,
    counterAttack: 55,
    crossing: 48,
    setPieceFocus: 44,
    timeWasting: 7,
  },
};

export function createGeneratedTeam(name, rating = 70, style = "balanced") {
  const roles = ["GK", "LB", "RB", "DM", "LM", "RM", "ST"];
  const offsets = [0, 1, -1, 0, 2, 1, 3];
  const lineup = roles.map((role, index) =>
    makePlayer(name + " " + (index + 1), role, rating + offsets[index], {
      heightCm:
        role === "GK" ? 191 : role === "CB" ? 187 : role === "ST" ? 184 : 178,
      preferredFoot: ["LB", "LW"].includes(role) ? "left" : "right",
      state: {
        fitness: 94 + (index % 4),
        form: 47 + (index % 5) * 2,
        morale: 54 + (index % 3) * 3,
        injuryProneness: 20 + (index % 6) * 7,
      },
    }),
  );
  const benchRoles = ["GK", "CB", "DM", "LW"];
  const bench = benchRoles.map((role, index) =>
    makePlayer(name + " 替补" + (index + 1), role, rating - 4 + (index % 3), {
      state: { fitness: 100, form: 50, morale: 52, injuryProneness: 28 },
    }),
  );

  return {
    name,
    lineup,
    bench,
    formation: {
      name: "2-3-1",
      defensiveBalance: style === "counter" ? 66 : style === "press" ? 43 : 52,
      midfieldDensity: style === "possession" ? 62 : 52,
      attackingNumbers: style === "press" ? 65 : style === "counter" ? 43 : 54,
    },
    tactics: { ...TACTIC_PRESETS[style] },
    coach: {
      attack: rating - 17,
      defense: rating - 18,
      adaptability: rating - 15,
      substitutions: 55,
    },
    chemistry: 66,
    morale: 58,
    form: 52,
  };
}

export function makeExampleTeams() {
  const river = createGeneratedTeam("河湾竞技", 72, "possession");
  const iron = createGeneratedTeam("铁城联", 71, "direct");

  river.lineup[4].name = "林岳";
  river.lineup[4].traits = ["playmaker", "bigGamePlayer"];
  river.lineup[6].name = "周野";
  river.lineup[6].attributes.finishing += 4;
  river.lineup[6].attributes.composure -= 3;
  river.lineup[6].traits = ["poacher", "streaky"];

  iron.lineup[2].name = "韩峥";
  iron.lineup[2].attributes.heading += 4;
  iron.lineup[2].attributes.aggression += 5;
  iron.lineup[6].name = "高塔";
  iron.lineup[6].heightCm = 193;
  iron.lineup[6].attributes.heading += 6;
  iron.lineup[6].attributes.pace -= 6;
  iron.lineup[6].traits = ["targetForward"];

  return { home: river, away: iron };
}
