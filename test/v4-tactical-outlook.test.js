import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV4TacticalOutlook} from '../versus/v4-adapter/tactical-outlook.js';

test('diagnoses measured lanes, paired cover and goal-side recovery independently of instruction strength',()=>{
  const point=(key,x,y,task,extra={})=>({key,x,y,task,active:true,target:{x,y},partners:[],...extra});
  const home=[point('h',50,50,0),point('a',35,50,1),point('b',50,35,2,{partners:['a']})];
  const away=[point('q',90,50),point('r',90,80)];
  const tasks=['carry','overlap','coverOverlap','press','screen'].map(type=>({type}));
  const roster=[...home,...away].map(({key},i)=>({key,side:i<3?0:1,name:key,role:'CM'}));
  const clip=(scenario,players,holder,owner,extra={})=>({scenario,tasks,roster,clipId:scenario,dimensions:{},frames:[
    {time:1.2,players,ball:{...players.find(p=>p.key===holder),holder},owner,...extra},
  ]});
  const attack=clip('attack',[...home,...away],'h',0);
  const defense=clip('defense',[point('h',85,50,3),point('a',90,65,4,{partners:['h'],opponent:'r'}),home[2],...away],'q',1);
  const loss=clip('loss',[...home,...away],'r',1,{transitionId:1,lossResponse:'regroup'});
  const assess=()=>Object.fromEntries(buildV4TacticalOutlook({attack,left:attack,defense,loss},'leading',0).diagnostics.map(d=>[d.id,d]));
  let d=assess();
  assert.equal(d.pass.status,'covered'); // Two clear directions, at right angles.
  assert.equal(d.press.status,'covered');
  assert.equal(d.overlap.status,'covered');
  assert.equal(d.loss.status,'attention'); // Nobody is goal-side of the ball.
  assert.equal(d.press.evidence.playerKey,'a');

  attack.frames[0].players[3]=point('q',42,50); // Block one of the two passes.
  defense.frames[0].players[1].x=75;
  home[2].target={x:75,y:65};
  d=assess();
  assert.equal(d.pass.status,'attention');
  assert.equal(d.press.status,'attention');
  assert.equal(d.overlap.status,'attention');
  assert.equal(d.overlap.evidence.playerKey,'b');

  home[1].task=0;
  assert.equal(assess().overlap.status,'unobserved');
});
