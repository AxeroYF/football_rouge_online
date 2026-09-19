import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repairTacticsLineups } from "../shared/config/tactics-repair.mjs";
import { normalizeTacticsSquads } from "../tactics-page.js";
import { buildAccountMatchSeat } from "../engine/campaign-match-engine.mjs";
import { CampaignService } from "../campaign-service.mjs";

const presets = ["position1", "position2", "position3"];
const plans = ["opening", "leading", "trailing"];
const roles = ["GK", "LB", "CB", "CB", "RB", "LM", "DM", "AM", "RM", "ST", "ST"];
const coords = [[50,90],[17,69],[39,70],[65,68],[85,69],[18,46],[43,46],[59,39],[82,45],[38,19],[66,22]];
const pool = role => role === "GK" ? "GK" : ["LB","CB","RB"].includes(role) ? "DEF" : role === "ST" ? "ATT" : "MID";
function fixture() {
  const roster = [], assignments = {}, squads = {};
  for (const squadId of ["expedition", "garrison"]) {
    const starters = roles.map((role, index) => {
      const id = `${squadId}-${index}`;
      roster.push({ id, name:id, role, pool:pool(role), overall:80, grade:"B" }); assignments[id] = squadId;
      return id;
    });
    const positionPresets = Object.fromEntries(presets.map((preset,p) => [preset, Object.fromEntries(starters.map((id,i) => [id,{x:coords[i][0]+p,y:coords[i][1]-p}]))]));
    const formationLines = { attack:21,midfield:45,defense:69,goalkeeper:90 };
    const tacticalPlans = Object.fromEntries(plans.map((plan,p) => [plan, {tactic:"balanced",style:"possession",positionPreset:presets[p],tacticalDimensions:{tempo:37+p},playerDuties:{[starters[6]]:"anchor"}}]));
    squads[squadId] = { formation:"4-4-2",starters,bench:[],positions:structuredClone(positionPresets.position1),formationLines,
      planSnapshots:{ ...structuredClone(tacticalPlans), __s4V2:{starters:[...starters],captainId:starters[6],positionPresets,
        formationLinePresets:Object.fromEntries(presets.map(preset => [preset,structuredClone(formationLines)])), tacticalPlans,activePositionPreset:"position2",fitnessThreshold:65} } };
  }
  return { id:"lineup-repair",nickname:"阵型补位",setupComplete:true,draft:{teamName:"补位测试",roster,offer:[]},playerSquads:{schemaVersion:2,assignments},
    tactics:{schemaVersion:2,activeSquadId:"garrison",squads,...structuredClone(squads.expedition)} };
}
function reserve(account, squadId, role, suffix = role, extras = {}) {
  const id = `bench-${squadId}-${suffix}`;
  account.draft.roster.push({ id,name:id,role,pool:pool(role),overall:90,grade:"S",...extras });
  account.playerSquads.assignments[id] = squadId;
  return id;
}
function assertSlots(before, after, changes = {}) {
  assert.deepEqual(after.starters, before.starters.map(id => changes[id] ?? id));
  assert.equal(after.formation,before.formation);
  assert.deepEqual(after.formationLines,before.formationLines);
  const b = before.planSnapshots.__s4V2, a = after.planSnapshots.__s4V2;
  assert.deepEqual(a.starters, after.starters);
  assert.equal(a.captainId,changes[b.captainId] ?? b.captainId);
  assert.deepEqual(a.formationLinePresets,b.formationLinePresets);
  assert.equal(a.activePositionPreset,b.activePositionPreset);
  for (const oldId of before.starters) {
    const id = changes[oldId] ?? oldId;
    assert.deepEqual(after.positions[id],before.positions[oldId]);
    for (const preset of presets) assert.deepEqual(a.positionPresets[preset][id],b.positionPresets[preset][oldId]);
    for (const plan of plans) {
      assert.deepEqual(a.tacticalPlans[plan].playerDuties[id],b.tacticalPlans[plan].playerDuties[oldId]);
      assert.deepEqual(after.planSnapshots[plan].playerDuties[id],before.planSnapshots[plan].playerDuties[oldId]);
    }
  }
  for (const plan of plans) assert.deepEqual(a.tacticalPlans[plan].tacticalDimensions,b.tacticalPlans[plan].tacticalDimensions);
  assert.equal(after.bench.some(id => after.starters.includes(id)),false);
}

