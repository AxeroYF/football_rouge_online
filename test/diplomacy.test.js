import {OilService} from '../server/application/oil-service.mjs';
import {repairHeadquartersWars} from '../server/application/war-settlement.mjs';
import {withoutNavalPreview} from '../shared/config/fog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DiplomacyService} from '../server/application/diplomacy-service.mjs';
import {EconomyService} from '../server/application/economy-service.mjs';
import {CardManagementService} from '../server/application/card-management-service.mjs';
import {ChallengeService} from '../server/application/challenge-service.mjs';
import {FogService} from '../server/application/fog-service.mjs';
import {createTerritoryWorld,canAttackFromTerritory,canAttack,captureTerritory} from '../territory-model.js';
import {hydrateCampaignWorld} from '../server/infrastructure/campaign-save-migrations.mjs';
import {playersAtWar,sharedHeadquarters,relationKey} from '../shared/config/diplomacy.mjs';
import {interactionWindowMarkup,serverPlayersMarkup,interactionNoticesMarkup} from '../client/social/interaction-controller.js';
import {FogSpatialIndex} from '../shared/map/fog-spatial.mjs';
import {setAbsence,absenceMatches} from '../shared/football/match-availability.mjs';
const catalog=JSON.parse(readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url)));
function fixture(){
 let at=1800000000000,broken=false,saved;
 const index={territories:['a','b','remote'].map((id,i)=>({territoryId:id,name:id,country:'法国',countryCode:'FRA',region:'europe',centroid:[i*5,45],bounds:[i*5,45,i*5+1,46],landNeighbors:id==='remote'?[]:[id==='a'?'b':'a'],neighbors:id==='remote'?[]:[id==='a'?'b':'a'],initialOwner:{type:'neutral'},spawnAllowed:true,playable:true,cityIds:[],clubIds:[]}))};
 const world=createTerritoryWorld(index),economy=new EconomyService({now:()=>at});
 const c={world,territoryIndex:index,playerDatabase:catalog,economy,now:()=>at,accounts:new Map(),save(){if(broken)throw Error('disk failure');saved=JSON.parse(JSON.stringify({world:c.world,accounts:Object.fromEntries(c.accounts)}));}};
 const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
 for(const [id,home]of [['a','a'],['b','b'],['c','remote']]){
  const roster=[],assignments={};for(const squad of ['expedition','garrison'])for(const [i,role]of roles.entries()){
   const p=structuredClone(catalog.find(p=>p.role===role&&!p.isX&&!roster.some(card=>card.cardDefinitionId===p.id)));p.cardDefinitionId=p.id;p.id=`${id}-${squad}-${i}`;p.playerId=p.id;p.cardInstanceId=p.id;p.state={fitness:43};roster.push(p);assignments[p.id]=squad;
  }
  const account={id,nickname:id,token:'secret-'+id,passwordHash:'private',setupComplete:true,homeTerritoryId:home,gold:100000,goldLedger:[],draft:{teamName:id,roster},playerSquads:{schemaVersion:2,assignments},resources:{fans:1000}};c.accounts.set(id,account);
  Object.assign(world.territories[home],{ownerType:'player',ownerId:id,capitalOf:id,buildings:[]});world.players[id]={playerId:id,territoryIds:[home],capitalTerritoryId:home};
 }
 c.oil=new OilService(c);
 c.cardManagement=new CardManagementService({accounts:c.accounts,world,catalog,economy,now:c.now,save:c.save});
 let d=new DiplomacyService({campaign:c});
 const action=(from,to,action,extra={})=>d.mutate(c.accounts.get(from),{targetId:to,action,requestId:crypto.randomUUID(),...extra});
 return {c,get d(){return d;},a:c.accounts.get('a'),b:c.accounts.get('b'),other:c.accounts.get('c'),action,broken:v=>broken=v,time:v=>at=v,tick:v=>at+=v,saved:()=>saved,reload:()=>{c.world=hydrateCampaignWorld(index,JSON.parse(JSON.stringify(c.world)));c.cardManagement.world=c.world;d=new DiplomacyService({campaign:c});}};
}
const accept=(f,proposal,from='b',to='a')=>f.action(from,to,'accept',{proposalId:proposal.proposalId});

test('server directory is global but never exposes account secrets or headquarters',()=>{
 const f=fixture(),list=f.d.summary(f.a).players;assert.equal(list.length,3);assert.ok(list.some(p=>p.id==='c'));
 const json=JSON.stringify(list);assert.ok(!json.includes('secret-'));assert.ok(!json.includes('passwordHash'));assert.ok(!json.includes('remote'));
 assert.equal(f.d.details(f.a,'c').location,null);assert.throws(()=>f.action('a','a','war'),/其他玩家/);
});

test('friendship requires consent, duplicates fail, rejection/cancellation/expiration are terminal',()=>{
 const f=fixture(),p=f.action('a','b','friendship');assert.equal(f.d.relationship('a','b').state,'neutral');
 assert.throws(()=>f.action('a','b','friendship'),/待处理/);assert.throws(()=>f.action('a','b','accept',{proposalId:p.proposalId}),/无权/);
 accept(f,p);assert.equal(f.d.relationship('b','a').state,'friendship');assert.throws(()=>accept(f,p),/已处理/);
 const q=f.action('a','c','location');f.action('c','a','reject',{proposalId:q.proposalId});assert.equal(f.d.details(f.a,'c').requests[0].status,'rejected');
 const r=f.action('a','c','friendly');f.action('a','c','cancel',{proposalId:r.proposalId});assert.throws(()=>f.action('c','a','accept',{proposalId:r.proposalId}),/已处理/);
 const t=f.action('a','c','location');f.tick(86400000);assert.throws(()=>f.action('c','a','accept',{proposalId:t.proposalId}),/过期/);
});

