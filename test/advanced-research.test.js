import {researchRewardMarkup} from '../client/resources/neutral-reward-controller.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {districtFixture} from './oil-fixture.mjs';
import {BIOLOGY_TOPIC,biologyReduction,researchedEnhancementChance} from '../shared/config/advanced-research.mjs';
import {createFormationResearchSlot} from '../shared/config/formation-research.mjs';
import {biologyFatigueLoss} from '../engine/s4-v2.1/versus/v2/biology-research-v2.js';
const M=60000;
function fixture(){const f=districtFixture();return {...f,command:(action,body={})=>f.s.formationResearch.mutate(f.a,action,{revision:f.s.formationResearch.data(f.a).revision,...body}),finish(){const j=f.a.formationResearch.active,rate=f.s.resourceState(f.a).current.science;f.setTime(f.time()+Math.ceil(j.required/rate*M)+1);f.s.save();}};}
test('new research shares the formation queue and rejects invalid, guaranteed and higher-material topics',()=>{
 const f=fixture();f.command('confirm',{slotId:'custom-1',formation:createFormationResearchSlot(0)});
 for(const topicId of ['biology:fake','enhancement:0:0','enhancement:7:8','tactic:balanced'])assert.throws(()=>f.command('start-topic',{topicId}),/无效|未开放/);
 f.command('start-topic',{topicId:BIOLOGY_TOPIC,level:5});assert.equal(f.a.formationResearch.active.level,1);assert.equal(f.a.formationResearch.active.required,200);assert.equal(biologyReduction(f.a),0);
 assert.throws(()=>f.command('start',{slotId:'custom-1',direction:'buildUp'}),/同时只能/);assert.throws(()=>f.command('start-topic',{topicId:'enhancement:2:1'}),/同时只能/);
 f.finish();assert.equal(biologyReduction(f.a),3);f.command('start',{slotId:'custom-1',direction:'buildUp'});assert.throws(()=>f.command('start-topic',{topicId:BIOLOGY_TOPIC}),/同时只能/);
});
test('biology completes five cumulative levels and enhancement is isolated by pairing',()=>{
 const f=fixture();for(let level=1;level<=5;level++){f.command('start-topic',{topicId:BIOLOGY_TOPIC});f.finish();assert.equal(biologyReduction(f.a),level*3);}assert.throws(()=>f.command('start-topic',{topicId:BIOLOGY_TOPIC}),/最高/);
 for(let level=1;level<=10;level++){f.command('start-topic',{topicId:'enhancement:2:1'});f.finish();assert.equal(researchedEnhancementChance(f.a,2,1),57+.5*level);}assert.throws(()=>f.command('start-topic',{topicId:'enhancement:2:1'}),/最高/);assert.equal(researchedEnhancementChance(f.a,3,2),51);
});
test('cancellation, stale revisions and failed saves preserve already completed levels',()=>{
 const f=fixture();f.command('start-topic',{topicId:BIOLOGY_TOPIC});f.finish();f.command('start-topic',{topicId:BIOLOGY_TOPIC});f.setTime(f.time()+M);f.s.save();
 assert.throws(()=>f.command('cancel',{jobId:'stale'}),/变化/);assert.throws(()=>f.command('cancel',{revision:-1}),/已更新/);
 f.command('cancel',{jobId:f.a.formationResearch.active.id});assert.equal(biologyReduction(f.a),3);f.command('start-topic',{topicId:BIOLOGY_TOPIC});assert.equal(f.a.formationResearch.active.completed,0);
 const before=structuredClone(f.a.formationResearch);f.setTime(f.time()+100*M);f.fail(true);assert.throws(()=>f.s.save(),/disk failure/);assert.deepEqual(f.a.formationResearch,before);f.fail(false);f.s.save();assert.equal(biologyReduction(f.a),6);assert.equal(f.saved().accounts[f.a.id].formationResearch.topicLevels[BIOLOGY_TOPIC],2);
});
test('zero science pauses work and old accounts gain no free levels',()=>{
 const f=fixture();assert.equal(biologyReduction(f.a),0);f.command('start-topic',{topicId:BIOLOGY_TOPIC});const from=f.time();f.s.formationResearch.prepare(f.s.accounts,{one:[{from,to:from+M,units:{science:0}}]},from+M);assert.equal(f.a.formationResearch.active.completed,0);assert.equal(biologyReduction(f.a),0);
});
test('small biology reductions survive fitness rounding and cumulative levels never compound',()=>{
 for(const reduction of [0,3,6,9,12,15]){const p={};let loss=0;for(let i=0;i<1000;i++)loss+=biologyFatigueLoss(p,.1,reduction);assert.ok(Math.abs(loss-(100-reduction))<1e-7);}
});


