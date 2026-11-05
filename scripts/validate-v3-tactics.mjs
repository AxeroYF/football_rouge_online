import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {V3_MATCH_PARAMETERS as parameters} from '../versus/v3/match-parameters-v3.js';
import {createV3Match} from '../versus/v3/match-engine-v3.js';
import {createV2MatchRng} from '../versus/v2/match-engine-v2.js';
import {simulateV2PossessionChain as native} from '../versus/v2/possession-chain-v2.js';
import {buildV2TeamSnapshots} from '../versus/v2/team-snapshot-v2.js';
import {buildV2SpatialMatchup,buildV2StageSpatialCache} from '../versus/v2/spatial-model-v2.js';
import {makeAssessmentTeam} from './engine-assessment-fixtures.mjs';

const original=new URL('../versus/v2/possession-chain-v2.js',import.meta.url);
let source=await fs.readFile(original,'utf8');
source=source.replace('buildV2StageSpatialCache, buildV2StageSpatialMatchup }','buildV2StageSpatialCache, buildV2StageSpatialMatchup as uncachedStage }');
source=source.replace(/from (["'])(\.\.?\/[^"']+)\1/g,(_,quote,spec)=>'from '+quote+new URL(spec,original).href+quote);
source+=`\nconst memo=new WeakMap();function buildV2StageSpatialMatchup(teams,side,stage,options={}){
 let values=memo.get(teams);if(!values)memo.set(teams,values=new Map());
 const key=JSON.stringify([side,stage,options.ballLane,options.possessionType]);
 if(!values.has(key))values.set(key,uncachedStage(teams,side,stage,options));return values.get(key);
}\n`;
await fs.mkdir('.assessment',{recursive:true});await fs.mkdir('outputs/engine-v3',{recursive:true});
const generated=path.resolve('.assessment/v3-tactical-probe.mjs');await fs.writeFile(generated,source);
const {simulateV2PossessionChain:chain}=await import(pathToFileURL(generated).href+'?'+Date.now());
const count=Number(process.env.V3_TACTICAL_SAMPLES??8192),state={minute:30,score:[0,0]},environment={weather:'sunny',referee:'standard'};
const rows=[];let verified=0;
for(const defense of ['left','right'])for(const attack of ['left','right']){
 const a=makeAssessmentTeam('A',{boardLines:true,holdScorePlans:true,plan:{inPossessionDetails:{attackDirection:attack}}});
 const b=makeAssessmentTeam('B',{boardLines:true,holdScorePlans:true,plan:{outOfPossessionDetails:{defenseDirection:defense}}});
 const match=createV3Match([a,b]);
 const snapshotTeams=buildV2TeamSnapshots(match.teams,{parameters,state,environment});
 const spatial=buildV2SpatialMatchup(snapshotTeams,{parameters}),stageSpatials=buildV2StageSpatialCache(snapshotTeams,{parameters,lazy:true});
 const options=seed=>({parameters,state,environment,snapshotTeams,spatial,stageSpatials,rng:createV2MatchRng('v3-tactic-probe:'+seed),chainIndex:seed,deferShotResolution:true});
 for(let seed=0;seed<4;seed++){assert.deepEqual(chain(match.teams,options(seed)),native(match.teams,options(seed)));verified++;}
 const values=[];
 for(let seed=0;seed<count;seed++){
  const result=chain(match.teams,options(seed));
  values.push((result.attackingTeamIndex===0?1:-1)*result.xg);
 }
 rows.push({attack,defense,count,rawThreatMarginPer100:100*values.reduce((s,x)=>s+x,0)/count,values});
 console.log(JSON.stringify({attack,defense,rawThreatMarginPer100:rows.at(-1).rawThreatMarginPer100}));
}
const find=(attack,defense)=>rows.find(row=>row.attack===attack&&row.defense===defense).values;
const [ll,rr,lr,rl]=[find('left','left'),find('right','right'),find('left','right'),find('right','left')];
const contrasts=ll.map((value,i)=>(value+rr[i]-lr[i]-rl[i])*100);
const mean=contrasts.reduce((s,x)=>s+x,0)/count;
const variance=contrasts.reduce((s,x)=>s+(x-mean)**2,0)/(count-1);
const error=1.96*Math.sqrt(variance/count);
const contrast={mean,ci95:[mean-error,mean+error],meaning:'matched weak-flank attack minus covered-flank attack, paired over common seeds; uncalibrated fixed-state shot-quality proxy, not match xG or win rate'};
await fs.writeFile('outputs/engine-v3/tactical-probe.json',JSON.stringify({nativeOutputChecks:verified,parameters,state,environment,rows,contrast},null,2));
console.log(JSON.stringify({nativeOutputChecks:verified,contrast}));
assert.ok(contrast.ci95[0]>0,'Weak-flank targeting must have a positive paired interaction in the fixed-state diagnostic');