test('request processing is actor-authorized, immutable and idempotent across reload',()=>{
 const f=fixture(),input={targetId:'b',action:'friendship',requestId:crypto.randomUUID()},p=f.d.mutate(f.a,input);
 assert.deepEqual(f.d.mutate(f.a,input),p);assert.equal(Object.keys(f.d.data().requests).length,1);
 assert.throws(()=>f.d.mutate(f.a,{...input,action:'war'}),/请求标识/);
 assert.throws(()=>f.action('c','a','accept',{proposalId:p.proposalId}),/不存在/);
 const response={targetId:'a',action:'accept',proposalId:p.proposalId,requestId:crypto.randomUUID()};f.d.mutate(f.b,response);f.reload();assert.deepEqual(f.d.mutate(f.b,response),{proposalId:p.proposalId});assert.equal(f.d.relationship('a','b').state,'friendship');
});

test('approved position is one-way, scoped to the headquarters and revoked without permanent exploration',()=>{
 const f=fixture(),fog=new FogService({territoryIndex:f.c.territoryIndex,now:f.c.now});
 assert.ok(!fog.update(f.a,f.c.world).view.visibleTerritoryIds.includes('remote'));
 const p=f.action('a','c','location');assert.deepEqual(sharedHeadquarters(f.c.world,'a'),[]);accept(f,p,'c','a');
 assert.deepEqual(sharedHeadquarters(f.c.world,'a'),['remote']);assert.deepEqual(sharedHeadquarters(f.c.world,'c'),[]);
 const view=fog.update(f.a,f.c.world).view;assert.ok(view.visibleTerritoryIds.includes('remote'));assert.ok(!view.exploredTerritoryIds.includes('remote'));assert.equal(f.d.details(f.a,'c').location.territoryId,'remote');
 assert.equal(f.d.details(f.b,'c').location,null);f.action('c','a','revoke-location');assert.ok(!fog.update(f.a,f.c.world).view.visibleTerritoryIds.includes('remote'));
});

test('shared headquarters does not join distant owned vision envelopes',()=>{
 const features={type:'FeatureCollection',features:[0,10,20].map((x,i)=>({type:'Feature',properties:{territoryId:String(i),region:'europe'},geometry:{type:'Polygon',coordinates:[[[x,40],[x+1,40],[x+1,41],[x,41],[x,40]]]}}))};
 const spatial=new FogSpatialIndex(features),plan=spatial.plan(['0'],null,['2']);
 assert.ok(spatial.visibleIds(plan).includes('2'));assert.ok(!spatial.visibleIds(plan).includes('1'));assert.equal(plan.envelopes.length,1);assert.equal(plan.sharedPolygons.length,1);
});

test('war is unilateral, clears friendship and sharing, blocks pending peacetime offers and gates every capture',()=>{
 const f=fixture();accept(f,f.action('a','b','friendship'));accept(f,f.action('a','b','location'));
 const trade=f.action('a','b','trade',{trade:{giveGold:100}});
 assert.equal(canAttack(f.c.territoryIndex,f.c.world,'a','b').reason,'not-at-war');
 assert.equal(canAttackFromTerritory(f.c.territoryIndex,f.c.world,'a','a','b').reason,'not-at-war');
 assert.throws(()=>captureTerritory(f.c.territoryIndex,f.c.world,'a','b',{permission:{allowed:true}}),/宣战/);
 f.action('a','b','war');assert.equal(playersAtWar(f.c.world,'b','a'),true);assert.equal(canAttack(f.c.territoryIndex,f.c.world,'a','b').allowed,true);assert.deepEqual(sharedHeadquarters(f.c.world,'a'),[]);
 assert.equal(f.d.data().requests[trade.proposalId].status,'cancelled');assert.throws(()=>f.action('a','b','friendly'),/战争期间/);
 f.reload();assert.equal(playersAtWar(f.c.world,'a','b'),true);
});

test('peace needs consent and cannot take effect while either direction has a territory battle',()=>{
 const f=fixture();f.action('a','b','war');const p=f.action('a','b','peace');assert.ok(playersAtWar(f.c.world,'a','b'));
 f.c.world.activeChallenges.b={attackerId:'b',defenderId:'a'};assert.throws(()=>accept(f,p),/比赛仍在进行/);assert.ok(playersAtWar(f.c.world,'a','b'));
 delete f.c.world.activeChallenges.b;accept(f,p);assert.equal(playersAtWar(f.c.world,'a','b'),false);assert.equal(canAttack(f.c.territoryIndex,f.c.world,'a','b').reason,'not-at-war');
});

