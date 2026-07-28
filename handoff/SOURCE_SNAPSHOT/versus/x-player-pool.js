const X_PLAYER_NAMES = Object.freeze(["李宣泰", "李俊良", "黄威", "杨帆", "张亦弛", "翟博闻", "李彬", "唐昊", "刘祖豪", "金典"]);

const ATTRIBUTE_KEYS = Object.freeze([
  "passing", "firstTouch", "dribbling", "crossing", "finishing", "longShots", "heading", "setPieces",
  "tackling", "marking", "positioning", "vision", "decisions", "composure", "offBall", "discipline",
  "pace", "acceleration", "strength", "stamina", "agility", "jumping", "workRate", "aggression",
  "goalkeeping", "reflexes",
]);

export const X_PLAYER_IDS = Object.freeze(X_PLAYER_NAMES.map((_, index) => `ydl-x-player-${index + 1}`));

export const X_PLAYERS = X_PLAYER_NAMES.map((name, index) => ({
  id:X_PLAYER_IDS[index],
  name,
  role:null,
  secondaryRole:null,
  pool:"X",
  overall:62,
  baseOverall:62,
  grade:"X",
  nationality:"中国",
  club:"黄狗青训",
  heightCm:null,
  preferredFoot:"both",
  attributes:Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 62])),
  referenceAttributes:Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 62])),
  state:{ fitness:100, form:50, morale:70 },
  development:{ age:18, potential:99 },
  cardFamilyId:`ydl-x-family-${index + 1}`,
  cardVersion:"S4-X",
  canHaveDuplicates:false,
  source:"ydl-prince-system",
  legendary:false,
  individualized:true,
  xPlayer:true,
  traits:[],
}));

export const X_PLAYER_BY_ID = Object.freeze(Object.fromEntries(X_PLAYERS.map((player) => [player.id, player])));
export const isXPlayer = (playerOrId) => Boolean(X_PLAYER_BY_ID[typeof playerOrId === "string" ? playerOrId : playerOrId?.id]);
