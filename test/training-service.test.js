import { EnhancementService } from "../server/application/enhancement-service.mjs";
import { createPlayerCardViewModel } from "../shared/player-card/player-card-contract.js";
import { buildV2TeamSnapshots } from "../engine/s4-v2.1/versus/v2/team-snapshot-v2.js";
import { EconomyService } from "../server/application/economy-service.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { TrainingService } from "../server/application/training-service.mjs";
import { BuildingService } from "../server/application/building-service.mjs";
import { CampaignService } from "../campaign-service.mjs";
import { PLAYER_ATTRIBUTE_LABELS } from "../shared/config/player-attributes.mjs";
import { trainingCapacity, trainingCostGold } from "../shared/config/training.mjs";
import { autoCompletePlayerSquads } from "../shared/config/player-squads.mjs";
import { buildAccountMatchSeat } from "../engine/campaign-match-engine.mjs";
import { normalizeTacticsSquads } from "../tactics-page.js";

function fixture() {
  let clock = 1000, failSave = false, saved;
  const roles = { GK: "GK", DEF: "CB", MID: "CM", ATT: "ST" };
  const catalog = Object.keys(roles).flatMap((pool) => Array.from({ length: 8 }, (_, i) => ({ id: `${pool}-${i}`, playerId: `${pool}-${i}`, name: `${pool}${i}`, pool, role: roles[pool], grade: "C", overall: 70, attributes: Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map((key) => [key, 70])), state: { fitness: 100 } })));
  const account = { gold: 100000, goldLedger: [], id: "p", nickname: "test", setupComplete: true, draft: { teamName: "训练队", roster: structuredClone(catalog), offer: [] }, playerSquads: { assignments: Object.fromEntries(catalog.map((p) => [p.id, Number(p.id.split("-")[1]) < 4 ? "expedition" : "garrison"])) } };
  const building = { id: "training-1", type: "training-center", status: "active", level: 1 };
  const world = { revision: 0, territories: { home: { territoryId: "home", ownerType: "player", ownerId: "p", buildings: [building] } }, players: { p: { territoryIds: ["home"] } } };
  const service = new TrainingService({ buildings: new BuildingService({ economy: new EconomyService(), now: () => clock }), territoryIndex: { territories: [{ territoryId: "home", country: "西班牙", name: "马德里" }] }, now: () => clock, random: () => 0, save: () => { if (failSave) throw new Error("disk failure"); saved = structuredClone(account); } });
  const start = (options = {}) => service.start(account, world, { territoryId: "home", buildingId: building.id, pool: "ATT", slot: 0, playerId: "ATT-0", requestId: "request-one", ...options });
  return { account, catalog, building, world, service, start, setTime: (time) => { clock = time; }, failSave: (value) => { failSave = value; }, saved: () => saved };
}

test("ten-minute training grants exactly five points once, resumes expedition and preserves results", () => {
  const f = fixture(), before = structuredClone(f.account.playerSquads), task = f.start();
  const player = f.account.draft.roster.find((p) => p.id === "ATT-0");
  assert.equal(task.completesAt - task.startedAt, 600000);
  assert.equal(task.gains, null);
  assert.equal(player.training.taskId, task.id);
  assert.deepEqual(f.account.playerSquads, before);
  assert.equal(f.start().id, task.id);
  f.setTime(task.completesAt - 1); assert.equal(f.service.settle(f.account), false);
  assert.equal(player.attributes.passing, 70);
  f.setTime(task.completesAt); assert.equal(f.service.settle(f.account), true);
  assert.equal(f.service.settle(f.account), false);
  assert.equal(player.training, undefined);
  assert.equal(player.attributes.passing, 75);
  assert.equal(player.effectiveAttributes.passing, 75);
  assert.equal(Object.values(player.attributes).reduce((a,b) => a+b, 0), 26 * 70 + 5);
  assert.equal(f.service.publicState(f.account).tasks[0].status, "completed");
  assert.deepEqual(f.service.publicState(f.account).tasks[0].gains, { passing: 5 });
  assert.deepEqual(f.account.playerSquads, before);
  f.start({ requestId: "request-two" });
  assert.equal(f.service.publicState(f.account).tasks.length, 1);
});