test('direct land and forged maritime challenge requests both require war before engine creation',()=>{
 const f=fixture(),service=new ChallengeService({world:f.c.world,accounts:f.c.accounts,territoryIndex:f.c.territoryIndex,save:f.c.save,now:f.c.now});
 for(const options of [{},{maritimeRoute:{sourceTerritoryId:'a',sourcePoint:[0,45]}}])assert.throws(()=>service.begin(f.a,'b',options),/宣战/);
 f.action('a','b','war');assert.doesNotThrow(()=>service.assertAttackAvailable(f.a,'b'));
 // A server-side state change between kickoff and settlement must also forbid capture.
 const challenge={id:'old',attackerId:'a',defenderId:'b',territoryId:'b',previousOwner:{type:'player',id:'b'},battle:{outcome:'win'},fromTerritoryIds:['a']};f.c.world.activeChallenges.b=challenge;
 f.d.pair('a','b').state='neutral';assert.equal(service.settleChallenge(challenge).captured,false);assert.equal(f.c.world.territories.b.ownerId,'b');
});

test('bilateral gold and player trade is atomic, keeps growth, joins garrison and never replays',()=>{
 const f=fixture(),give=f.a.draft.roster[0],take=f.b.draft.roster[1];give.trainingBonuses={passing:5};give.attributes.passing+=5;
 const p=f.action('a','b','trade',{trade:{giveGold:500,takeGold:200,giveCardIds:[give.id],takeCardIds:[take.id]}});
 assert.equal(f.a.gold,100000);assert.ok(f.a.draft.roster.includes(give));
 const body={targetId:'a',action:'accept',proposalId:p.proposalId,requestId:crypto.randomUUID()};
 f.broken(true);assert.throws(()=>f.d.mutate(f.b,body),/disk failure/);assert.equal(f.a.gold,100000);assert.ok(f.a.draft.roster.some(p=>p.id===give.id));
 f.broken(false);f.d.mutate(f.b,body);f.d.mutate(f.b,body);
 assert.equal(f.a.gold,99700);assert.equal(f.b.gold,100300);assert.equal(f.a.draft.roster.length,22);assert.equal(f.b.draft.roster.length,22);
 assert.equal(f.b.draft.roster.find(p=>p.id===give.id).trainingBonuses.passing,5);assert.equal(f.b.playerSquads.assignments[give.id],'garrison');assert.equal(f.a.playerSquads.assignments[take.id],'garrison');
 f.reload();f.d.mutate(f.b,body);assert.equal(f.a.gold,99700);
});

test('trade consent rejects changed cards, missing funds, locked or consumed assets without partial payment',()=>{
 for(const change of ['funds','growth','locked','missing','training']) {
  const f=fixture(),id=f.a.draft.roster[0].id,p=f.action('a','b','trade',{trade:{giveGold:100,takeGold:200,giveCardIds:[id]}});
  if(change==='funds')f.b.gold=0;if(change==='growth')f.a.draft.roster[0].attributes.passing+=1;if(change==='locked')f.a.draft.roster[0].locked=true;if(change==='missing')f.a.draft.roster.shift();if(change==='training')f.a.draft.roster[0].training={taskId:'busy'};
  const before=structuredClone([f.a,f.b]);assert.throws(()=>accept(f,p));assert.deepEqual([f.a,f.b],before);assert.equal(f.d.data().requests[p.proposalId].status,'pending');
 }
});

test('invalid trade quantities and insufficient proposal funds never reserve or move assets',()=>{
 for(const trade of [{giveGold:-1},{giveGold:1.5},{giveGold:'10'},{giveGold:1000000001},{giveGold:100001},{giveCardIds:['a-expedition-0','a-expedition-0']},{}]){
  const f=fixture(),before=structuredClone([f.a,f.b]);assert.throws(()=>f.action('a','b','trade',{trade}));assert.deepEqual([f.a,f.b],before);
 }
});

test('condemnation ends friendship, announces an unread event and can be withdrawn',()=>{
 const f=fixture();accept(f,f.action('a','b','friendship'));f.action('a','b','condemn');
 assert.equal(f.d.relationship('a','b').state,'neutral');assert.ok(f.d.details(f.b,'a').condemnedMe);assert.ok(f.d.summary(f.b).players.find(p=>p.id==='a').unread>0);
 f.action('b','a','read');assert.equal(f.d.summary(f.b).players.find(p=>p.id==='a').unread,0);f.tick(1);f.action('a','b','withdraw-condemnation');assert.equal(f.d.details(f.b,'a').condemnedMe,false);
});

test('friendlies use full fitness snapshots and leave official fatigue, absences, money and fans unchanged after restart and finish',()=>{
 const f=fixture();setAbsence(f.a.draft.roster[1],'injury',2,{sourceLegId:'old'});
 const before=structuredClone([f.a.draft,f.b.draft,f.a.gold,f.b.gold,f.a.resources,f.b.resources]);
 const invite=f.action('a','b','friendly');assert.equal(Object.keys(f.d.data().matches).length,0);const result=accept(f,invite);
 const match=f.d.data().matches[result.matchId];assert.ok(match.leg.home.players.every(p=>p.state.fitness===100));assert.ok(match.leg.away.players.every(p=>p.state.fitness===100));
 assert.throws(()=>f.d.snapshot(f.other,match.id),/无权/);assert.throws(()=>f.d.beginFriendly(f.a,f.other),/进行中/);
 f.reload();assert.equal(typeof f.d.active(f.a).leg.match.rng,'function');f.tick(300000);f.d.advance(f.c.now(),{maximumMatches:10,maximumChainsPerMatch:1000});
 const end=f.d.snapshot(f.a,match.id);assert.ok(end.completed);assert.equal(end.battle.captured,false);assert.equal(end.battle.broadcasts.length,1);
 assert.deepEqual([f.a.draft,f.b.draft,f.a.gold,f.b.gold,f.a.resources,f.b.resources],before);assert.equal(absenceMatches(f.a.draft.roster[1],'injury'),2);
 f.d.advance();assert.deepEqual([f.a.draft,f.b.draft,f.a.gold,f.b.gold,f.a.resources,f.b.resources],before);
});

