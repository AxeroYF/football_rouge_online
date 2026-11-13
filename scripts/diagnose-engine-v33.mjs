import {V3_MATCH_PARAMETERS} from "../versus/v3/match-parameters-v3.js";
import {mkdir,writeFile} from 'node:fs/promises';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';
import {createV3Match} from '../versus/v3/match-engine-v3.js';
import {advanceV2Match} from '../versus/v2/match-engine-v2.js';
import {configurationDigest,matchReliabilitySummary} from '../versus/v3/match-configuration.js';
import {tacticalProcessSummary} from '../versus/v3/tactical-execution.js';
import {flowClock} from '../versus/v3/flow-state.js';

const seed=process.argv.find(arg=>arg.startsWith('--seed='))?.slice(7)??'v33-diagnostic';
const teams=['A','B'].map(name=>makeAssessmentTeam(name,{boardLines:true,holdScorePlans:true,
  plan:{lossTransition:name==='A'?'counterPress':'regroup',restDefense:'balanced',clockManagement:'normal',pressTrigger:'wide',pressAssignment:'screen',defensiveFocus:'creator',buildUpRoute:'left',buildUpOutlet:'pivot',pressureEscape:'switch',setPieceRoutine:'near',setPieceCommitment:'protect'}}));
const match=createV3Match(teams,{seed,parameters:V3_MATCH_PARAMETERS,diagnosticTrace:true,weather:'sunny',referee:'standard'});
advanceV2Match(match,60);
const checkpointClock=flowClock(match),resumed=JSON.parse(JSON.stringify(match));
advanceV2Match(match,Infinity);advanceV2Match(resumed,Infinity);
const result=value=>({score:value.score,events:value.events,chains:value.chains,teams:value.teams,
  flowState:value.flowState,randomState:value.randomState,diagnostics:value.diagnostics});
const exact=configurationDigest(result(match))===configurationDigest(result(resumed));
const report={seed,reliability:matchReliabilitySummary(match),checkpointAtChain:60,checkpointClock,exactResume:exact,
  tacticalExecution:tacticalProcessSummary(match),configuration:match.configuration,score:match.score,clock:flowClock(match),diagnostics:match.diagnostics,
  counterPressAttempts:match.flowState.counterPressAttempts,counterPressRecoveries:match.flowState.counterPressRecoveries,
  teams:match.teams.map(team=>({name:team.name,stats:team.stats})),
  actions:match.chains.filter(chain=>chain.decisionTrace).map(chain=>({chainIndex:chain.context.chainIndex,
    attackingTeamIndex:chain.attackingTeamIndex,startZone:chain.startZone,endZone:chain.endZone,
    activeDurationSeconds:chain.activeDurationSeconds,deadBallSeconds:chain.deadBallSeconds,
    actions:chain.actions,secondaryActions:chain.secondaryActions,decisions:chain.decisionTrace,stages:chain.stages}))};
const out=new URL('../outputs/v33-diagnostic/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({engineVersion:match.engineVersion,score:match.score,exactResume:exact,
  chains:match.chains.length,clock:report.clock,report:new URL('report.json',out).pathname},null,2));
if(!exact)process.exitCode=1;
