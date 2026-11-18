import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLocalDispatcher,openLocalDispatcher} from '../versus/v4-host/dispatcher.js';
import {createCanonicalShadowSettlement,openCanonicalShadowSettlement} from '../versus/v4-host/shadow-settlement.js';
import {openSandboxJournal} from '../versus/v4-rollout/sandbox-journal.js';

const root=fs.realpathSync(process.env.V4_DISPATCH_SANDBOX??'');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-dispatch-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){
  assert.ok(process.env[key]);const relative=path.relative(root,path.resolve(process.env[key]));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
}
await import('../versus/ydl-content-store.js');
const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const initialState=structuredClone(yellowDogsLeague.state),beforeHash=hash(initialState),now=()=>1794934800000,createService=options=>new YellowDogsLeagueService(options);
const settlement=await createCanonicalShadowSettlement(path.join(root,'settlement'),{initialState,createService,now});
const bundleDirectory=path.resolve('outputs/v4-accepted-local-20261118/engine'),bundle=JSON.parse(fs.readFileSync(path.join(bundleDirectory,'manifest.json'),'utf8'));
const candidate={accepted:true,bundleDirectory,engineVersion:bundle.engineVersion,sourceDigest:bundle.sourceDigest};
const queue=await createLocalDispatcher(path.join(root,'queue'),{candidate,settlement,maxWorkers:2,maxPending:8});
const tasks=JSON.parse(fs.readFileSync(path.join(root,'tasks.json'),'utf8'));
await queue.setPolicy({mode:'canary',fixtureAllowlist:tasks.map(t=>t.fixture.id),competitions:['league']},{expectedRevision:0});
for(const task of tasks)await queue.enqueue(task);
await queue.setPolicy({mode:'off'},{expectedRevision:1});
let peakWorkers=0,peakActiveMatches=0;const interval=setInterval(async()=>{try{const running=(await queue.read()).jobs.filter(j=>j.status==='running');peakWorkers=Math.max(peakWorkers,new Set(running.map(j=>j.workerSlot)).size);peakActiveMatches=Math.max(peakActiveMatches,running.length);}catch{}},50);
const started=performance.now();let result;
try{result=await queue.drain();}finally{clearInterval(interval);}
assert.deepEqual(result,{computed:8,settled:8});assert.equal(peakWorkers,2);assert.equal(peakActiveMatches,8);
assert.equal(hash(initialState),beforeHash);assert.equal(hash(yellowDogsLeague.state),beforeHash);
const after=(await settlement.read()).state.league,newMatches=after.matches.slice(initialState.matches.length);
assert.equal(newMatches.length,8);assert.equal(new Set(newMatches.map(m=>m.id)).size,8);
const summaries=[];
for(const [index,task] of tasks.entries()){
  const pinned=(await (await openSandboxJournal(path.join(root,'queue/jobs',task.fixture.id,'journal'))).read()).fixtures[task.fixture.id];
  const report=pinned.result.value.report,record=newMatches[index];assert.deepEqual(record.score,report.score);
  assert.deepEqual([record.homeId,record.awayId],task.envelope.input.teams.map(t=>t.id));
  for(const [side,team] of report.teams.entries()){
    const before=initialState.teams.find(t=>t.id===team.id),updated=after.teams.find(t=>t.id===team.id);
    assert.equal(updated.table.played,before.table.played+1);assert.equal(updated.table.goalsFor,before.table.goalsFor+report.score[side]);
    assert.equal(updated.table.goalsAgainst,before.table.goalsAgainst+report.score[1-side]);
    const points=report.score[side]>report.score[1-side]?3:report.score[side]===report.score[1-side]?1:0;assert.equal(updated.table.points,before.table.points+points);
    for(const player of team.players){const key=`${team.id}:${player.id}${before.ownerId?'':':ai'}`;assert.equal(after.playerStats[key].appearances,(initialState.playerStats[key]?.appearances??0)+1);}
  }
  summaries.push({fixtureId:task.fixture.id,score:report.score,matchId:record.id,inputFingerprint:pinned.inputFingerprint});
}
const reopenedSettlement=await openCanonicalShadowSettlement(path.join(root,'settlement'),{createService,now}),reopened=await openLocalDispatcher(path.join(root,'queue'),{settlement:reopenedSettlement});
assert.deepEqual(await reopened.drain(),{computed:0,settled:0});assert.equal(hash((await reopenedSettlement.read()).state.league),hash(after));
const queueState=await reopened.read();assert.equal(queueState.policy.mode,'off');assert.ok(queueState.jobs.every(job=>job.selection.primary==='v4'&&job.status==='settled'));
const report={passed:true,scope:'Eight full real-team fixtures through local durable dispatch and canonical isolated settlement; not production or resource-limited capacity.',matches:8,peakWorkers,peakActiveMatches,elapsedMs:performance.now()-started,rollbackPreservedPins:true,reopenExactlyOnce:true,canonicalSingletonUnchanged:true,summaries};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
