import test from 'node:test';
import assert from 'node:assert/strict';
import {coalitionFixture} from './coalition-fixture.mjs';
import {DAILY_LEAGUE} from '../shared/config/daily-league.mjs';
import {ELITE_CLUBS} from '../shared/config/elite-clubs.mjs';
import {DailyLeagueService,leaguePlayerLocked} from '../server/application/daily-league-service.mjs';
import {buildAccountMatchSeat} from '../shared/football/account-match-seat.mjs';
import {setFitness} from '../shared/football/fitness-lineup.mjs';
import {setAbsence,absenceMatches} from '../shared/football/match-availability.mjs';

import {leagueFixture} from './daily-league-fixture.mjs';
test('09:50 reset keeps final standings overnight and removes yesterday reports and stats only after rewards',()=>{
 const t=leagueFixture(),{f}=t;assert.equal(t.league.ensureDay(),false);t.start();assert.equal(t.league.day.id,'2026-09-22');
 const day=t.league.day;for(const game of day.fixtures){game.status='completed';game.score=[1,0];game.broadcast={large:'old'};}day.stats.old={goals:1};
 assert.equal(t.league.reward(f.now),true);const gold=f.a.gold,packs=f.a.inventory.packs['legendary-player-pack'];assert.equal(t.league.reward(f.now),false);assert.equal(f.a.gold,gold);assert.equal(packs,15);
 f.tick(Date.parse('2026-09-23T09:49:59+08:00')-f.now);assert.equal(t.league.ensureDay(),false);assert.equal(t.league.day,day);
 f.tick(1000);assert.equal(t.league.ensureDay(),true);assert.deepEqual(t.league.day.stats,{});assert.ok(t.league.day.fixtures.every(g=>!g.broadcast));assert.equal(f.a.leagueRewardDay,'2026-09-22');
 t.league.day.rewarded=false;f.tick(86400000);assert.equal(t.league.ensureDay(),false,'unsettled day must survive rollover');
});
test('players use garrison fitness, both sides persist fatigue; defence remains full without mutating roster',()=>{
 const t=leagueFixture();t.start();const {f}=t,aPlayer=f.a.draft.roster.find(p=>p.id.includes('garrison')),bPlayer=f.b.draft.roster.find(p=>p.id.includes('garrison'));
 setFitness(aPlayer,80);setFitness(bPlayer,79);t.league.advance(f.now);const fixture=t.league.day.fixtures[0],leg=t.league.day.live[fixture.id].leg;
 assert.equal(leg.home.players.find(p=>p.id===aPlayer.id).state.fitness,80);assert.equal(leg.away.players.find(p=>p.id===bPlayer.id).state.fitness,79);
 assert.ok(leaguePlayerLocked(f.s.world,f.a.id,aPlayer.id));assert.match(f.s.cardManagement.blocked(f.a,aPlayer),/联赛/);
 const defence=buildAccountMatchSeat(f.a,'garrison',f.now,{fitness:true});assert.equal(defence.players.find(p=>p.id===aPlayer.id).state.fitness,100);assert.equal(aPlayer.state.fitness,80);
 leg.match.teams[0].players.find(p=>p.id===aPlayer.id).state.fitness=42;leg.match.teams[1].players.find(p=>p.id===bPlayer.id).state.fitness=38;
 leg.match.score=[2,1];leg.match.finished=true;leg.match.postMatchConsequences={injuries:[{teamIndex:1,playerId:bPlayer.id,matches:2}],suspensions:[]};
 t.league.settle(fixture,f.now);assert.equal(aPlayer.state.fitness,42);assert.equal(bPlayer.state.fitness,38);assert.equal(absenceMatches(bPlayer,'injury'),2);assert.equal(leaguePlayerLocked(f.s.world,f.a.id,aPlayer.id),false);
 assert.equal(t.league.settle(fixture,f.now),false);assert.equal(f.a.leagueNotices.length,1);assert.equal(f.b.leagueNotices.length,1);
 assert.ok(t.league.snapshot(fixture.id).battle.broadcasts.length);assert.ok(!JSON.stringify(t.league.view(f.a)).includes('archivedFields'));
});
test('settlement and reward disk failures restore both accounts and allow one successful retry',()=>{
 const t=leagueFixture();t.start();const {f}=t;t.league.advance(f.now);let fixture=t.league.day.fixtures[0],leg=t.league.day.live[fixture.id].leg;leg.match.finished=true;leg.match.score=[1,0];leg.match.teams[0].players[0].state.fitness=31;
 const before=f.a.draft.roster.find(p=>p.id===leg.match.teams[0].players[0].id).state.fitness;
 f.fail(true);assert.throws(()=>t.league.settle(fixture,f.now),/disk/);assert.equal(f.a.draft.roster.find(p=>p.id===leg.match.teams[0].players[0].id).state.fitness,before);assert.equal(f.a.leagueNotices,undefined);assert.equal(t.league.day.fixtures[0].status,'live');
 f.fail(false);fixture=t.league.day.fixtures[0];t.league.settle(fixture,f.now);for(const g of t.league.day.fixtures){g.status='completed';g.score=[1,0];}
 const gold=f.a.gold;f.fail(true);assert.throws(()=>t.league.reward(f.now),/disk/);assert.equal(f.a.gold,gold);assert.equal(t.league.day.rewarded,false);f.fail(false);t.league.reward(f.now);assert.equal(f.a.gold,gold+100000);
});
test('match restart restores deterministic RNG and league data survives world hydration',()=>{
 const t=leagueFixture();t.start();const {f}=t;t.league.advance(f.now);const id=t.league.day.fixtures[0].id;f.tick(10000);t.league.advance(f.now,{maximumChainsPerMatch:5});f.s.persist();const chain=t.league.day.live[id].leg.match.nextChainIndex;f.reload();
 assert.equal(f.s.dailyLeague.day.live[id].leg.match.nextChainIndex,chain);assert.equal(typeof f.s.dailyLeague.day.live[id].leg.match.rng,'function');assert.equal(f.s.dailyLeague.day.fixtures.length,2);
});
test('injured keeper with no reserve forfeits without blocking the next game or producing tickets',()=>{
 const t=leagueFixture();t.start();const p=t.f.a.draft.roster.find(p=>p.id.includes('garrison')&&p.pool==='GK');setAbsence(p,'injury',2);t.league.advance(t.f.now);
 assert.equal(t.league.day.fixtures[0].forfeit,true);assert.deepEqual(t.league.day.fixtures[0].score,[0,3]);assert.equal(t.league.day.fixtures[0].tickets,undefined);assert.deepEqual(t.league.day.live,{});
});
test('ten-team production roster resolves exact usernames, preserves NPC markers and plays bounded live set',()=>{
 const t=leagueFixture({ten:true});t.start();assert.equal(t.league.day.teams.length,10);assert.equal(t.league.day.fixtures.length,90);assert.equal(t.league.day.teams.filter(t=>t.name.includes('〔豪门〕')).length,4);
 for(let i=0;i<20;i++)t.league.advance(t.f.now);assert.equal(Object.keys(t.league.day.live).length,5);assert.equal(t.league.day.fixtures.filter(f=>f.status==='scheduled').length,85);
 const view=t.league.view(t.f.a);assert.equal(view.standings.length,10);assert.ok(!('live' in view));assert.ok(view.fixtures.every(f=>!f.leg&&!f.broadcast));
});
import {createCampaignApiHandler} from '../server/http/campaign-api-handler.mjs';
test('ticket demand and modifier are frozen at kickoff, paid once with result and visible in notification',()=>{
 const t=leagueFixture();t.start();const {f}=t;f.a.resources={fans:10000};f.s.world.territories.a.buildings=[{id:'stadium',type:'main-stadium',level:1,status:'active'}];
 f.s.wonders.ticketIncome=(account,match,gold)=>gold*2;t.league.advance(f.now);const fixture=t.league.day.fixtures[0];assert.equal(t.league.day.live[fixture.id].tickets.gold,1000);
 f.a.resources.fans=999999;f.s.world.territories.a.buildings[0].level=5;const gold=f.a.gold,leg=t.league.day.live[fixture.id].leg;leg.match.finished=true;leg.match.score=[1,0];
 t.league.settle(fixture,f.now);assert.equal(f.a.gold,gold+1000);assert.equal(fixture.tickets.attendance,5000);assert.match(f.a.leagueNotices[0].text,/1000/);assert.equal(t.league.settle(fixture,f.now),false);assert.equal(f.a.gold,gold+1000);
});
test('authenticated summary and spectator API never advance or persist league; read ACK is idempotent',async()=>{
 const t=leagueFixture();t.start();t.league.advance(t.f.now);const handler=createCampaignApiHandler({campaign:t.f.s}),game=t.league.day.fixtures[0];
 const invoke=async(path,token='a')=>{let result;await handler({method:'GET',headers:{authorization:'Bearer '+token}},{writeHead(){},end:body=>{result=JSON.parse(body);}},path.split('?')[0],'http://localhost'+path);return result;};
 let saves=0;const persist=t.f.s.persist.bind(t.f.s);t.f.s.persist=()=>{saves++;persist();};const chain=t.league.day.live[game.id].leg.match.nextChainIndex;
 assert.equal((await invoke('/api/campaign/league')).league.standings.length,2);assert.ok((await invoke('/api/campaign/league/match?id='+encodeURIComponent(game.id),'b')).live.broadcast);assert.equal(saves,0);assert.equal(t.league.day.live[game.id].leg.match.nextChainIndex,chain);
 await assert.rejects(()=>invoke('/api/campaign/league','invalid'));
 t.league.notify(t.f.a,{id:'notice',title:'test'});t.league.read(t.f.a,'notice');t.league.read(t.f.a,'notice');assert.equal(saves,1);assert.equal(t.league.summary(t.f.a).unread.length,0);
});
test('league frame progress requests at most one checkpoint per 30 seconds, kickoff is already persisted',()=>{
 const t=leagueFixture();t.start();assert.equal(t.league.advance(t.f.now),false);t.f.tick(10000);assert.equal(t.league.advance(t.f.now),false);t.f.tick(20000);assert.equal(t.league.advance(t.f.now),true);assert.equal(t.league.advance(t.f.now),false);
});
test('reset failure preserves all old reports and payout marker, successful reset prunes old wonder receipts',()=>{
 const t=leagueFixture();t.start();const {f}=t;const day=t.league.day;day.rewarded=true;day.stats.old={goals:1};day.fixtures[0].broadcast={sentinel:true};f.a.wonderHomeEvents={old:{day:'2026-09-22'}};
 f.tick(Date.parse('2026-09-23T09:50:00+08:00')-f.now);f.fail(true);assert.throws(()=>t.league.ensureDay(),/disk/);assert.deepEqual(t.league.day.stats,{old:{goals:1}});assert.equal(t.league.day.fixtures[0].broadcast.sentinel,true);assert.ok(f.a.wonderHomeEvents.old);
 f.fail(false);t.league.ensureDay();assert.deepEqual(f.a.wonderHomeEvents,{});assert.equal(t.league.day.id,'2026-09-23');
});
test('scorer and assist boards consume actual engine matchStats, separated by team and player ID',()=>{
 const t=leagueFixture();t.start();t.league.advance(t.f.now);const fixture=t.league.day.fixtures[0],leg=t.league.day.live[fixture.id].leg;
 const home=leg.match.teams[0].players.find(p=>p.startedMatch),away=leg.match.teams[1].players.find(p=>p.startedMatch);home.name=away.name='同名球员';home.matchStats.goals=2;home.matchStats.assists=1;away.matchStats.goals=1;away.matchStats.assists=2;leg.match.score=[2,1];leg.match.finished=true;
 t.league.settle(fixture,t.f.now);const v=t.league.view(t.f.a);assert.equal(v.scorers[0].playerId,home.id);assert.equal(v.scorers[0].goals,2);assert.equal(v.assists[0].playerId,away.id);assert.equal(v.assists[0].assists,2);assert.equal(v.scorers.length,2);assert.ok(v.scorers[0].ratingTotal>0);
});
import {setTestWar} from './diplomacy-fixture.mjs';
test('league and map invasion coexist: defence gets full fitness and live league roster remains unchanged',()=>{
 const t=leagueFixture({ten:true});t.start();const {f}=t;f.s.save();f.a.gold=100000;for(let i=0;i<5;i++)t.league.advance(f.now);setTestWar(f.s.world,'a','b');
 const player=f.b.draft.roster.find(p=>p.id.includes('garrison')),live=Object.values(t.league.day.live).find(x=>x.leg.match.teams.some(team=>team.id==='b'));
 const participant=live.leg.match.teams.find(team=>team.id==='b').players.find(p=>p.id===player.id);participant.state.fitness=47;setFitness(player,47);
 const challenge=f.begin();assert.ok(challenge.live.defender.players.filter(p=>p.active!==false).every(p=>p.state.fitness===100));assert.equal(player.state.fitness,47);assert.equal(participant.state.fitness,47);
 f.tick(1000);for(let i=0;i<5;i++){t.league.advance(f.now);f.s.challenges.advance(f.now,{maximumMatches:1,maximumChainsPerMatch:1});}assert.equal(Object.keys(t.league.day.live).length,5);assert.ok(f.s.challenges);assert.ok(f.s.state(f.b).dailyLeague);
});

