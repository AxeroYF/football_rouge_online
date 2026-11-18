import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../versus/v4/engine.js';
import {compileInput,demoInput} from '../versus/v4/fixtures.js';
import {createMatchTacticalReview} from '../versus/v4-host/match-tactical-review.js';
import {matchTacticalReviewMarkup,resolveReviewEvidence} from '../versus/public/match-tactical-review.js';
import {compareReviewIssue} from '../versus/public/tactics-interface.js';

test('each plan and each spell uses its actual frames, across goals, half time and a return to normal',()=>{
  const input=compileInput(demoInput());
  for(const team of input.teams){
    team.sourcePlans={normal:{},leading:{},trailing:{}};
    team.sourceBondCatalog=[];
    team.scorePlans={leading:{lossReaction:'regroup'},trailing:{lossReaction:'counterPress'}};
    for(const p of team.players)Object.assign(p,{baseAttributes:{...p.attributes},baseHeightCm:p.heightCm,traitDefinitions:[]});
  }
  const recorder=createMatchTacticalReview(input,engine);
  const clock=time=>({period:time<112?1:2,baseSeconds:time<112?0:100,elapsed:time<112?time:time-112,
    attackDirections:time<112?[1,-1]:[-1,1]});
  const point={x:50,y:33},holder={...point,key:'0:p',name:'<前腰>',side:0,role:'CM',active:true};
  const frame=(time,eventCursor,mode)=>({time,eventCursor,clock:clock(time),phase:'playing',activePlans:[mode,'normal'],
    ball:{...point,holder:holder.key},players:[holder,{...holder,x:99,key:'1:p',side:1}],coordination:[{owner:0},{owner:0}]});
  const event=(id,type,time,plan)=>({id,type,time,clock:clock(time),side:0,plan});
  const first=frame(15,1,'normal'),lead=frame(35,2,'leading'),normal=frame(51,3,'normal'),second=frame(116,5,'normal');
  recorder.consume([first,{...first,time:16},lead],[event(1,'goal',10),event(2,'tacticalPlanChanged',30,'leading')]);
  recorder.consume([lead,normal,second],[event(3,'tacticalPlanChanged',50,'normal'),event(4,'halfTime',102),event(5,'endsChanged',112),event(6,'shootoutStart',150),event(7,'fulltime',170)]);
  const [plans]=recorder.finish();
  assert.deepEqual(plans.normal.intervals.map(i=>[i.start,i.end]),[[0,30],[50,102],[112,150]]);
  assert.deepEqual(plans.leading.intervals.map(i=>[i.start,i.end]),[[30,50]]);
  assert.deepEqual(plans.trailing.intervals,[]);
  assert.deepEqual(plans.normal.intervals.map(i=>i.checks.pass.occurrences.noOutlet.evidence.time),[15,51,116]);
  assert.equal(plans.leading.checks[0].samples,1);
  assert.equal(plans.normal.checks[0].samples,4);
  assert.equal(plans.normal.checks[0].occurrences.noOutlet.count,4);
  assert.equal(plans.normal.checks[0].occurrences.noOutlet.episodes,3);
  assert.equal(plans.normal.intervals[0].checks.pass.occurrences.noOutlet.episodes,1);
  const data={fixtureId:'fixture',reportId:'match',plans};
  const html=matchTacticalReviewMarkup(data);
  assert.match(html,/t=116&amp;player=0%3Ap/);
  assert.match(html,/&lt;前腰&gt;/);
  assert.match(html,/落后预案 · 本场未启用/);
  assert.match(html,/3 个独立回合/);
  assert.match(html,/反复出现 · 建议调整/);
  const params=new URLSearchParams({plan:'normal',issue:'noOutlet',t:'116',player:'0:p'});
  assert.equal(resolveReviewEvidence(data,params).playerId,'p');
  params.set('player','1:p');assert.equal(resolveReviewEvidence(data,params),null);
  assert.doesNotMatch(matchTacticalReviewMarkup({...data,replayAvailable:false}),/href=/);
});

test('comparison follows the selected issue and its eligible sample denominator',()=>{
  const row=(count,samples)=>({samples,issueCounts:{fewAngles:count,noOutlet:1}});
  assert.match(compareReviewIssue(row(3,4),row(4,8),'fewAngles'),/有改善/);
  assert.match(compareReviewIssue(row(1,4),row(1,2),'fewAngles'),/上升/);
  assert.match(compareReviewIssue(row(2,4),row(4,8),'fewAngles'),/相同/);
  assert.match(compareReviewIssue(row(0,4),row(0,3),'fewAngles'),/均未复现/);
  assert.match(compareReviewIssue(row(3,4),row(0,0),'fewAngles'),/无法判断/);
});
