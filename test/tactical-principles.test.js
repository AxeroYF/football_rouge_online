import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyPrinciplePreset, changeTacticalPrinciple, compilePrincipleDimensions, tacticalPrincipleFields,
  TACTICAL_MODEL_VERSION, tacticalStyleMatches,
} from "../versus/public/tactical-principles.js";
import { tacticalDimensionsForPlan, createV2Match, advanceV2Match } from "../versus/v2/match-engine-v2.js";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const plain = value => JSON.parse(JSON.stringify(value));
const base = () => applyPrinciplePreset({ tactic:"balanced", style:"possession", positionPreset:"position1", playerDuties:{ sample:"anchor" } }, "control");

test("changing mentality preserves all independent principles and explicit fine tuning", () => {
  const plan = base();
  plan.dimensionOverrides = { tempo:37, pressing:73 };
  const before = compilePrincipleDimensions(plan);
  const next = changeTacticalPrinciple(plan, "tactic", "positive");
  const after = compilePrincipleDimensions(next);
  assert.equal(after.mentality, 66);
  for (const key of Object.keys(before).filter(key => key !== "mentality")) assert.equal(after[key], before[key], key);
  assert.deepEqual(next.playerDuties, plan.playerDuties);
  assert.deepEqual(tacticalDimensionsForPlan(next), after);
});

test("a principle resets only its owned overrides; detail adjustments and overrides apply once", () => {
  const plan = base();
  plan.dimensionOverrides = { tempo:11, directness:13, pressing:77, counterAttack:83 };
  plan.inPossessionDetails = { chanceCreation:"patient" };
  const next = changeTacticalPrinciple(plan, "possessionStyle", "vertical");
  assert.deepEqual(next.dimensionOverrides, { pressing:77, counterAttack:83 });
  const dimensions = compilePrincipleDimensions(next);
  assert.equal(dimensions.tempo, 54);
  assert.equal(dimensions.directness, 65);
  assert.equal(dimensions.pressing, 77);
  next.dimensionOverrides.tempo = 62;
  assert.equal(compilePrincipleDimensions(next).tempo, 62);
});

test("low block risk limits are explicit and combined conditional traits use each principle", () => {
  const positive = changeTacticalPrinciple(base(), "tactic", "positive");
  const low = changeTacticalPrinciple(positive, "defensiveBlock", "lowBlock");
  assert.equal(low.tactic, "balanced");
  assert.equal(compilePrincipleDimensions(low).mentality, 50);
  assert.equal(tacticalStyleMatches(low, "lowBlock"), true);
  assert.equal(tacticalStyleMatches(low, "possession"), true);
  assert.equal(tacticalStyleMatches(low, "highPress"), false);
  assert.deepEqual(tacticalPrincipleFields({ tactic:"positive", style:"wingPlay" }), {});
  assert.throws(() => tacticalPrincipleFields({ tacticalModelVersion:"future-unknown" }), /版本/);
});

function fixture(options = {}) {
  const service = new YellowDogsLeagueService({ statePath:null, rng:() => .37, now:() => Date.parse("2026-11-10T10:00:00+08:00"), ...options });
  const user = { id:"principles-manager", nickname:"Principles Manager" };
  service.beginDraft(user, "Principles FC"); service.autoDraft(user); service.finishDraft(user);
  const team = service.accountTeam(user.id);
  const body = () => ({ starterIds:[...team.preferredStarterIds], positions:plain(team.positions), positionPresets:plain(team.positionPresets),
    formationLinePresets:plain(team.formationLinePresets), tacticalPlans:plain(team.tacticalPlans),
    lineupSchemeId:team.activeLineupSchemeId, lineupSchemeRevision:team.lineupSchemes.find(scheme => scheme.id === team.activeLineupSchemeId).revision });
  return { service, user, team, body };
}

