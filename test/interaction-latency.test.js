import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignService} from '../campaign-service.mjs';
import {publicChallengeView} from '../server/application/challenge-service.mjs';
import {firstLegScoreText} from '../client/challenge/first-leg-score.js';
import {defenceEntries} from '../client/challenge/defence-notifications.js';
import {OilService} from '../server/application/oil-service.mjs';

test('first-leg scores are revealed only when finished and retain team order in live and archived reports',()=>{
 const leg={match:{finished:false,score:[2,1],teams:[{id:'a',name:'A'},{id:'b',name:'B'}]}};
 const challenge={id:'c',phase:'first-leg',live:{firstLeg:leg}};
 assert.equal(publicChallengeView(challenge,0).firstLeg,null);
 leg.match.finished=true;challenge.phase='second-leg';
 const view=publicChallengeView(challenge,0);
 assert.equal(firstLegScoreText({challenge:view}),'首回合：A 2 : 1 B');
 assert.equal(firstLegScoreText({battle:{broadcasts:[{legNumber:1,...view.firstLeg},{legNumber:2,teams:[{name:'B'},{name:'A'}],score:[0,0]}]}}),'首回合：A 2 : 1 B');
 assert.equal(firstLegScoreText({}), '');
});
test('defence notifications isolate account, include legacy defender ownership, and exclude attacks made by self',()=>{
 const state={playerId:'b',world:{activeChallenges:{x:{id:'x',attackerId:'a',defenderId:'b'},y:{id:'y',attackerId:'b',defenderId:'c'}}},battleHistory:[{id:'old',defender:{id:'b'}},{id:'other',defenderId:'c'}]};
 assert.deepEqual(defenceEntries(state).active.map(c=>c.id),['x']);assert.deepEqual(defenceEntries(state).history.map(c=>c.id),['old']);
 assert.deepEqual(defenceEntries(null),{active:[],history:[]});
});
test('compact enhancement returns committed view without constructing a world snapshot; legacy callers keep full state',()=>{
 let commits=0,states=0;
 const context={world:{},buildings:{settleConstructions(){}},training:{settle(){}},enhancement:{enhance(){commits++;return {id:'result'};}},actionState:()=>({wallet:{gold:100}}),enhancementDetails:()=>({cards:[]}),state:()=>{states++;return {world:{}};}};
 const result=CampaignService.prototype.mutateEnhancement.call(context,{},'enhance',{compact:true});
 assert.equal(commits,1);assert.equal(states,0);assert.equal(result.state,undefined);assert.equal(result.statePatch.wallet.gold,100);assert.deepEqual(result.view.cards,[]);
 CampaignService.prototype.mutateEnhancement.call(context,{},'enhance',{});assert.equal(states,1);
});
test('movement oil estimate uses current balance without building oil production and market views',()=>{
 const oil=new OilService({now:()=>0});oil.view=()=>{throw Error('unrelated territory scan');};
 const base={distanceKm:500,durationMs:60000};
 assert.equal(oil.estimate({setupComplete:true,oil:{balance:20}},base).oilAvailable,20);
 assert.equal(oil.estimate({setupComplete:true,oil:{balance:0}},base).oilShortage,true);
});

test('compact wonder acknowledgement skips world state construction and preserves legacy response',()=>{
 let saved=0,states=0;const fake={wonders:{acknowledgeCompetition(){saved++;}},state(){states++;return {playerId:'a'};}};
 assert.deepEqual(CampaignService.prototype.acknowledgeWonderCompetition.call(fake,{},'n',{compact:true}),{ok:true});assert.equal(states,0);assert.equal(saved,1);
 assert.deepEqual(CampaignService.prototype.acknowledgeWonderCompetition.call(fake,{},'n'),{state:{playerId:'a'}});assert.equal(states,1);
});
