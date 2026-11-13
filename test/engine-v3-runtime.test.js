import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocalServer} from './helpers/local-server.js';

test('the actual runtime creates V3 league training matches and broadcasts their real version',async t=>{
 const server=await startLocalServer({publicOnly:false});t.after(()=>server.stop());
 const config=await (await fetch(server.url+'/api/versus/config')).json();
 assert.equal(config.matchEngine,'v3');assert.equal(config.engineVersion,'3.3.0');assert.equal(config.engineProfile,'v3.3-tactical-execution.1');
 const post=async(path,body)=>{const value=await (await fetch(server.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();assert.equal(value.ok,true,value.error);return value;};
 const account=await post('/api/versus/register',{nickname:'V3 Runtime',password:'v3-runtime-test-password'});
 const identity={playerId:account.profile.id,accountToken:account.accountToken};
 await post('/api/versus/league/draft/start',{...identity,teamName:'V3 Runtime FC'});
 await post('/api/versus/league/draft/auto',identity);
 const drafted=await post('/api/versus/league/draft/finish',identity);
 const team=drafted.league.ownTeam;
 const tacticalPlans=structuredClone(team.tacticalPlans);
 Object.assign(tacticalPlans.opening,{pressTrigger:'wide',pressAssignment:'screen',defensiveFocus:'creator',setPieceRoutine:'near'});
 await post('/api/versus/league/team',{...identity,starterIds:team.roster.filter(p=>p.starter).map(p=>p.id),positions:team.positions,positionPresets:team.positionPresets,
   formationLinePresets:team.formationLinePresets,tacticalPlans,lineupSchemeId:team.activeLineupSchemeId,
   lineupSchemeRevision:team.lineupSchemes.find(s=>s.id===team.activeLineupSchemeId).revision});
 const created=await post('/api/versus/league/ai-training/start',{...identity,formation:'4-3-3',averageOverall:80});
 assert.equal(created.broadcast.match.engineVersion,'3.3.0');
 assert.equal(created.broadcast.match.engineProfile,'v3.3-tactical-execution.1');
 assert.equal(created.broadcast.match.modelVersion,'match-engine-v3.3');
 assert.equal(created.broadcast.match.teams[0].pressTrigger,'wide');
 assert.equal(created.broadcast.match.teams[0].setPieceRoutine,'near');
 const watch=await (await fetch(server.url+'/api/versus/watch/'+created.broadcast.code,{headers:{authorization:'Bearer '+created.spectatorToken}})).json();
 assert.equal(watch.ok,true,watch.error);assert.equal(watch.broadcast.match.engineVersion,'3.3.0');
 assert.match(watch.broadcast.revision,/^[a-f0-9]{64}$/);
 const restored=await post('/api/versus/watch/resume',{...identity,code:created.broadcast.code,spectatorToken:created.spectatorToken});
 assert.equal(restored.spectatorToken,created.spectatorToken);
 assert.equal(restored.broadcast.spectators.length,1);
 const rejected=await (await fetch(server.url+'/api/versus/watch/resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:created.broadcast.code,spectatorToken:created.spectatorToken})})).json();
 assert.equal(rejected.ok,false);assert.equal(rejected.errorCode,'BROADCAST_FORBIDDEN');
 const invalid=await fetch(server.url+'/api/versus/watch/resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:identity.playerId,accountToken:'invalid',code:created.broadcast.code})});
 assert.equal(invalid.status,401);assert.equal((await invalid.json()).errorCode,'BROADCAST_FORBIDDEN');
});