function researchReward(f,amount=80){f.a.pendingNeutralRewards=[{id:'old-research-reward',kind:'research',amount,status:'pending',receivedAt:1}];return f.a.pendingNeutralRewards[0];}
test('existing research rewards advance all open research branches without increasing science income',()=>{
 for(const branch of ['formation','enhancement','biology']){
  const f=fixture();if(branch==='formation'){f.command('confirm',{slotId:'custom-1',formation:createFormationResearchSlot(0)});f.command('start',{slotId:'custom-1',direction:'buildUp'});}else f.command('start-topic',{topicId:branch==='biology'?BIOLOGY_TOPIC:'enhancement:2:1'});
  researchReward(f,20);const id=f.a.formationResearch.active.id,science=f.s.resourceState(f.a).current.science;
  const result=f.s.formationResearch.assignReward(f.a,{rewardId:'old-research-reward',jobId:id});assert.equal(result.appliedResearch,20);assert.equal(f.a.formationResearch.active.completed,20);assert.equal(f.a.pendingNeutralRewards[0].status,'applied');assert.equal(f.s.resourceState(f.a).current.science,science);
  assert.equal(f.s.formationResearch.assignReward(f.a,{rewardId:'old-research-reward',jobId:id}).alreadyApplied,true);assert.equal(f.a.formationResearch.active.completed,20);
 }
});
test('reward completion grants the level immediately and retains overflow for another job with durable retry receipts',()=>{
 const f=fixture();f.command('start-topic',{topicId:BIOLOGY_TOPIC});researchReward(f,250);const first=f.a.formationResearch.active.id;
 const body={rewardId:'old-research-reward',jobId:first};f.s.formationResearch.assignReward(f.a,body);
 assert.equal(f.a.formationResearch.active,null);assert.equal(biologyReduction(f.a),3);assert.equal(f.a.pendingNeutralRewards[0].amount,50);assert.equal(f.a.pendingNeutralRewards[0].status,'pending');
 f.command('start-topic',{topicId:BIOLOGY_TOPIC});assert.equal(f.s.formationResearch.assignReward(f.a,body).alreadyApplied,true);assert.equal(f.a.formationResearch.active.completed,0);
 const saved=f.saved().accounts[f.a.id];assert.equal(saved.pendingNeutralRewards[0].researchApplications[first].amount,200);
 f.s.formationResearch.assignReward(f.a,{...body,jobId:f.a.formationResearch.active.id});assert.equal(f.a.formationResearch.active.completed,50);assert.equal(f.a.pendingNeutralRewards[0].status,'applied');
});
test('stale, missing and foreign reward requests preserve rewards and research; persistence failure rolls back both',()=>{
 const f=fixture();researchReward(f);const body={rewardId:'old-research-reward',jobId:'none'};
 assert.throws(()=>f.s.formationResearch.assignReward(f.a,body),/研究项目/);f.command('start-topic',{topicId:BIOLOGY_TOPIC});body.jobId=f.a.formationResearch.active.id;
 assert.throws(()=>f.s.formationResearch.assignReward(f.a,{...body,rewardId:'foreign'}),/奖励不存在/);
 assert.throws(()=>f.s.formationResearch.assignReward(f.a,{...body,jobId:'toString'}),/研究项目/);
 const before=structuredClone([f.a.formationResearch,f.a.pendingNeutralRewards]);const save=f.s.repository.save.bind(f.s.repository);let calls=0;f.s.repository.save=v=>{if(++calls===2)throw Error('disk failure');save(v);};
 assert.throws(()=>f.s.formationResearch.assignReward(f.a,body),/disk failure/);assert.deepEqual([f.a.formationResearch,f.a.pendingNeutralRewards],before);
 f.s.repository.save=save;f.s.formationResearch.assignReward(f.a,body);assert.equal(f.a.formationResearch.active.completed,80);
});
test('research rewards display the active topic and allocation, or keep the reward until a job starts',()=>{
 const f=fixture(),reward=researchReward(f,250);assert.match(researchRewardMarkup({},reward),/请先开始/);
 f.command('start-topic',{topicId:BIOLOGY_TOPIC});const html=researchRewardMarkup({formationResearch:f.s.formationResearch.publicState(f.a)},reward);
 assert.match(html,/生物研究/);assert.match(html,/比赛耐力/);assert.match(html,/剩余 50 保留/);assert.match(html,/data-apply-research-reward/);assert.doesNotMatch(html,/研究系统开放后/);
});


