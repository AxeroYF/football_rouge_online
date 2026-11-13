import {isV31,isV32} from './model-config.js';

// This registers existing rules; V3.1 deliberately does not change their values.
export const ENGINE_RULE_OWNERSHIP=Object.freeze([
  {id:'score-state',owner:'stage-probability',source:'state',effect:'leadingControl/trailingUrgency/levelDecisiveness'},
  {id:'leading-shot-quality',owner:'shot-xg',source:'state.leadingShotXgPenaltyPerGoal',effect:'non-penalty xG multiplier'},
  {id:'fatigue',owner:'player-state',source:'state.fatiguePerChain',effect:'fitness per chain; metrics apply fitness once'},
  {id:'rest-defense',owner:'dynamic-shape',source:'dynamicShape.restDefense',effect:'minimum eligible protected players'},
  {id:'structure',owner:'spatial-and-stage',source:'spatial.midfieldStructure/backlineExposure',effect:'coverage and structural penalties'},
  {id:'duration',owner:'possession-statistics',source:'chain.possessionDuration',effect:'duration weights; fixed 180 regulation chains'},
]);
const bucket=()=>({attempts:0,expected:0,actual:0,brierSum:0});
function observe(target,probability,actual) {
  target.attempts++;target.expected+=probability;target.actual+=Number(actual);
  target.brierSum+=(probability-Number(actual))**2;
}
export function initializeDiagnostics(match,options={}) {
  if(!isV31(match.parameters)&&!options.diagnosticBaseline)return;
  match.diagnostics={version:1,traceEnabled:Boolean(options.diagnosticTrace),traceLimit:16,
    chains:0,teams:[0,1].map(()=>({stages:{},shots:{},routes:{},plans:[]})),commands:[]};
}
export function wantsDecisionTrace(match) {
  return Boolean(match.diagnostics?.traceEnabled&&match.nextChainIndex<match.diagnostics.traceLimit);
}
export function recordChainDiagnostics(match,chain) {
  if(!match.diagnostics)return;
  const diagnostic=match.diagnostics;
  diagnostic.chains++;
  const team=diagnostic.teams[chain.attackingTeamIndex];
  for(const stage of chain.stages??[]) {
    if(stage.connection?.routeType)team.routes[stage.connection.routeType]=(team.routes[stage.connection.routeType]??0)+1;
    // Deferred shot stages and offside checks are not Bernoulli successes of p.
    if(['possession','shot'].includes(stage.stage)||['offside','periodEnded'].includes(stage.outcome))continue;
    const stageTeam=diagnostic.teams[stage.teamIndex??chain.attackingTeamIndex];
    const target=stageTeam.stages[stage.stage]??={...bucket(),bins:Array.from({length:5},bucket)};
    observe(target,stage.probability,stage.success);
    observe(target.bins[Math.min(4,Math.floor(stage.probability*5))],stage.probability,stage.success);
  }
}
export function recordShotDiagnostics(match,teamIndex,type,profile,goal,{xg,scoreStateXgMultiplier}={}) {
  if(!match.diagnostics)return;
  const shots=match.diagnostics.teams[teamIndex].shots;
  const target=shots[type]??={...bucket(),xg:0,scoreAdjustedShots:0,bins:Array.from({length:5},bucket)};
  observe(target,profile.goalProbability,goal);
  target.xg+=xg;
  if(scoreStateXgMultiplier!==1)target.scoreAdjustedShots++;
  observe(target.bins[Math.min(4,Math.floor(profile.goalProbability*5))],profile.goalProbability,goal);
}
export function recordPlanDiagnostic(match,team,metadata) {
  if(!match.diagnostics)return;
  const entry={chainIndex:match.nextChainIndex,minute:match.minute,teamIndex:team.index,...metadata};
  match.diagnostics.teams[team.index].plans.push(entry);
  match.diagnostics.commands.push(entry);
}
export function diagnosticSummary(match) {
  if(!match.diagnostics)return null;
  return {version:1,chains:match.diagnostics.chains,teams:structuredClone(match.diagnostics.teams),
    ...(isV32(match.parameters)?{counterPressAttempts:[...match.flowState.counterPressAttempts],counterPressRecoveries:[...match.flowState.counterPressRecoveries],activeSeconds:match.flowState.activeSeconds,deadBallSeconds:match.flowState.deadBallSeconds}:{} )};
}