test("ownership, position, construction, cross-center duplicates and per-level seats are enforced", () => {
  const f = fixture();
  f.world.territories.home.ownerId = "other"; assert.throws(() => f.start(), /自己的/);
  f.world.territories.home.ownerId = "p";
  f.building.status = "inactive"; assert.throws(() => f.start(), /尚未建成/); f.building.status = "active";
  assert.throws(() => f.start({ playerId: "MID-0" }), /对应位置/);
  assert.throws(() => f.start({ playerId: "foreign" }), /本队/);
  assert.throws(() => f.start({ pool: "__proto__" }), /席位/);
  assert.throws(() => f.start({ slot: 1 }), /席位/);
  f.start();
  assert.throws(() => f.start({ requestId: "request-two", playerId: "ATT-1" }), /占用/);
  const second = { ...f.building, id: "training-2" }; f.world.territories.home.buildings.push(second);
  assert.throws(() => f.start({ requestId: "request-two", buildingId: second.id }), /正在训练/);
  assert.throws(() => f.start({ playerId: "ATT-1" }), /请求编号/);
  for (let level = 1; level <= 5; level++) assert.equal(trainingCapacity(level), level);
  f.building.level = 2;
  f.start({ requestId: "request-two", slot: 1, playerId: "ATT-1" });
  f.start({ requestId: "request-mid", pool: "MID", playerId: "MID-4" });
  assert.ok(f.account.draft.roster.find((p) => p.id === "MID-4").training.taskId);
  assert.equal(f.account.playerSquads.assignments["MID-4"], "garrison");
});

test("random points can reach all 26 attributes and redistribute away from capped attributes", () => {
  const f = fixture(), player = f.account.draft.roster[0], seen = new Set();
  for (let i = 0; i < 26; i++) {
    f.service.random = () => (i + .5) / 26;
    const gains = f.service.gains(player);
    assert.equal(Object.values(gains).reduce((a,b) => a+b, 0), 5);
    Object.keys(gains).forEach((key) => seen.add(key));
  }
  assert.equal(seen.size, 26);
  player.attributes = Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map((key) => [key, 99]));
  player.attributes.reflexes = 94;
  assert.deepEqual(f.service.gains(player), { reflexes: 5 });
  player.attributes.reflexes = 95; assert.throws(() => f.service.gains(player), /不足 5/);
});

test("failed persistence rolls back starts and rewards without duplicating growth", () => {
  const f = fixture(), before = structuredClone(f.account);
  f.failSave(true); assert.throws(() => f.start(), /disk failure/); assert.deepEqual(f.account, before);
  f.failSave(false); const task = f.start(); const started = structuredClone(f.account);
  f.setTime(task.completesAt); f.failSave(true);
  assert.throws(() => f.service.settle(f.account), /disk failure/); assert.deepEqual(f.account, started);
  f.failSave(false); f.service.settle(f.account);
  assert.equal(f.account.draft.roster.find((p) => p.id === "ATT-0").attributes.passing, 75);
});

test("restart settles offline training and catalog hydration retains cumulative bonuses", () => {
  const f = fixture(), task = f.start();
  let saved = { accounts: { p: f.saved() }, world: null };
  const repository = { load: () => structuredClone(saved), save: (value) => { saved = structuredClone(value); } };
  const campaign = new CampaignService({ catalog: f.catalog, repository, now: () => task.completesAt });
  const account = campaign.accounts.get("p");
  campaign.state(account);
  assert.equal(account.draft.roster.find((p) => p.id === "ATT-0").attributes.passing, 75);
  const restarted = new CampaignService({ catalog: f.catalog, repository, now: () => task.completesAt + 1000 });
  const restored = restarted.accounts.get("p"); restarted.state(restored);
  const player = restored.draft.roster.find((p) => p.id === "ATT-0");
  assert.equal(player.attributes.passing, 75); assert.equal(player.effectiveAttributes.passing, 75);
  assert.equal(player.training, undefined);
  assert.equal(restarted.training.publicState(restored).tasks[0].gains.passing, 5);
});