test('enhancement completion notice persists, continues exactly one level and dismisses without losing research',()=>{
 const f=fixture(),topicId='enhancement:2:1';f.command('start-topic',{topicId});const firstId=f.a.formationResearch.active.id;f.finish();
 const notice=f.a.formationResearch.completionNotices[0];assert.equal(notice.id,firstId);assert.equal(notice.level,1);
 assert.deepEqual(f.saved().accounts[f.a.id].formationResearch.completionNotices,[notice]);
 const revision=f.a.formationResearch.revision;
 f.command('continue-notice',{noticeId:firstId});assert.equal(f.a.formationResearch.active.level,2);assert.equal(f.a.formationResearch.active.topicId,topicId);assert.deepEqual(f.a.formationResearch.completionNotices,[]);
 assert.throws(()=>f.command('continue-notice',{noticeId:firstId,revision}),/已更新/);
 f.finish();const second=f.a.formationResearch.completionNotices[0];f.command('read-notice',{noticeId:second.id});
 assert.equal(f.a.formationResearch.topicLevels[topicId],2);assert.equal(f.a.formationResearch.active,null);assert.deepEqual(f.a.formationResearch.completionNotices,[]);
 f.command('read-notice',{noticeId:second.id,revision:-1});assert.deepEqual(f.a.formationResearch.completionNotices,[]);
});

test('completed notice survives a busy queue, max level and failed continue commit',()=>{
 const f=fixture(),topicId='enhancement:2:1';f.command('start-topic',{topicId});f.finish();const id=f.a.formationResearch.completionNotices[0].id;
 f.command('start-topic',{topicId:BIOLOGY_TOPIC});assert.throws(()=>f.command('continue-notice',{noticeId:id}),/同时只能/);assert.equal(f.a.formationResearch.completionNotices[0].id,id);
 f.command('cancel',{jobId:f.a.formationResearch.active.id});
 const before=structuredClone(f.a.formationResearch),save=f.s.repository.save.bind(f.s.repository);let writes=0;
 f.s.repository.save=value=>{if(++writes===2)throw Error('disk failure');save(value);};
 assert.throws(()=>f.command('continue-notice',{noticeId:id}),/disk failure/);assert.deepEqual(f.a.formationResearch,before);f.s.repository.save=save;
 f.a.formationResearch.topicLevels[topicId]=10;assert.throws(()=>f.command('continue-notice',{noticeId:id}),/最高/);assert.equal(f.a.formationResearch.completionNotices.length,1);
});

test('research completion markup keeps full progress and both actions, disabling unavailable continuation',async()=>{
 const {completedResearchNoticesMarkup}=await import('../client/buildings/construction-notifications.js');
 const data={completionNotices:[{id:'notice',topicId:'enhancement:2:1',level:1}],topicLevels:{'enhancement:2:1':1},active:null};
 let html=completedResearchNoticesMarkup(data);assert.match(html,/aria-valuenow="100"/);assert.match(html,/继续研究/);assert.match(html,/知道了/);assert.doesNotMatch(html,/data-continue-research="notice" disabled/);
 for(const changed of [{active:{id:'other'}},{topicLevels:{'enhancement:2:1':10}}])assert.match(completedResearchNoticesMarkup({...data,...changed}),/data-continue-research="notice" disabled/);
 assert.match(completedResearchNoticesMarkup(data,'notice'),/data-read-research="notice" disabled/);
});


test('formation directions and biology retain completion and continue their own next level',()=>{
 for(const branch of ['formation','biology']){
  const f=fixture();
  if(branch==='formation'){f.command('confirm',{slotId:'custom-1',formation:createFormationResearchSlot(0)});f.command('start',{slotId:'custom-1',direction:'buildUp'});}
  else f.command('start-topic',{topicId:BIOLOGY_TOPIC});
  f.finish();const notice=f.a.formationResearch.completionNotices[0];assert.equal(notice.level,1);
  f.command('continue-notice',{noticeId:notice.id,topicId:'enhancement:2:1',slotId:'custom-2',direction:'fake'});
  const job=f.a.formationResearch.active;assert.equal(job.level,2);
  if(branch==='formation'){assert.equal(job.slotId,'custom-1');assert.equal(job.direction,'buildUp');}else assert.equal(job.topicId,BIOLOGY_TOPIC);
  assert.deepEqual(f.a.formationResearch.completionNotices,[]);
  f.finish();f.command('read-notice',{noticeId:f.a.formationResearch.completionNotices[0].id});
  assert.equal(branch==='formation'?f.a.formationResearch.slots[0].levels.buildUp:f.a.formationResearch.topicLevels[BIOLOGY_TOPIC],2);
 }
});
