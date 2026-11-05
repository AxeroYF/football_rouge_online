import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {startLocalServer} from './helpers/local-server.js';

function request(url,headers={},method='GET') {
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method,headers},response=>{const buffers=[];response.on('data',b=>buffers.push(b));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(buffers)}));});
    req.on('error',reject);req.end();
  });
}
test('YFFM1 serves negotiated cached assets, its current engine config and persistent login',async t=>{
  const server=await startLocalServer();t.after(()=>server.stop());
  const base=server.url;
  const page=await request(base+'/versus/');assert.equal(page.status,200);assert.match(page.body.toString(),/<title>YFFM1/);
  const identity=await request(base+'/versus/app.js',{'accept-encoding':'identity'});
  const zipped=await request(base+'/versus/app.js',{'accept-encoding':'gzip'});
  assert.equal(identity.headers['content-encoding'],undefined);
  assert.equal(zipped.headers['content-encoding'],'gzip');assert.deepEqual(gunzipSync(zipped.body),identity.body);
  assert.equal(zipped.headers.vary,'Accept-Encoding');
  const cached=await request(base+'/versus/app.js',{'accept-encoding':'identity','if-none-match':identity.headers.etag});
  assert.equal(cached.status,304);assert.equal(cached.body.length,0);
  const head=await request(base+'/versus/app.js',{'accept-encoding':'gzip'},'HEAD');
  assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],zipped.headers['content-length']);
  assert.equal((await request(base+'/versus/app.js',{},'POST')).status,405);
  assert.equal((await request(base+'/versus/assets/system-badges/ai-team-badge.svg')).status,200);
  const config=await (await fetch(base+'/api/versus/config')).json();assert.equal(config.matchEngine,'v3');assert.equal(config.engineVersion,'3.0.0');
  const post=async(route,body)=>(await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
  const user=await post('/api/versus/register',{nickname:'HTTP Manager',password:'http-test-password'});assert.equal(user.ok,true);
  const login=await post('/api/versus/login',{nickname:'HTTP Manager',password:'http-test-password'});assert.equal(login.profile.id,user.profile.id);
});
