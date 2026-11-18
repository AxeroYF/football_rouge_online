import fs from 'node:fs';
import path from 'node:path';
import {loadEngineBundle} from '../versus/v4-rollout/bundle.js';
import {createPlayerReportLedger} from '../versus/v4-host/player-report.js';

const file=process.argv[2],document=JSON.parse(fs.readFileSync(file,'utf8'));
const job=document.jobs.find(job=>job.error==='球员反抢统计与球队统计不一致');
if(!job)throw new Error('需要保留的反抢战报失败队列');
const engine=await loadEngineBundle(job.bundle.bundleDirectory,job.bundle),match=engine.createMatch(job.envelope.input,{recording:false}),ledger=createPlayerReportLedger(match.state.input,match.state.version);
const evidence=[];let previous=null,oldCounts=[0,0],oldLedger=[0,0];
while(match.state.phase!=='finished'){
  engine.advanceMatch(match,1);ledger.consume(match.events);
  const checkpoint=ledger.checkpoint(),counts=match.state.stats.map(stats=>stats.counterPressRecoveries),individual=[0,1].map(side=>Object.entries(checkpoint.players).filter(([key])=>key.startsWith(side+':')).reduce((sum,[,p])=>sum+p.pressuresWon,0));
  for(const side of [0,1])if(counts[side]-oldCounts[side]!==individual[side]-oldLedger[side])evidence.push({side,before:previous,events:match.events,counters:counts,individual,engineTime:match.state.time});
  previous=structuredClone(match.state.transition);oldCounts=counts;oldLedger=individual;match.events=[];
}
const result={fixtureId:job.fixture.id,sourceDigest:job.bundle.sourceDigest,evidence,counters:oldCounts,individual:oldLedger};
const target=path.join(path.dirname(file),`counterpress-report-diagnostic-${Date.now()}.json`);fs.writeFileSync(target,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