test('legacy in-flight PvP is migrated to a war and ongoing friendly snapshot survives world hydration',()=>{
 const f=fixture();f.c.world.activeChallenges.b={id:'legacy',attackerId:'a',defenderId:'b',previousOwner:{type:'player',id:'b'}};delete f.c.world.diplomacy;
 const migrated=new DiplomacyService({campaign:f.c});assert.ok(playersAtWar(f.c.world,'a','b'));assert.equal(migrated.relationship('a','c').state,'neutral');
});

test('UI shows all six actions, war confirmation, trade consent and pending status with escaped names',()=>{
 const f=fixture();f.b.draft.teamName='<script>bad</script>';f.action('b','a','trade',{trade:{giveGold:100,takeCardIds:[f.a.draft.roster[0].id]}});
 const list=serverPlayersMarkup({interactions:f.d.summary(f.a)});assert.match(list,/服务器玩家/);assert.match(list,/&lt;script&gt;/);assert.doesNotMatch(list,/<script>/);
 const html=interactionWindowMarkup(f.d.details(f.a,'b'),{confirmWar:true});
 for(const label of ['申请开放位置','宣布友谊','谴责','发起交易','邀请友谊赛','确认宣战','接受并完成交易'])assert.ok(html.includes(label),label);
 assert.match(html,/待处理/);assert.match(html,/data-interaction-response="reject"/);
});


test('ending naval preview keeps approved headquarters visibility',()=>{
 const f=fixture(),fog=new FogService({territoryIndex:f.c.territoryIndex,now:f.c.now});accept(f,f.action('a','c','location'),'c','a');
 const view=fog.update(f.a,f.c.world).view;
 const cleared=withoutNavalPreview({fog:{...view,preview:{id:'temporary'}},world:{territories:{remote:{ownerId:'c'}}}});
 assert.ok(cleared.fog.visibleTerritoryIds.includes('remote'));assert.ok(cleared.world.territories.remote);
});


test('public club profile projects the actual expedition without mutating or exposing the account',()=>{
 const f=fixture(),before=JSON.stringify(f.b);
 const squad=f.d.details(f.a,'b').squad;
 assert.equal(squad.players.length,11);
 assert.ok(squad.players.every(p=>f.b.playerSquads.assignments[p.player.playerId]==='expedition'));
 assert.ok(squad.players.every(p=>Number.isFinite(p.position.x)&&Number.isFinite(p.position.y)&&p.player.art?.url));
 assert.equal(squad.average,Number((squad.players.reduce((sum,p)=>sum+p.player.overall,0)/11).toFixed(1)));
 assert.equal(JSON.stringify(f.b),before);
 const json=JSON.stringify(squad);for(const key of ['secret-b','passwordHash','capitalTerritoryId','goldLedger'])assert.ok(!json.includes(key));
 squad.players[0].position.x=0;assert.equal(JSON.stringify(f.b),before);
});
test('incomplete public squad keeps the profile and interaction actions available',()=>{
 const f=fixture();f.b.draft.roster=[];
 const view=f.d.details(f.a,'b');assert.equal(view.squad.unavailable,true);
 const html=interactionWindowMarkup(view);assert.ok(html.includes('远征首发尚未就绪'));assert.ok(html.includes('data-interaction-action="war-confirm"'));
});

test('notification summary only exposes incoming proposals and strips private trade signatures',()=>{
 const f=fixture();const request=f.action('a','b','trade',{trade:{giveGold:100,takeGold:20,giveCardIds:[],takeCardIds:[]}});f.action('c','a','location');
 const summary=f.d.summary(f.b);assert.equal(summary.requests.length,1);assert.equal(summary.requests[0].id,request.proposalId);assert.equal(summary.requests[0].payload.giveGold,100);assert.equal(summary.requests[0].payload.giveSignatures,undefined);assert.equal(summary.requests[0].payload.takeSignatures,undefined);
 const html=interactionNoticesMarkup({interactions:summary});assert.match(html,/你获得：100 金币/);assert.match(html,/你付出：20 金币/);assert.match(html,/data-notice-action="accept"/);assert.match(html,/data-notice-action="reject"/);assert.doesNotMatch(html,/查看并处理/);
 f.action('b','a','accept',{proposalId:request.proposalId});assert.equal(f.d.summary(f.b).requests.length,0);assert.ok(f.d.summary(f.a).events.some(e=>e.type==='accept:trade'));
});
test('reading one notice preserves other unread events and rejects a foreign event id',()=>{
 const f=fixture();f.action('a','b','condemn');f.tick(1);f.action('a','b','withdraw-condemnation');const events=f.d.summary(f.b).events;assert.equal(events.length,2);
 f.action('b','a','read',{eventId:events[0].id});assert.equal(f.d.summary(f.b).events.length,1);assert.equal(f.d.summary(f.b).events[0].id,events[1].id);assert.equal(f.d.summary(f.b).players.find(p=>p.id==='a').unread,1);
 assert.throws(()=>f.action('c','a','read',{eventId:events[1].id}),/无权|不存在/);f.reload();assert.equal(f.d.summary(f.b).events.length,1);
});
test('server list has names without avatar tiles and notification text is escaped',()=>{
 const f=fixture();f.a.draft.teamName='<img onerror=bad>';f.action('a','b','friendship');const state={interactions:f.d.summary(f.b)};
 assert.doesNotMatch(serverPlayersMarkup(state),/<i /);assert.doesNotMatch(interactionNoticesMarkup(state),/<img onerror/);assert.match(interactionNoticesMarkup(state),/&lt;img/);
});


