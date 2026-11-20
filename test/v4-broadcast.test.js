import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatchMetrics,estimateShotXg} from '../versus/v4-host/match-metrics.js';
import {createMatchCommentary} from '../versus/v4-host/match-commentary.js';
import {createPlayerReportLedger} from '../versus/v4-host/player-report.js';
import {createBroadcastSummary} from '../versus/v4-host/broadcast-summary.js';
import {createMatch,advanceMatch,awardRestart,injurePlayer} from '../versus/v4/engine.js';
import {demoInput} from '../versus/v4/fixtures.js';
import {publicEvent,publicFrame,encodeFrames} from '../versus/v4-stream/codec.js';
import {broadcastShotSeries,broadcastDataMarkup} from '../versus/public/broadcast-data.js';
import {keyPlayEntries,sampleKeyPlay} from '../versus/public/broadcast-key-plays.js';
import {createStreamService} from '../versus/v4-stream/http-service.js';
const event=(id,time,type,side=0,extra={})=>({id,time,type,side,actor:`${side}:p1`,position:{x:90,y:34},clock:{baseSeconds:0,elapsed:time,attackDirections:[1,-1]},...extra});

test('possession excludes loose/dead/interval time and shootouts, resumes exactly',()=>{
  const all=[event(1,0,'kickoff'),event(2,10,'pass'),event(3,15,'loose'),event(4,20,'secondBall',1),
    event(5,25,'stoppage',1),event(6,40,'restart',1),event(7,50,'halfTime',null),event(8,100,'restart'),
    event(9,110,'shootoutStart',null),event(10,120,'shot'),event(11,130,'save',1)];
  const a=createMatchMetrics();a.consume(all);
  const b=createMatchMetrics();b.consume(all.slice(0,5));const resumed=createMatchMetrics(b.checkpoint());resumed.consume(all.slice(5));
  assert.deepEqual(resumed.view(140),a.view(140));assert.deepEqual(a.view().stats.map(s=>s.possession),[25,15]);
  assert.deepEqual(a.view().stats.map(s=>s.shots),[0,0]);
});
test('geometric xG is symmetric after changing ends and independent of outcome',()=>{
  const a=event(1,1,'shot'),b={...a,side:1,position:{x:15,y:34}};
  assert.equal(estimateShotXg(a),estimateShotXg(b));
  assert.equal(estimateShotXg({...a,position:{x:15,y:34},clock:{attackDirections:[-1,1]}}),estimateShotXg(a));
  assert.ok(estimateShotXg({...a,position:{x:75,y:34}})<estimateShotXg(a));
  assert.equal(estimateShotXg({...a,restartType:'penalty'}),.76);
  const metrics=createMatchMetrics();metrics.consume([a,event(2,2,'goal',0,{scoringSide:0}),event(3,3,'fulltime',null)]);
  const v=metrics.view(),match={teams:v.stats.map(stats=>({stats})),events:v.events};
  assert.equal(broadcastShotSeries(match).complete,true);assert.equal(broadcastShotSeries(match).shots[0].length,1);
});