for (const squadId of ["expedition","garrison"]) test(`${squadId}: moving a starter persists only a slot replacement and keeps the other formation`, () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ydl-tactics-repair-"));
  try {
    const dataPath = path.join(directory,"campaign.json"), account = fixture();
    const substitute = reserve(account,squadId,"DM");
    const before = structuredClone(account.tactics.squads[squadId]);
    const otherId = squadId === "expedition" ? "garrison" : "expedition";
    const other = structuredClone(account.tactics.squads[otherId]);
    const service = new CampaignService({dataPath,catalog:account.draft.roster});
    service.accounts.set(account.id,account);
    const state = service.assignPlayerSquad(account,before.starters[6],otherId);
    assertSlots(before,state.tactics.squads[squadId],{[before.starters[6]]:substitute});
    assertSlots(other,state.tactics.squads[otherId]);
    assert.equal(state.playerSquads.assignments[before.starters[6]],otherId);
    assert.deepEqual(state.tactics.starters,state.tactics.squads.expedition.starters);
    const persisted = JSON.parse(readFileSync(dataPath,"utf8")).accounts[account.id];
    assert.deepEqual(persisted.tactics,state.tactics);
    const board = normalizeTacticsSquads(state.tactics,account.draft.roster,state.playerSquads);
    assert.deepEqual(board.squads[squadId].starters,state.tactics.squads[squadId].starters);
    for (const preset of presets) for (const id of board.squads[squadId].starters) assert.deepEqual(board.squads[squadId].positionPresets[preset][id],state.tactics.squads[squadId].planSnapshots.__s4V2.positionPresets[preset][id]);
    assert.deepEqual(service.state(account).tactics,state.tactics);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test("multiple vacancies use a joint position fit without shifting retained players", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.expedition);
  const secondary = reserve(account,"expedition","ST","secondary",{secondaryRole:"AM",overall:99});
  const midfielder = reserve(account,"expedition","AM","primary",{secondaryRole:"DM",overall:81});
  reserve(account,"expedition","DM","training",{training:{taskId:"t"},overall:99});
  reserve(account,"expedition","DM","injured",{state:{injuryMatches:2},overall:99});
  for (const index of [6,7]) account.playerSquads.assignments[before.starters[index]] = "garrison";
  const repaired = repairTacticsLineups(account.tactics,account.draft.roster,account.playerSquads);
  assertSlots(before,repaired.squads.expedition,{[before.starters[6]]:midfielder,[before.starters[7]]:secondary});
  assert.equal(new Set(repaired.squads.expedition.starters).size,11);
});

test("a vacant keeper slot survives serialization and is filled later at its original coordinates", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.garrison);
  const missing = before.starters[0];
  account.draft.roster = account.draft.roster.filter(player => player.id !== missing);
  reserve(account,"garrison","ST","outfielder");
  const first = repairTacticsLineups(account.tactics,account.draft.roster,account.playerSquads);
  const incomplete = first.squads.garrison;
  assert.deepEqual(incomplete.starters,before.starters.slice(1));
  assert.equal(incomplete.vacantSlots.length,1);
  assert.equal(incomplete.vacantSlots[0].pool,"GK");
  assert.equal(JSON.stringify(incomplete).includes(missing),false);
  assert.deepEqual(repairTacticsLineups(first,account.draft.roster,account.playerSquads),first);
  const board = normalizeTacticsSquads(first,account.draft.roster,account.playerSquads);
  assert.deepEqual(board.squads.garrison.starters,incomplete.starters);
  assert.equal(board.squads.garrison.vacantSlots.length,1);
  assert.equal(board.autoAssignedPlayerIds.length,0);
  assert.throws(() => buildAccountMatchSeat({...account,tactics:first},"garrison"),/首发阵容有空缺/);
  const substitute = reserve(account,"garrison","GK");
  const repaired = repairTacticsLineups(JSON.parse(JSON.stringify(first)),account.draft.roster,account.playerSquads);
  assertSlots(before,repaired.squads.garrison,{[missing]:substitute});
  assert.equal(repaired.squads.garrison.vacantSlots,undefined);
});