const ally=(f,a,b)=>{accept(f,f.action(a,b,'friendship'),b,a);accept(f,f.action(a,b,'alliance'),b,a);};
test('alliance requires accepted friendship, recipient consent, and preserves the group on restart',()=>{
 const f=fixture();assert.throws(()=>f.action('a','b','alliance'),/先宣布友谊/);
 const friendship=f.action('a','b','friendship');assert.throws(()=>f.action('a','b','alliance'),/先宣布友谊/);accept(f,friendship);
 const proposal=f.action('a','b','alliance');assert.equal(f.d.relationship('a','b').state,'friendship');
 assert.throws(()=>accept(f,proposal,'c','a'),/不存在/);accept(f,proposal);
 assert.equal(f.d.relationship('a','b').state,'alliance');f.reload();assert.equal(f.d.relationship('a','b').state,'alliance');
 ally(f,'b','c');assert.equal(f.d.relationship('a','c').state,'alliance');
 assert.equal(f.d.details(f.a,'c').allianceMembers.length,3);
 assert.throws(()=>f.action('a','c','war'),/退出同盟/);assert.throws(()=>f.action('a','c','condemn'),/退出同盟/);
});
test('group war applies to both full alliances, cancels offers and rolls back atomically',()=>{
 const f=fixture();ally(f,'a','b');
 const d=structuredClone(f.other);Object.assign(d,{id:'d',nickname:'d'});d.draft.teamName='d';f.c.accounts.set('d',d);ally(f,'c','d');
 const trade=f.action('a','d','trade',{trade:{giveGold:100}});
 const before=structuredClone(f.d.data());f.broken(true);assert.throws(()=>f.action('c','a','war'),/disk failure/);assert.deepEqual(f.d.data(),before);f.broken(false);
 f.action('c','a','war');for(const a of ['a','b'])for(const b of ['c','d'])assert.ok(playersAtWar(f.c.world,a,b));
 assert.equal(f.d.data().requests[trade.proposalId].status,'cancelled');assert.equal(f.d.relationship('a','b').state,'alliance');
 assert.equal(f.d.summary(f.b).events.some(e=>e.type==='alliance-war'),true);
 f.reload();assert.ok(playersAtWar(f.c.world,'b','d'));
});
test('leaving repatriates units, retains paid tasks and keeps other members allied',()=>{
 const f=fixture();ally(f,'a','b');ally(f,'b','c');
 f.a.expeditionPiece={schemaVersion:1,tokenId:'default',territoryId:'b',movement:null};
 f.a.scouting={units:{s:{id:'s',territoryId:'remote',originTerritoryId:'a',movement:null}},tasks:{t:{territoryId:'remote',costGold:700,candidates:[{id:'paid'}],claimedAt:null}}};
 const paid=structuredClone(f.a.scouting.tasks),before=structuredClone(f.a);f.broken(true);assert.throws(()=>f.action('a','b','leave-alliance'),/disk failure/);assert.deepEqual(f.a,before);assert.equal(f.d.relationship('a','c').state,'alliance');f.broken(false);
 f.action('a','b','leave-alliance');assert.equal(f.a.expeditionPiece.territoryId,'a');assert.equal(f.a.scouting.units.s.territoryId,'a');assert.deepEqual(f.a.scouting.tasks,paid);
 assert.equal(f.d.relationship('b','c').state,'alliance');assert.equal(f.d.relationship('a','b').state,'friendship');assert.equal(f.d.relationship('a','c').state,'friendship');
});
test('alliance invitations reject group drift or wars that begin before acceptance',()=>{
 const f=fixture();accept(f,f.action('a','b','friendship'));const p=f.action('a','b','alliance');ally(f,'b','c');
 assert.throws(()=>accept(f,p),/已处理/);assert.equal(f.d.relationship('a','b').state,'friendship');
 const next=f.action('a','b','alliance');f.action('c','a','war');assert.throws(()=>accept(f,next),/已处理/);
});
test('allied owned tiles become temporary shared visibility without sharing unrelated exploration',()=>{
 const f=fixture(),fog=new FogService({territoryIndex:f.c.territoryIndex,now:f.c.now});ally(f,'a','c');
 const view=fog.update(f.a,f.c.world).view;assert.ok(view.visibleTerritoryIds.includes('remote'));assert.ok(view.sharedTerritoryIds.includes('remote'));assert.ok(!view.exploredTerritoryIds.includes('remote'));
 f.action('a','c','leave-alliance');assert.ok(!fog.update(f.a,f.c.world).view.visibleTerritoryIds.includes('remote'));
});