test('public goal cards and live totals keep scorer and assister distinct when both borrow the same spirit',async()=>{
  const match=createMatch(demoInput({duration:60,format:'full'}));
  const input=structuredClone(match.state.input);
  for(const p of input.teams[0].players.filter(p=>['p7','p10'].includes(p.id)))p.spiritForm={id:'same-legend',name:'普斯卡什',role:'ST'};
  const summary=createBroadcastSummary(input);
  const head={matchId:'spirit-credit',engineVersion:match.state.version,segments:[],complete:false};
  const events=[
    event(1,1,'goal',0,{actor:'0:p10',scoringSide:0,assistId:'p7',text:'进球'}),
    event(2,2,'goal',1,{actor:'1:p7',scoringSide:0,ownGoal:true,text:'乌龙'}),
  ];
  const reader={read:async()=>({events:events.map(e=>publicEvent(e)),frames:encodeFrames(match.frames)})};
  const before=await summary(reader,head);
  assert.ok(before.match.teams.flatMap(t=>t.players).every(p=>!p.stats.goals&&!p.stats.assists));
  head.segments.push({index:0});
  for(let read=0;read<2;read++){
    const {match:live}=await summary(reader,head);
    const goal=live.events.find(e=>e.id==='v4-1');
    assert.deepEqual([goal.actorId,goal.assistId],['p10','p7']);
    const stats=(side,id)=>live.teams[side].players.find(p=>p.id===id).stats;
    assert.deepEqual(stats(0,'p10'),{goals:1,assists:0});
    assert.deepEqual(stats(0,'p7'),{goals:0,assists:1});
    assert.deepEqual(stats(1,'p7'),{goals:0,assists:0});
  }
});
test('archive summary consumes only published packets and agrees with event statistics on join/reconnect',async()=>{
  const m=createMatch(demoInput({seed:'broadcast-proof',duration:120,format:'full'}),{frameInterval:1});
  advanceMatch(m,250);
  const first={events:m.events.map(e=>publicEvent(e,null)).filter(Boolean),frames:encodeFrames(m.frames.map(f=>publicFrame(f,null)))};
  const firstTime=m.state.time,firstId=m.state.nextEventId-1;
  while(m.state.phase!=='finished')advanceMatch(m,100);
  const second={events:m.events.filter(e=>e.id>firstId).map(e=>publicEvent(e,null)).filter(Boolean),frames:encodeFrames(m.frames.filter(f=>f.time>firstTime).map(f=>publicFrame(f,null)))};
  const head={matchId:'sample',engineVersion:m.state.version,segments:[{index:0,through:firstTime}],complete:false};
  const reads=[],reader={read:async i=>{reads.push(i);return [first,second][i];}};
  const summary=createBroadcastSummary(m.state.input),early=await summary(reader,head);
  assert.deepEqual(reads,[0]);assert.ok(early.match.events.every(e=>e.time<=firstTime));assert.equal(early.live,true);
  head.segments.push({index:1,through:m.state.time});head.complete=true;
  const final=await summary(reader,head),again=await summary(reader,head);
  assert.deepEqual(final,again);assert.deepEqual(reads,[0,1]);assert.equal(final.live,false);
  const metrics=createMatchMetrics();metrics.consume(m.events);
  assert.deepEqual(final.match.teams.map(t=>t.stats),metrics.view(m.state.time).stats);
  assert.ok(!JSON.stringify(final).includes('decision'));
  assert.equal(broadcastShotSeries(final.match).complete,true);
  assert.ok(!broadcastDataMarkup(final.match,'details').includes('控球回合'));
});
test('V4 key animation interpolates recorded positions without mirrored synthetic shot movement',()=>{
  const p={id:'a',teamIndex:1,x:10,y:20},q={...p,x:30,y:40};
  const sample=sampleKeyPlay({frames:[{time:2,players:[p],ball:{x:5,y:6}},{time:4,players:[q],ball:{x:9,y:10}}]},.5);
  assert.deepEqual(sample.ball,{x:7,y:8});assert.equal(sample.players[0].x,20);assert.equal(sample.players[0].y,30);
});

test('broadcast summary endpoint requires authorization and rejects caller release-time overrides',async()=>{
  let called=0,refreshed=0;
  const service=createStreamService({authorize:async req=>req.headers.authorization==='Bearer valid'?{subject:'viewer',ownerSide:null}:null});
  service.register('sample',{manifest:{matchId:'sample'},refresh:async()=>{refreshed++;},broadcast:async()=>{called++;return {score:[0,0]};}});
  async function get(suffix,token='valid'){
    let status,body;
    await service.handle({url:'/v4/matches/sample/'+suffix,method:'GET',headers:{authorization:'Bearer '+token}},
      {writeHead:s=>{status=s;},end:b=>{body=JSON.parse(b);}});
    return {status,body};
  }
  assert.equal((await get('broadcast','invalid')).status,403);assert.equal(called,0);
  assert.equal((await get('broadcast?until=99999')).status,400);assert.equal(called,0);
  assert.deepEqual(await get('broadcast'),{status:200,body:{score:[0,0]}});assert.equal(refreshed,1);
});

