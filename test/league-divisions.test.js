import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {divisionStandings,assignInitialDivisions} from '../versus/league-format.js';
const now=()=>Date.parse('2026-11-16T10:00:00+08:00');
const service=()=>new YellowDogsLeagueService({statePath:null,now,rng:()=>.37});
const complete=s=>{s.state.season.status='completed';s.state.season.currentRound=14;s.state.season.completedAt=now()-3600000;s.state.rounds.forEach(r=>{r.status='complete';});};

test('two eight-team divisions play 14 rounds with exactly one home and away meeting',()=>{
 const s=service();assert.equal(s.state.teams.length,16);assert.equal(s.state.rounds.length,14);
 assert.equal(new Set(s.state.teams.map(t=>t.name)).size,16);
 const pairs=new Map(),home=new Map(),away=new Map();
 for(const r of s.state.rounds){
  assert.equal(r.fixtures.length,8);assert.equal(new Set(r.fixtures.flatMap(f=>[f.homeId,f.awayId])).size,16);
  for(const f of r.fixtures){
   const h=s.state.teams.find(t=>t.id===f.homeId),a=s.state.teams.find(t=>t.id===f.awayId);
   assert.equal(h.division,a.division);assert.equal(f.division,h.division);
   const key=f.homeId+':'+f.awayId;pairs.set(key,(pairs.get(key)??0)+1);
   home.set(h.id,(home.get(h.id)??0)+1);away.set(a.id,(away.get(a.id)??0)+1);
  }
 }
 assert.equal(pairs.size,112);assert.ok([...pairs.values()].every(n=>n===1));
 assert.ok([...home.values(),...away.values()].every(n=>n===7));
 for(const t of s.state.teams)assert.equal(new Set(t.rosterIds).size,23);
 for(const d of ['A','B'])assert.deepEqual(s.standings(d).map(t=>t.rank),[1,2,3,4,5,6,7,8]);
});

test('initial placement prioritizes human teams and uses results for remaining spots',()=>{
 const s=service();s.state.teams.forEach((t,i)=>{t.table.points=100-i;t.ownerId=i>=14?'human-'+i:null;});
 assignInitialDivisions(s.state.teams);
 assert.ok(s.state.teams.slice(14).every(t=>t.division==='A'));
 assert.ok(s.state.teams.slice(0,6).every(t=>t.division==='A'));
 assert.ok(s.state.teams.slice(6,14).every(t=>t.division==='B'));
});

test('promotion and relegation are based on completed season and applied only once',()=>{
 const s=service();s.state.teams.forEach((t,i)=>{t.table.points=40-i;});
 const original=s.state.teams.map(t=>t.division);
 assert.equal(s.applyDivisionMovement(),null);assert.deepEqual(s.state.teams.map(t=>t.division),original);
 const table=s.standings(),expectedUp=table.filter(t=>t.division==='B').slice(0,2).map(t=>t.id),expectedDown=table.filter(t=>t.division==='A').slice(-2).map(t=>t.id);
 complete(s);const result=s.applyDivisionMovement();
 assert.deepEqual(result.promoted,expectedUp);assert.deepEqual(result.relegated,expectedDown);
 const after=s.state.teams.map(t=>t.division);s.applyDivisionMovement();assert.deepEqual(s.state.teams.map(t=>t.division),after);
 assert.equal(s.state.competitionFormat.movements.length,1);for(const d of ['A','B'])assert.equal(s.state.teams.filter(t=>t.division===d).length,8);
});

test('daily reset archives old division ranks, applies movement and rebuilds both schedules',()=>{
 const s=service();complete(s);s.state.cup.status='completed';s.state.dailyAutomation.lastRewardedSeasonId=s.state.season.id;
 const old=s.state.season.id,up=s.standings('B')[0].id;
 s.resetDailyCompetitions({manual:true,skipBackup:true});
 assert.equal(s.state.teams.find(t=>t.id===up).division,'A');assert.equal(s.state.rounds.length,14);
 assert.equal(s.state.archives.at(-1).standings.find(t=>t.id===up).division,'B');
 assert.equal(s.state.competitionFormat.movements[0].seasonId,old);assert.equal(s.state.season.currentRound,0);
});

