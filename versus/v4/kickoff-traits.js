import {seedState} from './world.js';

// Resolve once on the match copy, after enhancements and borrowed forms.
export function applyKickoffTraits(player, definitions, seed, side, competition, starter) {
  let multiplier = 1;
  const effects = {};
  for (const trait of definitions) {
    for (const rule of trait?.rules ?? []) {
      if (rule.hook === 'allInGamble' && effects.allInMultiplier == null) {
        const draw = seedState(JSON.stringify([String(seed), side, player.id, 'allInGamble']));
        effects.allInMultiplier = draw < 0x80000000 ? rule.winMultiply : rule.loseMultiply;
        multiplier *= effects.allInMultiplier;
      }
      if (rule.hook === 'sponsorEntry' && starter && !effects.sponsorEntry && ['league','cup'].includes(competition)) {
        effects.sponsorEntry = true;
        multiplier *= rule.multiply;
      }
    }
  }
  if (!Object.keys(effects).length) return player;
  const adjusted = {...player,...effects};
  for (const field of ['attributes','ydlBondBaseAttributes','baseAttributes']) {
    if (player[field]) adjusted[field] = Object.fromEntries(Object.entries(player[field]).map(([key,value]) =>
      [key, Math.max(1, Math.min(99, value * multiplier))]));
  }
  return adjusted;
}

export function kickoffTraitAnnouncements(player, teamName, seed, side) {
  const variant = seedState(JSON.stringify([String(seed),side,player.id,'commentary'])) % 2;
  const lines = [];
  if (player.allInMultiplier != null) {
    const win = player.allInMultiplier > 1;
    const options = win ? [
      `梭哈是一种智慧！${teamName}的 ${player.name}开局直接掷出大吉，全属性飙升 +8%，今天注定要大杀四方！`,
      `天命所归！${player.name}发动「梭哈是一种智慧」赌赢开局，全属性 +8% 火力全开！`,
    ] : [
      `梭哈是一种智慧……但今天好像不太智慧！${teamName}的 ${player.name}开局掷出大凶，全属性 -8%，主帅场边血压飙升！`,
      `十赌九输！${player.name}触发「梭哈是一种智慧」遗憾翻车，本场全属性 -8%，队友只能自求多福！`,
    ];
    lines.push({text:options[variant],level:'critical'});
  }
  if (player.sponsorEntry) lines.push({level:'highlight',text:[
    `带资进组！${teamName}让赞助商钦点的 ${player.name}首发出战，虽然脚法略显业余，但赛后经费已经安排上了！`,
    `金主驾到！${teamName}首发派上「带资进组」的 ${player.name}，这波属于实力不够、钞能力来凑！`,
  ][variant]});
  return lines;
}