test('commentary describes released phases, a turnover, a corner and the scorer without repeating routine touches',()=>{
  const input=[event(1,0,'kickoff',0,{text:'主队开球'}),event(2,40,'interception',1,{text:'后腰完成拦截'}),
    event(3,41,'tackle',0,{text:'连续争抢'}),event(4,75,'restart',0,{text:'主队执行角球',restartType:'corner'}),
    event(5,82,'pass',0,{text:'边锋传给中锋'}),event(6,85,'shot',0,{text:'中锋射门'}),
    event(7,86,'goal',0,{text:'进球',scoringSide:0,score:[1,0]})];
  const commentary=createMatchCommentary(),teams=[{name:'主队',players:[{id:'p1',name:'中锋'}]},{name:'客队',players:[]}];
  commentary.consume(input.slice(0,4),teams);
  const resumed=createMatchCommentary(structuredClone(commentary.state));
  resumed.consume(input.slice(4),teams);
  const metrics=createMatchMetrics();metrics.consume(input);
  const feed=resumed.feed(metrics.view(86).events);
  assert.deepEqual(feed.map(e=>e.type),['kickoff','interception','corner','shot','goal']);
  assert.match(feed.at(-1).text,/中锋抓住机会冷静施射洞穿球门.*主队取得领先.*1 : 0/);
  assert.match(feed.at(-2).detail,/边锋传给中锋/);
  assert.ok(Number.isFinite(feed.at(-2).xg));
});

test('伤退替补连续接替原站位，可从旧版公开包重建，球队间同 ID 独立', async()=>{
  const input=demoInput(),team=input.teams[0],starter=team.players.find(p=>p.role==='RB');
  team.bench=['bench1','bench2'].map((id,i)=>({...starter,id,number:20+i,anchor:{x:45,y:34}}));
  const sim=createMatch(input),packets=[];
  const summary=createBroadcastSummary(sim.state.input),head={segments:[]};
  const reader={read:async i=>packets[i]};
  let departing=sim.state.players.find(p=>p.side===0&&p.id===starter.id);
  for(let i=0;i<2;i++){
    const cursor=sim.events.length;
    awardRestart(sim,'throwIn',0,{x:45,y:0},'测试伤退');
    const sub=injurePlayer(sim,departing);
    assert.equal(sub.status,'substituted');
    advanceMatch(sim,12);
    const events=sim.events.slice(cursor).map(e=>publicEvent(e)).filter(Boolean);
    if(i===0)for(const e of events)delete e.departed;
    packets.push({events,frames:encodeFrames(sim.frames.slice(-1).map(f=>publicFrame(f)))});
    head.segments.push({index:i});
    const {match}=await summary(reader,head);
    const player=id=>match.teams[0].players.find(p=>p.id===id);
    departing=sim.state.players.find(p=>p.key===sub.incoming);
    const incoming=player(departing.id);
    assert.equal(incoming.active,true);
    assert.deepEqual(departing.anchor,starter.anchor);
    assert.deepEqual(incoming.position,player(starter.id).position);
    assert.equal(incoming.assignedRole,starter.role);
    assert.equal(player(i?'bench1':starter.id).replacedOnBoard,true);
    assert.equal(match.teams[1].players.find(p=>p.id===starter.id).replacedOnBoard,false);
  }
});

test('播报仅依据正式助攻和已发布事件记录射手里程碑',()=>{
  const teams=[{name:'主队',players:[{id:'p1',name:'射手'},{id:'p2',name:'队友'}]},{name:'客队',players:[]}];
  const c=createMatchCommentary();
  const goal=(id,score,extra={})=>event(id,5300+id,'goal',0,{score,scoringSide:0,...extra});
  c.consume([event(1,5301,'pass',0,{actor:'0:p2'}),goal(2,[1,0])],teams);
  const resumed=createMatchCommentary(JSON.parse(JSON.stringify(c.state)));
  resumed.consume([goal(3,[2,0],{assistId:'p2',special:'superWorldie'}),goal(4,[3,0])],teams);
  const feed=resumed.feed([]);
  assert.doesNotMatch(feed[0].text,/绝杀|助攻/);
  assert.match(feed[1].text,/梅开二度.*助攻：队友/);
  assert.match(feed[2].text,/帽子戏法/);
});

