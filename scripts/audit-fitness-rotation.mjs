import assert from 'node:assert/strict';
import fs from 'node:fs';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {inferElevenBoardRoles} from '../versus/rules.js';
import {automaticSubstitutionRank} from '../versus/automatic-substitution.js';

function fixture(){
  const s=new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-17T10:00:00+08:00'),rng:()=>.37});
  const user={id:'audit',nickname:'审阅'};s.beginDraft(user,'体能审阅队');s.autoDraft(user);s.finishDraft(user);
  const team=s.accountTeam(user.id),starters=[...team.preferredStarterIds],bench=team.rosterIds.filter(id=>!starters.includes(id));
  const roles=inferElevenBoardRoles(starters.map(id=>({id,position:team.positions[id]})));
  return {s,team,starters,bench,roles};
}
const rows=[];
for(const scenario of ['equal-threshold','threshold-100','bench-at-threshold']){
  const {s,team,starters,bench,roles}=fixture();
  const outgoing=starters.find(id=>roles[id]!=='GK'&&bench.some(b=>automaticSubstitutionRank(roles[id],REAL_PLAYER_BY_ID[b])>0));
  const incoming=bench.find(id=>automaticSubstitutionRank(roles[outgoing],REAL_PLAYER_BY_ID[id])>0);
  team.fitnessThreshold=scenario==='threshold-100'?100:65;
  bench.forEach(id=>team.playerState[id].fitness=45);
  team.playerState[outgoing].fitness=scenario==='equal-threshold'?65:60;
  team.playerState[incoming].fitness=scenario==='bench-at-threshold'?65:100;
  const selected=s.selectActualLineup(team,1);
  const rotated=selected.rotations.some(r=>r.outId===outgoing);
  assert.equal(rotated,scenario!=='equal-threshold');
  rows.push({scenario,threshold:team.fitnessThreshold,starterFitness:team.playerState[outgoing].fitness,benchFitness:team.playerState[incoming].fitness,rotated,
    outgoingOnBench:selected.substitutes.some(p=>p.id===outgoing)});
}
{
  const {s,team,starters,bench,roles}=fixture(),gk=starters.find(id=>roles[id]==='GK'),forward=bench.find(id=>REAL_PLAYER_BY_ID[id].role==='ST');assert.ok(forward);
  team.playerState[gk].injuryRounds=1;
  bench.forEach(id=>team.playerState[id].injuryRounds=id===forward?0:1);
  const selected=s.selectActualLineup(team,1),rotation=selected.rotations.find(r=>r.outId===gk);
  assert.equal(rotation.emergencyGoalkeeper,true);
  const positions=s.actualPositions(team,selected.lineup);
  assert.deepEqual(positions[rotation.inId],team.positions[gk]);
  rows.push({scenario:'forced-gk-no-reserve',incomingRole:REAL_PLAYER_BY_ID[rotation.inId].role,position:positions[rotation.inId],reason:rotation.reason});
}
{
  const {s,team,starters,bench,roles}=fixture();
  const incoming=bench.find(id=>starters.filter(starter=>roles[starter]!=='GK'&&automaticSubstitutionRank(roles[starter],REAL_PLAYER_BY_ID[id])>0).length>=2);
  const [soft,hard]=starters.filter(id=>roles[id]!=='GK'&&automaticSubstitutionRank(roles[id],REAL_PLAYER_BY_ID[incoming])>0);
  assert.ok(incoming&&soft&&hard);team.fitnessThreshold=65;
  team.playerState[soft].fitness=60;team.playerState[hard].injuryRounds=1;
  bench.forEach(id=>team.playerState[id].injuryRounds=id===incoming?0:1);
  const forward=s.selectActualLineup(team,1);
  team.preferredStarterIds=[hard,soft,...starters.filter(id=>id!==hard&&id!==soft)];
  const reversed=s.selectActualLineup(team,1);
  assert.equal(forward.lineup.length,11);assert.equal(reversed.lineup.length,11);
  rows.push({scenario:'soft-before-forced',originalOrderPlayers:forward.lineup.length,forcedFirstPlayers:reversed.lineup.length,
    originalRotations:forward.rotations,reorderedRotations:reversed.rotations});
}
{
  const {s,team,starters,bench,roles}=fixture();
  const outgoing=starters.find(id=>roles[id]!=='GK'&&bench.some(b=>automaticSubstitutionRank(roles[id],REAL_PLAYER_BY_ID[b])>0));
  const incoming=bench.find(id=>automaticSubstitutionRank(roles[outgoing],REAL_PLAYER_BY_ID[id])>0);
  bench.forEach(id=>team.playerState[id].injuryRounds=id===incoming?0:1);
  team.playerState[outgoing].fitness=65;team.playerState[incoming].fitness=66;
  const selected=s.selectActualLineup(team,1);assert.equal(selected.rotations.some(r=>r.outId===outgoing),false);
  rows.push({scenario:'one-point-improvement',starterFitness:65,benchFitness:66,rotated:false,outgoingOnBench:selected.substitutes.some(p=>p.id===outgoing)});
}
{
  const {s}=fixture(),team=s.state.teams.find(t=>t.aiClub&&!t.ownerId);
  team.rosterIds.forEach(id=>team.playerState[id].fitness=1);
  const selected=s.selectActualLineup(team,1);
  assert.equal(selected.lineup.length,0);
  rows.push({scenario:'ai-fitness-floor',players:selected.lineup.length,fitness:1});
}
const out='outputs/fitness-rotation-audit-20261117';fs.mkdirSync(out,{recursive:true});
{
  const {s,team,starters,bench,roles}=fixture();
  const outgoing=starters.find(id=>roles[id]!=='GK'&&bench.some(b=>automaticSubstitutionRank(roles[id],REAL_PLAYER_BY_ID[b])>0));
  team.playerState[outgoing].fitness=60;team.positionPresets.position2[outgoing]={x:31,y:48};
  const scheduled=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(team.id)),index=scheduled.homeId===team.id?0:1;
  const first=s.createFixtureMatch(scheduled,1,s.now()).match;
  const firstRotation=first.leagueAutoRotations[index].find(r=>r.outId===outgoing);assert.ok(firstRotation);
  const unsaved=first.teams[index].positionPresets.position2[firstRotation.inId];
  const scheme=team.lineupSchemes.find(s=>s.id===team.lineupSchemeAssignments.league);
  scheme.positionPresets=structuredClone(team.positionPresets);
  scheme.positionPresetOverrides={...scheme.positionPresetOverrides,position2:true};
  const second=s.createFixtureMatch(scheduled,1,s.now()).match;
  const secondRotation=second.leagueAutoRotations[index].find(r=>r.outId===outgoing);assert.ok(secondRotation);
  const saved=second.teams[index].positionPresets.position2[secondRotation.inId];
  assert.notDeepEqual(unsaved,{x:31,y:48});assert.deepEqual(saved,{x:31,y:48});
  rows.push({scenario:'assigned-scheme-position',directTeamEdit:unsaved,assignedSchemeEdit:saved});
}
fs.writeFileSync(out+'/audit-after.json',JSON.stringify({implemented:true,scenarios:rows},null,2));
console.log(JSON.stringify(rows,null,2));
