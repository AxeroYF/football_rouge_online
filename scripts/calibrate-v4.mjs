import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,workerData,parentPort} from 'node:worker_threads';
import {shotDiagnostics,mergeShotDiagnostics} from '../versus/v4/diagnostics.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const args=workerData?.args??Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const root=path.resolve(args.engine??'versus/v4');
const sourceHashes=Object.fromEntries(fs.readdirSync(root).filter(f=>f.endsWith('.js')).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const dependencies=dependencyHashes([...Object.keys(sourceHashes).map(name=>path.join(root,name)),...(args.source==='real'?['versus/v4-adapter/read-source.js','versus/v4-adapter/compile-match.js']:[])]);
const {simulateMatch}=await import(pathToFileURL(path.join(root,'engine.js')));
const {demoInput}=await import(pathToFileURL(path.join(root,'fixtures.js')));
const output=path.resolve(args.output??'outputs/v4-opportunities-20261117/calibration.json');
const real=args.source==='real';
const snapshot=real?(await import('../versus/v4-adapter/read-source.js')).readLeagueSource(process.cwd()):null;
const compileReal=real?(await import('../versus/v4-adapter/compile-match.js')).compileRealMatch:null;
const presets=real?snapshot.teams.map(t=>t.id):['balanced','left','press','counter'],rows=[];
const count=Number(args.seeds??3),duration=Number(args.duration??600);
const jobs=workerData?.jobs??(real?presets.flatMap((home,i)=>Array.from({length:count},(_,seed)=>({home,away:presets[(i+1+seed%(presets.length-1))%presets.length],seed}))):presets.flatMap(home=>presets.flatMap(away=>Array.from({length:count},(_,seed)=>({home,away,seed})))));
const workers=Math.max(1,Math.min(4,Number(args.workers??1)));
if(isMainThread&&workers>1){
  const chunks=await Promise.all(Array.from({length:workers},(_,i)=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{args,jobs:jobs.filter((_,j)=>j%workers===i)}});
    worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(new Error(`Calibration worker exited ${code}`));});
  })));
  rows.push(...chunks.flat());rows.sort((a,b)=>a.home.localeCompare(b.home)||a.away.localeCompare(b.away)||a.seed.localeCompare(b.seed));
}else for(const {home,away,seed} of jobs){
  const input=real?compileReal(snapshot,{homeId:home,awayId:away,fixtureId:`${args.split??'train'}:${home}:${away}:${seed}`,duration,seed:`${args.split??'train'}-${seed}`}).input:demoInput({home,away,duration,seed:`${args.split??'train'}-${seed}`});
  // Short calibration samples are uninterrupted clips for both sources. The
  // real adapter defaults to a full fixture, whose compressed halves would
  // otherwise add a second kickoff and restarts to the 600-second protocol.
  // This fixture-only override is never used with resultEnvelope/settlement.
  if(duration!==5400)input.format='clip';
  const m=simulateMatch(input,{recording:false}),passes=new Map(m.events.filter(e=>e.type==='pass').map(e=>[e.id,e]));
  let firstTouches=0,miscontrols=0;
  for(const e of m.events){const pass=passes.get(e.decisionId);if(pass&&e.side===pass.side&&['receive','miscontrol'].includes(e.type)){firstTouches++;if(e.type==='miscontrol')miscontrols++;}}
  const sum=key=>m.state.stats.reduce((n,s)=>n+(s[key]??0),0);
  let held=null,holdSeconds=0,holdCount=0;
  for(const e of m.events){
    if(['receive','interception','secondBall','tackle','save','block'].includes(e.type))held={key:e.actor,time:e.time};
    else if(['pass','shot'].includes(e.type)&&held?.key===e.actor){holdSeconds+=e.time-held.time;holdCount++;held=null;}
    else if(['stoppage','halfTime','fulltime'].includes(e.type))held=null;
  }
  const clock=m.state.clock,periods=clock?.completed??[],matchSeconds=clock?clock.played.reduce((a,b)=>a+b,0)+clock.dead.reduce((a,b)=>a+b,0):duration;
  const inPlaySeconds=clock?clock.played.reduce((a,b)=>a+b,0):null;
  rows.push({home,away,seed:input.seed,...(real?{sourceFingerprint:snapshot.fingerprint}:{}),goals:m.state.score.reduce((a,b)=>a+b,0),score:m.state.score,
    passes:sum('passes'),completed:sum('completed'),firstTouches,miscontrols,shots:sum('shots'),
    fouls:sum('fouls'),offsides:sum('offsides'),yellowCards:sum('yellowCards'),redCards:sum('redCards'),
    crosses:sum('crosses'),headers:sum('headers'),woodwork:sum('woodwork'),injuries:sum('injuries'),substitutions:sum('substitutions'),
    matchSeconds,inPlaySeconds,holdSeconds,holdCount,periods,simulationSeconds:m.state.time,shotDiagnostics:shotDiagnostics(m.events),
    cardReasons:m.events.filter(e=>e.type==='foul'&&e.sanction?.card).reduce((all,e)=>(all[e.sanction.card+':'+(e.foul.dogso?'dogso':e.sanction.severity)]=(all[e.sanction.card+':'+(e.foul.dogso?'dogso':e.sanction.severity)]??0)+1,all),{}),
    restarts:m.events.filter(e=>e.type==='restart').reduce((a,e)=>(a[e.restartType??'legacy']=(a[e.restartType??'legacy']??0)+1,a),{})});
}
if(!isMainThread){parentPort.postMessage(rows);}else{
const summarize=sample=>{const sum=key=>sample.reduce((n,r)=>n+r[key],0),goals=sample.map(r=>r.goals).sort((a,b)=>a-b);
  return {runs:sample.length,passes:sum('passes'),completed:sum('completed'),passCompletion:sum('completed')/sum('passes'),
    firstTouches:sum('firstTouches'),miscontrols:sum('miscontrols'),firstTouchErrorRate:sum('miscontrols')/sum('firstTouches'),
    meanGoals:sum('goals')/sample.length,meanGoalsPer600s:sum('goals')/sample.length*600/duration,normalizedGoalsPer90:sum('goals')/sample.length*5400/duration,
    scoreHistogram:sample.reduce((all,r)=>(all[r.score.join(':')]=(all[r.score.join(':')]??0)+1,all),{}),
    goalHistogram:Object.fromEntries([...new Set(goals)].map(g=>[g,goals.filter(x=>x===g).length])),
    zeroGoalShare:goals.filter(g=>g===0).length/sample.length,highScoreShare:goals.filter(g=>g>=6).length/sample.length,
    shotsPer600s:sum('shots')/sample.length*600/duration,shotsPerMatch:sum('shots')/sample.length,shotConversion:sum('goals')/Math.max(1,sum('shots')),
    shotsOnTargetShare:sample.reduce((n,r)=>n+r.shotDiagnostics.total.onTarget,0)/Math.max(1,sum('shots')),
    fouls:sum('fouls'),offsides:sum('offsides'),redCards:sum('redCards'),yellowCards:sum('yellowCards'),
    passesPerMatch:sum('passes')/sample.length,foulsPerMatch:sum('fouls')/sample.length,
    yellowsPerMatch:sum('yellowCards')/sample.length,redsPerMatch:sum('redCards')/sample.length,
    crossesPerMatch:sum('crosses')/sample.length,headersPerMatch:sum('headers')/sample.length,woodworkPerMatch:sum('woodwork')/sample.length,
    injuriesPerMatch:sum('injuries')/sample.length,substitutionsPerMatch:sum('substitutions')/sample.length,
    penaltiesPerMatch:sample.reduce((n,r)=>n+(r.restarts.penalty??0),0)/sample.length,
    ballInPlayShare:sample.every(r=>r.inPlaySeconds!==null)?sum('inPlaySeconds')/sum('matchSeconds'):null,
    meanHoldSeconds:sum('holdSeconds')/Math.max(1,sum('holdCount')),
    meanMatchSeconds:sum('matchSeconds')/sample.length,
    meanAddedSeconds:sample.reduce((n,r)=>n+r.periods.reduce((n,p)=>n+p.elapsed-(duration/2),0),0)/sample.length};};
const summary=summarize(rows);
if(real&&rows.some(row=>row.sourceFingerprint!==snapshot.fingerprint))throw new Error('来源快照在校准进程间发生变化');
const targets={passCompletion:[.70,.90],firstTouchErrorRate:[.02,.12],meanGoalsPer600s:[.15,.65]};
if(duration===5400)Object.assign(targets,{meanGoals:[1.8,4],zeroGoalShare:[0,.25],highScoreShare:[0,.15],
  passesPerMatch:[700,1300],foulsPerMatch:[15,35],yellowsPerMatch:[2,6],redsPerMatch:[0,.25],ballInPlayShare:[.50,.75],meanHoldSeconds:[1,4.5],
  shotsPerMatch:[20,40],shotConversion:[.06,.16],shotsOnTargetShare:[.25,.60]});
const gates=Object.fromEntries(Object.entries(targets).map(([key,[min,max]])=>[key,summary[key]>=min&&summary[key]<=max]));
const report={version:'v4-calibration-1',split:args.split??'train',duration,format:duration===5400?'full':'clip',workers,targets,summary,gates,
  sourceHashes,dependencyHashes:dependencies,...(real?{sourceFingerprint:snapshot.fingerprint,sourceRevisions:snapshot.sourceRevisions}:{}),
  scope:real?'Read-only real roster snapshots with fixed prematch fitness, neutral sunny conditions, no season settlement. Engineering targets, not observed league results.':duration===5400?'Synthetic full-match protocol: two halves, interval, ends change, period-specific added time. Engineering targets, not a real-league fit. Baseline engines may lack this clock.':`Synthetic ${duration}-second clips. Engineering targets, not a real-league fit.`,
  shotDiagnostics:mergeShotDiagnostics(rows.map(r=>r.shotDiagnostics)),
  byHomePreset:Object.fromEntries(presets.map(p=>[p,summarize(rows.filter(r=>r.home===p))])),rows};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,summary,gates}));
if(args.enforce==='true'&&Object.values(gates).some(v=>!v))process.exitCode=1;
}
