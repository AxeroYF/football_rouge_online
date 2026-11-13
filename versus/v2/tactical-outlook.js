const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const OUTLOOK_AXES = [
  ["control", "控球组织", ["buildUp", "pressResistance"]],
  ["vertical", "纵向推进", ["progression", "movement"]],
  ["wide", "边路展开", ["chanceCreation", "progression"]],
  ["press", "前场压迫", ["pressing"]],
  ["protect", "防线保护", ["shotPrevention", "defensiveDuel"]],
  ["counter", "转换反击", ["movement", "progression", "pressResistance"]],
];
export const TACTICAL_OUTLOOK_VERSION = "tactical-outlook-1";

function positions(frame) {
  return (frame?.players ?? []).filter(player => player.assignedRole !== "GK").map(player => ({
    id:player.id, role:player.assignedRole, duty:player.tacticalDuty,
    ...(player.targetPosition ?? player.basePosition),
  }));
}

function connectivity(players) {
  if (players.length < 2) return 0;
  return mean(players.map(player => {
    const distances = players.filter(other => other !== player).map(other => Math.hypot(player.x - other.x, player.y - other.y)).sort((a, b) => a - b);
    return clamp(1 - Math.max(0, mean(distances.slice(0, 2)) - 16) / 40);
  }));
}

export function buildTacticalOutlook({ projection, preview, plan, unavailableCount = 0 }) {
  const players = projection?.players ?? [];
  if (players.length !== 11 || preview?.frames?.length !== 3) return { modelVersion:TACTICAL_OUTLOOK_VERSION, valid:false, message:"完整首发与站位信息不足", axes:[] };
  const d = projection.dimensions;
  const attack = positions(preview.frames.find(frame => frame.id === "attack"));
  const defense = positions(preview.frames.find(frame => frame.id === "defense"));
  const base = positions(preview.frames.find(frame => frame.id === "base"));
  const midfield = players.filter(player => player.group !== "ATT" && player.group !== "GK");
  const front = players.filter(player => ["ST","LW","RW","LM","RM","AM"].includes(player.assignedRole));
  const wide = players.filter(player => ["LW","RW","LM","RM","LB","RB","LWB","RWB"].includes(player.assignedRole));
  const rear = players.filter(player => ["CB","LB","RB","LWB","RWB","DM"].includes(player.assignedRole));
  const groups = [midfield, [...midfield, ...front], wide, [...front, ...midfield], rear, front];
  const cross = plan.inPossessionDetails?.crossing;
  const intention = [
    ((100 - d.directness) * .65 + (100 - d.tempo) * .35) / 100,
    (d.directness * .65 + d.tempo * .35) / 100,
    (d.attackingWidth * .8 + (cross === "increase" ? 20 : cross === "reduce" ? 0 : 10)) / 100,
    (d.pressing * .75 + d.defensiveLine * .25) / 100,
    (d.compactness * .4 + (100 - d.defensiveLine) * .25 + (100 - d.mentality) * .35) / 100,
    (d.counterAttack * .8 + d.directness * .2) / 100,
  ];
  const attackWidth = attack.length ? Math.max(...attack.map(p => p.x)) - Math.min(...attack.map(p => p.x)) : 0;
  const baseGap = base.length ? Math.max(...base.map(p => p.y)) - Math.min(...base.map(p => p.y)) : 100;
  const rest = attack.filter(p => p.y >= 48).length;
  const outlets = attack.filter(p => p.y < 38).length;
  const centralDefense = defense.filter(p => p.x >= 25 && p.x <= 75 && p.y >= 48).length;
  const structure = [
    connectivity(base), connectivity(attack), clamp(attackWidth / 65) * .6 + clamp(outlets / 3) * .4,
    connectivity(defense) * .65 + clamp(1 - Math.max(0, baseGap - 45) / 45) * .35,
    clamp(rest / 3) * .55 + clamp(centralDefense / 4) * .45,
    clamp(outlets / 3) * .55 + connectivity(attack) * .45,
  ];
  const facts = [
    `中后场接应 ${midfield.length} 人；基础站位按相邻接应距离计算。`,
    `进攻投影前场接应 ${outlets} 人；结合向前连接和无球跑动。`,
    `边路相关球员 ${wide.length} 人；进攻投影展开宽度 ${Math.round(attackWidth)}。`,
    `基础外场纵深跨度 ${Math.round(baseGap)}；前后线连接影响持续施压。`,
    `进攻投影留后 ${rest} 人；防守中路保护 ${centralDefense} 人。`,
    `进攻投影前场出球点 ${outlets} 人；结合速度、跑位与传接。`,
  ];
  const tradeoffs = ["耐心接应可能放弃部分第一时间向前机会。", "快速向前也会提高失去球权的风险。", "边路投入需要禁区接应，并兼顾留守。", "压迫失败会暴露身后，也增加体力消耗。", "更多人保持保护，会减少进攻端接应。", "立即向前会放弃部分稳住球权的机会。"];
  const axes = OUTLOOK_AXES.map(([id, label, metrics], index) => {
    const group = [...new Map(groups[index].map(player => [player.id, player])).values()];
    const capacity = group.length ? clamp(mean(group.map(player => mean(metrics.map(key => Number(player.metrics?.[key] ?? 0))))) / 100) : 0;
    const value = Math.round(clamp(intention[index]) * (.35 + capacity * .45 + clamp(structure[index]) * .2) * 100);
    const fitness = group.length ? Math.round(mean(group.map(player => Number(player.fitness ?? 100)))) : 0;
    return { id, label, value, evidence:facts[index], support:`相关参与者 ${group.length} 人，平均体力 ${fitness}；能力与职责按引擎投影计算。`, tradeoff:tradeoffs[index] };
  });
  return { modelVersion:TACTICAL_OUTLOOK_VERSION, tacticalModelVersion:plan.tacticalModelVersion ?? "legacy", valid:true, axes,
    assumptions:{ minute:preview.minute, scoreState:preview.scoreState, weather:"sunny", opponentIncluded:false },
    warnings:[...(unavailableCount ? [`当前首发中有 ${unavailableCount} 人伤停或不可用，实际开赛阵容可能轮换。`] : []), ...(rest < 3 ? ["进攻投影的留后保护不足三人。"] : [])],
  };
}
