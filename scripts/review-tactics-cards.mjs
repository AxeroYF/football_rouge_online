// Build a fixture from the actual tactics controller with an in-memory roster.
// No browser, network requests, server or campaign save is accessed.
import fs from 'node:fs/promises';
import { createTacticsController } from '../tactics-page.js';
import { tacticsCardMarkup } from '../client/tactics/card-display-controller.js';

const catalog = JSON.parse(await fs.readFile('assets/data/s4-player-catalog.json', 'utf8'));
const chosen = new Set(), squads = {};
for (const squad of ['expedition', 'garrison']) {
  squads[squad] = [];
  for (const [pool, count] of [['GK', 1], ['DEF', 4], ['MID', 3], ['ATT', 3]]) {
    const players = catalog.filter(p => p.pool === pool && !chosen.has(p.id))
      .sort((a, b) => (b.grade === 'S') - (a.grade === 'S') || b.overall - a.overall).slice(0, count);
    for (const p of players) { chosen.add(p.id); squads[squad].push({ ...p, upgradeLevel: p.grade === 'S' ? 4 : 1 }); }
  }
}
const positions = [[50, 90], [16, 70], [39, 70], [61, 70], [84, 70], [26, 48], [50, 48], [74, 48], [24, 22], [50, 18], [76, 22]];
const account = {
  setupComplete: true, draft: { roster: Object.values(squads).flat() },
  playerSquads: { schemaVersion: 2, assignments: Object.fromEntries(Object.entries(squads).flatMap(([s, ps]) => ps.map(p => [p.id, s]))) },
  tactics: { activeSquadId: 'expedition', squads: Object.fromEntries(Object.entries(squads).map(([s, ps]) => [s, {
    starters: ps.map(p => p.id), captainId: ps[9].id,
    positions: Object.fromEntries(ps.map((p, i) => [p.id, { x: positions[i][0], y: positions[i][1] }])),
  }])) },
};
const panel = { dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.document = { querySelector: () => null, addEventListener() {} };
globalThis.window = { matchMedia: () => ({ matches: false }) };
const controller = createTacticsController({ panel, mapElement: { classList: { add() {}, remove() {} } },
  getCampaignState: () => account, setCampaignState() { throw Error('Unexpected save'); },
  request() { throw Error('Unexpected network request'); }, showToast() {},
});
controller.open(); controller.close();
await fs.mkdir('outputs/tactics-card-review', { recursive: true });
await fs.writeFile('outputs/tactics-card-review/board.html', panel.innerHTML);
await fs.writeFile('outputs/tactics-card-review/cards.json', JSON.stringify(Object.fromEntries(squads.expedition.map(p => [p.id, tacticsCardMarkup(p)]))));
console.log('Actual tactics board and 11 static field cards rendered offline.');
