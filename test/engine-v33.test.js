import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3Match,simulateV3Match} from '../versus/v3/match-engine-v3.js';
import {advanceV2Match} from '../versus/v2/match-engine-v2.js';
import {createYdlLeagueV2Match,advanceYdlLeagueV2Match,publicYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';
import {V3_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {configurationDigest} from '../versus/v3/match-configuration.js';
import {makeAssessmentTeam} from '../scripts/engine-assessment-fixtures.mjs';
import {prepareDefensiveAssignments,buildUpPreference,tacticalProcessSummary} from '../versus/v3/tactical-execution.js';
import {conditionalPlanName} from '../versus/v3/conditional-tactics.js';
import {resolveCornerRoutine} from '../versus/v3/corner-routines.js';
import {tacticalExecutionFields,EXECUTION_GROUPS} from '../versus/public/tactical-execution.js';
import {changeTacticalPrinciple,tacticalPrincipleFields} from '../versus/public/tactical-principles.js';
import {tacticalExecutionReviewMarkup} from '../versus/public/tactical-execution-review.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
const json=value=>JSON.parse(JSON.stringify(value));
const plan={pressTrigger:'wide',pressAssignment:'screen',defensiveFocus:'creator',buildUpRoute:'left',buildUpOutlet:'pivot',pressureEscape:'switch',setPieceRoutine:'short',setPieceCommitment:'protect'};
const teams=()=>['A','B'].map(name=>makeAssessmentTeam(name,{boardLines:true,holdScorePlans:true,plan:name==='A'?plan:{}}));
const options={seed:'v33-reliable',weather:'sunny',referee:'standard'};
const digest=match=>configurationDigest({score:match.score,chains:match.chains,teams:match.teams,events:match.events,flow:match.flowState,random:match.randomState});

test('V3.3 advanced tactics reproduce after checkpoints and produce an observable report',()=>{
  const now=1234567890000,match=createYdlLeagueV2Match(teams(),{...options,parameters:V3_MATCH_PARAMETERS,now});
  advanceYdlLeagueV2Match(match,now+30000,{maximumChains:35});const resumed=json(match);
  advanceYdlLeagueV2Match(match,now+120001,{maximumChains:Infinity});
  while(!resumed.finished)advanceYdlLeagueV2Match(resumed,now+120001,{maximumChains:7});
  assert.equal(match.engineVersion,'3.3.0');assert.equal(digest(match),digest(resumed));
  assert.deepEqual(json(match.report),json(resumed.report));
  assert.equal(match.report.tacticalReview.chainModelVersion,'possession-chain-v3.3');
  const summary=match.report.tacticalExecution;
  assert.ok(summary.teams.some(team=>team.build.attempts>0));assert.ok(summary.teams.some(team=>team.press.attempts>0));
  assert.ok(match.events.some(event=>event.type==='tacticalAction'));
  assert.match(tacticalExecutionReviewMarkup(summary),/战术执行复盘/);
  const exposed=JSON.stringify(publicYdlLeagueV2Match(match));
  for(const key of ['flowState','simulationSeed','initialTeams','streams'])assert.equal(exposed.includes('"'+key+'"'),false);
});

test('press triggers require observable context and assign covering rather than all-out chasing',()=>{
  const match=createV3Match(teams(),options),flow=match.flowState;
  Object.assign(flow,{owner:1,zone:'buildUp:farLeft'});
  match.teams[0].pressTrigger='backPass';
  assert.equal(prepareDefensiveAssignments(match.teams,flow).trigger,null);
  flow.previousAction={teamIndex:1,type:'recycle'};
  const pressure=prepareDefensiveAssignments(match.teams,flow);
  assert.equal(pressure.trigger,'backPass');assert.equal(pressure.pressers.length,1);
  assert.ok(flow.defenseAssignments[0].some(entry=>entry.role==='cover'));
  assert.ok(flow.defenseAssignments[0].some(entry=>entry.role==='screen'));
  match.teams[0].pressTrigger='ownHalf';flow.zone='defensiveThird:center';
  assert.equal(prepareDefensiveAssignments(match.teams,flow).trigger,null);
});

test('targeted marking selects a current opponent and remains bounded by reach',()=>{
  const m=createV3Match(teams(),options);Object.assign(m.flowState,{owner:1,zone:'buildUp:center'});
  const result=prepareDefensiveAssignments(m.teams,m.flowState);
  assert.ok(result.mark);assert.ok(m.teams[1].players.some(p=>p.id===result.mark.targetId));
  for(const p of Object.keys(m.flowState.shapes[0]))m.flowState.shapes[0][p]={x:0,y:0};
  assert.equal(prepareDefensiveAssignments(m.teams,m.flowState).mark,null);
});

test('designated buildup rewards a reachable outlet and does not invent an absent pivot',()=>{
  const team={buildUpRoute:'left',buildUpOutlet:'pivot',players:[{id:'pivot',assignedRole:'DM',localPosition:{x:30,y:64}}]};
  const preferred=buildUpPreference(team,'buildUp:leftHalfSpace','defensiveThird:center',.5);
  assert.equal(preferred.receiverId,'pivot');assert.deepEqual(preferred.reasons,['preferredRoute','preferredOutlet']);
  assert.ok(preferred.bonus>buildUpPreference(team,'buildUp:farRight','defensiveThird:center',.5).bonus);
  team.players=[];assert.equal(buildUpPreference(team,'buildUp:leftHalfSpace','defensiveThird:center',.5).receiverId,null);
});

test('score plans obey their start time and persisted cooldown',()=>{
  const m=createV3Match(teams(),options),team=m.teams[0];team.tacticalPlans.leading.planAfter='75';
  m.minute=70;assert.equal(conditionalPlanName(m,team,'leading'),'opening');
  m.minute=76;assert.equal(conditionalPlanName(m,team,'leading'),'leading');
  team.activePlan='leading';team.lastPlanChangedAt=4500;m.flowState.elapsedSeconds=4550;
  assert.equal(conditionalPlanName(m,team,'trailing'),'leading');
  const restored=json(m);restored.flowState.elapsedSeconds=4621;
  assert.equal(conditionalPlanName(restored,restored.teams[0],'trailing'),'trailing');
});

test('legacy active substitution settings cannot replace tired or booked players, including resumed games',()=>{
  const seats=teams();seats[0].players.push(...seats[0].players.slice(1,4).map((p,i)=>({...structuredClone(p),id:'bench'+i,active:false})));
  for(const state of ['opening','leading','trailing'])Object.assign(seats[0].tacticalPlans[state],{rotationPolicy:'balanced',rotationAfter:'60',rotationFitness:'75'});
  const m=createV3Match(seats,options),team=m.teams[0];Object.assign(m.flowState,{period:1,periodElapsed:1200,elapsedSeconds:3900});m.minute=65;
  team.players[1].state.fitness=40;team.players[2].matchStats.yellowCards=1;
  // Simulate an old checkpoint with rotation fields already applied to the runtime team.
  Object.assign(team,{rotationPolicy:'balanced',rotationAfter:'60',rotationFitness:'85'});
  const resumed=json(m);
  for(const game of [m,resumed]){
    advanceV2Match(game,1);
    assert.equal(game.events.some(e=>e.type==='substitution'&&e.reason==='conditional'),false);
    for(const event of game.events.filter(e=>e.type==='substitution'))assert.ok(['injury','goalkeeperRedCard'].includes(event.reason));
  }
  for(const field of ['rotationPolicy','rotationAfter','rotationFitness']){
    assert.equal(EXECUTION_GROUPS[field],undefined);
    assert.equal(tacticalExecutionFields(team)[field],undefined);
  }
});

test('near, far and short corners allocate separate jobs, consume time and expose a clearance restart',()=>{
  for(const routine of ['near','far','short']) {
    const m=createV3Match(teams(),options);m.teams[0].setPieceRoutine=routine;m.activeFlowChain={};
    const records=[],paid=[],shots=[];
    const result=resolveCornerRoutine(m,0,'box:farLeft',{reserve:(seconds,type)=>{paid.push({seconds,type});return true;},
      event:(type,index,text,data)=>records.push({type,...data}),metric:()=>80,roll:()=>0,taker:m.teams[0].players[1],
      shot:(...args)=>{shots.push(args);return {outcome:'goal',xg:args[2]};}});
    const setup=records.find(e=>e.type==='cornerPlan');assert.ok(setup);
    const all=[...setup.targetIds,...setup.protectedIds,setup.secondBallId].filter(Boolean);assert.equal(new Set(all).size,all.length);
    assert.equal(setup.protectedIds.length,4);assert.ok(paid.reduce((s,a)=>s+a.seconds,0)>=18);
    assert.equal(shots.length,1);assert.equal(result.outcome,'goal');
    const failed=resolveCornerRoutine(m,0,'box:farLeft',{reserve:()=>true,event:()=>{},metric:()=>80,roll:()=>.999,taker:m.teams[0].players[1],shot:()=>assert.fail('lost corner cannot shoot')});
    assert.equal(failed.outcome,'cleared');assert.equal(m.activeFlowChain.setPieceRestart.owner,1);
  }
});

test('execution settings survive scheme save/share and reject unknown values atomically',()=>{
  const service=new YellowDogsLeagueService({statePath:null,backupDir:null,rng:()=>.37,now:()=>Date.parse('2026-11-13T03:00:00Z')});
  const user={id:'v33-save',nickname:'V33 Save'};service.beginDraft(user,'V33 FC');service.autoDraft(user);service.finishDraft(user);
  const team=service.accountTeam(user.id),positions=json(team.positionPresets);
  const body=()=>({starterIds:[...team.preferredStarterIds],positions:json(team.positions),positionPresets:json(team.positionPresets),formationLinePresets:json(team.formationLinePresets),tacticalPlans:json(team.tacticalPlans),lineupSchemeId:team.activeLineupSchemeId,lineupSchemeRevision:team.lineupSchemes.find(s=>s.id===team.activeLineupSchemeId).revision});
  const request=body();for(const [key,value] of Object.entries(plan))request.tacticalPlans.opening=changeTacticalPrinciple(request.tacticalPlans.opening,key,value);
  service.saveTeam(user,request,{compact:true});const shared=service.exportLineupScheme(user);
  const imported=service.importLineupScheme(user,shared.code,{...body(),compact:true});
  for(const [key,value] of Object.entries(plan))assert.equal(imported.team.tacticalPlans.opening[key],value);
  assert.deepEqual(json(team.positionPresets),positions);
  const state=JSON.stringify(service.state),bad=body();bad.tacticalPlans.opening.pressTrigger='unsupported';
  assert.throws(()=>service.saveTeam(user,bad,{compact:true}),/压迫触发/);assert.equal(JSON.stringify(service.state),state);
  assert.equal(tacticalPrincipleFields({style:'possession',tactic:'balanced'}).pressTrigger,undefined);
  assert.equal(Object.keys(tacticalExecutionFields()).length,Object.keys(EXECUTION_GROUPS).length);
});

test('full mirrors keep new execution settings private in live and finished views',()=>{
  const now=1234567890000,service=new YellowDogsLeagueService({statePath:null,backupDir:null,now:()=>now,rng:()=>.37});
  const match=createYdlLeagueV2Match(teams(),{...options,now});
  advanceYdlLeagueV2Match(match,now+120001,{maximumChains:Infinity});
  match.events.push({id:'private-corner',type:'cornerPlan',teamIndex:1,minute:89,text:'secret',cornerRoutine:'far',protectedIds:['B3']},
    {id:'private-shot',type:'save',teamIndex:0,attackingTeamIndex:1,minute:89,text:'save',cornerRoutine:'far'});
  const exposed=service.broadcastView({code:'PRIVATE-V33',ownerId:'test',aiTraining:true,mirrorKind:'full',match,spectators:{}}).match;
  for(const key of Object.keys(EXECUTION_GROUPS))assert.equal(exposed.teams[1][key],undefined);
  assert.equal(exposed.report.tacticalExecution,undefined);
  assert.equal(exposed.events.find(e=>e.id==='private-corner').protectedIds,undefined);
  assert.equal(exposed.events.find(e=>e.id==='private-shot').cornerRoutine,undefined);
  assert.equal(exposed.teams[0].pressTrigger,match.teams[0].pressTrigger);
});
