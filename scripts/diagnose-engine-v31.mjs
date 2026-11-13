import {V31_MATCH_PARAMETERS} from '../versus/v3/match-parameters-v3.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';
import {createV3Match} from '../versus/v3/match-engine-v3.js';
import {advanceV2Match} from '../versus/v2/match-engine-v2.js';
import {configurationDigest,matchReliabilitySummary} from '../versus/v3/match-configuration.js';
import {ENGINE_RULE_OWNERSHIP} from '../versus/v3/diagnostics.js';

const seed=process.argv.find(arg=>arg.startsWith('--seed='))?.slice(7)??'v31-diagnostic';
const teams=['A','B'].map(name=>makeAssessmentTeam(name,{boardLines:true}));
const match=createV3Match(teams,{seed,parameters:V31_MATCH_PARAMETERS,diagnosticTrace:true,weather:'sunny',referee:'standard'});
advanceV2Match(match,60);
const resumed=JSON.parse(JSON.stringify(match));
advanceV2Match(match,180);advanceV2Match(resumed,180);
const result=value=>({score:value.score,events:value.events,chains:value.chains,stats:value.teams.map(t=>t.stats),randomState:value.randomState,diagnostics:value.diagnostics});
const exact=configurationDigest(result(match))===configurationDigest(result(resumed));
const report={seed,reliability:matchReliabilitySummary(match),checkpointAtChain:60,exactResume:exact,
  configuration:match.configuration,ruleOwnership:ENGINE_RULE_OWNERSHIP,
  score:match.score,teams:match.teams.map(t=>({name:t.name,stats:t.stats})),diagnostics:match.diagnostics,
  actions:match.chains.filter(chain=>chain.decisionTrace).map(chain=>({
    chainIndex:chain.context.chainIndex,attackingTeamIndex:chain.attackingTeamIndex,
    startZone:chain.startZone,endZone:chain.endZone,decisions:chain.decisionTrace,
    stages:chain.stages.map(stage=>({stage:stage.stage,actor:stage.actor,defender:stage.defender,
      probability:stage.probability,roll:stage.roll,success:stage.success,outcome:stage.outcome,
      factors:stage.factors,stateAdjustment:stage.stateAdjustment})),
  }))};
const out=new URL('../outputs/v31-diagnostic/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({engineVersion:match.engineVersion,score:match.score,exactResume:exact,
  tracedChains:report.actions.length,report:new URL('report.json',out).pathname},null,2));
if(!exact)process.exitCode=1;