test('borrowed-land conquest requires persistent directional consent and revocation is authoritative',async()=>{
 const {canConquerFromTerritory}=await import('../shared/config/diplomacy.mjs');const f=fixture();
 assert.throws(()=>f.action('a','b','conquest-access'),/盟友/);ally(f,'a','b');assert.equal(canConquerFromTerritory(f.c.world,'a','b'),false);
 const request=f.action('a','b','conquest-access');accept(f,request);assert.equal(canConquerFromTerritory(f.c.world,'a','b'),true);assert.equal(canConquerFromTerritory(f.c.world,'b','a'),false);
 f.reload();assert.equal(canConquerFromTerritory(f.c.world,'a','b'),true);f.broken(true);assert.throws(()=>f.action('b','a','revoke-conquest-access'),/disk failure/);assert.equal(canConquerFromTerritory(f.c.world,'a','b'),true);f.broken(false);
 f.action('b','a','revoke-conquest-access');assert.equal(canConquerFromTerritory(f.c.world,'a','b'),false);accept(f,f.action('a','b','conquest-access'));f.action('a','b','leave-alliance');accept(f,f.action('a','b','alliance'));assert.equal(canConquerFromTerritory(f.c.world,'a','b'),false);
});
test('only established clubs appear and global news is readable, persistent, dismissible and rolled back on save failure',()=>{
 const f=fixture();f.c.accounts.set('unbuilt',{id:'unbuilt',nickname:'account',draft:{roster:[]}});assert.equal(f.d.summary(f.a).players.length,3);
 ally(f,'a','b');assert.match(f.d.summary(f.other).news[0].text,/a、b.*结成同盟/);const event=f.d.summary(f.other).news[0];f.action('c','c','read-news',{eventId:event.id});assert.equal(f.d.summary(f.other).news.length,0);
 const before=structuredClone(f.c.world.news);f.broken(true);assert.throws(()=>f.action('c','a','war'),/disk failure/);assert.deepEqual(f.c.world.news,before);f.broken(false);f.action('c','a','war');assert.match(f.d.summary(f.b).news[0].text,/c.*a、b.*宣战/);f.reload();assert.ok(f.d.summary(f.b).news.some(e=>e.type==='war'));
});
test('neutral conquest cannot be started from allied land without accepted permission',()=>{
 const f=fixture();ally(f,'a','b');f.a.expeditionPiece={schemaVersion:1,tokenId:'default',territoryId:'b',movement:null};f.c.world.territories.remote.ownerType='neutral';f.c.world.territories.remote.ownerId=null;
 const service=new ChallengeService({world:f.c.world,accounts:f.c.accounts,territoryIndex:f.c.territoryIndex,now:f.c.now});assert.throws(()=>service.begin(f.a,'remote'),e=>e.code==='ally-conquest-permission');
});

function extraPlayer(f,id){
 const a=structuredClone(f.other);Object.assign(a,{id,nickname:id,homeTerritoryId:id});a.draft.teamName=id;f.c.accounts.set(id,a);
 f.c.territoryIndex.territories.push({...f.c.territoryIndex.territories[0],territoryId:id});
 f.c.world.territories[id]={territoryId:id,ownerType:'player',ownerId:id,capitalOf:id,buildings:[],version:0};
 f.c.world.players[id]={playerId:id,territoryIds:[id],capitalTerritoryId:id};return a;
}
function winningChallenge(f,{attackerId='a',defenderId='b',territoryId='b',id='headquarters-battle'}={}){
 const challenge={id,attackerId,defenderId,territoryId,previousOwner:{type:'player',id:defenderId},battle:{outcome:'win'},fromTerritoryIds:[attackerId]};
 f.c.world.activeChallenges[territoryId]=challenge;return challenge;
}
const challengeService=f=>new ChallengeService({world:f.c.world,accounts:f.c.accounts,territoryIndex:f.c.territoryIndex,save:f.c.save,now:f.c.now});

