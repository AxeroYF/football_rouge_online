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
import { createV2MatchRng, createV2Match, advanceV2Match, finishV2Match } from '../engine/s4-v2.1/versus/v2/match-engine-v2.js';
import { v2PenaltyShootout } from '../engine/s4-v2.1/versus/v2/penalty-shootout-v2.js';
import { resolveV2MatchParameters } from '../engine/s4-v2.1/versus/v2/match-parameters-v2.js';
import { publicCampaignLiveLeg, restoreCampaignLiveLeg } from '../engine/campaign-match-engine.mjs';
import { absenceMatches, setAbsence } from '../shared/football/match-availability.mjs';
import { nextLegSeat, applyLegConsequences } from '../server/application/match-consequences.mjs';
const stream=(seed,state)=>{const rng=createV2MatchRng(seed,state);return Array.from({length:8},()=>rng());};
function closeLeg(leg,{score=[1,0],injuries=[],reds=[]}={}){
  leg.match.postMatchConsequences={injuries:[],suspensions:[]};
  for(const [teamIndex,index,matches=1]of injuries){const p=leg.match.teams[teamIndex].players[index];p.active=false;p.injury={severity:'matchEnding',injuryRounds:matches};leg.match.postMatchConsequences.injuries.push({teamIndex,playerId:p.id,matches,reason:matches===2?'lightningInjury':'match'});leg.match.events.push({id:`injury-${teamIndex}-${index}`,type:'injury',teamIndex,minute:80,actorId:p.id,text:'测试伤退'});}
  for(const [teamIndex,index]of reds){const p=leg.match.teams[teamIndex].players[index];p.active=false;p.sentOff=true;p.matchStats.redCards=1;leg.match.postMatchConsequences.suspensions.push({teamIndex,playerId:p.id,matches:1,reason:'redCard'});leg.match.events.push({id:`red-${teamIndex}-${index}`,type:'red',teamIndex,minute:81,actorId:p.id,text:'测试红牌'});}
  leg.match.teams.forEach((t,i)=>t.score=score[i]);leg.match.score=[...score];leg.match.finished=true;leg.match.nextChainIndex=leg.knockout?240:180;
}
const playing=(leg,id)=>leg.match.teams.flatMap(t=>t.players).some(p=>p.id===id&&p.active);
function secondLeg(f,c){f.tick(2*M);f.advance();assert.equal(c.phase,'intermission');f.tick(3*M);f.advance();assert.equal(c.phase,'second-leg');return c.live.secondLeg;}

