import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePositionPresetLinks} from '../versus/public/position-preset-links.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {advanceYdlLeagueV2Match} from '../versus/v2/ydl-league-engine-adapter.js';
import {deriveFormationLines} from '../versus/public/formation-rules.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
function setup(){
  const s=new YellowDogsLeagueService({statePath:null,rng:()=>.37});
  const u={id:'preset-test',nickname:'站位'};s.beginDraft(u,'站位队');s.autoDraft(u);s.finishDraft(u);
  const t=s.accountTeam(u.id);
  const body=()=>structuredClone({lineupSchemeId:t.activeLineupSchemeId,lineupSchemeRevision:t.lineupSchemes.find(x=>x.id===t.activeLineupSchemeId).revision,starterIds:t.preferredStarterIds,positionPresets:t.positionPresets,formationLinePresets:t.formationLinePresets,positionPresetOverrides:t.positionPresetOverrides,tacticalPlans:t.tacticalPlans});
  const save=b=>s.saveTeam(u,b,{compact:true});
  const id=t.preferredStarterIds.find(id=>t.positions[id].x<40);
  return {s,u,t,body,save,id};
}
test('unedited phases follow default coordinates and formation lines across repeated saves',()=>{
  const {t,body,save,id}=setup();
  assert.deepEqual(t.positionPresetOverrides,{position2:false,position3:false});
  for(const x of [27,31]){
    const b=body();b.positionPresets.position1[id].x=x;b.formationLinePresets.position1.midfield+=1;save(b);
    for(const key of ['position2','position3']){
      assert.deepEqual(t.positionPresets[key],t.positionPresets.position1);
      assert.deepEqual(t.formationLinePresets[key],t.formationLinePresets.position1);
    }
  }
});
test('editing only tactics does not detach positions; explicit phase edits remain independent',()=>{
  const {t,body,save,id}=setup();let b=body();b.tacticalPlans.leading.tactic='defensive';save(b);
  assert.equal(t.positionPresetOverrides.position2,false);
  b=body();b.positionPresets.position2[id].x=37;b.positionPresetOverrides.position2=true;save(b);
  b=body();b.positionPresets.position1[id].x=22;save(b);
  assert.equal(t.positionPresets.position2[id].x,37);assert.equal(t.positionPresets.position3[id].x,22);
  b=body();b.positionPresetOverrides.position2=false;save(b);
  assert.deepEqual(t.positionPresets.position2,t.positionPresets.position1);
});
test('legacy clients changing only default inherit; explicit phase coordinate changes detach',()=>{
  const {t,body,save,id}=setup();let b=body();delete b.positionPresetOverrides;b.positionPresets.position1[id].x=30;save(b);
  assert.equal(t.positionPresetOverrides.position2,false);assert.equal(t.positionPresets.position2[id].x,30);
  b=body();delete b.positionPresetOverrides;b.positionPresets.position3[id].x=38;save(b);
  assert.equal(t.positionPresetOverrides.position3,true);assert.equal(t.positionPresets.position3[id].x,38);
});
test('legacy stock coordinates follow, custom phase maps and line boundaries remain intact',()=>{
  const coords=[[50,90],[18,69],[39,69],[61,69],[82,69],[24,45],[50,45],[76,45],[22,19],[50,19],[78,19]];
  const stock=Object.fromEntries(coords.map(([x,y],i)=>[String(i),{x,y}]));
  const base=structuredClone(stock);base['1'].x=30;
  const source={preferredStarterIds:Object.keys(stock),positionPresets:{position1:base,position2:stock,position3:structuredClone(stock)}};
  let r=resolvePositionPresetLinks(source);assert.equal(r.positionPresetOverrides.position2,false);assert.equal(r.positionPresets.position2['1'].x,30);
  source.positionPresets.position3['1'].x=33;r=resolvePositionPresetLinks(source);
  assert.equal(r.positionPresetOverrides.position3,true);assert.equal(r.positionPresets.position3['1'].x,33);
  source.positionPresets.position3=structuredClone(base);
  const lines=deriveFormationLines(Object.entries(base).map(([id,position])=>({id,position})));
  source.formationLinePresets={position1:lines};
  // A real line edit remains independent even if all coordinates match.
  const lineKey=Object.keys(lines)[1];source.formationLinePresets.position3={...lines,[lineKey]:lines[lineKey]+3};
  assert.equal(resolvePositionPresetLinks(source).positionPresetOverrides.position3,true);
});
test('scheme switching and share import preserve follow/custom modes',()=>{
  const {s,u,t,body,save,id}=setup();let b=body();b.positionPresetOverrides.position2=true;b.positionPresets.position2[id].x=37;save(b);
  const share=s.exportLineupScheme(u);
  s.updateLineupScheme(u,{action:'create',name:'另一套'},{compact:true});
  b=body();b.positionPresetOverrides.position2=false;b.positionPresets.position1[id].x=29;save(b);
  s.updateLineupScheme(u,{action:'select',lineupSchemeId:'lineup-1'},{compact:true});
  assert.equal(t.positionPresets.position2[id].x,37);assert.equal(t.positionPresetOverrides.position2,true);
  s.updateLineupScheme(u,{action:'select',lineupSchemeId:'lineup-2'},{compact:true});
  assert.equal(t.positionPresets.position2[id].x,29);
  s.importLineupScheme(u,share.code,{lineupSchemeRevision:body().lineupSchemeRevision,compact:true});
  assert.equal(t.positionPresetOverrides.position2,true);assert.equal(t.positionPresetOverrides.position3,false);
});
test('score-triggered plans keep the same player coordinates when phases follow default',()=>{
  for(const phase of ['leading','trailing']){
    const {s,t,body,save,id}=setup();const b=body();b.positionPresets.position1[id].x=29;
    b.tacticalPlans[phase].planAfter='0';save(b);
    const f=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(t.id)),index=f.homeId===t.id?0:1;
    const {match,startedAt}=s.createFixtureMatch(f,1,s.now());
    const side=match.teams[index];side.score=phase==='leading'?2:0;match.teams[1-index].score=phase==='trailing'?2:0;
    const expected=structuredClone(side.positions);
    advanceYdlLeagueV2Match(match,startedAt+3000,{maximumChains:1});
    assert.equal(side.activePlan,phase);assert.deepEqual(side.positions,expected);
    for(const player of side.players.filter(p=>p.active))assert.deepEqual(player.boardPosition,expected[player.id]);
  }
});

test('stored follow modes and independent layouts survive service reload',()=>{
  const {s,u,t,body,save,id}=setup();const b=body();b.positionPresetOverrides.position3=true;b.positionPresets.position3[id].x=35;save(b);
  const dir=mkdtempSync(path.join(tmpdir(),'yffm1-position-links-'));
  try{
    const statePath=path.join(dir,'league.json');writeFileSync(statePath,JSON.stringify(s.state));
    const restored=new YellowDogsLeagueService({statePath,backupDir:null});const team=restored.accountTeam(u.id);
    assert.deepEqual(team.positionPresetOverrides,{position2:false,position3:true});
    assert.equal(team.positionPresets.position3[id].x,35);
    assert.deepEqual(team.positionPresets.position2,team.positionPresets.position1);
    // The shared normalizer also accepts tracked/proxied storage values.
    const proxied=new Proxy(t.positionPresets.position1,{});
    assert.doesNotThrow(()=>resolvePositionPresetLinks({...t,positionPresets:{...t.positionPresets,position1:proxied}}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
