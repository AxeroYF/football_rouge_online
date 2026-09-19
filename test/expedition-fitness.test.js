import {setTestWar} from './diplomacy-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CampaignService } from '../campaign-service.mjs';
import { DRAFT_VERSION } from '../shared/config/draft.mjs';
import { buildAccountMatchSeat } from '../shared/football/account-match-seat.mjs';
import { prepareFitnessSeat, effectiveFitness, setFitness } from '../shared/football/fitness-lineup.mjs';
import { ExpeditionFitnessService } from '../server/application/expedition-fitness-service.mjs';
import { createCampaignLiveLeg, advanceCampaignLiveLeg } from '../engine/campaign-match-engine.mjs';
import { fitnessRedline } from '../shared/config/fitness.mjs';
import { YDL_TRAIT_CARDS } from '../engine/s4-v2.1/versus/trait-pool.js';
import { expeditionPanelView } from '../client/map/expedition-panel-controller.js';

const M=60000,H=60*M;
const catalog=JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url),'utf8')).filter(p=>!p.isX);
function account(id='a') {
  const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
  const points=[[50,90],[17,68],[39,68],[65,68],[85,68],[18,44],[43,44],[59,44],[82,44],[38,20],[66,20]];
  const roster=[],assignments={},squads={};
  for(const squad of ['expedition','garrison']) {
    const starters=roles.map((role,i)=>{
      const p=structuredClone(catalog.find(p=>p.role===role));
      p.id=`${id}-${squad}-${i}`;p.cardDefinitionId=p.id;p.name=p.id;setFitness(p,100);
      roster.push(p);assignments[p.id]=squad;return p.id;
    });
    const positions=Object.fromEntries(starters.map((id,i)=>[id,{x:points[i][0],y:points[i][1]}]));
    const lines={attack:20,midfield:44,defense:68,goalkeeper:90};
    squads[squad]={starters,positions,formationLines:lines,planSnapshots:{__s4V2:{starters,captainId:starters[1],fitnessThreshold:65,
      positionPresets:{position1:positions,position2:structuredClone(positions),position3:structuredClone(positions)},
      formationLinePresets:{position1:lines,position2:lines,position3:lines},
      tacticalPlans:{opening:{tactic:'balanced',style:'possession',positionPreset:'position1',playerDuties:{[starters[1]]:'support'}},leading:{tactic:'defensive',style:'counterAttack',positionPreset:'position2',playerDuties:{}},trailing:{tactic:'positive',style:'possession',positionPreset:'position3',playerDuties:{}}}}}};
  }
  return {id,nickname:id,token:id,setupComplete:true,homeTerritoryId:id,gold:10000,draft:{version:DRAFT_VERSION,teamName:id,roster},playerSquads:{schemaVersion:2,assignments},tactics:{schemaVersion:2,activeSquadId:'expedition',squads},expeditionPiece:{schemaVersion:1,territoryId:id,tokenId:'default',movement:null}};
}
function reserve(a,role='LB',fitness=90,overall=90,suffix=role+'-bench') {
  const p={...structuredClone(catalog.find(p=>p.role===role)||catalog.find(p=>p.role===(role==='LWB'?'LB':'RB'))),role,id:a.id+'-'+suffix,name:suffix,overall,effectiveOverall:overall};
  p.cardDefinitionId=p.id;setFitness(p,fitness);a.draft.roster.push(p);a.playerSquads.assignments[p.id]='expedition';return p;
}
function fixture({resources=false}={}) {
  let now=1000000,saved=null,fail=false;
  const ids=['a','b','c'];
  const index={territories:ids.map((id,i)=>({territoryId:id,country:'法国',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:ids.filter(x=>x!==id),landNeighbors:ids.filter(x=>x!==id),cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
  const resourceCatalog={schemaVersion:1,version:'fitness-test',periodMs:H,territories:Object.fromEntries(ids.map(id=>[id,{terrain:['plains'],yields:{gold:12,production:10,science:10}}]))};
  const repository={load:()=>saved,save:state=>{if(fail)throw Error('disk failure');saved=JSON.parse(JSON.stringify(state));}};
  const options={catalog,territoryIndex:index,territoryResources:resources?resourceCatalog:null,repository,now:()=>now,random:()=>0.2};
  let s=new CampaignService(options);const a=account('a'),b=account('b');
  for(const v of [a,b]){s.accounts.set(v.id,v);s.world.players[v.id]={playerId:v.id,territoryIds:[v.id],capitalTerritoryId:v.id};Object.assign(s.world.territories[v.id],{ownerType:'player',ownerId:v.id,capitalOf:v.id,buildings:[]});}
  setTestWar(s.world,'a','b');
  s.save();
  return {get s(){return s;},get a(){return s.accounts.get('a');},get b(){return s.accounts.get('b');},get now(){return now;},tick:ms=>now+=ms,fail:value=>fail=value,
    reload:()=>{s=new CampaignService(options);},begin:()=>s.challenges.begin(s.accounts.get('a'),'b').challenge,
    advance:()=>s.challenges.advance(now,{maximumMatches:10,maximumChainsPerMatch:1000})};
}
const seat=a=>buildAccountMatchSeat(a,'expedition',0,{fitness:true});
test('redline clamps and defaults malformed values',()=>{assert.equal(fitnessRedline(NaN),65);assert.equal(fitnessRedline(101),100);assert.equal(fitnessRedline(1),45);assert.equal(fitnessRedline(65.7),66);});
test('equal redline rotates to fresh same-side wingback, preserves all shapes, duties, captain and saved tactics',()=>{
  const a=account(),old=a.draft.roster[1];setFitness(old,65);const bench=reserve(a,'LWB');const before=structuredClone(a);
  const s=seat(a);assert.equal(s.rotations[0].inId,bench.id);assert.equal(s.captainId,bench.id);
  for(const key of ['position1','position2','position3'])assert.deepEqual(s.positionPresets[key][bench.id],before.tactics.squads.expedition.planSnapshots.__s4V2.positionPresets[key][old.id]);
  assert.equal(s.tacticalPlans.opening.playerDuties[bench.id],'support');assert.equal(s.players.filter(p=>p.active!==false).length,11);assert.deepEqual(a,before);
});
test('redline requires strictly fresher reserves; without one a legal tired starter remains',()=>{const a=account();setFitness(a.draft.roster[1],65);reserve(a,'LB',65);assert.equal(seat(a).rotations.length,0);});
test('selection uses position priority then enhanced overall, not reserve insertion order',()=>{
  const a=account();setFitness(a.draft.roster[1],60);reserve(a,'LB',99,80,'weak');const best=reserve(a,'LB',90,99,'strong');
  reserve(a,'CB',100,120,'wrong-role');assert.equal(seat(a).rotations[0].inId,best.id);
});
test('goalkeeper cannot be replaced by outfield and no garrison is borrowed below minimum',()=>{const a=account();setFitness(a.draft.roster[0],29);reserve(a,'CB');assert.throws(()=>seat(a),/无法出征/);reserve(a,'GK',30);assert.equal(seat(a).rotations.length,1);});
test('unavailable reserves are excluded and no substitute is assigned twice',()=>{const a=account();setFitness(a.draft.roster[2],60);setFitness(a.draft.roster[3],60);const p=reserve(a,'CB');const bad=reserve(a,'CB',100,100,'training');bad.training={taskId:'busy'};const s=seat(a);assert.equal(s.rotations.length,1);assert.equal(s.rotations[0].inId,p.id);assert.equal(new Set(s.players.map(p=>p.id)).size,s.players.length);});
test('garrison starts full without refilling its stored fatigue or blocking training',()=>{const a=account();for(const p of a.draft.roster.slice(11)){setFitness(p,20);p.training={taskId:'training'};}const s=buildAccountMatchSeat(a,'garrison',0,{fitness:true});assert.ok(s.players.every(p=>p.state.fitness===100));assert.ok(a.draft.roster.slice(11).every(p=>p.state.fitness===20));});
test('996 keeps fixed fitness during selection and ordinary recovery',()=>{const f=fixture();const trait=YDL_TRAIT_CARDS.find(t=>t.rules.some(r=>r.hook==='fixedFitness'&&r.value===94));assert.ok(trait);const p=f.a.draft.roster[1];p.traits=[trait.id];setFitness(p,10);f.s.save();f.tick(H);f.s.save();assert.equal(p.state.fitness,94);assert.equal(effectiveFitness(seat(f.a).players.find(x=>x.id===p.id)),94);});
test('natural recovery preserves decimals, caps at 100 and does not reset on squad switches or midnight',()=>{const f=fixture(),p=f.a.draft.roster[1];setFitness(p,40);f.tick(3*M);f.s.save();assert.equal(p.state.fitness,41.5);f.a.playerSquads.assignments[p.id]='garrison';f.s.save();assert.equal(p.state.fitness,41.5);f.tick(20*M);f.s.save();assert.equal(p.state.fitness,51.5);f.tick(24*H);f.s.save();assert.equal(p.state.fitness,100);});
test('save and restart recover offline exactly once',()=>{const f=fixture();const id=f.a.draft.roster[1].id;setFitness(f.a.draft.roster[1],40);f.s.save();f.tick(20*M);f.reload();assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,50);f.reload();assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,50);});
test('legacy missing recovery timestamp starts now without retroactive refills',()=>{const a=account();setFitness(a.draft.roster[1],23);const s=new ExpeditionFitnessService({world:{},accounts:new Map([['a',a]]),now:()=>100*H});s.prepare();assert.equal(a.draft.roster[1].state.fitness,23);});
test('recovery center boosts only stationed expedition; arrival splits offline interval and centers do not stack',()=>{
  const f=fixture(),p=f.a.draft.roster[1],g=f.a.draft.roster[12];setFitness(p,10);setFitness(g,10);
  f.s.world.territories.a.buildings=[{type:'recovery-center',status:'active',builtAt:f.now},{type:'recovery-center',status:'active',builtAt:f.now}];
  f.a.expeditionPiece.movement={toTerritoryId:'a',arrivesAt:f.now+10*M};f.s.save();f.tick(20*M);f.s.save();
  assert.equal(p.state.fitness,25);assert.equal(g.state.fitness,20);
  f.s.world.territories.a.buildings=[];f.s.save();f.tick(10*M);f.s.save();assert.equal(p.state.fitness,30);
});
test('center completion during offline construction applies boost only after actual completion',()=>{
  const f=fixture({resources:true}),p=f.a.draft.roster[1];setFitness(p,10);
  f.a.resources={fans:10000};f.s.save();f.s.buildings.build(f.a,f.s.world,'a','recovery-center','production');
  f.tick(40*M);f.s.save();assert.equal(f.s.world.territories.a.buildings.find(b=>b.type==='recovery-center').status,'active');
  assert.ok(p.state.fitness>30&&p.state.fitness<50,`fitness ${p.state.fitness}`);
});
test('recovery disk failure rolls back state and cursor, retry awards once',()=>{const f=fixture(),p=f.a.draft.roster[1];setFitness(p,40);f.s.save();const before=structuredClone(f.a);f.tick(20*M);f.fail(true);assert.throws(()=>f.s.save(),/disk/);assert.deepEqual(f.a,before);f.fail(false);f.s.save();assert.equal(p.state.fitness,50);});
test('actual live games start defender at home and full while expedition uses persisted fitness',()=>{const f=fixture();setFitness(f.a.draft.roster[1],70);setFitness(f.b.draft.roster[12],10);const c=f.begin();assert.equal(c.live.firstLeg.match.teams[0].id,'b');assert.equal(c.live.firstLeg.match.teams[1].players[1].state.fitness,70);assert.equal(c.live.firstLeg.match.teams[0].players[1].state.fitness,100);assert.equal(f.b.draft.roster[12].state.fitness,10);});
test('first leg persists engine fatigue; intermission restores 1.5; second leg inherits; settlement is idempotent',()=>{
  const f=fixture();const c=f.begin();
  f.tick(2*M);f.advance();assert.equal(c.phase,'intermission');
  const id=c.live.firstLeg.match.teams[1].players.find(p=>p.active&&!p.injury&&!p.sentOff&&p.state.fitness<99).id;
  const end=c.live.firstLeg.match.teams[1].players.find(p=>p.id===id).state.fitness;assert.ok(end<100);assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,end);
  f.tick(3*M);f.advance();assert.equal(c.phase,'second-leg');assert.equal(c.live.secondLeg.match.teams[0].id,'b');
  assert.equal(c.live.secondLeg.match.teams[1].players.find(p=>p.id===id).state.fitness,end+1.5);
  assert.deepEqual(c.live.secondLeg.aggregateBaseScore,c.live.firstLeg.match.score);
  f.tick(3*M);f.advance();assert.equal(f.s.world.activeChallenges.b,undefined);
  const final=f.a.draft.roster.find(p=>p.id===id).state.fitness;assert.equal(final,c.live.secondLeg.match.teams[1].players.find(p=>p.id===id).state.fitness);assert.ok(final<=end+1.5);
  assert.equal(f.s.challenges.settleChallenge(c),null);assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,final);
  const battle=f.a.battleHistory.at(-1);assert.ok(battle.legs.every(l=>l.home==='b'&&l.away==='a'));
  assert.equal(battle.score[0],battle.legs[0].score[1]+battle.legs[1].score[1]);
});
test('match reserves are inactive, consume no match fitness and do not count toward the eleven',()=>{
  const a=account();const b=reserve(a,'LB');const home=seat(a),away=seat(account('b'));
  const leg=createCampaignLiveLeg({home,away,seed:'fitness-reserves',legNumber:1,startedAt:0});
  assert.equal(leg.match.teams[0].players.filter(p=>p.active).length,11);assert.equal(leg.match.snapshotTeams?.[0]?.players?.length??11,11);
  advanceCampaignLiveLeg(leg,2*M,{maximumChains:1000});const result=leg.match.teams[0].players.find(p=>p.id===b.id);
  if(!result.enteredAsSubstitute)assert.equal(result.state.fitness,90);
});
test('redline second-leg selection uses inherited fitness, keeps legal low starters when no fresh reserve',()=>{const a=account();const s=seat(a);for(const p of s.players)setFitness(p,20);const next=prepareFitnessSeat(s,{minimum:0});assert.equal(next.players.filter(p=>p.active).length,11);assert.ok(next.players.every(p=>p.state.fitness===20));});
test('active challenge locks transfers, tactics assignment and enhancement materials',()=>{const f=fixture(),p=f.a.draft.roster[1];f.begin();assert.throws(()=>f.s.assignPlayerSquad(f.a,p.id,'garrison'),/比赛进行中/);assert.match(f.s.enhancement.blocked(f.a,f.s.world,p,true),/比赛进行中/);const tactics=structuredClone(f.a.tactics);tactics.playerSquads=structuredClone(f.a.playerSquads);tactics.playerSquads.assignments[p.id]='garrison';assert.throws(()=>f.s.saveTactics(f.a,tactics),/比赛进行中/);});
test('redline persists sanitized values in each squad',()=>{const f=fixture(),value=structuredClone(f.a.tactics);value.squads.expedition.planSnapshots.__s4V2.fitnessThreshold=87;value.squads.garrison.planSnapshots.__s4V2.fitnessThreshold=999;f.s.saveTactics(f.a,value);assert.equal(f.a.tactics.squads.expedition.planSnapshots.__s4V2.fitnessThreshold,87);assert.equal(f.a.tactics.squads.garrison.planSnapshots.__s4V2.fitnessThreshold,100);f.reload();assert.equal(f.a.tactics.squads.expedition.planSnapshots.__s4V2.fitnessThreshold,87);});
test('expedition preview reports the same redline replacements as the actual engine seat',()=>{const a=account();setFitness(a.draft.roster[1],65);reserve(a,'LB');const view=expeditionPanelView({...a,playerId:a.id});assert.deepEqual(view.players.map(p=>p.id),seat(a).players.filter(p=>p.active).map(p=>p.id));assert.equal(view.rotations.length,1);});