test('wartime alliance inherits wars from both sides, including enemy allies, and persists',()=>{
 const f=fixture();extraPlayer(f,'d');extraPlayer(f,'e');ally(f,'c','d');
 f.action('a','c','war');f.action('b','e','war');
 accept(f,f.action('a','b','friendship'));const p=f.action('a','b','alliance');
 assert.deepEqual(f.d.data().requests[p.proposalId].payload.enemies,['c','d','e']);
 const offer=f.action('b','c','trade',{trade:{giveGold:1}});
 const before=structuredClone(f.d.data());f.broken(true);assert.throws(()=>accept(f,p),/disk failure/);assert.deepEqual(f.d.data(),before);f.broken(false);
 accept(f,p);
 for(const a of ['a','b'])for(const b of ['c','d','e'])assert.ok(playersAtWar(f.c.world,a,b));
 assert.equal(f.d.relationship('a','b').state,'alliance');assert.equal(f.d.data().requests[offer.proposalId].status,'cancelled');
 f.reload();assert.ok(playersAtWar(f.c.world,'b','d'));
});
test('alliance accepted after a new external war joins that war; enemy members cannot merge',()=>{
 const f=fixture();accept(f,f.action('a','b','friendship'));const p=f.action('a','b','alliance');f.action('a','c','war');accept(f,p);assert.ok(playersAtWar(f.c.world,'b','c'));
 const g=fixture();extraPlayer(g,'d');ally(g,'a','c');ally(g,'b','d');
 // A legacy inconsistent pair must not turn enemies into allies through a third party.
 g.d.pair('c','d').state='war';g.d.pair('a','b').state='friendship';assert.throws(()=>g.action('a','b','alliance'),/成员之间正在交战/);
});
test('headquarters capture ends both alliance blocs, retains other wars and blocks already running captures',()=>{
 const f=fixture();extraPlayer(f,'d');extraPlayer(f,'e');ally(f,'a','c');ally(f,'b','d');f.action('a','b','war');f.action('a','e','war');
 const peace=f.action('a','b','peace'),main=winningChallenge(f),other=winningChallenge(f,{attackerId:'d',defenderId:'a',territoryId:'a',id:'other-live'}),service=challengeService(f);
 const before=JSON.stringify({world:f.c.world,accounts:[...f.c.accounts]});f.broken(true);assert.throws(()=>service.settleChallenge(main),/disk failure/);assert.equal(JSON.stringify({world:f.c.world,accounts:[...f.c.accounts]}),before);f.broken(false);
 const battle=service.settleChallenge(main);assert.equal(battle.captured,true);assert.equal(battle.warEnded.loserId,'b');
 for(const x of ['a','c'])for(const y of ['b','d'])assert.equal(playersAtWar(f.c.world,x,y),false);
 assert.ok(playersAtWar(f.c.world,'a','e'));assert.equal(f.d.relationship('b','d').state,'alliance');assert.equal(f.d.data().requests[peace.proposalId].status,'cancelled');assert.equal(f.c.world.territories.b.ownerId,'a');
 assert.equal(f.d.summary(f.other).news.filter(e=>e.type==='war-ended').length,1);
 f.action('a','b','war');const second=service.settleChallenge(other);assert.equal(second.captured,false);assert.match(second.captureBlockedReason,/战争已结束/);assert.equal(f.c.world.territories.a.ownerId,'a');
});
test('ordinary land capture does not end war and a lost headquarters match transfers no land',()=>{
 const f=fixture();f.action('a','b','war');f.c.world.players.b.capitalTerritoryId='remote';f.b.homeTerritoryId='remote';f.c.world.territories.b.capitalOf=null;
 assert.equal(challengeService(f).settleChallenge(winningChallenge(f)).captured,true);assert.ok(playersAtWar(f.c.world,'a','b'));
 const g=fixture();g.action('a','b','war');const c=winningChallenge(g);c.battle.outcome='loss';assert.equal(challengeService(g).settleChallenge(c).captured,false);assert.ok(playersAtWar(g.c.world,'a','b'));
});
test('old headquarters victories repair once, but a later declaration is not undone',()=>{
 const f=fixture();f.action('a','b','war');f.tick(10);
 captureTerritory(f.c.territoryIndex,f.c.world,'a','b',{permission:{allowed:true,fromTerritoryIds:['a']}});
 f.a.battleHistory=[{challengeId:'legacy-capital',territoryId:'b',captured:true,defender:{type:'player',id:'b'},settledAt:f.c.now()}];
 assert.ok(repairHeadquartersWars(f.c.world,f.c.accounts,f.c.now()));assert.equal(playersAtWar(f.c.world,'a','b'),false);
 f.tick(1);f.action('a','b','war');assert.equal(repairHeadquartersWars(f.c.world,f.c.accounts,f.c.now()),false);assert.ok(playersAtWar(f.c.world,'a','b'));
 delete f.c.world.diplomacy.headquartersSettlementVersion;repairHeadquartersWars(f.c.world,f.c.accounts,f.c.now());assert.ok(playersAtWar(f.c.world,'a','b'));
});
test('news acknowledgement is lightweight, idempotent and rolls back only its read markers on save failure',()=>{
 const f=fixture();ally(f,'a','b');const event=f.d.summary(f.other).news[0],input={action:'read-news',targetId:'c',eventId:event.id,requestId:crypto.randomUUID()};
 const before=structuredClone(f.d.data());f.d.transaction=()=>{throw Error('must not clone all accounts');};f.a.nonSerializable=()=>1;
 f.broken(true);assert.throws(()=>f.d.mutate(f.other,input),/disk failure/);assert.equal(f.other.worldNewsReadIds,undefined);assert.deepEqual(f.d.data(),before);
 f.broken(false);f.d.mutate(f.other,input);assert.equal(f.d.summary(f.other).news.length,0);f.d.mutate(f.other,input);assert.equal(f.other.worldNewsReadIds.length,1);
 assert.throws(()=>f.d.mutate(f.other,{...input,eventId:'different'}),/请求标识/);assert.equal(f.d.summary(f.a).news.length,1);
});


test('acknowledgement persists directly without running campaign economic settlement',()=>{
 const f=fixture();ally(f,'a','b');const event=f.d.summary(f.other).news[0];
 f.c.persist=f.c.save;f.c.save=()=>{throw Error('must not settle world economy');};
 f.action('c','c','read-news',{eventId:event.id});assert.ok(f.saved().accounts.c.worldNewsReadIds.includes(event.id));
});
test('legacy read and peace request timestamps do not hide a recorded headquarters victory',()=>{
 const f=fixture();f.action('a','b','war');f.tick(10);const at=f.c.now();
 captureTerritory(f.c.territoryIndex,f.c.world,'a','b',{permission:{allowed:true,fromTerritoryIds:['a']}});
 f.a.battleHistory=[{challengeId:'legacy-hq',territoryId:'b',captured:true,defender:{type:'player',id:'b'},settledAt:at}];
 delete f.d.pair('a','b').warStartedAt;f.tick(20);f.action('a','b','peace');
 repairHeadquartersWars(f.c.world,f.c.accounts,f.c.now());assert.equal(playersAtWar(f.c.world,'a','b'),false);
});


