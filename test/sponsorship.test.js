import {setTestWar} from './diplomacy-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SponsorshipService } from '../server/application/sponsorship-service.mjs';
import { EconomyService } from '../server/application/economy-service.mjs';
import { CampaignService } from '../campaign-service.mjs';
import { createChallengeScheduler } from '../server/scheduler/challenge-scheduler.mjs';
import { createCampaignApiHandler } from '../server/http/campaign-api-handler.mjs';
import { SPONSORS,SPONSOR_CONTRACT_TYPES,SPONSOR_HOUR_MS as H,SPONSOR_DAY_MS as D,sponsoredTeamName,sponsoredStadiumName } from '../shared/config/sponsorship.mjs';
import { createCampaignLiveLeg,publicCampaignLiveLeg,buildAccountMatchSeat } from '../engine/campaign-match-engine.mjs';
import { sponsorRewardPreviewMarkup,broadcastSponsorMarkup,sponsorRewardMarkup } from '../client/sponsorship/sponsor-markup.js';
import { sponsorshipWindowMarkup } from '../client/sponsorship/sponsorship-controller.js';
const origin=1788825600000; // Beijing 08:00, outside the attack curfew.
function fixture(){
 let now=origin,sequence=0;const a={id:'one',setupComplete:true,gold:0,goldLedger:[],draft:{teamName:'原球队',roster:[]}};
 const service=new SponsorshipService({economy:new EconomyService({now:()=>now}),now:()=>now});
 service.migrateAccount(a);
 function next(type='normal',brand=null,account=a){
  for(let i=0;i<10000;i++){const ch={id:'reward-'+sequence++,territoryId:'target',previousOwner:{type:'neutral'}},r=service.rewardForChallenge(account,ch);if(r&&r.type===type&&(!brand||r.sponsorId===brand))return service.grantNeutralReward(account,ch);}
  throw Error('test offer not found');
 }
 return {service,a,next,setNow:n=>now=n,accounts:new Map([[a.id,a]])};
}
test('18 brands include the ten S4 originals and eight requested additions with local transparent assets',()=>{
 assert.equal(SPONSORS.length,18);assert.equal(new Set(SPONSORS.map(b=>b.id)).size,18);
 for(const id of ['bmw','mercedes','audi','tesla','mcdonalds','honda','toyota','ferrari'])assert.ok(SPONSORS.some(b=>b.id===id));
 const manifest=JSON.parse(fs.readFileSync(new URL('../assets/sponsors/sponsors-manifest.json',import.meta.url),'utf8'));
 for(const brand of SPONSORS){
  const bytes=fs.readFileSync(new URL('..'+brand.icon,import.meta.url));assert.ok(bytes.length>100);
  if(brand.icon.endsWith('.svg')){const svg=bytes.toString();assert.match(svg,/viewBox=/);assert.doesNotMatch(svg,/<script|foreignObject|onload=|href=/i);}
  const record=manifest.sponsors.find(b=>b.id===brand.id);assert.ok(record);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.displaySha256??record.sha256);
  const original=fs.readFileSync(new URL('../assets/sponsors/'+record.icon,import.meta.url));assert.equal(crypto.createHash('sha256').update(original).digest('hex'),record.sha256);
 }
});
test('contract terms match user-confirmed days, hourly rates and slots',()=>{
 assert.deepEqual(Object.values(SPONSOR_CONTRACT_TYPES).map(t=>[t.durationDays,t.hourlyGold,t.limit]),[[1,200,3],[2,300,1],[2,600,1]]);
});
test('migration never gifts an offer and unknown contract schema is rejected',()=>{
 const f=fixture();assert.deepEqual(f.a.sponsorship.offers,[]);assert.equal(f.service.migrateAccount(f.a),false);
 assert.throws(()=>f.service.migrateAccount({sponsorship:{schemaVersion:9}}),/存档/);
});
test('only neutral conquests can roll contracts; draws are deterministic across retries',()=>{
 const f=fixture(),outcomes=new Set();let count=0;
 for(let i=0;i<2000;i++){const c={id:'sample-'+i,territoryId:'target',previousOwner:{type:'neutral'}};
  const one=f.service.rewardForChallenge(f.a,c);assert.deepEqual(one,f.service.rewardForChallenge(f.a,c));
  if(one){count++;outcomes.add(one.sponsorId);assert.ok(SPONSOR_CONTRACT_TYPES[one.type]);}
  for(const type of ['player','club'])assert.equal(f.service.rewardForChallenge(f.a,{...c,previousOwner:{type}}),null);
 }
 assert.ok(count>600&&count<800);assert.equal(outcomes.size,18);
});
test('repeated reward grant preserves exactly one offer and does not reset its state',()=>{
 const f=fixture(),offer=f.next(),ch={id:offer.sourceChallengeId,territoryId:offer.sourceTerritoryId,previousOwner:{type:'neutral'}};
 assert.equal(f.service.grantNeutralReward(f.a,ch).id,offer.id);assert.equal(f.a.sponsorship.offers.length,1);
 f.service.respond(f.a,offer.id,'accept');f.service.grantNeutralReward(f.a,ch);assert.equal(f.a.sponsorship.offers.length,1);assert.equal(f.a.sponsorship.offers[0].status,'accepted');
});
test('pending contracts do not expire or earn; signing starts a full duration with no upfront payment',()=>{
 const f=fixture(),offer=f.next();f.setNow(origin+10*D);f.service.prepare(f.accounts,origin+10*D);
 assert.equal(f.a.gold,0);assert.equal(f.a.sponsorship.offers[0].status,'pending');
 const state=f.service.respond(f.a,offer.id,'accept'),c=state.contracts[0];
 assert.equal(c.signedAt,origin+10*D);assert.equal(c.expiresAt,c.signedAt+D);assert.equal(c.nextPaymentAt,c.signedAt+H);
 assert.equal(f.a.gold,0);assert.equal(state.hourlyGold,200);
});
for(const type of ['normal','stadium','team'])test(type+' pays once per full hour, catches up offline and stops exactly at expiry',()=>{
 const f=fixture(),offer=f.next(type);f.service.respond(f.a,offer.id,'accept');const terms=SPONSOR_CONTRACT_TYPES[type];
 f.service.prepare(f.accounts,origin+H-1);assert.equal(f.a.gold,0);
 f.service.prepare(f.accounts,origin+H);assert.equal(f.a.gold,terms.hourlyGold);
 f.service.prepare(f.accounts,origin+H);assert.equal(f.a.gold,terms.hourlyGold);
 f.service.prepare(f.accounts,origin+terms.durationDays*D+12*D);assert.equal(f.a.gold,terms.hourlyGold*terms.durationDays*24);
 assert.equal(f.a.sponsorship.contracts[0].status,'expired');assert.equal(f.service.publicState(f.a,origin+terms.durationDays*D).hourlyGold,0);
 f.service.prepare(f.accounts,origin+H);assert.equal(f.a.gold,terms.hourlyGold*terms.durationDays*24);
});
test('slots and brand exclusivity block signing but preserve pending rewards',()=>{
 const f=fixture();
 for(const brand of ['bmw','audi','honda'])f.service.respond(f.a,f.next('normal',brand).id,'accept');
 const pending=f.next('normal','toyota');assert.throws(()=>f.service.respond(f.a,pending.id,'accept'),/名额已满/);assert.ok(f.service.publicState(f.a).offers.some(o=>o.id===pending.id));
 assert.throws(()=>f.service.respond(f.a,f.next('stadium','bmw').id,'accept'),/品牌/);
 for(const [type,brand,other] of [['stadium','tesla','mercedes'],['team','ferrari','apple']]){
  f.service.respond(f.a,f.next(type,brand).id,'accept');
  assert.throws(()=>f.service.respond(f.a,f.next(type,other).id,'accept'),/名额已满/);
 }
 assert.equal(f.service.publicState(f.a).hourlyGold,1500);
 f.setNow(origin+D);f.service.save=()=>f.service.prepare(f.accounts,origin+D);
 f.service.respond(f.a,pending.id,'accept');assert.equal(f.service.publicState(f.a).slots.normal.used,1);
});
test('signing and rejecting are idempotent; one player cannot respond to another player offer',()=>{
 const f=fixture(),offer=f.next();f.service.respond(f.a,offer.id,'accept');f.service.respond(f.a,offer.id,'accept');assert.equal(f.a.sponsorship.contracts.length,1);
 assert.throws(()=>f.service.respond(f.a,offer.id,'reject'),/已经处理/);
 const other={id:'two',setupComplete:true,gold:0,goldLedger:[]};f.service.migrateAccount(other);
 assert.throws(()=>f.service.respond(other,offer.id,'accept'),/不存在/);
 const rejected=f.next();f.service.respond(f.a,rejected.id,'reject');f.service.respond(f.a,rejected.id,'reject');assert.throws(()=>f.service.respond(f.a,rejected.id,'accept'),/已经处理/);
});
test('failed signing restores pending offer and does not create a contract',()=>{
 const f=fixture(),offer=f.next(),before=JSON.stringify(f.a);f.service.save=()=>{throw Error('disk failure');};
 assert.throws(()=>f.service.respond(f.a,offer.id,'accept'),/disk failure/);assert.equal(JSON.stringify(f.a),before);
});
test('hourly settlement rollback restores every account and ledger on overflow or persistence failure',()=>{
 const f=fixture();f.service.respond(f.a,f.next().id,'accept');
 const before=JSON.stringify(f.a);f.service.prepare(f.accounts,origin+H).rollback();assert.equal(JSON.stringify(f.a),before);
 const other={...structuredClone(f.a),id:'two',gold:Number.MAX_SAFE_INTEGER};f.accounts.set(other.id,other);
 const all=JSON.stringify([...f.accounts]);assert.throws(()=>f.service.prepare(f.accounts,origin+H));assert.equal(JSON.stringify([...f.accounts]),all);
});
test('contract persistence and a restarted settlement service agree with uninterrupted payment',()=>{
 const f=fixture();f.service.respond(f.a,f.next('team').id,'accept');f.service.prepare(f.accounts,origin+7*H);
 const copy=JSON.parse(JSON.stringify(f.a)),service=new SponsorshipService({economy:new EconomyService()});service.migrateAccount(copy);
 service.prepare(new Map([[copy.id,copy]]),origin+60*H);f.service.prepare(f.accounts,origin+60*H);
 assert.equal(copy.gold,28800);assert.equal(copy.gold,f.a.gold);assert.equal(copy.sponsorship.contracts[0].paidHours,48);
});
test('team and stadium naming is projected and expires without overwriting original names',()=>{
 const f=fixture();f.service.respond(f.a,f.next('team','bmw').id,'accept');f.service.respond(f.a,f.next('stadium','audi').id,'accept');
 assert.equal(sponsoredTeamName(f.a,origin),'原球队-宝马');assert.equal(sponsoredStadiumName(f.a,'原球场',origin),'奥迪竞技场');
 assert.equal(sponsoredTeamName(f.a,origin+2*D),'原球队');assert.equal(sponsoredStadiumName(f.a,'原球场',origin+2*D),'原球场');assert.equal(f.a.draft.teamName,'原球队');
});
function campaignFixture(){
 let now=origin;const index={territories:['home','target'].map((id,i)=>({territoryId:id,country:'测试',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:[i?'home':'target'],landNeighbors:[i?'home':'target'],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const resources={schemaVersion:1,version:'test',periodMs:H,territories:Object.fromEntries(['home','target'].map(id=>[id,{terrain:['plains'],yields:{gold:12,production:2,science:1}}]))};
 const s=new CampaignService({catalog:[],territoryIndex:index,territoryResources:resources,now:()=>now});
 const a={id:'one',nickname:'test',token:'test',setupComplete:true,homeTerritoryId:'home',gold:10000,goldLedger:[],draft:null,playerSquads:{assignments:{}},mapColor:'#123456'};
 s.accounts.set(a.id,a);s.sponsorship.migrateAccount(a);s.playerPacks.migrateAccount(a);s.world.players.one={playerId:'one',territoryIds:['home'],capitalTerritoryId:'home'};
 Object.assign(s.world.territories.home,{ownerType:'player',ownerId:'one',capitalOf:'one'});s.save();
 let sequence=0;
 const challenge=()=>{
  for(;;){const c={id:'campaign-reward-'+sequence++,territoryId:'target',attackerId:'one',previousOwner:{type:'neutral',id:null},fromTerritoryIds:['home'],aiDifficulty:1,battle:{id:'win',outcome:'win',events:[]},settleAt:now};if(s.sponsorship.rewardForChallenge(a,c))return c;}
 };
 return {s,a,setNow:n=>now=n,challenge};
}
test('real neutral capture grants the previewed sponsor contract once as the single tile reward',()=>{
 const {s,a,challenge}=campaignFixture(),c=challenge();s.world.activeChallenges.target=c;
 s.world.neutralRewards.offers.target={id:'planned-offer',kind:'sponsorship',amount:1,sourceTerritoryId:'target',contract:{sponsorId:'bmw',type:'normal',durationDays:1,hourlyGold:200}};
 const result=s.challenges.settleChallenge(c);assert.ok(result.rewards.sponsorship);assert.equal(result.rewards.gold,undefined);assert.equal(result.rewards.packs,undefined);
 assert.equal(a.sponsorship.offers.length,1);assert.equal(a.sponsorship.contracts.length,0);assert.equal(s.challenges.settleChallenge(c),null);
});
test('failed neutral capture commit restores ownership, wallet, packs and contract, then retry gives the same reward',()=>{
 const {s,a,challenge}=campaignFixture(),c=challenge();s.world.activeChallenges.target=c;
 s.world.neutralRewards.offers.target={id:'planned-offer',kind:'sponsorship',amount:1,sourceTerritoryId:'target',contract:{sponsorId:'bmw',type:'normal',durationDays:1,hourlyGold:200}};
 const expected='sponsor-offer:planned-offer',before=JSON.stringify({a,w:s.world});const save=s.repository.save;
 s.repository.save=()=>{throw Error('disk failure');};assert.throws(()=>s.challenges.settleChallenge(c),/disk failure/);assert.equal(JSON.stringify({a,w:s.world}),before);
 s.repository.save=save;assert.equal(s.challenges.settleChallenge(c).rewards.sponsorship.id,expected);assert.equal(a.sponsorship.offers.length,1);
});
test('losing, capturing clubs or player territories never creates a sponsor contract',()=>{
 for(const mode of ['loss','club','player']){
  const {s,a,challenge}=campaignFixture(),c=challenge();if(mode==='loss')c.battle.outcome='loss';else{c.previousOwner.type=mode;s.world.territories.target.ownerType=mode;}
  s.world.activeChallenges.target=c;s.challenges.settleChallenge(c);assert.equal(a.sponsorship.offers.length,0);
 }
});
test('campaign hourly income combines territories and sponsors without double counting',()=>{
 const {s,a,setNow,challenge}=campaignFixture(),offer=s.sponsorship.grantNeutralReward(a,challenge());s.sponsorship.respond(a,offer.id,'accept');
 const rate=offer.hourlyGold,gold=a.gold;setNow(origin+H);s.save();
 assert.equal(a.gold,gold+12+rate);const resource=s.resourceState(a);assert.equal(resource.hourly.gold,12+rate);
 assert.equal(resource.sources.reduce((sum,v)=>sum+v.yields.gold,0),12+rate);
 assert.equal(s.world.resourceEconomy.rates.one.gold,12);
});
test('scheduler pays hourly contracts even when no match is running',()=>{
 const {s,a,setNow,challenge}=campaignFixture(),offer=s.sponsorship.grantNeutralReward(a,challenge());s.sponsorship.respond(a,offer.id,'accept');const gold=a.gold;
 const scheduler=createChallengeScheduler({campaign:s,autoStart:false,now:()=>origin+H});
 setNow(origin+H);assert.equal(scheduler.persist(),true);assert.equal(a.gold,gold+12+offer.hourlyGold);assert.equal(scheduler.persist(),false);
});
test('actual HTTP signing authenticates the owner and ignores caller-supplied money or duration',async()=>{
 const {s,a,challenge}=campaignFixture(),offer=s.sponsorship.grantNeutralReward(a,challenge());
 const handler=createCampaignApiHandler({campaign:s}),response={writeHead(code){this.code=code;},end(body){this.body=JSON.parse(body);}};
 const request={method:'POST',headers:{authorization:'Bearer test'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({offerId:offer.id,action:'accept',hourlyGold:999999,durationDays:100}));}};
 await handler(request,response,'/api/campaign/sponsorship/respond','/api/campaign/sponsorship/respond');
 assert.equal(response.code,200);const c=a.sponsorship.contracts[0];assert.equal(c.hourlyGold,offer.hourlyGold);assert.equal(c.durationDays,offer.durationDays);
});
test('pending contract UI shows days, hourly income and blocked slots without season or signing-bonus copy',()=>{
 const f=fixture();f.next('normal','bmw');const html=sponsorshipWindowMarkup(f.service.publicState(f.a),{tab:'pending',now:origin,territoryLabel:()=>'<来源>'});
 assert.match(html,/宝马/);assert.match(html,/每小时/);assert.match(html,/1 天/);assert.match(html,/&lt;来源&gt;/);assert.match(html,/data-sponsor-action="accept"/);assert.doesNotMatch(html,/赛季|签约奖金/);
 assert.match(sponsorRewardPreviewMarkup(),/35%/);
});
test('reward result and TV boards escape labels, limit three distinct brands and preserve separate logo surfaces',()=>{
 const brand={id:'bmw',name:'<宝马>',icon:'/assets/sponsors/bmw.svg'};
 const html=broadcastSponsorMarkup({sponsors:[brand,brand,...SPONSORS.slice(0,5)]});
 assert.equal((html.match(/class="broadcast-sponsor-board"/g)||[]).length,3);assert.match(html,/&lt;宝马&gt;/);
 assert.equal(broadcastSponsorMarkup(null),'');
 assert.match(sponsorRewardMarkup({sponsor:brand,typeName:'普通赞助',hourlyGold:200,durationDays:1}),/查看合同/);
});

function grant(service,account,type,brand){
 for(let i=0;i<100000;i++){const c={id:'specific-'+type+'-'+brand+'-'+i,territoryId:'target',previousOwner:{type:'neutral'}},r=service.sponsorship.rewardForChallenge(account,c);if(r?.type===type&&r.sponsorId===brand){const offer=service.sponsorship.grantNeutralReward(account,c);service.sponsorship.respond(account,offer.id,'accept');return offer;}}
 throw Error('no deterministic fixture reward');
}
test('actual two-leg challenge broadcasts the current home clubs normal sponsors, never visiting or naming sponsors',()=>{
 const f=campaignFixture(),{s,a}=f;
 const catalog=JSON.parse(fs.readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url),'utf8'));
 s.playerDatabase=catalog;
 const roster=[['GK',4],['DEF',10],['MID',10],['ATT',9]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool&&!p.isX).slice(0,n));
 a.draft={teamName:'主队',roster:structuredClone(roster)};
 const b={id:'two',nickname:'客队',setupComplete:true,homeTerritoryId:'target',gold:0,goldLedger:[],draft:{teamName:'客队',roster:structuredClone(roster)}};
 s.accounts.set(b.id,b);s.world.players.two={playerId:'two',territoryIds:['target'],capitalTerritoryId:'target'};
 Object.assign(s.world.territories.target,{ownerType:'player',ownerId:'two'});setTestWar(s.world,a.id,b.id);
 for(const brand of ['microsoft','bmw','mcdonalds'])grant(s,a,'normal',brand);
 grant(s,a,'stadium','audi');grant(s,a,'team','ferrari');grant(s,b,'normal','honda');
 const {challenge}=s.challenges.begin(a,'target');
 const first=publicCampaignLiveLeg(challenge.live.firstLeg,{now:origin});
 assert.equal(first.venue.name,'客队主场');assert.equal(first.venue.ownerId,'two');assert.deepEqual(first.venue.sponsors.map(b=>b.id),['honda']);assert.equal(first.teams[0].name,'客队');assert.equal(first.teams[1].name,'主队-法拉利');
 f.setNow(challenge.firstLegEndsAt);
 let safety=0;while(challenge.phase==='first-leg'&&safety++<300)s.advanceActiveChallenges(challenge.firstLegEndsAt,{maximumMatches:1,maximumChainsPerMatch:1});
 assert.equal(challenge.phase,'intermission');
 f.setNow(challenge.secondLegStartsAt);s.advanceActiveChallenges(challenge.secondLegStartsAt,{maximumMatches:1,maximumChainsPerMatch:1});
 const second=publicCampaignLiveLeg(challenge.live.secondLeg,{now:challenge.secondLegStartsAt});
 assert.equal(second.teams[0].name,'客队');assert.equal(second.venue.ownerId,'two');assert.deepEqual(second.venue.sponsors.map(b=>b.id),['honda']);
 assert.deepEqual(publicCampaignLiveLeg(challenge.live.firstLeg,{now:origin+D}).venue.sponsors,[]);
 assert.equal(s.sponsorMatchVenue(null),null);
});
test('campaign persistence failure rolls back both hourly territory and sponsorship income',()=>{
 const f=campaignFixture(),{s,a}=f;grant(s,a,'normal','bmw');const before=JSON.stringify({a,e:s.world.resourceEconomy});f.setNow(origin+H);
 const save=s.repository.save;s.repository.save=()=>{throw Error('disk failure');};assert.throws(()=>s.save(),/disk failure/);assert.equal(JSON.stringify({a,e:s.world.resourceEconomy}),before);
 s.repository.save=save;s.save();assert.equal(a.gold,10212);
});
