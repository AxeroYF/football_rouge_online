import test from 'node:test';
import assert from 'node:assert/strict';
import {leagueSchedule,leagueStandings,leagueTicket,leagueDate,LEAGUE_REWARDS} from '../shared/config/daily-league.mjs';
test('ten-team double round robin has 90 unique games, 18 rounds and nine home/away games per team',()=>{
 const ids=Array.from({length:10},(_,i)=>'t'+i),fixtures=leagueSchedule(ids,'2026-09-22');
 assert.equal(fixtures.length,90);assert.equal(new Set(fixtures.map(f=>f.homeId+':'+f.awayId)).size,90);
 for(let r=1;r<=18;r++){const games=fixtures.filter(f=>f.round===r);assert.equal(games.length,5);assert.equal(new Set(games.flatMap(f=>[f.homeId,f.awayId])).size,10);}
 for(const id of ids){assert.equal(fixtures.filter(f=>f.homeId===id).length,9);assert.equal(fixtures.filter(f=>f.awayId===id).length,9);}
 assert.equal(fixtures[0].startsAt,Date.parse('2026-09-22T10:00:00+08:00'));assert.equal(fixtures.at(-1).startsAt,Date.parse('2026-09-22T18:30:00+08:00'));
 assert.deepEqual(fixtures,leagueSchedule(ids,'2026-09-22'));
});
test('same-named teams remain distinct; draws, wins and goals produce standings without live-match leakage',()=>{
 const day={teams:[{id:'a',name:'巴萨'},{id:'npc',name:'巴萨'},{id:'b',name:'B'}],fixtures:[{homeId:'a',awayId:'npc',status:'completed',score:[2,1]},{homeId:'a',awayId:'b',status:'completed',score:[1,1]},{homeId:'npc',awayId:'b',status:'live',score:[10,0]}]};
 const rows=leagueStandings(day);assert.deepEqual(rows.map(r=>[r.id,r.points,r.played]),[['a',4,2],['b',1,1],['npc',0,1]]);
});
test('tickets use fan demand and seat ceiling; reward endpoints and local day are explicit',()=>{
 assert.deepEqual(leagueTicket(5000,30000),{attendance:2500,capacity:30000,price:.1,gold:250});assert.equal(leagueTicket(999999,30000).gold,3000);
 assert.equal(leagueTicket(-1,30000).gold,0);assert.equal(leagueDate(Date.parse('2026-09-21T16:00:00Z')),'2026-09-22');
 assert.deepEqual(LEAGUE_REWARDS[0],{rank:1,gold:100000,packs:15});assert.deepEqual(LEAGUE_REWARDS.at(-1),{rank:10,gold:50000,packs:8});
});