test('mixed oil, gold and player trades conserve resources and survive replay and reload',()=>{
 const f=fixture();f.c.oil.initialize(f.a);f.c.oil.initialize(f.b);const id=f.a.draft.roster[0].id;
 const proposal=f.action('a','b','trade',{trade:{giveOil:12,giveCardIds:[id],takeGold:500,takeOil:2}});
 assert.equal(f.a.oil.balance,30);assert.equal(f.b.gold,100000);
 const input={targetId:'a',action:'accept',proposalId:proposal.proposalId,requestId:crypto.randomUUID()};
 f.d.mutate(f.b,input);assert.equal(f.a.oil.balance,20);assert.equal(f.b.oil.balance,40);assert.equal(f.a.gold,100500);assert.equal(f.b.gold,99500);assert.ok(f.b.draft.roster.some(p=>p.id===id));
 f.reload();f.d.mutate(f.b,input);assert.equal(f.a.oil.balance,20);assert.equal(f.b.oil.balance,40);assert.equal(f.b.gold,99500);
});
test('gifts to neutral players require consent and no payment; rejection and cancellation transfer nothing',()=>{
 for(const response of ['accept','reject','cancel']){
  const f=fixture();f.c.oil.initialize(f.a);f.c.oil.initialize(f.b);const id=f.a.draft.roster[0].id;
  const p=f.action('a','b','trade',{trade:{mode:'gift',giveOil:5,giveGold:100,giveCardIds:[id]}});assert.equal(f.d.data().requests[p.proposalId].payload.kind,'gift');
  assert.equal(f.a.oil.balance,30);assert.equal(f.b.oil.balance,30);
  if(response==='cancel')f.action('a','b',response,{proposalId:p.proposalId});else f.action('b','a',response,{proposalId:p.proposalId});
  assert.equal(f.a.oil.balance,response==='accept'?25:30);assert.equal(f.b.oil.balance,response==='accept'?35:30);assert.equal(f.b.gold,response==='accept'?100100:100000);assert.equal(f.d.relationship('a','b').state,'neutral');
 }
});
test('invalid oil quantities and forged gift requests cannot move resources',()=>{
 for(const trade of [{giveOil:-1},{giveOil:1.5},{giveOil:'10'},{giveOil:1000001},{giveOil:31},{mode:'gift',giveOil:1,takeGold:1},{mode:'invalid',giveOil:1},{}]){
  const f=fixture(),before=structuredClone([f.a,f.b]);assert.throws(()=>f.action('a','b','trade',{trade}));assert.deepEqual([f.a,f.b],before);
 }
});
test('acceptance rechecks current oil and atomically rolls back oil, gold and cards on save failure',()=>{
 const f=fixture();f.c.oil.initialize(f.a);f.c.oil.initialize(f.b);const id=f.a.draft.roster[0].id;
 const p=f.action('a','b','trade',{trade:{giveOil:15,giveCardIds:[id],takeGold:500}});
 f.a.oil.balance=14;let before=structuredClone([f.a,f.b]);assert.throws(()=>accept(f,p),/石油不足/);assert.deepEqual([f.a,f.b],before);
 f.a.oil.balance=30;before=structuredClone([f.a,f.b]);const save=f.c.save;let calls=0;f.c.save=()=>{if(++calls===2)throw Error('disk failure');save();};
 assert.throws(()=>accept(f,p),/disk failure/);assert.deepEqual([f.a,f.b],before);assert.equal(f.d.data().requests[p.proposalId].status,'pending');
 f.c.save=save;accept(f,p);assert.equal(f.a.oil.balance,15);assert.equal(f.b.oil.balance,45);
});
test('oil inventory overflow and wartime trading reject the whole proposal or acceptance',()=>{
 const f=fixture();f.c.oil.initialize(f.a);f.c.oil.initialize(f.b);f.b.oil.balance=Number.MAX_SAFE_INTEGER;
 const p=f.action('a','b','trade',{trade:{giveOil:1}}),before=structuredClone([f.a,f.b]);assert.throws(()=>accept(f,p),/安全范围/);assert.deepEqual([f.a,f.b],before);
 f.action('a','b','war');assert.throws(()=>accept(f,p),/已处理/);assert.throws(()=>f.action('a','b','trade',{trade:{giveOil:1}}),/战争期间/);
});
test('resource forms and both quote views show oil, gifting and the correct transaction direction',()=>{
 const f=fixture();const form=interactionWindowMarkup(f.d.details(f.a,'b'),{tradeOpen:true,trade:{giveOil:7,takeGold:800}});
 assert.match(form,/data-trade-oil="give" value="7"/);assert.match(form,/data-trade-oil="take"/);assert.match(form,/30 石油/);assert.match(form,/金币、石油、球员/);
 const gift=interactionWindowMarkup(f.d.details(f.a,'b'),{tradeOpen:true,trade:{mode:'gift',giveOil:5}});assert.match(gift,/无需付出/);assert.doesNotMatch(gift,/data-trade-oil="take"/);assert.match(gift,/发送赠送申请/);
 f.action('a','b','trade',{trade:{giveOil:7,takeGold:800}});const html=interactionNoticesMarkup({playerId:'b',interactions:f.d.summary(f.b)});assert.match(html,/你获得：0 金币 · 7 石油/);assert.match(html,/你付出：800 金币/);assert.match(interactionWindowMarkup(f.d.details(f.b,'a')),/7 石油/);
});
