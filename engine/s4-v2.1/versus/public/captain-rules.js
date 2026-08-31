export const DEFAULT_CAPTAIN_STYLE = "calm";

export const CAPTAIN_STYLES = Object.freeze({
  calm:Object.freeze({ name:"稳定军心", summary:"加强后场组织并小幅约束犯规。" }),
  commanding:Object.freeze({ name:"场上指挥", summary:"小幅提高所有阶段的战术执行。" }),
  inspiring:Object.freeze({ name:"激情鼓舞", summary:"落后时加强向前推进和机会制造。" }),
  disciplined:Object.freeze({ name:"铁腕纪律", summary:"降低犯规、黄牌和直接红牌风险。" }),
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

export function normalizeCaptainStyle(value) {
  return Object.hasOwn(CAPTAIN_STYLES, value) ? value : DEFAULT_CAPTAIN_STYLE;
}

export function captainLeadershipRating(player) {
  const attributes = player?.displayAttributes ?? player?.attributes ?? player?.effectiveAttributes ?? {};
  return Number((
    Number(attributes.composure ?? 50) * .30
    + Number(attributes.decisions ?? 50) * .25
    + Number(attributes.discipline ?? 50) * .20
    + Number(attributes.workRate ?? 50) * .15
    + Number(attributes.positioning ?? 50) * .10
  ).toFixed(1));
}

export function captainLeadershipScale(player) {
  return clamp((captainLeadershipRating(player) - 50) / 50, 0, 1);
}

export function activeCaptain(team) {
  const captainId = String(team?.captainId ?? "");
  return captainId ? (team?.players ?? []).find((player) => player.id === captainId && player.active !== false && !player.sentOff && !player.injury) ?? null : null;
}

export function captainStyleModifiers(team, scoreState = "level") {
  const captain = activeCaptain(team);
  const style = normalizeCaptainStyle(team?.captainStyle);
  const scale = captain ? captainLeadershipScale(captain) : 0;
  const stage = { buildUp:0, progression:0, finalThird:0, chance:0, shot:0 };
  let foulMultiplier = 1;
  let cardMultiplier = 1;
  let directRedMultiplier = 1;
  if (!captain) return { active:false, captainId:null, style, leadership:0, scale:0, stage, foulMultiplier, cardMultiplier, directRedMultiplier };
  if (style === "calm") {
    stage.buildUp = .003 + .003 * scale;
    stage.progression = .003 + .003 * scale;
    foulMultiplier = .98 - .02 * scale;
  } else if (style === "commanding") {
    Object.keys(stage).forEach((key) => { stage[key] = .002 + .002 * scale; });
  } else if (style === "inspiring" && scoreState === "trailing") {
    stage.progression = .003 + .003 * scale;
    stage.finalThird = .004 + .004 * scale;
    stage.chance = .004 + .004 * scale;
    stage.shot = .002 + .002 * scale;
  } else if (style === "disciplined") {
    foulMultiplier = .95 - .05 * scale;
    cardMultiplier = .94 - .06 * scale;
    directRedMultiplier = .94 - .06 * scale;
  }
  return { active:Boolean(captain), captainId:captain?.id ?? null, style, leadership:captain ? captainLeadershipRating(captain) : 0, scale, stage, foulMultiplier, cardMultiplier, directRedMultiplier };
}
