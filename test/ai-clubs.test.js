import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_CLUBS} from '../versus/public/ai-club-config.js';
import {installAiClub,planAiClub} from '../versus/ai-clubs.js';
import {REAL_PLAYERS,REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {resolveV2PlayerDuty} from '../versus/v2/player-duties-v2.js';
import {advanceYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';
const service=()=>new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-16T10:00:00+08:00'),rng:()=>.37});

test('ten clubs have stable 23-player rosters, 3 goalkeepers, two valid tactical boards and S/A additions',()=>{
 for(const [index,club] of AI_CLUBS.entries()){
  const team={id:`club-${index}`,rosterIds:[]};installAiClub(team,index,REAL_PLAYERS);
  assert.equal(team.name,club.name);assert.equal(new Set(team.rosterIds).size,23);
  assert.equal(team.rosterIds.filter(id=>REAL_PLAYER_BY_ID[id].role==='GK').length,3);
  assert.equal(team.lineupSchemes.length,2);
  for(const addition of team.aiClub.additions)assert.ok(['S','A'].includes(REAL_PLAYER_BY_ID[addition.playerId].grade));
  assert.equal(team.rosterIds.some(id=>REAL_PLAYER_BY_ID[id].grade==='X'),false);
  for(const schemeIndex of [0,1]){
   const plan=planAiClub(team,REAL_PLAYERS,{schemeIndex});
   assert.equal(plan.lineup.length,11);assert.equal(plan.substitutes.length,12);
   assert.equal(plan.lineup.filter(p=>p.role==='GK').length,1);
   assert.equal(plan.configuration.tacticalPlans.opening.rotationPolicy,undefined);
   assert.notDeepEqual(plan.configuration.positionPresets.position1,plan.configuration.positionPresets.position2);
   assert.notDeepEqual(plan.configuration.positionPresets.position1,plan.configuration.positionPresets.position3);
   for(const phase of Object.values(plan.configuration.tacticalPlans))for(const player of plan.lineup){
    if(player.assignedRole==='GK')continue;
    const value=phase.playerDuties[player.id];assert.equal(resolveV2PlayerDuty(player.assignedRole,value),value);
    assert.ok(player.role===player.assignedRole||player.secondaryRole===player.assignedRole);
   }
  }
  const before=JSON.stringify(team);assert.equal(installAiClub(team,index,REAL_PLAYERS),false);assert.equal(JSON.stringify(team),before);
 }
});

test('club training supports both boards, enhancement and deterministic repeat without changing league assets',()=>{
 const s=service(),user={id:'trainer',nickname:'训练经理'};
 s.beginDraft(user,'训练队');s.autoDraft(user);s.finishDraft(user);
 const before=JSON.stringify({assets:s.state.s4Assets,ai:s.state.teams.filter(t=>!t.ownerId)});
 const config={clubId:'inter',schemeIndex:1,upgradeLevel:4,trainingSeed:'repeat-case'};
 const prepared=s.systemAiTrainingSeat(config);
 assert.equal(prepared.seat.players.length,23);
 assert.equal(prepared.seat.tacticalPlans.opening.rotationPolicy,undefined);
 assert.ok(prepared.seat.players.every(p=>p.state.fitness===100));
 const run=()=>{
  const result=s.createAiTraining(user,config);
  const live=[...s.liveAiTrainings.values()][0];
  for(let i=0;i<5&&!live.match.report;i++)advanceYdlLeagueV2Match(live.match,live.startedAt+1_000_000+i*100_000,{maximumChains:Infinity});
  assert.ok(live.match.report);
  return {score:live.match.report.score,players:live.match.report.teams[1].players.map(p=>[p.id,p.stats.goals,p.stats.assists])};
 };
 assert.deepEqual(run(),run());
 assert.equal(JSON.stringify({assets:s.state.s4Assets,ai:s.state.teams.filter(t=>!t.ownerId)}),before);
 assert.throws(()=>s.systemAiTrainingSeat({clubId:'missing'}),/未知/);
 assert.throws(()=>s.systemAiTrainingSeat({clubId:'inter',upgradeLevel:9}),/强化/);
 assert.throws(()=>s.systemAiTrainingSeat({clubId:'inter',traitIds:['aerial-beacon']}),/特性/);
 const withTrait=s.systemAiTrainingSeat({clubId:'inter',upgradeLevel:4,traitIds:['aerial-beacon']});
 assert.ok(withTrait.seat.players.some(p=>p.traits.includes('aerial-beacon')));
 assert.ok(withTrait.seat.players.filter(p=>p.role==='GK').every(p=>!p.traits.length));
 const custom={formation:'4-3-3',averageOverall:85,trainingSeed:'same-roster'};
 assert.deepEqual(s.systemAiTrainingSeat(custom),s.systemAiTrainingSeat(custom));
 assert.equal(s.systemAiTrainingSeat({...custom,trainingStyle:'press'}).seat.tacticalPlans.opening.defensiveBlock,'highPress');
 s.state.season.status='completed';
 s.createMirrorBatchSimulation(user,{...config,requestId:'repeat-batch',totalMatches:10});
 const job=s.state.mirrorMarketplace.batchJobs[0];
 assert.equal(job.trainingSeed,'repeat-case');assert.equal(job.opponentSeat.players.length,23);
 assert.equal(s.mirrorBatchMatchSeed(job,1),s.mirrorBatchMatchSeed({...job,id:'another-job'},1));
 assert.notEqual(s.mirrorBatchMatchSeed(job,1),s.mirrorBatchMatchSeed(job,2));
 assert.notEqual(s.mirrorBatchMatchSeed({...job,mirrorTeamId:'human-mirror'},1),s.mirrorBatchMatchSeed(job,1));
});

test('upgrading at a season boundary preserves human assets and does not rewrite archived AI records',()=>{
 const s=service(),user={id:'owner',nickname:'玩家'};
 s.beginDraft(user,'保留球队');s.autoDraft(user);s.finishDraft(user);
 const human=s.accountTeam(user.id),assets=JSON.stringify(s.state.s4Assets),ids=[...human.rosterIds];
 const ai=s.state.teams.find(t=>!t.ownerId);delete ai.aiClub;ai.name='旧球队';ai.rosterIds=[];
 s.state.season.currentRound=2;s.upgradeAiClubs();assert.equal(ai.name,'旧球队');
 s.state.playerStats['old']={key:'old',playerId:REAL_PLAYERS[0].id,teamId:ai.id,teamName:'旧球队',goals:1};
 s.upgradeAiClubs(true);assert.equal(ai.rosterIds.length,23);
 const old=Object.values(s.state.playerStats)[0];assert.equal(old.teamName,'旧球队');assert.equal(old.isAi,true);
 assert.deepEqual(human.rosterIds,ids);assert.equal(JSON.stringify(s.state.s4Assets),assets);
});

test('AI selection obeys fitness, injury, competition suspension and final bans without touching ownership',()=>{
 const s=service(),team=s.state.teams[0];
 assert.equal(team.rosterIds.length,23);
 const initial=s.selectActualLineup(team,1);const tired=initial.lineup.find(p=>p.role!=='GK');
 team.playerState[tired.id].fitness=35;
 const replacement=s.selectActualLineup(team,2);
 assert.ok(!replacement.lineup.some(p=>p.id===tired.id));
 const injured=replacement.lineup[1];team.playerState[injured.id].injuryRounds=2;
 const banned=replacement.lineup[2];const suspended=replacement.lineup[3];team.playerState[suspended.id].cupSuspension=1;
 const ownership=JSON.stringify(s.state.s4Assets);
 const result=s.selectActualLineup(team,3,'cup',{bannedPlayerIds:[banned.id]});
 for(const id of [injured.id,banned.id,suspended.id])assert.ok(![...result.lineup,...result.substitutes].some(p=>p.id===id));
 assert.equal(JSON.stringify(s.state.s4Assets),ownership);
 const roster=JSON.stringify(team.rosterIds);s.advanceCupAvailability();assert.equal(team.playerState[suspended.id].cupSuspension,0);
 assert.equal(JSON.stringify(team.rosterIds),roster);
});

test('AI match settlement persists fatigue and attributes leaderboards to AI without minting cards',()=>{
 const s=service(), [home,away]=s.state.teams;
 const fixture={homeId:home.id,awayId:away.id,matchId:null};
 const assets=JSON.stringify(s.state.s4Assets);
 const record=s.simulateFixture(fixture,1);
 assert.ok(record.report);
 assert.ok(Object.values(home.playerState).some(p=>p.fitness<100));
 assert.equal(JSON.stringify(s.state.s4Assets),assets);
 const entries=Object.values(s.state.playerStats);
 assert.ok(entries.length>0);assert.ok(entries.every(e=>e.isAi===true));
 assert.ok(entries.every(e=>e.key.endsWith(':ai')));
 const details=s.teamDetail({id:'observer'},home.id);
 assert.equal(details.roster.length,23);assert.equal(details.aiSchemes.length,2);
 const human={id:'human',nickname:'经理'};s.beginDraft(human,'玩家球队');s.autoDraft(human);s.finishDraft(human);
 const own=s.accountTeam(human.id);assert.equal(own.aiClub,undefined);
 assert.ok(Object.values(s.state.playerStats).every(e=>e.isAi===true));
});

test('both sides may field the same player IDs with independent states and statistics',()=>{
 const s=service(),[home,away]=s.state.teams;
 const copy=JSON.parse(JSON.stringify(home));Object.assign(away,copy,{id:away.id,name:'独立副本队'});
 assert.notEqual(home.playerState,away.playerState);
 const shared=s.selectActualLineup(home,1).lineup[0].id;
 // Ownership must never remove an AI player from the independent roster.
 s.ownedPlayerIds=()=>new Set(home.rosterIds);
 assert.equal(s.selectActualLineup(home,1).lineup.length,11);
 assert.ok(s.selectActualLineup(away,1).lineup.some(p=>p.id===shared));
 home.playerState[shared].fitness=90;assert.equal(away.playerState[shared].fitness,100);
 home.playerState[shared].fitness=100;
 const record=s.simulateFixture({homeId:home.id,awayId:away.id,matchId:null},1);
 assert.ok(record.report);
 const rows=Object.values(s.state.playerStats).filter(p=>p.playerId===shared);
 assert.equal(rows.length,2);assert.equal(new Set(rows.map(p=>p.teamId)).size,2);
 assert.ok(rows.every(p=>p.isAi));
});