test('绝杀只在终场确认，恢复检查点及直播窗口滚动后仍保留正确的进球词',()=>{
  const teams=[{name:'主队',players:[{id:'p1',name:'中锋'}]},{name:'客队',players:[]}];
  const c=createMatchCommentary();
  c.consume([event(1,5110,'goal',0,{scoringSide:0,score:[1,0],bodyPart:'head'})],teams);
  assert.match(c.feed()[0].text,/比赛尾声.*甩头攻门/);
  for(let id=2;id<116;id++)c.consume([event(id,5110+id,'offside')],teams);
  const saved=JSON.stringify(c.state);
  const resumed=createMatchCommentary(JSON.parse(saved));
  resumed.consume([event(116,5400,'fulltime',null,{score:[1,0]})],teams);
  assert.match(resumed.feed()[0].text,/中锋.*绝杀/);
  const tied=createMatchCommentary(JSON.parse(saved));
  tied.consume([event(116,5399,'goal',1,{scoringSide:1,score:[1,1]}),event(117,5400,'fulltime',null,{score:[1,1]})],teams);
  assert.doesNotMatch(tied.feed()[0].text,/绝杀/);
  assert.match(tied.feed().find(e=>e.id==='v4-116').text,/绝平/);
});

test('戏剧事件、实际特性触发和逐轮点球使用补丁词库',()=>{
  const teams=[{name:'主队',players:[{id:'p1',name:'前锋'}]},{name:'客队',players:[{id:'p1',name:'门神'}]}];
  const c=createMatchCommentary();
  c.consume([
    event(1,1,'woodwork',0,{text:'击中横梁'}),event(2,2,'parry',1),event(3,3,'blackWhistle'),
    event(4,4,'brawl'),event(5,5,'goal',0,{scoringSide:0,score:[1,0],special:'butterFingers',keeperKey:'1:p1'}),
    event(6,6,'traitActivated',0,{traitOpening:true,text:'疯狗来了！专属开场词',level:'highlight'}),
    event(7,7,'shootoutStart'),event(8,8,'shot'),event(9,9,'shootoutResult',0,{goal:true,shootoutScore:[1,0]}),
    event(10,10,'shootoutResult',1,{goal:false,shootoutScore:[1,0]}),event(11,11,'shootoutResult',0,{goal:true,shootoutScore:[2,0]}),
    event(12,12,'traitActivated',0,{traitOpening:true,text:'卷王来了！点球大战决胜时刻',level:'critical'}),
  ].map(e=>publicEvent(e)),teams);
  const rows=c.feed(),byId=id=>rows.find(e=>e.id==='v4-'+id);
  assert.match(byId(1).text,/横梁/);
  assert.match(byId(2).text,/门神.*脱手/);
  assert.match(byId(3).text,/争议.*点球/);
  assert.match(byId(4).text,/群体冲突/);
  assert.match(byId(5).text,/门神.*脱手/);
  assert.equal(byId(5).actorId,'p1');
  assert.equal(byId(6).text,'疯狗来了！专属开场词');
  assert.deepEqual(rows.filter(e=>e.type==='penaltyShootoutKick').map(e=>e.shootoutGoal),[true,false,true]);
  assert.equal(byId(8),undefined);
  assert.match(byId(11).text,/第 2 轮.*2 : 0/);
  assert.match(byId(12).text,/卷王来了/);
});

test('同一个进球在公开直播、完场战报与回看入口具有相同文案、事件号和回放时间',async()=>{
  const sim=createMatch(demoInput({seed:'commentary-report',duration:60,format:'full'}));
  const s=sim.state,scorer=s.players.find(p=>p.side===0 && p.role==='ST');
  s.rules.restartTouch=null;
  s.ball={mode:'loose',holder:null,flight:null,lastTouch:scorer.key,x:104.9,y:34,z:0,vz:0,vx:15,vy:0};
  while(s.phase!=='finished')advanceMatch(sim,100);
  const ledger=createPlayerReportLedger(s.input,s.version);
  ledger.consume(sim.events,(e,id)=>{e.assistId=id;});
  const report=ledger.finish(s),goal=report.importantEvents.find(e=>e.type==='goal');
  assert.ok(goal.text.includes(scorer.name));
  assert.ok(goal.text.includes('1 : 0'));
  const packet={events:sim.events.map(e=>publicEvent(e)).filter(Boolean),frames:encodeFrames(sim.frames.map(f=>publicFrame(f)))};
  const live=await createBroadcastSummary(s.input)({read:async()=>packet},{segments:[{index:0}],complete:true});
  const row=live.match.events.find(e=>e.id===goal.id);
  assert.deepEqual([row.text,row.replayTime,row.assistId],[goal.text,goal.replayTime,goal.assistId]);
  const replay=keyPlayEntries(live.match).find(entry=>entry.event.id===goal.id);
  assert.equal(replay.event.text,goal.text);
  assert.ok(replay.clip.frames.length>=2);
});
