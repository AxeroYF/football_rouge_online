import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {REAL_PLAYER_BY_ID,isXPlayer} from '../versus/player-pool.js';
import {createInboxReadSync} from '../versus/public/inbox-read-sync.js';
import {inboxActionAt} from '../versus/public/inbox-rules.js';

const NOW=Date.parse('2026-11-17T12:00:00+08:00'),user={id:'inbox-fix',nickname:'邮件修复'};
function fixture(statePath=null){
  let now=NOW;
  const service=new YellowDogsLeagueService({statePath,backupDir:null,now:()=>now,rng:()=>.37});
  service.beginDraft(user,'邮件修复队');service.autoDraft(user);service.finishDraft(user);
  return {service,team:service.accountTeam(user.id),advance:ms=>{now+=ms;}};
}
function clientFixture(request,count=2){
  let scope='a',view={updatedAt:1,inbox:Array.from({length:count},(_,i)=>({id:`mail-${i}`,createdAt:1,readAt:null})),inboxUnreadCount:count};
  const errors=[];
  const sync=createInboxReadSync({getScope:()=>scope,getView:()=>view,request,onError:error=>errors.push(error.message),now:()=>100});
  return {sync,errors,get view(){return view;},setView:next=>{view=next;},switchAccount:()=>{scope='b';view={inbox:[{id:'mail-0',createdAt:1,readAt:null}],inboxUnreadCount:1};sync.reconcile();}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('same-ID report preserves original send time and read state; changed content has an update time',()=>{
  const {service,team,advance}=fixture(),original=service.inbox(team).find(m=>m.type==='daily-report');
  service.readInbox(user,original.id,{compact:true});advance(1000);service.updateDailyReports();
  const same=service.inbox(team).find(m=>m.id===original.id);
  assert.equal(same.readAt,NOW);assert.equal(same.createdAt,original.createdAt);assert.equal(same.updatedAt,original.updatedAt);
  service.pushInbox(team,{...same,summary:'内容已更新'});
  const changed=service.inbox(team).find(m=>m.id===same.id);
  assert.equal(changed.readAt,NOW);assert.equal(changed.createdAt,original.createdAt);assert.equal(changed.updatedAt,NOW+1000);
  service.readInbox(user,changed.id,{compact:true});assert.equal(service.inbox(team).find(m=>m.id===changed.id).readAt,NOW+1000);
});

test('valid compensation is protected; cancelled or missing business objects are deletable',()=>{
  const {service,team}=fixture();
  const id=team.rosterIds.find(id=>!isXPlayer(REAL_PLAYER_BY_ID[id]));
  const card=service.grantS4Card(team,id,{grantOwnership:false,upgradeLevel:4});
  const offer=service.createS4EnhancementTraitOffer(user.id,card,{source:'threshold-compensation'});
  const mail=service.sendS4TraitCompensationMail(team,offer);
  assert.equal(service.inboxActionState(mail).status,'pending');assert.throws(()=>service.deleteInbox(user,mail.id),/待办/);
  card.status='recycled';service.pruneInvalidS4EnhancementTraitOffers();
  assert.equal(service.inbox(team).find(m=>m.id===mail.id).action.status,'cancelled');
  assert.doesNotThrow(()=>service.deleteInbox(user,mail.id));
  const missing=service.pushInbox(team,{id:'missing-compensation',type:'trait-compensation',payload:{offerId:'gone'}});
  assert.equal(service.inboxActionState(missing).status,'unavailable');assert.equal(service.inboxMessageDeletable(missing),true);
});

test('completed compensation stays completed even if its card later disappears',()=>{
  const {service,team}=fixture();const id=team.rosterIds.find(id=>!isXPlayer(REAL_PLAYER_BY_ID[id]));
  const card=service.grantS4Card(team,id,{grantOwnership:false,upgradeLevel:4});
  const offer=service.createS4EnhancementTraitOffer(user.id,card,{source:'threshold-compensation'});
  const mail=service.sendS4TraitCompensationMail(team,offer);
  service.chooseS4EnhancementTrait(user,offer.id,offer.traitIds[0]);card.status='recycled';
  assert.equal(service.inboxActionState(mail).status,'completed');
});

test('invitation expiration only applies to pending status; finished actions remain finished',()=>{
  for(const status of ['accepted','rejected','withdrawn'])assert.equal(inboxActionAt({status,expiresAt:1},NOW).status,status);
  assert.equal(inboxActionAt({status:'pending',expiresAt:NOW},NOW).status,'expired');
  const {service,team}=fixture();service.state.friendlyInvitations.push({id:'invite',status:'pending',expiresAt:NOW+1});
  const mail=service.pushInbox(team,{id:'invite-mail',type:'friendly-invite',payload:{friendlyInvitationId:'invite'}});
  assert.equal(service.inboxMessageDeletable(mail),false);
});

test('category deletion uses a frozen ID selection, protects valid actions, and never alters rewards',()=>{
  const {service,team}=fixture();service.state.inbox[team.id]=[];
  const packs=service.grantS4Pack(user.id,'private-mixed',2).map(p=>p.id),coins=service.wallet(user.id).balance;
  service.pushInbox(team,{id:'reward',type:'reward'});service.pushInbox(team,{id:'notice',type:'notice'});
  service.state.cardTradeOffers.push({id:'pending',status:'pending'});
  service.pushInbox(team,{id:'trade',type:'trade-offer',payload:{tradeOfferId:'pending'}});
  service.readInbox(user,'reward',{compact:true});service.readInbox(user,'notice',{compact:true});
  service.pushInbox(team,{id:'later-reward',type:'reward'});
  service.deleteInboxBatch(user,'read',{category:'rewards',messageIds:['reward','notice','trade']});
  assert.deepEqual(service.inbox(team).map(m=>m.id).sort(),['later-reward','notice','trade']);
  service.deleteInboxBatch(user,'all',{category:'action',messageIds:['trade']});assert.ok(service.inbox(team).some(m=>m.id==='trade'));
  assert.deepEqual(service.s4PackInventory(user.id).map(p=>p.id),packs);assert.equal(service.wallet(user.id).balance,coins);
  assert.throws(()=>service.deleteInboxBatch(user,'all',{category:'bogus'}),/分类无效/);
});

test('read-batch acknowledges already-read IDs and distinguishes skipped and missing entries',()=>{
  const {service,team}=fixture();service.state.inbox[team.id]=[];
  service.pushInbox(team,{id:'reward',type:'reward'});service.pushInbox(team,{id:'notice',type:'notice'});
  service.readInbox(user,'reward',{compact:true});
  const receipt=service.readInboxBatch(user,['reward','notice','missing'],{category:'rewards'});
  assert.deepEqual(receipt.messageIds,['reward']);assert.deepEqual(receipt.skippedMessageIds,['notice']);assert.deepEqual(receipt.missingMessageIds,['missing']);
});

test('250 protected emails are read in two confirmed batches without clearing the pending actions',async()=>{
  const {service,team}=fixture();service.state.inbox[team.id]=[];service.state.cardTradeOffers=[];
  for(let i=0;i<250;i++){
    service.state.cardTradeOffers.push({id:`offer-${i}`,status:'pending'});
    service.pushInbox(team,{id:`mail-${i}`,type:'trade-offer',payload:{tradeOfferId:`offer-${i}`}});
  }
  const sizes=[];const c=clientFixture(async(_path,body)=>{sizes.push(body.messageIds.length);return service.readInboxBatch(user,body.messageIds,{category:body.category});},250);
  await c.sync.read(c.view.inbox.map(m=>m.id),{category:'trades'});
  assert.deepEqual(sizes,[200,50]);assert.equal(c.view.inboxUnreadCount,0);assert.equal(service.inbox(team).filter(m=>!m.readAt).length,0);
  assert.equal(service.inbox(team).filter(m=>m.action.status==='pending').length,250);
});

test('failed later chunk rolls back only unconfirmed messages',async()=>{
  let calls=0;const c=clientFixture(async(_path,body)=>{if(++calls>1)throw Object.assign(new Error('failed'),{status:400});return {messageIds:body.messageIds,readAt:500};},250);
  await c.sync.read(c.view.inbox.map(m=>m.id));assert.equal(c.view.inboxUnreadCount,50);assert.equal(c.errors.length,1);
});

test('concurrent read failure cannot undo another success or roll back the snapshot version',async()=>{
  const a=deferred(),b=deferred();const c=clientFixture((_path,body)=>body.messageId==='mail-0'?a.promise:b.promise);
  const first=c.sync.read(['mail-0'],{single:true}),second=c.sync.read(['mail-1'],{single:true});
  b.resolve({messageId:'mail-1',readAt:500,updatedAt:99});await second;
  a.reject(Object.assign(new Error('failed'),{status:400}));await first;
  assert.equal(c.view.inboxUnreadCount,1);assert.equal(c.view.inbox[1].readAt,500);assert.equal(c.view.updatedAt,1);
});

test('late results and queued retries cannot mutate a switched account',async()=>{
  const wait=deferred();let calls=0;const c=clientFixture(()=>{calls++;return wait.promise;});
  const job=c.sync.read(['mail-0'],{single:true});c.switchAccount();wait.reject(new Error('network'));await job;
  assert.equal(c.view.inboxUnreadCount,1);assert.equal(c.view.inbox[0].readAt,null);assert.equal(calls,1);assert.deepEqual(c.errors,[]);
});

test('lost response retries the same idempotent read once',async()=>{
  let calls=0;const c=clientFixture(async(_path,body)=>{if(++calls===1)throw new Error('lost');return {messageId:body.messageId,readAt:500};});
  await c.sync.read(['mail-0'],{single:true});assert.equal(calls,2);assert.equal(c.view.inboxUnreadCount,1);
});

test('a newer authoritative read survives a failed request; stale snapshots preserve confirmed reads',async()=>{
  const wait=deferred();const c=clientFixture(()=>wait.promise);
  const job=c.sync.read(['mail-0'],{single:true});
  c.setView({inbox:[{id:'mail-0',createdAt:1,readAt:100}],inboxUnreadCount:0});c.sync.reconcile(c.view,{authoritative:true});
  wait.reject(Object.assign(new Error('failed'),{status:400}));await job;assert.equal(c.view.inboxUnreadCount,0);
  const d=clientFixture(async()=>({messageId:'mail-0',readAt:500}));await d.sync.read(['mail-0'],{single:true});
  d.setView({inbox:[{id:'mail-0',createdAt:1,readAt:null}]});d.sync.reconcile();assert.equal(d.view.inbox[0].readAt,500);
});

test('next opponent retains home and away; suspensions use the next competition',()=>{
  const {service,team}=fixture();service.teamSchedule=()=>[{status:'scheduled',competition:'cup',venue:'home',opponentName:'对手'}];
  assert.equal(service.nextOpponent(team.id).venue,'home');
  team.playerState[team.rosterIds[0]].suspension=2;team.playerState[team.rosterIds[1]].cupSuspension=1;
  assert.equal(service.inboxAvailability(team,'league').suspended[0].id,team.rosterIds[0]);
  assert.equal(service.inboxAvailability(team,'cup').suspended[0].id,team.rosterIds[1]);
  assert.equal(service.inboxAvailability(team,'friendly').suspended.length,0);
});

for(const format of ['json','shard'])test(`${format} old match links survive archive and reload; deleted archives show summary only`,()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-inbox-'));
  try{
    const statePath=path.join(directory,format==='json'?'league.json':'shards');const {service,team}=fixture(statePath);
    const opponent=service.state.teams.find(t=>t.id!==team.id);
    service.state.matches.push({id:'old-match',round:1,competition:'league',homeId:team.id,awayId:opponent.id,score:[2,1],playedAt:NOW,
      report:{teams:[{id:team.id,name:'历史主队',players:[]},{id:opponent.id,name:'历史客队',players:[]}],score:[2,1]}});
    service.pushInbox(team,{id:'old-mail',type:'matchweek',matchId:'old-match'});
    service.archiveSeason('inbox-test');service.state.matches=[];service.save({skipDailyBackup:true});
    const loaded=new YellowDogsLeagueService({statePath,backupDir:null,now:()=>NOW,rng:()=>.37});
    const mail=loaded.inbox(loaded.accountTeam(user.id)).find(m=>m.id==='old-mail');
    assert.deepEqual(mail.matchLink,{available:true,archived:true});
    const detail=loaded.matchDetail(user,'old-match');assert.equal(detail.archived,true);assert.equal(detail.teams[0].name,'历史主队');
    // Old shard summaries without the new index still fall back to reading the archive.
    delete loaded.state.archives[0].matchRefs;assert.equal(loaded.matchDetail(user,'old-match').archived,true);
    loaded.state.archives=[];assert.equal(loaded.inboxMatchLink('old-match').available,false);
    assert.throws(()=>loaded.matchDetail(user,'old-match'),error=>error.code==='MATCH_REPORT_UNAVAILABLE');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
