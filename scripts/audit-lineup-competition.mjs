import assert from 'node:assert/strict';
import fs from 'node:fs';
import {competitionAvailability} from '../versus/public/lineup-competition.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';
function setup(){
  const s=new YellowDogsLeagueService({statePath:null,rng:()=>.37});
  const u={id:'scope-audit',nickname:'审阅'};s.beginDraft(u,'审阅队');s.autoDraft(u);s.finishDraft(u);
  const t=s.accountTeam(u.id);
  const act=(action,id,competition)=>s.updateLineupScheme(u,{action,lineupSchemeId:id,competition},{compact:true});
  return {s,u,t,act};
}
// Fixed behavior; the original audit.json remains the before-change evidence.
const rows=[];
{
  const {t,act}=setup();act('create');
  assert.equal(t.lineupSchemes[1].competitionScope,undefined);
  assert.ok(Object.values(t.lineupSchemeAssignments).every(id=>id==='lineup-1'));
  rows.push({case:'new-scheme-label',display:'unbound',actual:{...t.lineupSchemeAssignments}});
  act('assign','lineup-2','cup');act('create');
  const before={...t.lineupSchemeAssignments};act('delete','lineup-3');
  assert.equal(before.cup,'lineup-2');assert.equal(t.lineupSchemeAssignments.cup,'lineup-2');
  rows.push({case:'delete-unassigned-changes-cup',before,after:{...t.lineupSchemeAssignments}});
}
{
  const {t,act}=setup();act('create');act('assign','lineup-2','cup');act('assign','lineup-1','all');
  const before={...t.lineupSchemeAssignments};act('create');act('assign','lineup-3','friendly');
  assert.equal(before.cup,'lineup-1');assert.equal(t.lineupSchemeAssignments.cup,'lineup-1');
  rows.push({case:'old-cup-binding-revives',before,after:{...t.lineupSchemeAssignments}});
}
{
  const {s,t,act}=setup();act('create');act('assign','lineup-2','friendly');
  t.attackFocus='right';t.lineupSchemes[1].attackFocus='right';act('select','lineup-1');
  const f=s.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(t.id));
  const m=s.createFixtureMatch(f,1,s.now(),{competitionMode:'friendly'}).match,i=f.homeId===t.id?0:1;
  const training=s.aiTrainingPlayerSeat(t).attackFocus;
  assert.equal(m.teams[i].attackFocus,'right');assert.notEqual(training,'right');
  rows.push({case:'training-is-current-scheme',friendly:m.teams[i].attackFocus,training});
}
assert.equal(competitionAvailability({state:{cupSuspension:1}},'cup').unavailable,true);
assert.equal(competitionAvailability({state:{seasonFinalBanned:true}},'league').unavailable,false);
rows.push({case:'availability-display',cupSuspensionMarked:true,disabledSeasonFinalBanMarked:false});
const out='outputs/lineup-competition-audit-20261117';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/audit-after.json',JSON.stringify({implemented:true,scenarios:rows},null,2));
console.log(JSON.stringify(rows,null,2));