test('restart during intermission restores engine fatigue and stops recovery at second kickoff',()=>{
  const f=fixture();const c=f.begin();
  f.tick(2*M);f.advance();const id=c.live.firstLeg.match.teams[1].players.find(p=>p.active&&!p.injury&&!p.sentOff&&p.state.fitness<99).id;const end=f.a.draft.roster.find(p=>p.id===id).state.fitness;
  f.tick(10*M);f.reload();assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,end+1.5);
  f.advance();const restored=f.s.world.activeChallenges.b;assert.equal(restored.phase,'second-leg');
  assert.equal(restored.live.secondLeg.match.teams[1].players.find(p=>p.id===id).state.fitness,end+1.5);
  f.reload();assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,end+1.5);
});
test('first-leg write failure restores phase and fatigue; retry applies match result once',()=>{
  const f=fixture(),c=f.begin(),id=f.a.draft.roster[1].id;
  f.tick(2*M);f.fail(true);assert.throws(()=>f.advance(),/disk/);
  assert.equal(c.phase,'first-leg');assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,100);
  assert.equal(c.live.firstLeg.fitnessApplied,undefined);f.fail(false);f.advance();
  assert.equal(c.phase,'intermission');const end=f.a.draft.roster.find(p=>p.id===id).state.fitness;
  f.s.save();assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,end);
});
test('second-leg write failure remains retryable, with no extra fatigue or duplicate wonder recovery',()=>{
  const f=fixture();const c=f.begin(),id=f.a.draft.roster[1].id;
  f.tick(2*M);f.advance();f.tick(3*M);f.advance();const before=f.a.draft.roster.find(p=>p.id===id).state.fitness;
  f.tick(3*M);f.fail(true);assert.throws(()=>f.advance(),/disk/);assert.equal(c.phase,'finished');
  assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,before);assert.equal(c.live.secondLeg.fitnessApplied,undefined);
  f.fail(false);f.advance();const after=f.a.draft.roster.find(p=>p.id===id).state.fitness;
  assert.equal(after,c.live.secondLeg.match.teams[1].players.find(p=>p.id===id)?.state.fitness??before);assert.equal(f.a.battleHistory.length,1);assert.equal(f.s.challenges.settleChallenge(c),null);
  assert.equal(f.a.draft.roster.find(p=>p.id===id).state.fitness,after);
});
test('sanctuary restores attacker participants once after both legs, never a bench-only player or defender',()=>{
  const f=fixture();const bench=reserve(f.a,'LB',70);const c=f.begin();
  f.tick(2*M);f.advance();f.tick(3*M);f.advance();
  // Finish the second game, then enable the existing effect for settlement.
  const leg=c.live.secondLeg;advanceCampaignLiveLeg(leg,f.now+3*M,{maximumChains:1000});
  const firstInjured=new Set(c.live.firstLeg.match.teams[1].players.filter(p=>p.injury).map(p=>p.id));
  const p=leg.match.teams[1].players.find(p=>p.active&&!p.injury&&!firstInjured.has(p.id));assert.ok(p);
  const expected=Math.min(100,p.state.fitness+15),originalHas=f.s.wonders.has.bind(f.s.wonders);
  f.s.wonders.has=(a,id)=>id==='las-lajas-sanctuary'?a.id==='a':originalHas(a,id);
  f.tick(3*M);f.s.challenges.settleChallenge(c);
  assert.equal(f.a.draft.roster.find(x=>x.id===p.id).state.fitness,expected);
  const benchResult=leg.match.teams[1].players.find(p=>p.id===bench.id);
  if(![c.live.firstLeg,leg].some(l=>l.match.teams[1].players.some(p=>p.id===bench.id&&(p.startedMatch||p.enteredAsSubstitute))))assert.equal(f.a.draft.roster.find(p=>p.id===bench.id).state.fitness,71.5);
  assert.ok(f.b.draft.roster.every(p=>p.state.fitness===100));
  const prior=f.a.draft.roster.find(x=>x.id===p.id).state.fitness;f.s.wonders.challengeCompleted(f.a,c);assert.equal(f.a.draft.roster.find(x=>x.id===p.id).state.fitness,prior);
});
test('adding an unused reserve does not change the engine starting formation, chemistry or spatial snapshot',()=>{
  const a=account();const before=seat(a),away=seat(account('b'));reserve(a,'LB');const after=seat(a);
  const first=createCampaignLiveLeg({home:before,away,seed:'bench-neutral',legNumber:1,startedAt:0});
  const second=createCampaignLiveLeg({home:after,away,seed:'bench-neutral',legNumber:1,startedAt:0});
  advanceCampaignLiveLeg(first,1000,{maximumChains:1});advanceCampaignLiveLeg(second,1000,{maximumChains:1});
  assert.deepEqual(second.match.teams[0].structureRoles,first.match.teams[0].structureRoles);
  assert.equal(second.match.teams[0].players.filter(p=>p.active).length,11);
  assert.deepEqual(second.match.snapshotTeams?.[0]?.v2Snapshot?.activeBonds,first.match.snapshotTeams?.[0]?.v2Snapshot?.activeBonds);
});