test("training preserves tactics participants but substitutes them in matches without changing garrison", () => {
  const f = fixture();
  const before = buildAccountMatchSeat(f.account, "garrison").players.map((p) => p.id);
  f.start(); f.start({ pool: "MID", playerId: "MID-4", requestId: "garrison-training" });
  const expedition = buildAccountMatchSeat(f.account, "expedition");
  assert.ok(!expedition.players.some((p) => p.id === "ATT-0"));
  assert.deepEqual(buildAccountMatchSeat(f.account, "garrison").players.map((p) => p.id), before);
  const normalized = normalizeTacticsSquads(null, f.account.draft.roster, f.account.playerSquads);
  assert.ok(normalized.squads.expedition.starters.includes("ATT-0"));
  assert.deepEqual(autoCompletePlayerSquads(f.account.playerSquads, f.account.draft.roster).autoAssignedPlayerIds, []);
  f.world.activeChallenges = { battle: { attackerId: "p" } };
  assert.throws(() => f.start({ pool: "DEF", playerId: "DEF-0", requestId: "match-training" }), /比赛结束/);
});

test("ongoing training cannot be bypassed by squad reassignment or tactics payloads", () => {
  const f = fixture(); f.start();
  const campaign = new CampaignService({ catalog: f.catalog, repository: { load: () => ({ accounts: { p: structuredClone(f.account) }, world: null }), save() {} }, now: () => 1000 });
  const account = campaign.accounts.get("p");
  assert.throws(() => campaign.assignPlayerSquad(account, "ATT-0", "garrison"), /训练.*结束/);
  const assignments = { ...account.playerSquads.assignments, "ATT-0": "garrison" };
  assert.throws(() => campaign.saveTactics(account, { playerSquads: { assignments } }), /训练.*结束/);
});


test("cancel releases player and seat, survives restart, and never awards partial growth", () => {
  const f = fixture(), task = f.start(), before = structuredClone(f.account.draft.roster.find((p) => p.id === "ATT-0").attributes);
  f.setTime(task.startedAt + 300000);
  assert.throws(() => f.service.cancel({ id: "other" }, task.id), /不存在/);
  assert.equal(f.service.cancel(f.account, task.id).status, "cancelled");
  assert.equal(f.service.cancel(f.account, task.id).status, "cancelled");
  assert.deepEqual(f.service.publicState(f.account).tasks, []);
  const player = f.account.draft.roster.find((p) => p.id === "ATT-0");
  assert.equal(player.training, undefined);
  assert.equal(f.account.playerSquads.assignments[player.id], "expedition");
  assert.deepEqual(player.attributes, before);
  const campaign = new CampaignService({ catalog: f.catalog, repository: { load: () => ({ accounts: { p: structuredClone(f.saved()) }, world: null }), save() {} }, now: () => task.completesAt + 1 });
  const restored = campaign.accounts.get("p"); campaign.state(restored);
  assert.deepEqual(restored.draft.roster.find((p) => p.id === "ATT-0").attributes, before);
  assert.deepEqual(campaign.training.publicState(restored).tasks, []);
  const next = f.start({ requestId: "training-next" });
  f.service.cancel(f.account, task.id);
  assert.equal(player.training.taskId, next.id);
});

test("failed cancellation rolls back; deadline completion wins over a late cancel", () => {
  const f = fixture(), task = f.start(), before = structuredClone(f.account);
  f.failSave(true); assert.throws(() => f.service.cancel(f.account, task.id), /disk failure/);
  assert.deepEqual(f.account, before);
  f.failSave(false); f.setTime(task.completesAt);
  assert.equal(f.service.cancel(f.account, task.id).status, "completed");
  assert.equal(f.service.cancel(f.account, task.id).status, "completed");
  assert.equal(f.account.draft.roster.find((p) => p.id === "ATT-0").attributes.passing, 75);
});

test("cancelled latest session leaves seat empty instead of reviving the previous result", () => {
  const f = fixture(), first = f.start();
  f.setTime(first.completesAt); f.service.settle(f.account);
  const second = f.start({ requestId: "training-next" });
  f.service.cancel(f.account, second.id);
  assert.deepEqual(f.service.publicState(f.account).tasks, []);
  f.setTime(second.completesAt); f.service.settle(f.account);
  assert.equal(f.account.draft.roster.find((p) => p.id === "ATT-0").attributes.passing, 75);
});