test('new RNG distinguishes seeds and preserves default/null/explicit-zero and resume contracts',()=>{
 assert.notDeepEqual(stream('A'),stream('B'));assert.deepEqual(stream('A'),stream('A'));assert.deepEqual(stream('A',null),stream('A'));assert.notDeepEqual(stream('A',0),stream('A'));
 const rng=createV2MatchRng('A');rng();const resumed=createV2MatchRng('unused',rng.getState());assert.equal(rng(),resumed());
});
test('serialized live match resumes exactly with same events, scores and RNG state',()=>{
 const options={home:seat(account('home')),away:seat(account('away')),seed:'resume-fix',legNumber:1,startedAt:0};
 const live=createCampaignLiveLeg(options);advanceCampaignLiveLeg(live,3000,{maximumChains:4});
 const restored=restoreCampaignLiveLeg(JSON.parse(JSON.stringify(live)));
 advanceCampaignLiveLeg(live,6000,{maximumChains:4});advanceCampaignLiveLeg(restored,6000,{maximumChains:4});
 assert.deepEqual(restored.match.events,live.match.events);assert.deepEqual(restored.match.score,live.match.score);assert.equal(restored.match.rngState,live.match.rngState);
});
test('first-leg red card and injuries exclude both teams next leg, then serve exactly one absence',()=>{
 const f=fixture(),c=f.begin();const red=f.a.draft.roster[1].id,injury=f.a.draft.roster[2].id,lightning=f.b.draft.roster[13].id;
 closeLeg(c.live.firstLeg,{reds:[[1,1]],injuries:[[1,2],[0,2,2]]});const next=secondLeg(f,c);
 for(const id of [red,injury,lightning])assert.equal(playing(next,id),false);
 assert.equal(absenceMatches(f.a.draft.roster[1],'suspension'),1);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),2);
 closeLeg(next);f.s.challenges.settleChallenge(c);
 assert.equal(absenceMatches(f.a.draft.roster[1],'suspension'),0);assert.equal(absenceMatches(f.a.draft.roster[2],'injury'),0);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),1);
});
test('fresh reserve replaces injured starter in all saved match shapes and redline remains secondary',()=>{
 const f=fixture(),bench=reserve(f.a,'LB',40),c=f.begin(),saved=structuredClone(f.a.tactics);
 closeLeg(c.live.firstLeg,{injuries:[[1,1]]});const next=secondLeg(f,c);
 assert.equal(playing(next,bench.id),true);for(const key of ['position1','position2','position3'])assert.deepEqual(next.away.positionPresets[key][bench.id],saved.squads.expedition.planSnapshots.__s4V2.positionPresets[key][f.a.draft.roster[1].id]);
 assert.deepEqual(f.a.tactics,saved);
});
test('second-leg injury survives settlement, reload and real time; only subsequent legs serve it',()=>{
 const f=fixture(),c=f.begin();closeLeg(c.live.firstLeg);const next=secondLeg(f,c),id=f.a.draft.roster[2].id;closeLeg(next,{injuries:[[1,2,2]]});f.s.challenges.settleChallenge(c);f.tick(24*H);f.reload();
 assert.equal(absenceMatches(f.a.draft.roster.find(p=>p.id===id),'injury'),2);
 const d=f.begin();assert.equal(playing(d.live.firstLeg,id),false);closeLeg(d.live.firstLeg);const last=secondLeg(f,d);assert.equal(playing(last,id),false);closeLeg(last);f.s.challenges.settleChallenge(d);
 assert.equal(absenceMatches(f.a.draft.roster.find(p=>p.id===id),'injury'),0);
});
test('already unavailable reserves serve a leg without being fielded',()=>{
 const f=fixture(),bench=reserve(f.a,'LB');setAbsence(bench,'injury',2);const c=f.begin();assert.equal(playing(c.live.firstLeg,bench.id),false);closeLeg(c.live.firstLeg);f.tick(2*M);f.advance();assert.equal(absenceMatches(bench,'injury'),1);
});
test('first-leg save failure rolls back both accounts and availability marker; retry applies once',()=>{
 const f=fixture(),c=f.begin();closeLeg(c.live.firstLeg,{injuries:[[0,2,2],[1,2]]});f.tick(2*M);f.fail(true);assert.throws(()=>f.advance(),/disk/);
 assert.equal(absenceMatches(f.a.draft.roster[2],'injury'),0);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),0);assert.equal(c.live.firstLeg.consequencesApplied,undefined);
 f.fail(false);f.advance();assert.equal(absenceMatches(f.a.draft.roster[2],'injury'),1);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),2);applyLegConsequences(f.s.accounts,c,c.live.firstLeg);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),2);
});
test('second-leg failure restores served counters and new injuries before successful retry',()=>{
 const f=fixture(),c=f.begin();closeLeg(c.live.firstLeg,{reds:[[1,1]]});const next=secondLeg(f,c);closeLeg(next,{injuries:[[0,2,2]]});f.fail(true);assert.throws(()=>f.s.challenges.settleChallenge(c),/disk/);
 assert.equal(absenceMatches(f.a.draft.roster[1],'suspension'),1);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),0);assert.equal(next.consequencesApplied,undefined);
 f.fail(false);f.s.challenges.settleChallenge(c);assert.equal(absenceMatches(f.a.draft.roster[1],'suspension'),0);assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),2);assert.equal(f.s.challenges.settleChallenge(c),null);
});
test('restart during intermission retains injury and exclusion, without applying first leg twice',()=>{
 const f=fixture(),c=f.begin(),id=f.a.draft.roster[1].id;closeLeg(c.live.firstLeg,{injuries:[[1,1,2]]});f.tick(2*M);f.advance();f.reload();f.tick(3*M);f.advance();const current=f.s.world.activeChallenges.b;
 assert.equal(absenceMatches(f.a.draft.roster[1],'injury'),2);assert.equal(playing(current.live.secondLeg,id),false);
});
test('newer overlapping-match injury is not served retroactively by an older live leg',()=>{
 const f=fixture();setAbsence(f.b.draft.roster[13],'injury',1,{sourceLegId:'old'});const c=f.begin();setAbsence(f.b.draft.roster[13],'injury',2,{sourceLegId:'new'});closeLeg(c.live.firstLeg);f.tick(2*M);f.advance();assert.equal(absenceMatches(f.b.draft.roster[13],'injury'),2);
});
test('insufficient healthy starters forfeit 0-3 without simulation and still serve absences',()=>{
 const f=fixture();for(const p of f.a.draft.roster.slice(1,6))setAbsence(p,'injury',1);const c=f.begin();advanceCampaignLiveLeg(c.live.firstLeg,f.now+1000,{maximumChains:1});
 assert.equal(c.live.firstLeg.match.abandoned,true);assert.equal(c.live.firstLeg.match.abandonmentReason,'insufficientPlayers');assert.deepEqual(c.live.firstLeg.match.score,[3,0]);assert.equal(c.live.firstLeg.match.chains.length,0);
 f.tick(1000);f.advance();assert.ok(f.a.draft.roster.slice(1,6).every(p=>absenceMatches(p,'injury')===0));
});
test('seven healthy players may play and low fitness alone is still rejected at initial departure',()=>{
 const a=account();for(const p of a.draft.roster.slice(1,5))setAbsence(p,'injury',1);
 const partial=buildAccountMatchSeat(a,'expedition',0,{fitness:true,allowShortHanded:true});assert.equal(partial.players.filter(p=>p.active).length,7);
 const leg=createCampaignLiveLeg({home:partial,away:seat(account('b')),seed:'seven',legNumber:1,startedAt:0});advanceCampaignLiveLeg(leg,1000,{maximumChains:1});assert.equal(leg.match.abandoned,false);
 const low=account();setFitness(low.draft.roster[1],10);assert.throws(()=>buildAccountMatchSeat(low,'expedition',0,{fitness:true,allowShortHanded:true}),/无法出征/);
});
test('both short teams terminate without arbitrary winner',()=>{
 const a=seat(account()),b=seat(account('b'));a.players.forEach((p,i)=>p.active=i<6);b.players.forEach((p,i)=>p.active=i<6);
 const leg=createCampaignLiveLeg({home:a,away:b,seed:'both-short',legNumber:2,knockout:true,startedAt:0});advanceCampaignLiveLeg(leg,1000,{maximumChains:1});assert.equal(leg.winnerIndex,null);assert.equal(leg.penalties,null);assert.deepEqual(leg.match.score,[0,0]);
});
test('knockout superstorm downgrades; legacy weather-stopped tie never starts penalties',()=>{
 const home=seat(account()),away=seat(account('b'));const leg=createCampaignLiveLeg({home,away,seed:'storm',legNumber:2,knockout:true,startedAt:0,weather:{type:'superStorm',precipitation:100}});
 assert.equal(leg.match.environment.weather,'storm');leg.match.environment.weather='superStorm';leg.match.superStormStopMinute=65;leg.match.nextChainIndex=130;
 advanceCampaignLiveLeg(leg,160000,{maximumChains:1000});assert.equal(leg.match.abandoned,true);assert.equal(leg.penalties,null);assert.equal(leg.winnerIndex,null);assert.ok(!leg.match.events.some(e=>e.type==='penaltyShootoutKick'));
});
test('extra time keeps 120-minute final clock and finished-match reload completes decision once',()=>{
 const leg=createCampaignLiveLeg({home:seat(account()),away:seat(account('b')),seed:'extra',legNumber:2,knockout:true,startedAt:0});leg.match.nextChainIndex=180;advanceCampaignLiveLeg(leg,160000,{maximumChains:1000});assert.equal(leg.extraTimePlayed,true);assert.equal(leg.match.minute,120);assert.equal(leg.match.events.find(e=>e.type==='fulltime').minute,120);
 const tied=createCampaignLiveLeg({home:seat(account()),away:seat(account('b')),seed:'resume-shootout',legNumber:2,knockout:true,startedAt:0});finishV2Match(tied.match);const restored=JSON.parse(JSON.stringify(tied));advanceCampaignLiveLeg(restored,160000);assert.ok(restored.penalties);const count=restored.match.events.length;advanceCampaignLiveLeg(restored,160000);assert.equal(restored.match.events.length,count);
});
test('live injury substitute and tactical presets use engine coordinates, not original seat',()=>{
 const home=seat(account()),away=seat(account('b'));home.players.push({...structuredClone(home.players[0]),id:'gk-sub',active:false});
 const leg=createCampaignLiveLeg({home,away,seed:'sub-display',legNumber:1,startedAt:0});leg.match.parameters=resolveV2MatchParameters({events:{injuryPerChain:1,blackWhistlePerMatch:0},environment:{weatherEventPerChain:{sunny:0}}});leg.match.rng=()=>0;advanceV2Match(leg.match,1);
 let view=publicCampaignLiveLeg(leg);assert.deepEqual(view.teams[0].players.find(p=>p.id==='gk-sub').position,{x:50,y:90});
 leg.match.teams[1].positions[away.players[1].id]={x:23,y:55};view=publicCampaignLiveLeg(leg);assert.deepEqual(view.teams[1].players.find(p=>p.id===away.players[1].id).position,{x:23,y:55});
});
test('history retains both legs, first-leg consequences, original team mapping and random-event detail after reload',()=>{
 const f=fixture(),c=f.begin();closeLeg(c.live.firstLeg,{injuries:[[1,2]]});const next=secondLeg(f,c);closeLeg(next,{reds:[[0,2]]});
 for(const leg of [c.live.firstLeg,next])for(const type of ['lightning','brawl','blackWhistle','penaltyAwarded'])leg.match.events.unshift({id:type,type,teamIndex:1,minute:3,text:type,detail:'trace'});
 f.s.challenges.settleChallenge(c);f.reload();const battle=f.a.battleHistory.at(-1);assert.equal(battle.broadcasts.length,2);assert.equal(battle.postMatchConsequences.injuries[0].teamIndex,0);assert.equal(battle.postMatchConsequences.injuries[0].legNumber,1);assert.equal(battle.postMatchConsequences.suspensions[0].teamIndex,1);
 for(const number of [1,2])for(const type of ['lightning','brawl','blackWhistle','penaltyAwarded'])assert.ok(battle.events.some(e=>e.legNumber===number&&e.type===type&&e.detail==='trace'));
 assert.equal(new Set(battle.events.filter(e=>e.id).map(e=>e.id)).size,battle.events.filter(e=>e.id).length);
});
function shootoutMatch(){const match=createV2Match([seat(account()),seat(account('b'))],{seed:'penalties'});let n=0;match.rng=()=>n++<2?0.1:(n%2?0.01:0.99);return match;}
test('S4 shootout equalises eligible numbers, captain kicks first and ends once unreachable',()=>{
 const match=shootoutMatch();match.teams[1].players.at(-1).active=false;const result=v2PenaltyShootout(match);
 assert.deepEqual(result.eligiblePlayerIds.map(ids=>ids.length),[10,10]);assert.equal(result.excludedPlayerIds[0].length,1);assert.equal(result.kicks[0].takerId,match.teams[0].captainId);assert.equal(result.kicks.length,6);assert.deepEqual(result.scores,[3,0]);assert.ok(result.kicks.every(k=>k.probability>=.58&&k.probability<=.9));assert.ok(result.kicks.some(k=>!k.scored));
});
test('shootout probability changes with taker and keeper ability, not constant 74%',()=>{
 const low=shootoutMatch(),high=shootoutMatch();for(const p of high.teams[0].players){p.attributes.finishing=99;p.attributes.composure=99;}for(const p of low.teams[0].players){p.attributes.finishing=20;p.attributes.composure=20;}
 const a=v2PenaltyShootout(low),b=v2PenaltyShootout(high);assert.ok(b.kicks[0].probability>a.kicks[0].probability);
});
test('shootout never uses a dismissed goalkeeper and guards invalid random sources',()=>{
 const match=shootoutMatch();match.teams[1].players[0].active=false;match.teams[1].players[0].sentOff=true;const result=v2PenaltyShootout(match);assert.ok(result.kicks.filter(k=>k.teamIndex===0).every(k=>k.goalkeeperId!==match.teams[1].players[0].id));
 const invalid=shootoutMatch();invalid.rng=()=>0;assert.throws(()=>v2PenaltyShootout(invalid),/100轮/);
});
test('referees are deterministic per seed and all S4 scales reachable',()=>{const home=seat(account()),away=seat(account('b'));const referees=new Set();for(let i=0;i<40;i++){const options={home,away,seed:`referee-${i}`,legNumber:1,startedAt:0};const a=createCampaignLiveLeg(options),b=createCampaignLiveLeg(options);assert.equal(a.match.environment.referee,b.match.environment.referee);referees.add(a.match.environment.referee);}assert.deepEqual([...referees].sort(),['lenient','standard','strict']);});
test('actual black-whistle pipeline produces red card, penalty and guaranteed keeper save',()=>{
 const home=seat(account()),away=seat(account('b'));
 home.players.forEach(p=>{p.nationality='阿根廷';p.traits=[];});away.players.forEach(p=>{p.nationality='测试国';p.traits=[];});
 const immunity=YDL_TRAIT_CARDS.find(t=>t.rules.some(r=>r.hook==='redCardImmune'&&r.immune));assert.ok(immunity);
 away.players[0].traits=['muddy-knees',immunity.id];
 const match=createV2Match([home,away],{seed:'guaranteed-penalty',possessionChains:1,forceBlackWhistle:true,parameters:resolveV2MatchParameters({events:{injuryPerChain:0,ownGoalPerMatch:0}})});advanceV2Match(match,1);
 assert.ok(match.events.some(e=>e.type==='blackWhistle'));const red=match.events.find(e=>e.type==='red');assert.ok(red);assert.ok(match.postMatchConsequences.suspensions.some(p=>p.playerId===red.actorId));assert.ok(match.events.some(e=>e.type==='penaltyAwarded'));assert.ok(match.events.some(e=>e.type==='save'&&e.attackType==='penalty'&&e.traitName==='一夫当关'));
});
test('all unavailable squad can still resolve and serve a leg without stalling the challenge',()=>{
 const f=fixture();for(const p of f.a.draft.roster.slice(0,11))setAbsence(p,'injury',1);const c=f.begin();f.tick(1000);f.advance();assert.equal(c.phase,'intermission');assert.deepEqual(c.live.firstLeg.match.score,[3,0]);assert.equal(publicCampaignLiveLeg(c.live.firstLeg).teams[1].activeCount,0);
 f.tick(3*M);f.advance();assert.equal(c.live.secondLeg.match.teams[1].players.filter(p=>p.active).length,11);
});
import { campaignReportBroadcast } from '../campaign-broadcast.js';
test('completed broadcasts are selected from both-leg history without a live session',()=>{
 const reports=[{legNumber:1},{legNumber:2}];const controller={snapshot:{completed:true,battle:{broadcasts:reports}}};assert.equal(campaignReportBroadcast(controller),reports[1]);controller.reportLegNumber=1;assert.equal(campaignReportBroadcast(controller),reports[0]);
});