test('pre-schedule standings show resolved players and NPCs with zero data without generating or saving a season',()=>{
 const t=leagueFixture({ten:true});let saves=0;t.f.s.persist=()=>saves++;
 const view=t.league.view(t.f.a);assert.equal(view.day,null);assert.equal(view.standings.length,10);assert.equal(view.standings.filter(t=>t.kind==='player').length,6);
 for(const row of view.standings)for(const key of ['played','won','drawn','lost','goalsFor','goalsAgainst','points','goalDifference'])assert.equal(row[key],0);
 assert.deepEqual(view.fixtures,[]);assert.equal(saves,0);assert.equal(t.league.day,null);
});
test('spectators are authenticated account names, deduplicated across tabs, ephemeral and removed by exit or TTL',()=>{
 const t=leagueFixture();t.start();t.league.advance(t.f.now);const {f}=t,id=t.league.day.fixtures[0].id,chain=t.league.day.live[id].leg.match.nextChainIndex;let saves=0;f.s.persist=()=>saves++;
 assert.equal(t.league.summary(f.a).liveCount,1);
 t.league.watch(f.a,id,'tab-a-0001');t.league.watch(f.a,id,'tab-a-0002');let view=t.league.watch(f.b,id,'tab-b-0001');assert.equal(view.spectators.length,2);assert.deepEqual(view.spectators.map(v=>v.name).sort(),['a','b']);
 assert.equal(t.league.view(f.a).fixtures[0].spectators.length,2);t.league.leave(f.b,id,'tab-a-0001');assert.equal(t.league.audience(id).length,2);
 t.league.leave(f.a,id,'tab-a-0001');assert.equal(t.league.audience(id).length,2);t.league.leave(f.a,id,'tab-a-0002');assert.equal(t.league.audience(id).length,1);
 f.tick(30000);assert.deepEqual(t.league.audience(id),[]);assert.equal(saves,0);assert.equal(t.league.day.live[id].leg.match.nextChainIndex,chain);assert.ok(!JSON.stringify(t.league.day).includes('tab-a-0001'));
 assert.throws(()=>t.league.watch(f.a,id,'bad'),/会话无效/);assert.throws(()=>t.league.watch(f.a,'missing','tab-a-0001'),/不存在/);
 for(let n=0;n<20;n++)t.league.watch(f.a,id,'tab-number-'+n);assert.equal(t.league.viewers.size,8);
 t.league.day.live={};assert.deepEqual(t.league.audience(id),[]);assert.equal(t.league.summary(f.a).liveCount,0);
});
test('watch and leave HTTP endpoints require authentication and ignore supplied spectator names',async()=>{
 const t=leagueFixture();t.start();t.league.advance(t.f.now);const id=t.league.day.fixtures[0].id,handler=createCampaignApiHandler({campaign:t.f.s});let saves=0;t.f.s.persist=()=>saves++;
 const invoke=async(action,token,body)=>{let value;const request={method:'POST',headers:{authorization:'Bearer '+token},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};await handler(request,{writeHead(){},end:s=>value=JSON.parse(s)},'/api/campaign/league/'+action,'http://localhost/api/campaign/league/'+action);return value;};
 await assert.rejects(()=>invoke('watch','invalid',{id,session:'tab-http-1'}));assert.deepEqual(t.league.audience(id),[]);
 const result=await invoke('watch','a',{id,session:'tab-http-1',name:'fake'});assert.equal(result.spectators[0].name,'a');await invoke('leave','a',{id,session:'tab-http-1'});assert.deepEqual(t.league.audience(id),[]);assert.equal(saves,0);
});

