import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {leagueFixture} from '../test/daily-league-fixture.mjs';
const t=leagueFixture({ten:true}),{f}=t,out='outputs/daily-league-review';fs.mkdirSync(out,{recursive:true});
t.start();f.s.save();for(const a of f.s.accounts.values())a.resources={...a.resources,fans:10000};
for(const a of [f.a,f.b])f.s.world.territories[a.homeTerritoryId].buildings.push({id:'league-stadium-'+a.id,type:'main-stadium',status:'active',level:1,ownerId:a.id});
const durations=[],start=performance.now();let maxLive=0;
for(let round=1;round<=18;round++){
 const games=t.league.day.fixtures.filter(g=>g.round===round),target=games[0].startsAt;if(f.now<target)f.tick(target-f.now);f.s.save();
 for(let i=0;i<5;i++){const at=performance.now();t.league.advance(f.now);durations.push(performance.now()-at);maxLive=Math.max(maxLive,Object.keys(t.league.day.live).length);}
 f.tick(125000);
 for(let i=0;i<1000&&games.some(g=>g.status!=='completed');i++){const at=performance.now();t.league.advance(f.now,{maximumChainsPerMatch:1});durations.push(performance.now()-at);}
 assert.ok(games.every(g=>g.status==='completed'),'round '+round);console.log('Completed round '+round);fs.writeFileSync(out+'/season-progress.json',JSON.stringify({round,elapsedMs:performance.now()-start}));
}
t.league.advance(f.now);assert.ok(t.league.day.rewarded);const view=t.league.view(f.a);assert.ok(view.standings.every(r=>r.played===18));
assert.equal(view.fixtures.length,90);assert.equal(Object.keys(t.league.day.live).length,0);assert.ok(view.scorers.length);assert.ok(view.assists.length);
for(const a of f.s.accounts.values()){assert.equal(a.leagueRewardDay,t.league.day.id);assert.ok(a.leagueNotices.length<=24);assert.equal(a.leagueNotices.filter(n=>n.kind==='reward').length,1);}
const completed=t.league.day.fixtures.filter(g=>!g.forfeit);assert.ok(completed.length>0);assert.ok(completed.every(g=>g.broadcast||g.archivedFields));
const gold=f.a.gold;t.league.reward(f.now);assert.equal(f.a.gold,gold);
const beforeBytes=Buffer.byteLength(JSON.stringify(t.league.day)),beforeMemory=process.memoryUsage();
const p95=[...durations].sort((a,b)=>a-b)[Math.floor(durations.length*.95)];
f.tick(Date.parse('2026-09-23T09:49:59+08:00')-f.now);assert.equal(t.league.ensureDay(),false);assert.equal(t.league.day.id,'2026-09-22');
f.tick(1000);assert.equal(t.league.ensureDay(),true);assert.equal(Object.keys(t.league.day.stats).length,0);assert.ok(t.league.day.fixtures.every(g=>!g.broadcast&&!g.archivedFields));
const result={synthetic:true,realMatches:completed.length,forfeits:90-completed.length,maxLive,elapsedMs:performance.now()-start,sliceP95Ms:p95,sliceMaxMs:Math.max(...durations),finishedDayBytes:beforeBytes,resetDayBytes:Buffer.byteLength(JSON.stringify(t.league.day)),memory:beforeMemory};
fs.writeFileSync(out+'/season-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
