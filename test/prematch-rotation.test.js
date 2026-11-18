import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPrematchLineup} from '../versus/prematch-rotation.js';
import {belowFitnessThreshold,effectivePrematchFitness,prematchUnavailableReason} from '../versus/public/fitness-rules.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {inferElevenBoardRoles} from '../versus/rules.js';
import {automaticSubstitutionRank} from '../versus/automatic-substitution.js';
import {resolvePassivePlayerExit} from '../versus/v2/match-engine-v2.js';
import {advanceYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';

const player=(id,role,fitness=100,extra={})=>({id,name:id,role,overall:80,attributes:{goalkeeping:10,reflexes:10,positioning:10},state:{fitness},...extra});
const slots=players=>players.map(p=>({id:p.id,playerId:p.id,role:p.role}));
function fixture(){
  const s=new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-17T10:00:00+08:00'),rng:()=>.37});
  const user={id:'prematch',nickname:'赛前'};s.beginDraft(user,'赛前轮换队');s.autoDraft(user);s.finishDraft(user);
  const team=s.accountTeam(user.id),starters=[...team.preferredStarterIds],bench=team.rosterIds.filter(id=>!starters.includes(id));
  const roles=inferElevenBoardRoles(starters.map(id=>({id,position:team.positions[id]})));
  return {s,user,team,starters,bench,roles};
}

test('forced holes win the last substitute regardless of preferred-starter order',()=>{
  const players=[player('keeper','GK'),player('tired','CB',60),player('injured','CB',100,{state:{fitness:100,injuryRounds:1}}),player('bench','CB')];
  for(const preferred of [players.slice(0,3),[players[2],players[1],players[0]]]){
    const result=selectPrematchLineup({slots:slots(preferred),players});
    assert.equal(result.assignments.length,3);
    assert.equal(result.rotations[0].outId,'injured');assert.equal(result.rotations[0].inId,'bench');
    assert.ok(result.assignments.some(a=>a.player.id==='tired'));
  }
});

test('forced holes use global position matching and never put a reserve goalkeeper in an outfield slot',()=>{
  const starters=[player('gk','GK'),player('lb','LB',30),player('cb','CB',30)];
  const result=selectPrematchLineup({slots:slots(starters),players:[...starters,player('versatile','CB',100,{secondaryRole:'LB'}),player('specialist','CB'),player('reserve-gk','GK',100,{overall:99})]});
  assert.equal(result.assignments.find(a=>a.slot.id==='lb').player.id,'versatile');
  assert.equal(result.assignments.find(a=>a.slot.id==='cb').player.id,'specialist');
  assert.ok(result.substitutes.some(p=>p.id==='reserve-gk'));
});

for(const [threshold,outFitness,inFitness,rotated] of [[65,65,100,false],[65,64.6,65,true],[100,60,100,true],[100,100,100,false],[45,45,100,false],[65,60,64,false]])test(`red-line boundary ${outFitness}/${inFitness} at ${threshold}`,()=>{
  const first=player('starter','CB',outFitness),bench=player('bench','CB',inFitness);
  const result=selectPrematchLineup({slots:slots([first]),players:[first,bench],threshold});
  assert.equal(Boolean(result.rotations.length),rotated);assert.equal(belowFitnessThreshold(outFitness,threshold),outFitness<threshold);
  if(rotated)assert.ok(result.substitutes.some(p=>p.id==='starter'));
});

test('a mandatory keeper vacancy uses keeping ability and frees its previous outfield slot',()=>{
  const starters=[player('gk','GK',30),player('cb','CB',90,{attributes:{goalkeeping:90,reflexes:90,positioning:90}}),player('st','ST')];
  const result=selectPrematchLineup({slots:slots(starters),players:[...starters,player('bench','CB')]});
  const keeper=result.assignments.find(a=>a.slot.role==='GK');assert.equal(keeper.player.id,'cb');assert.equal(keeper.emergency,true);
  assert.equal(result.assignments.find(a=>a.slot.id==='cb').player.id,'bench');assert.equal(result.assignments.length,3);
  assert.equal(new Set(result.assignments.map(a=>a.player.id)).size,3);
});

test('injury, event suspension, bans and the 45 floor are hard rules',()=>{
  const p=player('p','CB',44.9);assert.match(prematchUnavailableReason(p),/45/);
  p.state.fitness=45;assert.equal(prematchUnavailableReason(p),null);
  p.state.cupSuspension=1;assert.equal(prematchUnavailableReason(p,'league'),null);assert.equal(prematchUnavailableReason(p,'cup'),'停赛');
  p.blockedReason='赛事禁用';assert.equal(prematchUnavailableReason(p,'friendly'),'赛事禁用');
  delete p.blockedReason;p.state.injuryRounds=1;assert.equal(prematchUnavailableReason(p,'friendly'),'伤缺');
  assert.equal(effectivePrematchFitness({fitness:1},'friendly'),100);assert.equal(effectivePrematchFitness({fitness:1},'friendly',55),55);
});

test('friendly matches do not voluntarily rotate eligible low-fitness starters',()=>{
  const first=player('starter','CB',55),bench=player('bench','CB');
  assert.equal(selectPrematchLineup({slots:slots([first]),players:[first,bench],competition:'friendly'}).rotations.length,0);
});

test('both human and AI exclude every player below 45 rather than reviving eleven',()=>{
  const {s,team}=fixture(),ai=s.state.teams.find(t=>!t.ownerId&&t.aiClub);
  for(const club of [team,ai]){
    club.rosterIds.forEach(id=>club.playerState[id].fitness=1);
    const selected=s.selectActualLineup(club,1);assert.equal(selected.lineup.length,0);assert.equal(selected.substitutes.length,0);
  }
});

test('insufficient eligible players stop the match before any possession or kickoff',()=>{
  for(const human of [true,false]){
    const {s,team}=fixture(),club=human?team:s.state.teams.find(t=>!t.ownerId&&t.aiClub);
    club.rosterIds.forEach(id=>club.playerState[id].fitness=1);
    const scheduled=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(club.id));
    const {match,startedAt}=s.createFixtureMatch(scheduled,1,s.now());
    advanceYdlLeagueV2Match(match,startedAt+120001,{maximumChains:1});
    assert.equal(match.abandoned,true);assert.equal(match.finished,true);
    assert.equal(match.nextChainIndex,0);assert.deepEqual(match.teams.map(t=>t.score),[0,0]);
    assert.equal(match.events.some(e=>e.type==='kickoff'),false);
  }
});

