import { readFileSync } from 'node:fs';
import { buildAccountMatchSeat } from '../../shared/football/account-match-seat.mjs';
import { prepareV22Match } from './v21-adapter.mjs';

export function createV22DemoAccounts() {
  const catalog = JSON.parse(readFileSync(new URL('../../assets/data/s4-player-catalog.json', import.meta.url), 'utf8')).filter(p => !p.isX);
  const used = new Set();
  const roles = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW'];
  const pools = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'ATT', 'ATT', 'ATT'];
  const coords = [[50,94],[10,70],[36,75],[64,75],[90,70],[28,47],[50,57],[72,47],[12,24],[50,18],[88,24]];
  return ['曙光竞技', '北境联队'].map((name, t) => {
    const roster = roles.map((role, i) => {
      const player = catalog.find(p => !used.has(p.id) && p.role === role) ?? catalog.find(p => !used.has(p.id) && p.pool === pools[i]);
      used.add(player.id); return { ...structuredClone(player), state: { fitness: 95 }, active: true };
    });
    const positions = Object.fromEntries(roster.map((p, i) => [p.id, { x: coords[i][0], y: coords[i][1] }]));
    const duties = Object.fromEntries(roster.map((p, i) => [p.id, [null,'holdingFullback','coverDefender','coverDefender','overlappingFullback',null,'anchor',null,'bylineWinger','advancedForward','insideForward'][i]]).filter(([, duty]) => duty));
    const base = { positionPreset: 'position1', playerDuties: duties, inPossessionDetails: { attackDirection: 'balanced' }, outOfPossessionDetails: { marking: 'mixed' } };
    const control = { ...base, label: '控球推进', tactic: 'balanced', style: 'possession', tacticalDimensions: { tempo: 53, directness: 35, attackingWidth: 68, defensiveLine: 55, pressing: 55, compactness: 65, mentality: 55 } };
    const press = { ...base, label: '高位压迫', tactic: 'positive', style: 'possession', tacticalDimensions: { tempo: 76, directness: 54, attackingWidth: 70, defensiveLine: 83, pressing: 88, compactness: 72, mentality: 72 } };
    const counter = { ...base, label: '低位反击', tactic: 'defensive', style: 'counterAttack', tacticalDimensions: { tempo: 63, directness: 82, attackingWidth: 45, defensiveLine: 22, pressing: 23, compactness: 88, mentality: 30, counterAttack: 85 } };
    const wide = { ...base, label: '套边与内切', tactic: 'positive', style: 'possession', inPossessionDetails: { attackDirection: 'right', crossing: 'increase' }, tacticalDimensions: { tempo: 60, directness: 60, attackingWidth: 96, defensiveLine: 58, pressing: 58, compactness: 42, mentality: 66 } };
    const inverted = { ...control, label: '内收组织', playerDuties: { ...duties, [roster[4].id]: 'invertedFullback', [roster[10].id]: 'bylineWinger' } };
    const tacticalPlans = { opening: t === 0 ? control : counter, control, press, counter, wide, inverted, leading: { ...counter, triggerGoalDifference: 1 }, trailing: { ...press, triggerGoalDifference: 1 } };
    return { id: `demo-${t}`, nickname: name, playerSquads: { assignments: Object.fromEntries(roster.map(p => [p.id, 'expedition'])) }, draft: { teamName: name, roster },
      tactics: { formation: '4-3-3', planSnapshots: { __s4V2: {
        starters: roster.map(p => p.id), positionPresets: { position1: positions, position2: structuredClone(positions), position3: structuredClone(positions) }, tacticalPlans,
      } } },
    };
  });
}

export function createV22DemoInput(seed = 'v22-review-1', options = {}) {
  const seats = createV22DemoAccounts().map(account => {
    const seat = buildAccountMatchSeat(account);
    // Additional comparison choices are each projected as a saved opening plan;
    // the default/leading/trailing plans follow the production projection directly.
    for (const key of ['control', 'press', 'counter', 'wide', 'inverted']) {
      const variant = structuredClone(account);
      const saved = variant.tactics.planSnapshots.__s4V2;
      saved.tacticalPlans.opening = saved.tacticalPlans[key];
      seat.tacticalPlans[key] = buildAccountMatchSeat(variant).tacticalPlans.opening;
    }
    return seat;
  });
  return prepareV22Match(seats, { seed, ...options });
}