test('16-team cup contains 29 matches across 7 events and no group stage',()=>{
 const s=service();
 for (let index = 0; index < 16; index++) {
   const owner = { id:`cup-owner-${index}`, nickname:`杯赛经理${index}` };
   s.beginDraft(owner, `杯赛球队${index}`);
   s.autoDraft(owner);
   s.finishDraft(owner);
 }
 s.startCup();assert.equal(s.state.cup.participants.length,16);assert.equal(s.state.cup.leagueRounds.length,0);
 const events=[];let matches=0;
 while(s.state.cup.status!=='completed'){
  const e=s.state.cup.events.find(e=>e.status==='pending');assert.ok(e);events.push(e.stage+':'+e.leg);
  const fixtures=s.cupEventFixtures(e);matches+=fixtures.length;
  for(const f of fixtures){f.score=[1,0];f.status='complete';f.winnerId=f.homeId;}
  s.completeCupEvent(e);
  const count=s.state.cup.events.length;s.completeCupEvent(e);assert.equal(s.state.cup.events.length,count);
 }
 const awards = s.state.ledger.filter(entry => entry.type === 'cup-pack-reward');
 for (const [stage, packType, quantity] of [['roundOf16','public-random',1], ['quarterfinals','cup-private-position',1], ['semifinals','public-random',2]]) {
   const winners = s.state.cup.knockout[stage].map(tie => s.state.teams.find(team => team.id === tie.winnerId).ownerId).sort();
   const payments = awards.filter(entry => entry.stage === stage);
   assert.deepEqual(payments.map(entry => entry.accountId).sort(), winners);
   assert.ok(payments.every(entry => entry.packType === packType && entry.quantity === quantity));
 }
 assert.equal(awards.length, 16);
 assert.equal(matches,29);assert.deepEqual(events,['roundOf16:1','roundOf16:2','quarterfinals:1','quarterfinals:2','semifinals:1','semifinals:2','final:1']);
 assert.ok(s.state.cup.championId);assert.equal(s.state.cup.knockout.final[0].legs.length,1);
 assert.equal(s.ensureSeasonFinalTournament(),null);
});

test('season final and its rewards, bans and forced mirrors are disabled',()=>{
 const s=service(),user={id:'owner',nickname:'玩家'};s.beginDraft(user,'禁用测试');s.autoDraft(user);s.finishDraft(user);
 const team=s.accountTeam(user.id),before=JSON.stringify(s.state.s4Packs);
 s.state.seasonFinalTournament={id:'old-final',seasonId:s.state.season.id,status:'scheduled',seedSnapshot:[{teamId:team.id,isAi:false,seed:1}]};
 assert.equal(s.ensureSeasonFinalTournament(),null);assert.equal(s.seasonFinalTournamentView(),null);
 assert.equal(s.grantSeasonFinalPlacementReward(team.id,{id:'x'},'champion'),null);
 assert.deepEqual(s.seasonFinalBannedPlayerIds(team.id),[]);assert.deepEqual(s.forcedSeedMirrorTeams(),[]);
 assert.throws(()=>s.simulateNextSeasonFinalMatch(),/停用/);assert.equal(JSON.stringify(s.state.s4Packs),before);
 complete(s);s.state.cup.status='completed';assert.ok(s.settleDailySeason({manual:true}));
});