function saveMatchLineup(account) {
  const expedition = buildAccountMatchSeat(account, "expedition"), garrison = buildAccountMatchSeat(account, "garrison");
  const squad = (seat) => {
    const starters = seat.players.map((p) => p.id);
    const positionPresets = Object.fromEntries(["position1", "position2", "position3"].map((key, index) => [key, Object.fromEntries(starters.map((id) => [id, { x: seat.positions[id].x + index, y: seat.positions[id].y }]))]));
    const plans = Object.fromEntries(["opening", "leading", "trailing"].map((key) => [key, { ...seat.tacticalPlans[key], playerDuties: Object.fromEntries(starters.map((id) => [id, `duty-${key}-${id}`])) }]));
    return { formation: "4-3-3", starters, positions: positionPresets.position1, planSnapshots: { __s4V2: { starters, positionPresets, tacticalPlans: plans, captainId: starters.includes("ATT-0") ? "ATT-0" : starters[0] } } };
  };
  account.tactics = { squads: { expedition: squad(expedition), garrison: squad(garrison) } };
  return expedition;
}

test("match substitution retains healthy starters, all three slot coordinates, duties and captain without mutating the saved team", () => {
  const f = fixture(); const planned = saveMatchLineup(f.account);
  f.start(); f.start({ pool: "GK", playerId: "GK-0", requestId: "train-keeper" });
  const before = structuredClone(f.account);
  const seat = buildAccountMatchSeat(f.account, "expedition");
  assert.equal(new Set(seat.players.map((p) => p.id)).size, 11);
  for (let index = 0; index < planned.players.length; index++) {
    const original = planned.players[index], replacement = seat.players[index];
    if (!["ATT-0", "GK-0"].includes(original.id)) assert.equal(replacement.id, original.id);
    else { assert.notEqual(replacement.id, original.id); assert.equal(replacement.pool, original.pool); }
    for (const key of ["position1", "position2", "position3"]) assert.deepEqual(seat.positionPresets[key][replacement.id], before.tactics.squads.expedition.planSnapshots.__s4V2.positionPresets[key][original.id]);
    for (const key of ["opening", "leading", "trailing"]) assert.equal(seat.tacticalPlans[key].playerDuties[replacement.id], `duty-${key}-${original.id}`);
  }
  assert.equal(seat.captainId, seat.players[planned.players.findIndex((p) => p.id === "ATT-0")].id);
  assert.deepEqual(f.account, before);
  const normalized = normalizeTacticsSquads(f.account.tactics, f.account.draft.roster, f.account.playerSquads);
  assert.deepEqual(normalized.squads.expedition.starters, before.tactics.squads.expedition.starters);
  for (const key of ["position1", "position2", "position3"]) for (const id of before.tactics.squads.expedition.starters) assert.deepEqual(normalized.squads.expedition.positionPresets[key][id], before.tactics.squads.expedition.planSnapshots.__s4V2.positionPresets[key][id]);
  f.service.cancel(f.account, f.service.publicState(f.account).tasks.find((t) => t.playerId === "ATT-0").id);
  assert.equal(buildAccountMatchSeat(f.account, "expedition").players[planned.players.findIndex((p) => p.id === "ATT-0")].id, "ATT-0");
});

test("replacement prioritizes matching positions and never borrows garrison or training/injured substitutes", () => {
  const f = fixture(); saveMatchLineup(f.account);
  const find = (id) => f.account.draft.roster.find((p) => p.id === id);
  find("MID-3").overall = 99; find("ATT-3").overall = 60;
  f.start();
  const seat = buildAccountMatchSeat(f.account, "expedition");
  assert.ok(seat.players.some((p) => p.id === "ATT-3"));
  assert.ok(!seat.players.some((p) => p.id === "MID-3"));
  find("ATT-3").training = { taskId: "another-training" };
  assert.ok(buildAccountMatchSeat(f.account, "expedition").players.some((p) => p.id === "MID-3"));
  find("MID-3").state.injury = { matchesRemaining: 1 };
  const before = structuredClone(f.account);
  assert.throws(() => buildAccountMatchSeat(f.account, "expedition"), /替补不足/);
  assert.deepEqual(f.account, before);
  assert.ok(buildAccountMatchSeat(f.account, "garrison").players.length === 11);
});