test("delayed replacements retain each slot index across several missing players", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.expedition);
  for (const index of [2,6,10]) account.playerSquads.assignments[before.starters[index]] = "garrison";
  let repaired = repairTacticsLineups(account.tactics,account.draft.roster,account.playerSquads);
  assert.deepEqual(repaired.squads.expedition.vacantSlots.map(slot => slot.index),[2,6,10]);
  const defender = reserve(account,"expedition","CB");
  repaired = repairTacticsLineups(repaired,account.draft.roster,account.playerSquads);
  assert.equal(repaired.squads.expedition.starters[2],defender);
  assert.deepEqual(repaired.squads.expedition.vacantSlots.map(slot => slot.index),[6,10]);
  const midfielder = reserve(account,"expedition","DM"), forward = reserve(account,"expedition","ST");
  repaired = repairTacticsLineups(repaired,account.draft.roster,account.playerSquads);
  assertSlots(before,repaired.squads.expedition,{[before.starters[2]]:defender,[before.starters[6]]:midfielder,[before.starters[10]]:forward});
});

test("old saved lineups are repaired and persisted by the backend state endpoint", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.expedition);
  const substitute = reserve(account,"expedition","DM");
  account.draft.roster = account.draft.roster.filter(player => player.id !== before.starters[6]);
  const service = new CampaignService({catalog:account.draft.roster, pauseEconomyWhenStopped:false, now:()=>1000});
  service.accounts.set(account.id,account);
  let saves = 0; const persist = service.save.bind(service); service.save = () => { saves++; return persist(); };
  const state = service.state(account);
  assertSlots(before,state.tactics.squads.expedition,{[before.starters[6]]:substitute});
  assert.ok(saves > 0);
  const count = saves; service.state(account); assert.equal(saves,count);
});

for (const squadId of ["expedition","garrison"]) test(`${squadId}: matches use repaired slots without mutating saved tactics or previous match seats`, () => {
  const account = fixture(), before = structuredClone(account.tactics.squads[squadId]);
  const previousSeat = buildAccountMatchSeat(account,squadId), snapshot = structuredClone(previousSeat);
  const substitute = reserve(account,squadId,"DM");
  account.playerSquads.assignments[before.starters[6]] = squadId === "expedition" ? "garrison" : "expedition";
  const saved = structuredClone(account);
  const seat = buildAccountMatchSeat(account,squadId);
  assert.deepEqual(seat.players.map(player => player.id),before.starters.map(id => id === before.starters[6] ? substitute : id));
  assert.equal(seat.captainId,substitute);
  for (const preset of presets) assert.deepEqual(seat.positionPresets[preset][substitute],before.planSnapshots.__s4V2.positionPresets[preset][before.starters[6]]);
  assert.deepEqual(account,saved);
  assert.deepEqual(previousSeat,snapshot);
});

test("saving an outdated lineup repairs its missing starter instead of resetting the formation", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.expedition);
  const substitute = reserve(account,"expedition","DM");
  const submitted = structuredClone(account.tactics);
  account.playerSquads.assignments[before.starters[6]] = "garrison";
  const service = new CampaignService({catalog:account.draft.roster, pauseEconomyWhenStopped:false, now:()=>1000});
  service.accounts.set(account.id,account);
  const state = service.saveTactics(account,submitted);
  assertSlots(before,state.tactics.squads.expedition,{[before.starters[6]]:substitute});
});

test("existing training starters and bench departures do not change saved starting positions", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.expedition);
  account.draft.roster.find(player => player.id === before.starters[6]).training = {taskId:"training"};
  const bench = reserve(account,"expedition","DM");
  account.tactics.squads.expedition.bench = [bench];
  account.playerSquads.assignments[bench] = "garrison";
  const repaired = repairTacticsLineups(account.tactics,account.draft.roster,account.playerSquads);
  assertSlots(before,repaired.squads.expedition);
  assert.equal(repaired.squads.expedition.bench.includes(bench),false);
});

test("a stronger duplicate in the other squad does not drag the formation across squads", () => {
  const account = fixture(), before = structuredClone(account.tactics.squads.expedition);
  const old = account.draft.roster.find(player => player.id === before.starters[6]);
  old.cardDefinitionId = "duplicate-family";
  const copy = reserve(account,"garrison","DM","duplicate",{cardDefinitionId:"duplicate-family",upgradeLevel:3});
  const substitute = reserve(account,"expedition","DM");
  const repaired = repairTacticsLineups(account.tactics,account.draft.roster,account.playerSquads);
  assertSlots(before,repaired.squads.expedition,{[old.id]:substitute});
  assert.equal(repaired.squads.expedition.starters.includes(copy),false);
});