test('full legacy cards keep their sparse shape after elapsed recovery',()=>{
  const a=account();for(const p of a.draft.roster){delete p.state;delete p.fitness;}
  const before=structuredClone(a.draft.roster);let now=1;
  const s=new ExpeditionFitnessService({world:{},accounts:new Map([['a',a]]),now:()=>now});
  s.prepare();now+=M;s.prepare();assert.deepEqual(a.draft.roster,before);
});

test('biology is snapshotted for expeditions, excludes garrison and lowers live match fatigue',()=>{
 const a=account('bio'),b=account('rival');a.formationResearch={topicLevels:{'biology:match-endurance':5}};
 const boosted=seat(a);assert.equal(boosted.biologyFatigueReduction,15);assert.equal(buildAccountMatchSeat(a,'garrison',0,{fitness:true}).biologyFatigueReduction,0);
 const plain={...structuredClone(boosted),biologyFatigueReduction:0},home=seat(b);
 const run=away=>{const leg=createCampaignLiveLeg({home,away,seed:'bio-test',legNumber:1,startedAt:0});advanceCampaignLiveLeg(leg,120000,{maximumChains:40});return leg;};
 const normal=run(plain),research=run(boosted);assert.equal(research.match.teams[1].biologyFatigueReduction,15);
 const sum=l=>l.match.teams[1].players.reduce((n,p)=>n+Number(p.state.fitness),0);assert.ok(sum(research)>sum(normal));
 a.formationResearch.topicLevels['biology:match-endurance']=0;assert.equal(research.match.teams[1].biologyFatigueReduction,15);
 const service=new ExpeditionFitnessService({world:{},accounts:new Map([[a.id,a]])});service.applyLeg(a,{},research);for(const p of research.match.teams[1].players)assert.equal(a.draft.roster.find(x=>x.id===p.id).state.fitness,p.state.fitness);
});
