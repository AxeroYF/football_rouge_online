import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {competitionAvailability,nextMatchLineupScheme} from '../versus/public/lineup-competition.js';
function setup(){
  const s=new YellowDogsLeagueService({statePath:null,rng:()=>.37});
  const u={id:'competition-test',nickname:'赛事'};s.beginDraft(u,'赛事队');s.autoDraft(u);s.finishDraft(u);
  const t=s.accountTeam(u.id);
  const act=(action,id,competition)=>s.updateLineupScheme(u,{action,lineupSchemeId:id,competition},{compact:true});
  return {s,u,t,act};
}
test('creating and deleting an unbound scheme preserve every competition',()=>{
  const {t,act}=setup();act('create');act('assign','lineup-2','cup');
  const before=structuredClone(t.lineupSchemeAssignments);act('create');
  assert.deepEqual(t.lineupSchemeAssignments,before);assert.equal(t.lineupSchemes[2].competitionScope,undefined);
  act('delete','lineup-3');assert.deepEqual(t.lineupSchemeAssignments,before);
});
test('all then one competition does not resurrect a superseded binding',()=>{
  const {t,act}=setup();act('create');act('assign','lineup-2','cup');act('assign','lineup-1','all');
  act('create');act('assign','lineup-3','friendly');
  assert.deepEqual(t.lineupSchemeAssignments,{league:'lineup-1',cup:'lineup-1',friendly:'lineup-3'});
  act('assign','lineup-3','cup');assert.equal(t.lineupSchemeAssignments.friendly,'lineup-3');
  act('select','lineup-2');assert.equal(t.lineupSchemeAssignments.league,'lineup-1');
});
test('deleting active or inactive bound schemes changes only affected competitions',()=>{
  for(const active of [true,false]){
    const {t,act}=setup();act('create');act('assign','lineup-2','cup');act('create');act('assign','lineup-3','friendly');
    if(active)act('select','lineup-2');act('delete','lineup-2');
    assert.deepEqual(t.lineupSchemeAssignments,{league:'lineup-1',cup:active?'lineup-1':'lineup-3',friendly:'lineup-3'});
    act('delete','lineup-3');assert.deepEqual(t.lineupSchemeAssignments,{league:'lineup-1',cup:'lineup-1',friendly:'lineup-1'});
    assert.throws(()=>act('delete','lineup-1'),/至少/);
  }
});
test('importing or renaming tactics cannot rebind competitions',()=>{
  const {s,u,t,act}=setup();act('create');act('assign','lineup-2','cup');
  const before=structuredClone(t.lineupSchemeAssignments),share=s.exportLineupScheme(u);
  act('select','lineup-1');s.importLineupScheme(u,share.code,{compact:true});
  s.updateLineupScheme(u,{action:'rename',lineupSchemeId:'lineup-2',name:'杯赛阵容'},{compact:true});
  assert.deepEqual(t.lineupSchemeAssignments,before);
  assert.throws(()=>act('rename','lineup-2'),/不能为空/);
  assert.deepEqual(t.lineupSchemeAssignments,before);
});
test('persisted mapping wins over stale scopes and only invalid references are repaired',()=>{
  const {s,u,t,act}=setup();act('create');act('assign','lineup-2','cup');
  t.lineupSchemes[0].competitionScope='cup';t.lineupSchemes[1].competitionScope='all';
  t.lineupSchemeAssignments.friendly='deleted';
  const dir=mkdtempSync(path.join(tmpdir(),'yffm1-bindings-'));
  try{
    const statePath=path.join(dir,'league.json');writeFileSync(statePath,JSON.stringify(s.state));
    const restored=new YellowDogsLeagueService({statePath,backupDir:null,rng:()=>.37});
    assert.deepEqual(restored.accountTeam(u.id).lineupSchemeAssignments,{league:'lineup-1',cup:'lineup-2',friendly:'lineup-2'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('all three matches use assigned tactics and snapshots remain fixed after reassignment',()=>{
  const {s,t,act}=setup();act('create');act('assign','lineup-2','cup');act('create');act('assign','lineup-3','friendly');
  const focuses={'lineup-1':'left','lineup-2':'right','lineup-3':'center'};
  for(const scheme of t.lineupSchemes)scheme.attackFocus=focuses[scheme.id];
  t.attackFocus=focuses[t.activeLineupSchemeId];
  act('select','lineup-1');
  const fixture=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(t.id));
  const index=fixture.homeId===t.id?0:1;
  for(const [competition,id] of Object.entries(t.lineupSchemeAssignments)){
    const match=s.createFixtureMatch(fixture,1,s.now(),{competitionMode:competition}).match;
    assert.equal(match.leagueLineupSchemes[index].id,id);
    assert.equal(match.teams[index].attackFocus,focuses[id]);
    const next={competition,status:'live',lineupScheme:structuredClone(match.leagueLineupSchemes[index])};
    act('assign','lineup-1',competition);
    assert.equal(nextMatchLineupScheme(t,next).id,id);
    assert.equal(nextMatchLineupScheme(t,{competition,status:'scheduled'}).id,'lineup-1');
  }
});
test('next opponent reports pending binding and frozen live scheme even after deletion',()=>{
  const {s,t,act}=setup();act('create');act('assign','lineup-2','league');
  const f=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(t.id)),i=f.homeId===t.id?0:1;
  const match=s.createFixtureMatch(f,1,s.now()).match;
  s.teamSchedule=()=>[{status:'scheduled',competition:'league'}];
  assert.equal(s.nextOpponent(t.id).lineupScheme.id,'lineup-2');
  s.state.liveRound={matches:[{code:'binding-live',match}]};
  s.teamSchedule=()=>[{status:'live',competition:'league',broadcastCode:'binding-live'}];
  act('delete','lineup-2');
  assert.equal(s.nextOpponent(t.id).lineupScheme.id,'lineup-2');
  assert.equal(match.leagueLineupSchemes[i].id,'lineup-2');
});
test('status respects each competition, injury, fitness floor, and ignores disabled finals',()=>{
  const p={state:{fitness:60,suspension:2,cupSuspension:3,seasonFinalBanned:true,seasonFinalSuspension:4}};
  assert.equal(competitionAvailability(p,'league').label,'联赛停赛 2场');
  assert.equal(competitionAvailability(p,'cup').label,'杯赛停赛 3场');
  assert.deepEqual(competitionAvailability(p,'friendly'),{fitness:100,unavailable:false,label:'体能 100'});
  p.state.suspension=0;assert.equal(competitionAvailability(p,'league').unavailable,false);
  p.state.cupSuspension=0;p.state.fitness=44;
  assert.equal(competitionAvailability(p,'cup').label,'体能不足45');
  p.state.injuryRounds=1;assert.equal(competitionAvailability(p,'friendly').label,'伤缺 1轮');
  p.state.injuryRounds=0;p.fixedFitness=55;assert.equal(competitionAvailability(p,'friendly').fitness,55);
});