test("saved training players remain eligible for tactics saves and legacy training flags no longer remove them", () => {
  const f = fixture(); saveMatchLineup(f.account); f.start();
  f.account.draft.roster.find((p) => p.id === "ATT-0").training.suspendedExpedition = true;
  const campaign = new CampaignService({ catalog: f.catalog, repository: { load: () => ({ accounts: { p: structuredClone(f.account) }, world: null }), save() {} }, now: () => 1000 });
  const account = campaign.accounts.get("p");
  const starters = [...account.tactics.squads.expedition.starters];
  const positions = structuredClone(account.tactics.squads.expedition.planSnapshots.__s4V2.positionPresets);
  campaign.saveTactics(account, structuredClone(account.tactics));
  assert.deepEqual(account.tactics.squads.expedition.starters, starters);
  assert.deepEqual(account.tactics.squads.expedition.planSnapshots.__s4V2.positionPresets, positions);
  assert.equal(account.playerSquads.assignments["ATT-0"], "expedition");
});


test("finishing training persists an empty seat without losing or repeating rewards", () => {
  const f = fixture(), first = f.start();
  assert.throws(() => f.service.finish(f.account, first.id), /尚未完成/);
  assert.throws(() => f.service.finish({ training: { tasks: {} } }, first.id), /不存在/);
  f.setTime(first.completesAt);
  assert.equal(f.service.finish(f.account, first.id).status, "finished");
  assert.deepEqual(f.service.publicState(f.account).tasks, []);
  const player = f.account.draft.roster.find((p) => p.id === "ATT-0");
  assert.equal(player.attributes.passing, 75);
  assert.equal(player.training, undefined);
  assert.equal(f.service.finish(f.account, first.id).status, "finished");
  assert.equal(player.attributes.passing, 75);
  const restored = f.saved();
  assert.deepEqual(f.service.publicState(restored).tasks, []);
  assert.equal(f.service.settle(restored), false);
  assert.equal(f.service.finish(restored, first.id).status, "finished");
  const next = f.start({ requestId: "finish-next", playerId: "ATT-1" });
  f.service.finish(f.account, first.id);
  assert.equal(f.service.publicState(f.account).tasks[0].id, next.id);
  assert.equal(f.account.draft.roster.find((p) => p.id === "ATT-1").training.taskId, next.id);
});

test("finishing the latest result does not resurrect older results and save failures are retryable", () => {
  const f = fixture(), first = f.start();
  f.setTime(first.completesAt); f.service.settle(f.account);
  const next = f.start({ requestId: "finish-next" });
  f.setTime(next.completesAt); f.service.settle(f.account);
  const before = structuredClone(f.account);
  f.failSave(true);
  assert.throws(() => f.service.finish(f.account, next.id), /disk failure/);
  assert.deepEqual(f.account, before);
  f.failSave(false); f.service.finish(f.account, next.id);
  assert.deepEqual(f.service.publicState(f.account).tasks, []);
  assert.equal(f.account.draft.roster.find((p) => p.id === "ATT-0").attributes.passing, 80);
  const cancelled = f.start({ requestId: "cancel-after-finish" });
  f.service.cancel(f.account, cancelled.id);
  assert.throws(() => f.service.finish(f.account, cancelled.id), /已取消/);
});


test('higher center levels target core attributes without increasing points or rewriting existing sessions',()=>{
 const f=fixture();f.building.level=5;
 const task=f.start();const player=f.account.draft.roster.find(p=>p.id==='ATT-0');
 const gains=f.account.training.tasks[task.id].gains;
 assert.equal(Object.values(gains).reduce((a,b)=>a+b,0),5);
 assert.ok(Object.keys(gains).every(k=>['finishing','offBall','dribbling','pace','heading','composure'].includes(k)));
 const frozen=structuredClone(gains);f.building.level=1;assert.deepEqual(f.account.training.tasks[task.id].gains,frozen);
 assert.equal(f.service.details(f.account,f.world,'home',f.building.id).capacity,1);
});