test('legacy ten-team save migrates once without losing assets and refunds pending predictions',()=>{
 const s=service(),user={id:'legacy',nickname:'旧玩家'};s.beginDraft(user,'保留队');s.autoDraft(user);s.finishDraft(user);
 const raw=JSON.parse(JSON.stringify(s.state));delete raw.competitionFormat;
 // Retain the actual player's seat; joining no longer consumes team zero.
 raw.teams.sort((a,b)=>Number(Boolean(b.ownerId))-Number(Boolean(a.ownerId)));
 raw.teams=raw.teams.slice(0,10);raw.teams.forEach(t=>delete t.division);
 raw.season.currentRound=4;raw.season.totalRounds=18;raw.teams[0].table.points=0;
 raw.matchPredictions.bets=[{id:'old-bet',accountId:user.id,amount:120,status:'pending'}];
 const assets=JSON.stringify(raw.s4Assets),ids=[...raw.teams[0].rosterIds],balance=raw.wallets[user.id].balance;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-divisions-')),file=path.join(dir,'league.json');fs.writeFileSync(file,JSON.stringify(raw));
 const migrated=new YellowDogsLeagueService({statePath:file,now,rng:()=>.37});
 assert.equal(migrated.state.teams.length,16);assert.equal(migrated.state.teams[0].division,'A');
 assert.deepEqual(migrated.state.teams[0].rosterIds,ids);assert.equal(JSON.stringify(migrated.state.s4Assets),assets);
 assert.equal(migrated.wallet(user.id).balance,balance+120);assert.equal(migrated.state.archives.at(-1).season.currentRound,4);
 const reopened=new YellowDogsLeagueService({statePath:file,now,rng:()=>.37});
 assert.equal(reopened.state.archives.length,migrated.state.archives.length);assert.equal(reopened.wallet(user.id).balance,balance+120);
 assert.equal(reopened.state.rounds.length,14);
});

test('live legacy fixtures delay migration until settlement',()=>{
 const s=service();delete s.state.competitionFormat;s.state.teams=s.state.teams.slice(0,10);
 s.state.liveRound={matches:[]};const old=s.state.season.id;
 assert.equal(s.ensureCompetitionFormat(),false);assert.equal(s.state.teams.length,10);assert.equal(s.state.season.id,old);
 s.state.liveRound=null;assert.equal(s.ensureCompetitionFormat(),true);assert.equal(s.state.teams.length,16);
});

test('both divisions receive rank rewards once and the next daily boundary moves teams',()=>{
 let time=now();const s=new YellowDogsLeagueService({statePath:null,now:()=>time,rng:()=>.37});
 const users=[{id:'a-user',nickname:'A级玩家'},{id:'b-user',nickname:'B级玩家'}];
 for(const u of users){s.beginDraft(u,u.nickname);s.autoDraft(u);s.finishDraft(u);}
 const a=s.accountTeam(users[0].id),b=s.accountTeam(users[1].id);
 for(const [team,division] of [[a,'A'],[b,'B']]){
   if(team.division===division)continue;
   const swap=s.state.teams.find(t=>!t.ownerId&&t.division===division);
   swap.division=team.division;team.division=division;
 }
 a.table.points=99;b.table.points=99;
 complete(s);s.state.cup.status='completed';
 const settled=s.settleDailySeason({manual:true});assert.equal(settled.recipients.length,2);
 assert.ok(settled.recipients.every(r=>r.rank===1));assert.equal(new Set(settled.recipients.map(r=>r.division)).size,2);
 const wallets=JSON.stringify(s.state.wallets),packs=JSON.stringify(s.state.s4Packs);s.settleDailySeason({manual:true});
 assert.equal(JSON.stringify(s.state.wallets),wallets);assert.equal(JSON.stringify(s.state.s4Packs),packs);
 time=Date.parse('2026-11-17T09:52:00+08:00');assert.equal(s.runDailyAutomation(),true);
 assert.equal(b.division,'A');assert.equal(s.state.competitionFormat.movements.length,1);assert.equal(s.state.season.currentRound,0);
 s.runDailyAutomation();assert.equal(s.state.competitionFormat.movements.length,1);
 time=Date.parse('2026-11-17T10:01:00+08:00');s.runDailyAutomation();assert.equal(s.state.cup.stage,'roundOf16');
});