test('human and AI rest a tired starter but retain that player as an eligible substitute',()=>{
  const {s,team,starters,bench,roles}=fixture();
  const outgoing=starters.find(id=>roles[id]!=='GK'&&bench.some(b=>automaticSubstitutionRank(roles[id],REAL_PLAYER_BY_ID[b])>0));
  team.playerState[outgoing].fitness=60;
  const own=s.selectActualLineup(team,1);assert.ok(own.rotations.some(r=>r.outId===outgoing));assert.ok(own.substitutes.some(p=>p.id===outgoing));
  const ai=s.state.teams.find(t=>!t.ownerId&&t.aiClub);
  for(const id of ai.preferredStarterIds)if(REAL_PLAYER_BY_ID[id].role!=='GK')ai.playerState[id].fitness=60;
  const selected=s.selectActualLineup(ai,1);assert.ok(selected.rotations.length>0);
  for(const rotation of selected.rotations)if(rotation.reason.includes('红线'))assert.ok(selected.substitutes.some(p=>p.id===rotation.outId));
});

test('rested player can enter through passive injury substitution; prematch rotation consumes no quota',()=>{
  const {s,team,starters,bench,roles}=fixture();
  const outgoing=starters.find(id=>roles[id]==='CB'&&bench.some(b=>automaticSubstitutionRank('CB',REAL_PLAYER_BY_ID[b])>0));assert.ok(outgoing);
  team.playerState[outgoing].fitness=60;
  const scheduled=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(team.id)),index=scheduled.homeId===team.id?0:1;
  const match=s.createFixtureMatch(scheduled,1,s.now()).match,side=match.teams[index];
  const rotation=match.leagueAutoRotations[index].find(r=>r.outId===outgoing);assert.ok(rotation);
  const rested=side.players.find(p=>p.id===outgoing);assert.equal(rested.active,false);assert.equal(rested.substitutedOut,undefined);assert.equal(side.stats.substitutions,0);
  side.players.filter(p=>!p.active&&p.id!==outgoing).forEach(p=>p.injury={severity:'matchEnding'});
  const injured=side.players.find(p=>p.id===rotation.inId);injured.active=false;injured.injury={severity:'matchEnding'};
  const result=resolvePassivePlayerExit(match,side,injured,'injury');assert.equal(result.incoming.id,outgoing);assert.equal(side.stats.substitutions,1);
  assert.equal(side.players.filter(p=>p.active).length,11);
});

test('forced keeper relocation preserves each original slot in all three presets',()=>{
  const {s,team,starters,bench,roles}=fixture(),gk=starters.find(id=>roles[id]==='GK');
  team.playerState[gk].injuryRounds=1;
  bench.filter(id=>REAL_PLAYER_BY_ID[id].role==='GK').forEach(id=>team.playerState[id].injuryRounds=1);
  const selected=s.selectActualLineup(team,1);assert.equal(selected.lineup.length,11);
  const keeper=selected.lineup.find(p=>p.assignedRole==='GK');assert.equal(keeper.emergencyGoalkeeper,true);
  for(const key of ['position1','position2','position3']){
    const positions=s.actualPositions(team,selected.lineup,key);
    for(const p of selected.lineup)assert.deepEqual(positions[p.id],team.positionPresets[key][p.lineupSlotId]);
    assert.deepEqual(positions[keeper.id],team.positionPresets[key][gk]);
  }
  const scheduled=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(team.id)),index=scheduled.homeId===team.id?0:1;
  const {match,startedAt}=s.createFixtureMatch(scheduled,1,s.now());
  const side=match.teams[index],matchKeeper=side.players.find(p=>p.id===keeper.id);
  assert.equal(matchKeeper.emergencyGoalkeeper,true);assert.equal(matchKeeper.assignedRole,'GK');
  side.score=2;match.teams[1-index].score=0;
  advanceYdlLeagueV2Match(match,startedAt+3000,{maximumChains:1});
  assert.equal(matchKeeper.assignedRole,'GK');assert.equal(side.players.filter(p=>p.active).length,11);
});
