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
import { compileLiveSeat, createLiveV4Match, publicLiveV4Match } from "../versus/v4-adapter/live-match.js";
import { dutyFor } from "../versus/v4/execution.js";
import {movementFrames,shapeScenarios} from "../versus/public/shape-preview-player.js";
import {captureMovement,compareMovements} from "../versus/public/shape-movement.js";

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

test("the board freezes all five leading-plan paths and compares an unsaved position edit by player ID", () => {
  const {service,user,body}=fixture();
  const draft={...body(),planState:"leading",positionPresetOverrides:{position2:true,position3:true}};
  const baseline=service.tacticalOutlook(user,{...draft,captureMovement:true}).movements;
  assert.deepEqual(Object.keys(baseline).sort(),Object.keys(shapeScenarios).sort());
  for(const scenario of Object.keys(shapeScenarios)){
    const current=captureMovement(service.tacticalShapePreview(user,{...draft,scenario}));
    assert.deepEqual(baseline[scenario],current);
    assert.deepEqual(new Set(current.players.map(p=>p.id)),new Set(draft.starterIds));
    assert.ok(compareMovements(baseline[scenario],current).players.every(p=>p.peakGap===0));
  }
  const player=draft.starterIds[3],position=draft.positionPresets.position2[player];
  position.x+=position.x<50?6:-6;
  const current=captureMovement(service.tacticalShapePreview(user,{...draft,scenario:"defense"}));
  assert.ok(compareMovements(baseline.defense,current).players.find(p=>p.id===player).start.distance>1);
  assert.equal(service.tacticalOutlook(user,draft).movements,undefined);
});

test("V4 board previews run four reproducible situations on an unsaved eleven without modifying the team", () => {
  const { service, user, team, body } = fixture();
  const before = plain(team), request = body();
  for (const scenario of ["attack", "left", "loss", "defense"]) {
    const input = { ...request, scenario, planState:"trailing" };
    const preview = service.tacticalShapePreview(user, input);
    assert.match(preview.engineVersion, /^4\./);
    assert.equal(preview.scoreState, "trailing");
    assert.equal(preview.roster.length, 22);
    const keys = new Set(preview.roster.map(p => p.key));
    const first = preview.frames[0], last = preview.frames.at(-1);
    assert.equal(first.owner, ["defense", "loss"].includes(scenario) ? 1 : 0);
    assert.equal(first.ball.x < 50, scenario === "left");
    assert.equal(Boolean(first.transition), scenario === "loss");
    assert.equal(last.time, 12);
    assert.notDeepEqual(first.ball, last.ball);
    for (const frame of preview.frames) {
      assert.equal(frame.players.length, 22);
      for (const p of frame.players) {
        assert.ok(keys.has(p.key) && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100);
        if (p.key.startsWith("0:")) {
          assert.ok(preview.tasks[p.task].reason && Number.isFinite(p.target.x));
          assert.ok(p.partners.every(key => keys.has(key)));
        }
      }
    }
    if (scenario === "loss") assert.deepEqual(service.tacticalShapePreview(user, input), preview);
  }
  assert.throws(() => service.tacticalShapePreview(user, { ...request, scenario:"unknown" }), /场景/);
  assert.deepEqual(plain(team), before);
});