test('injury replacements exhaust primary, secondary, same-line, utility and emergency outfield candidates in order',()=>{
 const candidates=[{id:'primary',role:'LB',overall:70},{id:'secondary',role:'ST',secondaryRole:'LB',overall:80},{id:'same-line',role:'CB',overall:90},{id:'utility',role:'ST',utilityPlayer:true,overall:95},{id:'emergency',role:'ST',overall:99}];
 for(let start=0;start<candidates.length;start++){
  const home=seat(account()),away=seat(account('b'));[home.players[0],home.players[1]]=[home.players[1],home.players[0]];const outgoing=home.players[0];
  for(const p of [...home.players,...away.players]){p.traits=[];p.traitDefinitions=[];}
  for(const c of candidates.slice(start))home.players.push({...structuredClone(outgoing),secondaryRole:null,traits:[],traitDefinitions:[],...c,name:c.id,active:false});
  const leg=createCampaignLiveLeg({home,away,seed:'injury-candidates-'+start,legNumber:1,startedAt:0});leg.match.parameters=resolveV2MatchParameters({events:{injuryPerChain:1,blackWhistlePerMatch:0},environment:{weatherEventPerChain:{sunny:0}}});leg.match.rng=()=>0;advanceV2Match(leg.match,1);
  const event=leg.match.events.find(e=>e.type==='substitution'&&e.outgoingPlayerId===outgoing.id);assert.equal(event?.incomingPlayerId,candidates[start].id);
  const team=leg.match.teams[0],incoming=team.players.find(p=>p.id===event.incomingPlayerId);assert.equal(incoming.assignedRole,'LB');assert.equal(team.players.filter(p=>p.active).length,11,JSON.stringify(leg.match.events.filter(e=>['injury','redCard','substitution','lightning'].includes(e.type))));
  for(const positions of Object.values(team.positionPresets))assert.deepEqual(positions[incoming.id],home.positionPresets.position1[outgoing.id]);
  assert.ok(team.players.find(p=>p.id===outgoing.id).substitutedOut);
 }
});
test('injury fallback excludes dismissed, injured and previously substituted players and never uses a goalkeeper outfield',()=>{
 const home=seat(account()),away=seat(account('b'));[home.players[0],home.players[1]]=[home.players[1],home.players[0]];const outgoing=home.players[0];
 for(const p of [...home.players,...away.players]){p.traits=[];p.traitDefinitions=[];}
 for(const id of ['injured','dismissed','used','keeper','healthy'])home.players.push({...structuredClone(outgoing),id,name:id,role:id==='keeper'?'GK':'ST',secondaryRole:null,active:false});
 const leg=createCampaignLiveLeg({home,away,seed:'injury-filter',legNumber:1,startedAt:0}),team=leg.match.teams[0];
 team.players.find(p=>p.id==='injured').injury={};team.players.find(p=>p.id==='dismissed').sentOff=true;team.players.find(p=>p.id==='used').substitutedOut=true;
 leg.match.parameters=resolveV2MatchParameters({events:{injuryPerChain:1,blackWhistlePerMatch:0},environment:{weatherEventPerChain:{sunny:0}}});leg.match.rng=()=>0;advanceV2Match(leg.match,1);
 assert.equal(leg.match.events.find(e=>e.type==='substitution'&&e.outgoingPlayerId===outgoing.id)?.incomingPlayerId,'healthy');
});
test('forced pre-match injury replacement uses emergency outfield reserves but redline preference does not',()=>{
 const a=account(),starter=a.draft.roster[1],bench=reserve(a,'ST',90);delete bench.secondaryRole;
 setAbsence(starter,'injury',2);const forced=seat(a);assert.ok(forced.players.some(p=>p.id===bench.id&&p.active));assert.ok(!forced.players.some(p=>p.id===starter.id&&p.active));
 setAbsence(starter,'injury',0);setFitness(starter,50);const regular=seat(a);assert.ok(regular.players.some(p=>p.id===starter.id&&p.active));assert.ok(!regular.players.some(p=>p.id===bench.id&&p.active));
});

