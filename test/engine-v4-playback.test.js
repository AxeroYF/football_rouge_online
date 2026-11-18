import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamPlayback} from '../versus/v4-stream/playback.js';
import {createPublisher} from '../versus/v4-stream/publisher.js';
import {simulateMatch} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {VERSION} from '../versus/v4/world.js';

function harness(options={}){
  const recording=simulateMatch(demoInput({duration:90,seed:'playback-proof'}),{frameInterval:1});
  const publisher=createPublisher(recording,{matchId:'proof',engineVersion:VERSION,ownerSide:null});publisher.publishUntil(90);
  const packets=[];let cursor;do{const packet=publisher.read(cursor,{maxFrames:15,maxEvents:80});packets.push(packet);cursor=packet.to;}while(!packets.at(-1).complete);
  let released=1,online=true;const urls=[];
  const fetcher=async url=>{urls.push(url);if(!online)throw new Error('offline');
    if(url.endsWith('/head'))return {ok:true,json:async()=>({matchId:'proof',engineVersion:VERSION,ownerSide:null,publishedThrough:packets[released-1].through,
      segments:packets.slice(0,released).map((p,index)=>({index,through:p.through})),complete:released===packets.length})};
    const index=Number(url.split('/').at(-1));return {ok:index<released,status:425,json:async()=>structuredClone(packets[index])};
  };
  return {packets,urls,client:createStreamPlayback({matchId:'proof',fetcher,maxFrames:64,maxEvents:64,...options}),publishAll(){released=packets.length;},online(value){online=value;}};
}

test('speed, pause, keyframe seeking and catch-up affect only local time and respect the release boundary',async()=>{
  const h=harness(),p=h.client;await p.pump();assert.ok(p.frame);const start=p.state.time;
  p.tick(1);assert.equal(p.state.time,start);p.play();p.slowMotion(false);p.setRate(64);
  for(let i=0;i<10;i++)p.tick(1);assert.equal(p.state.time,p.state.publishedThrough);assert.equal(p.state.buffering,true);
  await p.seek(999);assert.equal(p.state.time,p.state.publishedThrough);assert.ok(p.events.every(e=>e.time<=p.state.time));
  h.publishAll();await p.refresh();await p.seek(70);assert.equal(p.state.time,70);assert.ok(p.frame.time<=70);
  await p.seek(0);assert.equal(p.state.time,0);await p.catchUp();assert.equal(p.state.time,88);
  assert.ok(p.state.frames<=64);assert.ok(p.state.events<=64);assert.ok(h.urls.every(url=>!url.includes('?')));
  p.close();assert.equal(p.frame,null);
});

test('network failure retains the displayed state, then reconnect resumes without duplicate frames',async()=>{
  const h=harness(),p=h.client;await p.pump();const before=p.frame;
  h.online(false);await assert.rejects(p.pump());assert.equal(p.state.connected,false);assert.deepEqual(p.frame,before);
  h.online(true);h.publishAll();await p.pump();assert.equal(p.state.connected,true);
  const frames=p.state.frames;await p.pump();assert.equal(p.state.frames,frames);p.close();
});

test('bounded prefetch sustains 64x playback at half-second polls without fetching unpublished segments',async()=>{
  assert.throws(()=>createStreamPlayback({matchId:'proof',lookAheadSeconds:Infinity}),/预读/);
  const h=harness({lookAheadSeconds:60,maxFrames:256,maxEvents:1024}),p=h.client;await p.pump();
  assert.ok(h.urls.filter(url=>url.includes('/segments/')).every(url=>url.endsWith('/0')));
  h.publishAll();await p.pump();p.play();p.slowMotion(false);p.setRate(64);
  for(let i=1;i<=3;i++){p.tick(.5);assert.equal(p.state.time,Math.min(90,i*32));await p.pump();}
  assert.equal(p.state.complete,true);assert.ok(p.state.frames<=256);p.close();
});

test('expired replay clears buffered private frames and stops retries',async()=>{
  const h=harness();let retired=false,requests=0;
  // Reuse a real encoded packet so there is a displayed frame before expiry.
  const packet=h.packets[0],p=createStreamPlayback({matchId:'proof',fetcher:async url=>{
    requests++;if(retired)return {ok:false,status:410};
    return {ok:true,json:async()=>url.endsWith('/head')?{matchId:'proof',engineVersion:VERSION,ownerSide:null,publishedThrough:packet.through,segments:[{index:0,through:packet.through}],complete:false}:structuredClone(packet)};
  }});
  await p.pump();assert.ok(p.frame);p.play();retired=true;
  await assert.rejects(p.pump(),error=>error.code==='V4_REPLAY_EXPIRED');assert.equal(p.frame,null);assert.deepEqual(p.events,[]);assert.equal(p.state.expired,true);assert.equal(p.state.playing,false);
  const count=requests;await p.pump();assert.equal(requests,count);await assert.rejects(p.seek(0),/关闭/);h.client.close();
});
