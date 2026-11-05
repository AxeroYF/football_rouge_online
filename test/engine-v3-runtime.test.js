import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocalServer} from './helpers/local-server.js';

test('the actual runtime creates V3 league training matches and broadcasts their real version',async t=>{
 const server=await startLocalServer({publicOnly:false});t.after(()=>server.stop());
 const config=await (await fetch(server.url+'/api/versus/config')).json();
 assert.equal(config.matchEngine,'v3');assert.equal(config.engineVersion,'3.0.0');assert.equal(config.engineProfile,'v3.0-tactical-control.1');
 const post=async(path,body)=>{const value=await (await fetch(server.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();assert.equal(value.ok,true,value.error);return value;};
 const account=await post('/api/versus/register',{nickname:'V3 Runtime',password:'v3-runtime-test-password'});
 const identity={playerId:account.profile.id,accountToken:account.accountToken};
 await post('/api/versus/league/draft/start',{...identity,teamName:'V3 Runtime FC'});
 await post('/api/versus/league/draft/auto',identity);
 await post('/api/versus/league/draft/finish',identity);
 const created=await post('/api/versus/league/ai-training/start',{...identity,formation:'4-3-3',averageOverall:80});
 assert.equal(created.broadcast.match.engineVersion,'3.0.0');
 assert.equal(created.broadcast.match.engineProfile,'v3.0-tactical-control.1');
 assert.equal(created.broadcast.match.modelVersion,'match-engine-v3.0');
 const watch=await (await fetch(server.url+'/api/versus/watch/'+created.broadcast.code,{headers:{authorization:'Bearer '+created.spectatorToken}})).json();
 assert.equal(watch.ok,true,watch.error);assert.equal(watch.broadcast.match.engineVersion,'3.0.0');
});
