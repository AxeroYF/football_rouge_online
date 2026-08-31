export const DRAFT_SIZE = 22;
export const LINE_KEYS = Object.freeze(["GK", "DEF", "MID", "ATT"]);
export const MINIMUM_PLAYERS_PER_LINE = 2;
export const GRADE_WEIGHTS = Object.freeze({ C: 0.57, B: 0.38, A: 0.05 });
export const LINE_WEIGHTS = Object.freeze({ GK: 0.12, DEF: 0.32, MID: 0.30, ATT: 0.26 });

export const DRAFT_CONFIG = Object.freeze({
  size: DRAFT_SIZE,
  minimumPlayersPerLine: MINIMUM_PLAYERS_PER_LINE,
  gradeWeights: GRADE_WEIGHTS,
  lineWeights: LINE_WEIGHTS,
});
