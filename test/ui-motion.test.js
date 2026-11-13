import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatchFeedback,createUiMotion,uiMotionEnabled} from '../versus/public/ui-motion.js';

const snapshot=(score,events=[],live=true,code='A')=>({code,live,match:{score,events}});
test('broadcast effects skip history and duplicate polls, including the final goal',()=>{
  const feedback=createMatchFeedback(),old={id:'1',type:'goal'},goal={id:'2',type:'goal'};
  assert.deepEqual(feedback.update(snapshot([1,0],[old])),{scores:[],events:[]});
  assert.deepEqual(feedback.update(snapshot([2,0],[old,goal],false)),{scores:[0],events:[goal]});
  assert.deepEqual(feedback.update(snapshot([2,0],[old,goal],false)),{scores:[],events:[]});
  assert.deepEqual(feedback.update(snapshot([4,3],[old,goal],true,'B')),{scores:[],events:[]});
  feedback.reset();
  assert.deepEqual(feedback.update(snapshot([5,3],[old,goal],true,'B')),{scores:[],events:[]});
});
test('motion preferences respect the system, explicit choices, and cancel in-flight effects',()=>{
  assert.equal(uiMotionEnabled('system',true),false);
  assert.equal(uiMotionEnabled('on',true),true);
  assert.equal(uiMotionEnabled('off',false),false);
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:{dataset:{}}});
  const media=Object.assign(new EventTarget(),{matches:false});
  let plays=0,cancels=0;
  const element={animate(){plays++;return {cancel(){cancels++;}};}};
  const motion=createUiMotion({document,matchMedia:()=>media});
  motion.page('squad',element);motion.page('squad',element);
  assert.equal(plays,1);
  motion.setPreference('off');assert.equal(cancels,1);assert.equal(document.documentElement.dataset.uiMotion,'off');
  motion.play(element);assert.equal(plays,1);
  motion.setPreference('system');media.matches=true;media.dispatchEvent(new Event('change'));
  motion.play(element);assert.equal(plays,1);
  motion.setPreference('on');motion.play(element);assert.equal(plays,2);
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(cancels,2);motion.play(element);assert.equal(plays,2);
  motion.destroy();
});

test('score and player effects target new events only, and enabling motion does not replay them',()=>{
  const document=Object.assign(new EventTarget(),{hidden:false,documentElement:{dataset:{}}});
  const media=Object.assign(new EventTarget(),{matches:false});
  const played=[];
  const element=(id,dataset={})=>({dataset,animate(){played.push(id);return {cancel(){}};}});
  const score=element('score'),player=element('player',{motionPlayer:'p1'});
  const root={querySelector:()=>score,querySelectorAll:()=>[player]};
  const motion=createUiMotion({document,matchMedia:()=>media});
  motion.broadcast(root,snapshot([0,0]));
  const next=snapshot([1,0],[{id:'g',type:'goal',actorId:'p1'}]);
  motion.broadcast(root,next);assert.deepEqual(played,['score','player']);
  motion.broadcast(root,next);assert.equal(played.length,2);
  motion.setPreference('off');
  const later=snapshot([2,0],[...next.match.events,{id:'g2',type:'goal',actorId:'p1'}]);
  motion.broadcast(root,later);motion.setPreference('on');motion.broadcast(root,later);
  assert.equal(played.length,2);motion.destroy();
});