test('league tickets use the actual owned match venue even when the stadium is outside headquarters',()=>{
 const t=leagueFixture();t.start();const {f}=t;f.a.resources={fans:10000};
 f.s.world.territories.a.buildings=[];
 f.s.world.territories['stadium-annex']={id:'stadium-annex',ownerId:f.a.id,buildings:[{id:'annex-stadium',type:'main-stadium',status:'active',level:1,upgradeTo:2}]};
 const venue=f.s.sponsorMatchVenue(f.a,f.now);assert.equal(venue.stadiumId,'annex-stadium');assert.ok(venue.seatingCapacity>0);
 t.league.advance(f.now);const game=t.league.day.fixtures[0],live=t.league.day.live[game.id];
 assert.equal(live.tickets.capacity,venue.seatingCapacity);assert.equal(live.tickets.attendance,5000);assert.equal(live.tickets.gold,500);
 const before=f.a.gold;live.leg.match.finished=true;live.leg.match.score=[1,0];t.league.settle(game,f.now);assert.equal(f.a.gold,before+500);assert.match(f.a.leagueNotices[0].text,/5000/);
});
test('league does not sell seats from an enemy stadium on the former headquarters territory',()=>{
 const t=leagueFixture();t.start();const {f}=t;f.a.resources={fans:10000};f.s.world.territories.a.ownerId=f.b.id;
 f.s.world.territories.a.buildings=[{id:'lost-stadium',type:'main-stadium',status:'active',level:1}];
 t.league.advance(f.now);const live=Object.values(t.league.day.live)[0];assert.equal(live.tickets.attendance,0);assert.equal(live.tickets.gold,0);
});