test("editor, preview and played matches resolve the same role across preset lines and clear a saved duty", () => {
  const { service, user, team, body } = fixture();
  const request = body(), ids = request.starterIds, playerId = ids[5];
  const coordinates = [[50,90],[12,68],[40,68],[60,68],[88,68],[50,52],[35,47],[70,43],[10,20],[50,20],[90,20]];
  const positions = Object.fromEntries(ids.map((id,i) => [id, { x:coordinates[i][0], y:coordinates[i][1] }]));
  request.positions = positions;
  request.positionPresetOverrides = { position2:true, position3:true };
  for (const key of ["position1","position2","position3"]) {
    request.positionPresets[key] = plain(positions);
    request.formationLinePresets[key] = { attack:20, midfield:key === "position2" ? 55 : 44, defense:68, goalkeeper:90 };
  }
  request.tacticalPlans.opening.playerDuties = { [playerId]:"anchor" };
  request.tacticalPlans.leading.playerDuties = { [playerId]:"advancedPlaymaker" };
  service.saveTeam(user, request, { compact:true });
  const saved = body();
  for (const [planState,mode,role,duty] of [["opening","normal","DM","anchor"],["leading","leading","AM","advancedPlaymaker"]]) {
    const view = service.tacticalShapePreview(user, { ...saved, planState }).roster.find(p => p.side === 0 && p.id === playerId);
    const player = compileLiveSeat(service.aiTrainingPlayerSeat(team),0).players.find(p => p.id === playerId);
    assert.equal(view.role, role);
    assert.equal(view.duty, duty);
    assert.equal(player.sourceRolePlans[mode], role);
    assert.equal(dutyFor({ activePlans:[mode] }, { ...player, side:0 }), duty);
  }
  const seat = service.aiTrainingPlayerSeat(team);
  const match = createLiveV4Match([seat, plain(seat)], { seed:"board-readout", duration:60 });
  const display = publicLiveV4Match(match, match.startedAt, 0, false);
  const ownRow = display.teams[0].players.find(p => p.id === playerId);
  assert.equal(ownRow.assignedRole, "DM");
  assert.equal(ownRow.tacticalDuty, "anchor");
  assert.equal(display.teams[1].players.find(p => p.id === playerId).tacticalDuty, undefined);

  saved.tacticalPlans.leading.playerDuties = {};
  assert.equal(service.tacticalShapePreview(user, { ...saved, planState:"leading" }).roster.find(p => !p.side && p.id === playerId).duty, null);
  service.saveTeam(user, saved, { compact:true });
  const player = compileLiveSeat(service.aiTrainingPlayerSeat(team),0).players.find(p => p.id === playerId);
  assert.equal(dutyFor({ activePlans:["leading"] }, { ...player, side:0 }), null);
  assert.equal(player.dutyPlans.normal, "anchor");
});

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

test("each V4 outlook points to reproducible frames on its own preset; editing leading leaves opening unchanged", () => {
  const { service, user, body } = fixture();
  const request = body();
  let opening;
  for (const [planState,scoreState,minute] of [["opening","level",25],["leading","leading",70],["trailing","trailing",70]]) {
    const payload = { ...request, planState };
    const report = service.tacticalOutlook(user,payload);
    if(planState==="opening") opening=report;
    assert.match(report.engineVersion,/^4\./);
    assert.equal(report.planState,planState);
    assert.equal(report.scoreState,scoreState);
    assert.equal(report.assumptions.minute,minute);
    assert.deepEqual(report.diagnostics.map(row=>row.id),["pass","press","overlap","loss"]);
    for(const row of report.diagnostics){
      if(row.status==="unobserved"){
        assert.equal(row.samples,0);
        assert.equal(row.evidence,undefined);
        continue;
      }
      assert.ok(row.samples>=row.flagged && row.samples>0);
      assert.equal(Object.values(row.issueCounts).reduce((sum,n)=>sum+n,0),row.flagged);
      const clip=service.tacticalShapePreview(user,{...payload,scenario:row.evidence.scenario});
      assert.equal(clip.clipId,row.evidence.clipId);
      const frame=clip.frames.find(f=>f.time===row.evidence.time);
      const player=clip.roster.find(p=>p.key===row.evidence.playerKey);
      assert.ok(frame.players.some(p=>p.key===player.key&&p.active));
      assert.equal(player.side,0);
    }
    assert.ok(report.diagnostics.find(row=>row.id==="loss").samples>0);
  }
  request.tacticalPlans.leading=applyPrinciplePreset(request.tacticalPlans.leading,"press");
  assert.deepEqual(service.tacticalOutlook(user,{...request,planState:"opening"}),opening);
  const invalid={...request,positionPresets:plain(request.positionPresets)};
  for(const point of Object.values(invalid.positionPresets.position2)) point.y=90;
  assert.equal(service.tacticalOutlook(user,{...invalid,planState:"leading"}).valid,false);
  assert.deepEqual(service.tacticalOutlook(user,{...invalid,planState:"opening"}),opening);
});

test('board movement shows a short coherent phase and can focus a later diagnostic frame',()=>{
  const {service,user,body}=fixture();
  for(const scenario of Object.keys(shapeScenarios)){
    const clip=service.tacticalShapePreview(user,{...body(),scenario,planState:'leading'});
    const start=clip.frames[0];
    if(scenario==='gain'){assert.equal(start.owner,0);assert.ok(start.transitionId);}
    const windows=[movementFrames(clip),movementFrames(clip,9.6)];
    for(const frames of windows){
      assert.ok(frames.at(-1).time-frames[0].time<=4.00001);
      assert.ok(frames.every(f=>f.owner===frames[0].owner&&f.transitionId===frames[0].transitionId));
    }
    assert.ok(windows[0].length>1,scenario);
    assert.ok(windows[1].some(f=>f.time===9.6));
  }
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