test("training prices follow the approved curve and charge the actual enhanced overall", () => {
  for (const [overall, cost] of [[20,250],[60,250],[70,500],[80,1000],[90,2000],[100,4000]]) assert.equal(trainingCostGold(overall), cost);
  let previous = 0;
  for (let overall = 1; overall <= 112; overall++) { const cost = trainingCostGold(overall); assert.ok(cost >= previous); assert.equal(cost % 50, 0); previous = cost; }
  assert.equal(trainingCostGold({overall:70,effectiveOverall:80}),1000);
  const f=fixture(),p=f.account.draft.roster.find(p=>p.id==='ATT-0');p.overall=90;
  const view=f.service.details(f.account,f.world,'home',f.building.id);
  assert.equal(view.players.find(p=>p.playerId==='ATT-0').costGold,2000);
  const task=f.start({costGold:1});assert.equal(task.costGold,2000);assert.equal(f.account.gold,98000);
  f.start();assert.equal(f.account.gold,98000);assert.equal(f.account.goldLedger.length,1);
});

test("insufficient funds cannot create a task or ledger entry and cancellation refunds exactly once", () => {
  const f=fixture();f.account.gold=499;const before=structuredClone(f.account);
  assert.equal(f.service.details(f.account,f.world,'home',f.building.id).players[0].canAfford,false);
  assert.throws(()=>f.start(),/金币不足/);assert.deepEqual(f.account,before);
  f.account.gold=500;const task=f.start();assert.equal(f.account.gold,0);
  assert.equal(f.service.cancel(f.account,task.id).refundedGold,500);
  f.service.cancel(f.account,task.id);f.start();assert.equal(f.account.gold,500);
  assert.deepEqual(f.account.goldLedger.map(e=>e.delta),[-500,500]);
});

test("refund uses persisted payment despite later enhancement and legacy free tasks never mint gold", () => {
  const f=fixture(),task=f.start(),restored=structuredClone(f.saved());
  restored.draft.roster.find(p=>p.id==='ATT-0').overall=100;
  const fresh=new TrainingService({buildings:f.service.buildings,now:()=>2000});
  assert.equal(fresh.cancel(restored,task.id).refundedGold,500);assert.equal(restored.gold,100000);
  const legacy=fixture(),free=legacy.start();delete legacy.account.training.tasks[free.id].costGold;
  assert.equal(legacy.service.cancel(legacy.account,free.id).refundedGold,0);assert.equal(legacy.account.gold,99500);
  const complete=fixture(),paid=complete.start();complete.setTime(paid.completesAt);
  assert.equal(complete.service.cancel(complete.account,paid.id).refundedGold,0);assert.equal(complete.account.gold,99500);
});

test("core growth raises card and match ratings; non-core growth still reaches the engine", () => {
  for(const pool of ['ATT','MID']) {
    const f=fixture(),task=f.start({pool,playerId:`${pool}-0`});f.setTime(task.completesAt);f.service.settle(f.account);
    const p=f.account.draft.roster.find(p=>p.id===`${pool}-0`),expected=pool==='MID'?71:70;
    assert.equal(p.overall,expected);assert.equal(p.effectiveOverall,expected);assert.equal(p.baseOverall,expected);
    assert.equal(createPlayerCardViewModel(p).overall,expected);
    const publicTask=f.service.publicState(f.account).tasks[0];assert.equal(publicTask.overallBefore,70);assert.equal(publicTask.overallAfter,expected);
    const seat=buildAccountMatchSeat(f.account,'expedition'),matchPlayer=seat.players.find(entry=>entry.id===p.id);
    assert.equal(matchPlayer.overall,expected);assert.equal(matchPlayer.attributes.passing,75);
    const snapshot=buildV2TeamSnapshots([{id:'isolated',players:[matchPlayer]}])[0].players[0];
    assert.equal(snapshot.displayAttributes.passing,75);assert.equal(snapshot.overall,expected);
  }
});

test("fractional core improvement accumulates across sessions and follows each position's core attributes", () => {
  const cases=[['MID','passing',3],['ATT','finishing',3],['DEF','tackling',3],['GK','goalkeeping',2]];
  for(const [pool,key,count] of cases) {
    const f=fixture();f.service.gains=()=>({[key]:1,aggression:4});
    for(let i=0;i<count;i++) {
      const task=f.start({pool,playerId:`${pool}-0`,requestId:`fraction-${pool}-${i}`});f.setTime(task.completesAt);f.service.settle(f.account);
      const p=f.account.draft.roster.find(p=>p.id===`${pool}-0`);
      assert.equal(p.overall,i+1<count?70:71);assert.equal(p.trainingBonuses[key],i+1);
    }
  }
});

