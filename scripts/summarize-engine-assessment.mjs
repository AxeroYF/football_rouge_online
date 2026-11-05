import fs from 'node:fs/promises';
import path from 'node:path';
const directory=path.resolve('outputs/engine-assessment');
const available=await fs.readdir(directory);
const files=available.includes('matches-modern.json')?['matches-modern.json']:available.includes('matches-constant.json')?['matches-constant.json']:available.filter(file=>/^matches(?:-\d+)?\.json$/.test(file));
const reports=await Promise.all(files.map(async file=>JSON.parse(await fs.readFile(path.join(directory,file),'utf8'))));
const rows=reports.flatMap(report=>report.rows);
const mean=values=>values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);
const variance=values=>values.length<2?0:values.reduce((sum,value)=>sum+(value-mean(values))**2,0)/(values.length-1);
const round=value=>Math.round(value*10000)/10000;
const confidence=values=>{const m=mean(values),t=values.length<=8?2.365:values.length<=12?2.201:values.length<=16?2.131:values.length<=24?2.069:values.length<=32?2.04:1.96;const e=t*Math.sqrt(variance(values)/values.length);return [round(m-e),round(m+e)];};
const pairGroups=data=>[...Map.groupBy(data,row=>row.pair).values()];
const scenarios=reports[0].scenarios.map(scenario=>{
 const data=rows.filter(row=>row.scenario===scenario.id),pairs=pairGroups(data);
 const margin=row=>row.score[0]-row.score[1],xgMargin=row=>row.xg[0]-row.xg[1];
 return {id:scenario.id,games:data.length,independentSeeds:pairs.length,win:round(mean(data.map(row=>Number(margin(row)>0)))),draw:round(mean(data.map(row=>Number(margin(row)===0)))),loss:round(mean(data.map(row=>Number(margin(row)<0)))),meanGoals:round(mean(data.map(row=>row.score[0]+row.score[1]))),goalMargin:round(mean(data.map(margin))),goalMarginCI95:confidence(pairs.map(pair=>mean(pair.map(margin)))),goalMarginSD:round(Math.sqrt(variance(data.map(margin)))),xgMargin:round(mean(data.map(xgMargin))),xgMarginCI95:confidence(pairs.map(pair=>mean(pair.map(xgMargin)))),possession:round(mean(data.map(row=>row.possession))),redCardsPerGame:round(mean(data.map(row=>row.reds[0]+row.reds[1]))),injuriesPerGame:round(mean(data.map(row=>row.injuries[0]+row.injuries[1]))),independentEventGames:data.filter(row=>row.independentEvents.length).length};
});
const structure=JSON.parse(await fs.readFile(path.join(directory,'structure.json'),'utf8'));
const base=structure.rows.find(row=>row.id==='baseline');
const chainSummary=structure.rows.map(row=>{
 const rate=(team,key)=>row.totals[team][key]/row.count*100;
 const netThreat=row.raw.map(record=>(record[0]===0?1:-1)*record[2]*100);
 const difference=netThreat.map((value,i)=>value-(base.raw[i][0]===0?1:-1)*base.raw[i][2]*100);
 return {id:row.id,n:row.count,selectedAPercent:round(rate(0,'chains')),shotsAPer100:round(rate(0,'shots')),shotsBPer100:round(rate(1,'shots')),rawThreatAPer100:round(rate(0,'rawThreat')),rawThreatBPer100:round(rate(1,'rawThreat')),netRawThreat:round(mean(netThreat)),deltaFromBaseline:round(mean(difference)),deltaCI95:confidence(difference),structure:row.structure.map(s=>({midfieldIntegrity:s.midfieldIntegrity,exposure:s.exposure,centralControl:s.centralControl,flankControl:s.flankControl,roles:s.roles,dimensions:s.dimensions})),holeCoverage:{left:row.stageThreat.left.coverageDeficit,right:row.stageThreat.right.coverageDeficit}};
});
const summary={method:{fullMatches:rows.length,fullMatchSeedClusters:pairGroups(rows.filter(row=>row.scenario==='equal-433')).length,fullMatchCI:'Approximate 95% t intervals over seed clusters averaging both side orders; exploratory small samples, no multiple-comparison correction',chain:'Fixed 30-minute 0:0 state, full strength, normal chains unless transition specified; raw shot quality is not official match xG, goals or win probability',chainNativeEqualityChecks:structure.nativeChainEqualityChecks,chainSamplesPerCondition:structure.samplesPerCondition},scenarios,chainSummary,boundary:structure.boundary,elapsedFullSimulationMs:reports.reduce((sum,report)=>sum+report.elapsedMs,0)};
await fs.writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({method:summary.method,scenarios,boundary:summary.boundary},null,2));
console.log(JSON.stringify(chainSummary.map(({structure,...rest})=>rest),null,2));