test("principles survive save, scheme snapshots, shares, previews and actual match input without moving players", () => {
  const { service, user, team, body } = fixture();
  const request = body();
  const positionsBefore = plain(team.positionPresets), startersBefore = [...team.preferredStarterIds];
  request.tacticalPlans.opening = applyPrinciplePreset(request.tacticalPlans.opening, "press");
  request.tacticalPlans.opening = changeTacticalPrinciple(request.tacticalPlans.opening, "possessionStyle", "possession");
  request.tacticalPlans.opening = changeTacticalPrinciple(request.tacticalPlans.opening, "transitionStyle", "counterAttack");
  request.tacticalPlans.opening.dimensionOverrides.directness = 34;
  request.tacticalPlans.opening = changeTacticalPrinciple(request.tacticalPlans.opening, "restDefense", "conservative");
  request.tacticalPlans.opening = changeTacticalPrinciple(request.tacticalPlans.opening, "clockManagement", "slow");
  const receipt = service.saveTeam(user, request, { compact:true });
  const stored = receipt.team.tacticalPlans.opening;
  assert.equal(stored.tacticalModelVersion, TACTICAL_MODEL_VERSION);
  assert.equal(stored.possessionStyle, "possession");
  assert.equal(stored.defensiveBlock, "highPress");
  assert.equal(stored.transitionStyle, "counterAttack");
  assert.equal(stored.dimensionOverrides.directness, 34);
  assert.equal(stored.lossTransition, "counterPress");
  assert.equal(stored.restDefense, "conservative");
  assert.equal(stored.clockManagement, "slow");
  assert.deepEqual(plain(team.positionPresets), positionsBefore);
  assert.deepEqual([...team.preferredStarterIds], startersBefore);
  const scheme = team.lineupSchemes.find(scheme => scheme.id === team.activeLineupSchemeId);
  assert.equal(scheme.tacticalPlans.opening.tacticalModelVersion, TACTICAL_MODEL_VERSION);
  const input = service.aiTrainingPlayerSeat(team);
  assert.equal(input.tacticalPlans.opening.possessionStyle, "possession");
  assert.equal(input.tacticalPlans.opening.restDefense, "conservative");
  const match = createV2Match([input, { ...plain(input), name:"Opponent" }], { rng:() => .5, possessionChains:2 });
  assert.equal(match.teams[0].tacticalDimensions.directness, 34);
  assert.equal(match.teams[0].tacticalDimensions.pressing, 82);
  assert.equal(match.teams[0].possessionStyle, "possession");
  const preview = service.tacticalShapePreview(user, { ...body(), planState:"opening" });
  assert.equal(preview.dimensions.directness, 34);
  assert.equal(preview.dimensions.pressing, 82);
  const share = service.exportLineupScheme(user);
  assert.match(share.code, /^\d{9}$/);
  const imported = service.importLineupScheme(user, share.code, { ...body(), compact:true });
  assert.equal(imported.team.tacticalPlans.opening.tacticalModelVersion, TACTICAL_MODEL_VERSION);
  assert.equal(imported.team.tacticalPlans.opening.dimensionOverrides.directness, 34);
  assert.equal(imported.team.tacticalPlans.opening.lossTransition, "counterPress");
  assert.equal(imported.team.tacticalPlans.opening.restDefense, "conservative");
  assert.equal(imported.team.tacticalPlans.opening.clockManagement, "slow");
  advanceV2Match(match, 1);
  match.teams[0].tacticalPlans.opening.dimensionOverrides.directness = 81;
  advanceV2Match(match, 2);
  assert.equal(match.teams[0].tacticalDimensions.directness, 81, "same-name plan revisions must be applied");
});

test("outlook uses the actual lineup, is read-only, changes with tactics and rejects foreign players", () => {
  const { service, user, team, body } = fixture();
  const before = JSON.stringify(service.state);
  const original = service.tacticalOutlook(user, { ...body(), planState:"opening" });
  assert.equal(JSON.stringify(service.state), before);
  assert.equal(original.valid, true);
  assert.equal(original.axes.length, 6);
  original.axes.forEach(axis => assert.ok(Number.isFinite(axis.value) && axis.value > 0 && axis.value <= 100));
  const request = body();
  request.tacticalPlans.opening = applyPrinciplePreset(request.tacticalPlans.opening, "press");
  const pressed = service.tacticalOutlook(user, request);
  assert.ok(pressed.axes.find(axis => axis.id === "press").value > original.axes.find(axis => axis.id === "press").value);
  assert.equal(JSON.stringify(service.state), before);
  assert.throws(() => service.tacticalOutlook(user, { starterIds:[...team.preferredStarterIds.slice(1), "foreign-id"] }), /完整|首发/);
});

test("legacy top-level style and mentality saves retain their previous API behavior", () => {
  const { service, user, team } = fixture();
  // Simulate an existing pre-principles team; new drafts now start with principles.
  for (const key of Object.keys(team.tacticalPlans)) team.tacticalPlans[key] = {tactic:"balanced",style:"possession",positionPreset:team.tacticalPlans[key].positionPreset};
  const positions = plain(team.positions);
  service.saveTeam(user, { starterIds:[...team.preferredStarterIds], positions, tactic:"defensive", style:"longBall" }, { compact:true });
  assert.equal(team.tactic, "defensive");
  assert.equal(team.style, "longBall");
  assert.equal(team.tacticalPlans.opening.tactic, "defensive");
  assert.equal(team.tacticalPlans.opening.tacticalModelVersion, undefined);
  assert.deepEqual(plain(team.positions), positions);
});

test("a cold service reload preserves principle choices, overrides and all three position presets", t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "yffm1-tactics-"));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + "yffm1-tactics-"));
    rmSync(directory, { recursive:true, force:true });
  });
  const statePath = path.join(directory, "league.json");
  const { service, user, team, body } = fixture({ statePath, backupDir:path.join(directory, "backups") });
  const request = body();
  request.tacticalPlans.opening = applyPrinciplePreset(request.tacticalPlans.opening, "wing");
  request.tacticalPlans.opening.dimensionOverrides.attackingWidth = 76;
  const positions = plain(team.positionPresets);
  service.saveTeam(user, request, { compact:true });
  const restored = new YellowDogsLeagueService({ statePath, backupDir:path.join(directory, "backups"), now:service.now }).accountTeam(user.id);
  assert.equal(restored.tacticalPlans.opening.possessionStyle, "wingPlay");
  assert.equal(restored.tacticalPlans.opening.dimensionOverrides.attackingWidth, 76);
  assert.equal(restored.tacticalPlans.opening.tacticalModelVersion, TACTICAL_MODEL_VERSION);
  assert.deepEqual(plain(restored.positionPresets), positions);
});