test("training before or after enhancement produces the same growth and downgrade preserves it", () => {
  const enhance=new EnhancementService({economy:new EconomyService()}),cards=[];
  for(const first of [true,false]) {
    const f=fixture(),p=f.account.draft.roster.find(p=>p.id==='MID-0');
    if(first)enhance.applyLevel(p,3);
    const task=f.start({pool:'MID',playerId:p.id});f.setTime(task.completesAt);f.service.settle(f.account);
    if(!first)enhance.applyLevel(p,3);
    assert.equal(p.baseOverall,71);assert.equal(p.overall,74);assert.equal(p.attributes.passing,78);
    enhance.applyLevel(p,5);assert.equal(p.overall,78);assert.equal(p.attributes.passing,82);
    enhance.applyLevel(p,2);assert.equal(p.overall,73);assert.equal(p.attributes.passing,77);
    cards.push(p);
  }
  assert.deepEqual(cards[0].attributes,cards[1].attributes);assert.deepEqual(cards[0].trainingBonuses,cards[1].trainingBonuses);
});

test("enhancement during training cannot create phantom points at 99 and unused points are refunded", () => {
  const f=fixture(),p=f.account.draft.roster.find(p=>p.id==='MID-0');
  p.attributes.passing=92;const task=f.start({pool:'MID',playerId:p.id});
  new EnhancementService({economy:new EconomyService()}).applyLevel(p,4);
  f.setTime(task.completesAt);f.service.settle(f.account);
  const done=f.service.publicState(f.account).tasks[0];
  assert.equal(p.attributes.passing,99);assert.deepEqual(done.gains,{passing:2});assert.equal(p.trainingBonuses.passing,2);
  assert.equal(done.refundedGold,300);assert.equal(f.account.gold,99800);
  f.service.settle(f.account);assert.equal(f.account.gold,99800);
  new EnhancementService({economy:new EconomyService()}).applyLevel(p,0);assert.equal(p.attributes.passing,94);
});

test("old trained cards repair ratings and survive two reloads without extra growth", () => {
  for(const instance of [false,true]) {
    const f=fixture(),p=f.account.draft.roster.find(p=>p.id==='MID-0');
    p.trainingBonuses={passing:5};p.attributes.passing=75;p.effectiveAttributes={...p.attributes};p.overall=70;p.effectiveOverall=70;
    if(instance)p.cardInstanceId=p.id;
    let saved={accounts:{p:structuredClone(f.account)},world:null};
    const repository={load:()=>structuredClone(saved),save:value=>{saved=structuredClone(value);}};
    for(let i=0;i<2;i++) {
      const campaign=new CampaignService({catalog:f.catalog,repository,now:()=>1000});
      const restored=campaign.accounts.get('p').draft.roster.find(p=>p.id==='MID-0');
      assert.equal(restored.attributes.passing,75);assert.equal(restored.effectiveAttributes.passing,75);
      assert.equal(restored.overall,71);assert.equal(restored.baseOverall,71);assert.equal(restored.trainingBonuses.passing,5);
      assert.equal(restored.cardInstanceId,restored.id);
      campaign.save();
    }
  }
});

test("offline paid training raises overall on restart and is neither charged nor applied twice", () => {
  const f=fixture(),task=f.start({pool:'MID',playerId:'MID-0'});
  let saved={accounts:{p:f.saved()},world:null};
  const repository={load:()=>structuredClone(saved),save:value=>{saved=structuredClone(value);}};
  for(let i=0;i<2;i++) {
    const campaign=new CampaignService({catalog:f.catalog,repository,now:()=>task.completesAt+1000});
    const account=campaign.accounts.get('p');campaign.training.settle(account);
    const p=account.draft.roster.find(p=>p.id==='MID-0');
    assert.equal(p.overall,71);assert.equal(p.attributes.passing,75);
    assert.equal(account.gold,99500);assert.equal(account.goldLedger.filter(e=>e.reason==='player-training').length,1);
  }
});
