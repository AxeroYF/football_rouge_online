import test from 'node:test';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService, S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS, REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {YDL_TRAIT_CARDS} from '../versus/trait-pool.js';
import {applyS4Enhancement} from '../versus/s4-balance.js';
import {possessPlayer} from '../versus/spirit-possession.js';
import {spectatorCardPlayer} from '../versus/public/spirit-form.js';
import {createSourceSnapshot} from '../versus/v4-adapter/source-snapshot.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {createLiveV4Match,publicLiveV4Match} from '../versus/v4-adapter/live-match.js';
import {createMatch,advanceMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {VERSION} from '../versus/v4/world.js';
import {createPlayerReportLedger} from '../versus/v4-host/player-report.js';
import {publicEvent,encodeFrames} from '../versus/v4-stream/codec.js';
import {createBroadcastSummary} from '../versus/v4-host/broadcast-summary.js';

const now = Date.parse('2026-11-19T10:01:00+08:00');
function setup() {
  const service = new YellowDogsLeagueService({statePath:null,backupDir:null,now:()=>now,rng:()=>.37});
  const user = {id:'spirit-owner',nickname:'请神测试'};
  service.beginDraft(user,'请神测试队'); service.autoDraft(user); service.finishDraft(user);
  const team = service.accountTeam(user.id);
  const fixture = service.state.rounds[0].fixtures.find(f => [f.homeId,f.awayId].includes(team.id));
  const id = team.preferredStarterIds.find(id => REAL_PLAYER_BY_ID[id].role === 'GK');
  const card = service.representativeCard(user.id,id);
  card.traitIds = ['spirit-possession'];
  return {service,team,fixture,id,card};
}

test('正式开赛锁定跨位置 S+4，观战显示变身，结算归原球员', async () => {
  const {service,team,fixture,id,card} = setup();
  const original = structuredClone(card);
  const snapshot = createSourceSnapshot({league:service.state,catalog:REAL_PLAYERS,traitCatalog:YDL_TRAIT_CARDS,bondCatalog:S4_BOND_CATALOG});
  const side = fixture.homeId === team.id ? 0 : 1;
  const compile = (seed,competition) => compileRealMatch(snapshot,{...fixture,fixtureId:'spirit-test',seed,competition,duration:60}).input;
  let input, player;
  const draws = new Set();
  for (let i=0;i<32;i++) {
    input = compile('spirit-'+i,'league');
    player = input.teams[side].players.find(p=>p.id===id);
    draws.add(player.spiritForm.id);
    if (draws.size>1 && player.spiritForm.role!=='GK') break;
  }
  assert.ok(draws.size>1);
  assert.equal(player.role,'GK');
  assert.notEqual(player.naturalRole,'GK');
  const target = REAL_PLAYER_BY_ID[player.spiritForm.id];
  const enhanced = applyS4Enhancement(target,4);
  assert.equal(target.grade,'S');
  assert.equal(player.overall,enhanced.overall);
  assert.deepEqual(player.baseAttributes,enhanced.attributes);
  assert.deepEqual(compile(input.seed,'cup').teams[side].players.find(p=>p.id===id).spiritForm, player.spiritForm);
  const match = createMatch(input);
  const recovered = restoreCheckpoint(exportCheckpoint(match));
  assert.deepEqual(recovered.state.players.find(p=>p.key===side+':'+id).spiritForm,player.spiritForm);
  const ledger = createPlayerReportLedger(input,VERSION);
  const packet = {events:match.events.map(e=>publicEvent(e)).filter(Boolean),frames:encodeFrames(match.frames)};
  const onAir = await createBroadcastSummary(input)({read:async()=>packet},{segments:[{}],matchId:'spirit-test'});
  const lines = onAir.match.events.filter(e=>e.type==='spiritPossession');
  assert.equal(lines.length,1);
  assert.ok(lines[0].text.includes(player.name) && lines[0].text.includes(target.name+' +4'));
  const row = onAir.match.teams[side].players.find(p=>p.id===id);
  const shown = spectatorCardPlayer(row);
  assert.deepEqual([shown.id,shown.name,shown.grade,shown.upgradeLevel],[target.id,target.name,'S',4]);
  advanceMatch(match,10000);
  ledger.consume(match.events);
  const report = ledger.finish(match.state);
  assert.equal(report.importantEvents.filter(e=>e.type==='spiritPossession').length,1);
  const actual = report.teams[side].players.find(p=>p.id===id);
  assert.equal(actual.name,REAL_PLAYER_BY_ID[id].name);
  service.finalizeFixture(fixture,1,{report});
  const stats = service.state.playerStats[team.id+':'+id];
  assert.equal(stats.playerName,actual.name);
  assert.deepEqual([stats.appearances,stats.goals,stats.assists,stats.ratingTotal],[1,actual.stats.goals,actual.stats.assists,actual.rating]);
  assert.deepEqual(card,original);
});

test('请神上身后 V4 用原卡的俱乐部和强化等级判定羁绊，加成落在借用的属性上', () => {
  const {service, team, fixture, id} = setup();
  const {seats, matchOptions} = service.prepareFixtureMatch(fixture, 1, now, {competitionMode:'friendly',matchEngine:'v4'});
  const side = fixture.homeId === team.id ? 0 : 1;
  const seat = seats[side], starters = seat.players.filter(p => p.active !== false);
  const carrier = starters.find(p => p.id === id);
  const members = [carrier,...starters.filter(p => p !== carrier).slice(0,4)];
  for (const p of starters) {
    p.club = members.includes(p) ? '巴塞罗那' : '其他';
    p.upgradeLevel = 0;
    p.traits = p === carrier ? ['spirit-possession'] : [];
    delete p.traitDefinitions;
  }
  const seed = Array.from({length:64}, (_,i) => 'bond-spirit-' + i).find(seed => possessPlayer(carrier,seed,side).club !== '巴塞罗那');
  assert.ok(seed);
  for (const [bond,style,attr,points,count] of [
    ['club:巴塞罗那','possession','passing',4,5], ['structure:united','balanced','workRate',5,11],
  ]) {
    for (const plan of Object.values(seat.tacticalPlans)) Object.assign(plan,{possessionStyle:style,bondIds:[bond]});
    const match = createLiveV4Match(seats,{...matchOptions,seed,duration:60});
    const state = match.spatial.state;
    const player = state.players.find(p => p.side === side && p.id === id);
    assert.notEqual(player.club, '巴塞罗那');
    assert.equal(player.upgradeLevel, 4);
    assert.equal(player.bondIdentity.upgradeLevel, 0);
    const [row] = state.activeBonds[side];
    assert.equal(row.id, bond);
    assert.equal(row.count, count);
    assert.ok(row.memberIds.includes(id));
    assert.equal(player.attributes[attr], Math.min(99, player.baseAttributes[attr] + points));
  }
});

test('友谊赛首发与替补开赛时各抽一次，同场两名球员抽中同一张卡也保留各自的身份', () => {
  const {service,team,fixture,id} = setup();
  const {seats,matchOptions} = service.prepareFixtureMatch(fixture,1,now,{competitionMode:'friendly',matchEngine:'v4'});
  const side = fixture.homeId === team.id ? 0 : 1;
  const bench = seats[side].players.find(p=>p.active===false);
  bench.traits = ['spirit-possession'];
  const carrier = seats[side].players.find(p=>p.id===id);
  let seed;
  for (let i=0;i<2048;i++) {
    const candidate = 'shared-spirit-'+i;
    if (possessPlayer(carrier,candidate,side).spiritForm.id === possessPlayer(bench,candidate,side).spiritForm.id) {
      seed = candidate;
      break;
    }
  }
  assert.ok(seed);
  const match = createLiveV4Match(seats,{...matchOptions,seed,duration:60});
  const players = match.spatial.state.players.filter(p=>p.spiritForm);
  assert.deepEqual(players.map(p=>p.id).sort(),[id,bench.id].sort());
  assert.equal(players[0].spiritForm.id,players[1].spiritForm.id);
  assert.equal(match.events.filter(e=>e.type==='spiritPossession').length,2);
  const first = publicLiveV4Match(match,now,null,false);
  const second = publicLiveV4Match(match,now,null,false);
  const get = view => spectatorCardPlayer(view.teams[side].players.find(p=>p.id===id));
  assert.deepEqual(get(first),get(second));
  assert.equal(get(first).id,players.find(p=>p.id===id).spiritForm.id);
  assert.ok(seats[side].players.every(p=>!p.spiritForm));
});