test('injured goalkeepers use goalkeeper reserves and stay short-handed when only outfield reserves exist',()=>{
 for(const hasKeeper of [false,true]){
  const home=seat(account()),away=seat(account('b')),outgoing=home.players[0];
  for(const p of [...home.players,...away.players]){p.traits=[];p.traitDefinitions=[];}
  home.players.push({...structuredClone(outgoing),id:'outfield',role:'ST',secondaryRole:null,active:false,overall:99});
  if(hasKeeper)home.players.push({...structuredClone(outgoing),id:'reserve-gk',role:'GK',secondaryRole:null,active:false,overall:70});
  const leg=createCampaignLiveLeg({home,away,seed:'injury-keeper',legNumber:1,startedAt:0});
  leg.match.parameters=resolveV2MatchParameters({events:{injuryPerChain:1,blackWhistlePerMatch:0},environment:{weatherEventPerChain:{sunny:0}}});leg.match.rng=()=>0;advanceV2Match(leg.match,1);
  const event=leg.match.events.find(e=>e.type==='substitution'&&e.outgoingPlayerId===outgoing.id);
  assert.equal(event?.incomingPlayerId,hasKeeper?'reserve-gk':undefined);assert.equal(leg.match.teams[0].players.filter(p=>p.active).length,hasKeeper?11:10);
 }
});
