import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LeagueShardStore,createTrackedState,trackedSubtreeVersion} from '../versus/league-shard-store.js';
import {YellowDogsLeagueService} from '../versus/league-service.js';

function storeFixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-storage-hot-'));
  t.after(()=>{assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm-storage-hot-'));fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store:new LeagueShardStore(dir,{backupDir:null})};
}

test('raw serialization preserves bytes and tracking for nested and composed values',t=>{
  const {dir,store}=storeFixture(t),dirty=new Set();
  const state=createTrackedState({friendlyInvitations:[{id:'i',nested:{text:'中文 😀',list:[null,1,true]},status:'pending'}]},scope=>dirty.add(scope));
  const value=state.friendlyInvitations,version=trackedSubtreeVersion(value);
  const composed={outer:{list:value},missing:undefined,number:NaN};
  for(const [index,input] of [value,composed].entries()){
    const expected=JSON.stringify(input),ref=store.writeRevisionJson(path.join(dir,'revisions','1'),`${index}.json`,input);
    assert.equal(fs.readFileSync(path.join(dir,ref),'utf8'),expected);
    assert.equal(store.writeRevisionJson(path.join(dir,'revisions','2'),`${index}.json`,input,ref),ref);
  }
  assert.equal(dirty.size,0);assert.equal(trackedSubtreeVersion(value),version);
  state.friendlyInvitations[0].nested.list.push(2);
  assert.ok(trackedSubtreeVersion(value)>version);assert.deepEqual([...dirty],['core']);
  const ref=store.writeRevisionJson(path.join(dir,'revisions','3'),'changed.json',composed);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,ref),'utf8')).outer.list[0].nested.list,[null,1,true,2]);
});

test('byte-length precheck still detects same-length content changes and repairs missing shards',t=>{
  const {dir,store}=storeFixture(t);let previous=null;
  for(const [index,text] of ['a','中','国','x😀'].entries()){
    const ref=store.writeRevisionJson(path.join(dir,'revisions',String(index)), 'text.json',{text},previous);
    assert.notEqual(ref,previous);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,ref),'utf8')),{text});previous=ref;
  }
  fs.unlinkSync(path.join(dir,previous));
  const repaired=store.writeRevisionJson(path.join(dir,'revisions','repair'),'text.json',{text:'x😀'},previous);
  assert.ok(fs.existsSync(path.join(dir,repaired)));
});

test('tracked action indexes invalidate on nested edits, replacement and deletion, not unrelated revisions',()=>{
  const service=new YellowDogsLeagueService({statePath:null,backupDir:null});
  service.state=createTrackedState(service.state,()=>{});
  service.state.friendlyInvitations=[{id:'a',status:'pending',nested:{n:1}}];
  service.state.cardTradeOffers=[{id:'t',status:'pending'}];
  let context=service.inboxActionContext();
  service.state.updatedAt++;assert.equal(service.inboxActionContext().invitations,context.invitations);
  service.state.friendlyInvitations[0].nested.n++;
  let next=service.inboxActionContext();assert.notEqual(next.invitations,context.invitations);assert.equal(next.trades,context.trades);context=next;
  service.state.friendlyInvitations[0]={id:'b',status:'accepted'};
  next=service.inboxActionContext();assert.equal(next.invitations.has('a'),false);assert.equal(next.invitations.get('b').status,'accepted');
  service.state.cardTradeOffers[0].status='cancelled';assert.notEqual(service.inboxActionContext().trades,context.trades);
  service.state.friendlyInvitations.splice(0,1);assert.equal(service.inboxActionContext().invitations.size,0);
  service.state.friendlyInvitations=[{id:'c',status:'pending'}];assert.equal(service.inboxActionContext().invitations.has('c'),true);
  service.state={...service.state,friendlyInvitations:[{id:'untracked',status:'pending'}]};
  context=service.inboxActionContext();service.state.friendlyInvitations.push({id:'new'});
  assert.notEqual(service.inboxActionContext().invitations,context.invitations);assert.ok(service.inboxActionContext().invitations.has('new'));
});

test('cached actions still expire with time and details cannot reveal another recipient invitation',()=>{
  let now=Date.parse('2026-11-17T10:00:00+08:00');
  const service=new YellowDogsLeagueService({statePath:null,backupDir:null,now:()=>now,rng:()=>.37,pagedInbox:true}),user={id:'hot-owner',nickname:'缓存测试'};
  service.beginDraft(user,'缓存测试队');service.autoDraft(user);service.finishDraft(user);
  service.state=createTrackedState(service.state,()=>{});
  const team=service.accountTeam(user.id);
  service.state.friendlyInvitations=[{id:'invite',status:'pending',fromOwnerId:user.id,toOwnerId:'other',createdAt:now,expiresAt:now+1000}];
  service.state.inbox[team.id]=[{id:'mail',type:'friendly-invite',createdAt:now,updatedAt:now,payload:{friendlyInvitationId:'invite'}}];
  assert.equal(service.inboxDetail(user,'mail').message.action.status,'pending');
  assert.equal(service.inboxMeta(team).counts.action,1);
  const index=service.inboxActionContext().invitations;now+=1000;
  assert.equal(service.inboxActionContext().invitations,index);
  assert.equal(service.inboxDetail(user,'mail').message.action.status,'expired');assert.equal(service.inboxMeta(team).counts.action,0);
  service.state.friendlyInvitations[0].status='accepted';
  assert.equal(service.inboxDetail(user,'mail').message.action.status,'accepted');
  service.state.friendlyInvitations[0].fromOwnerId='unrelated';
  assert.equal(service.inboxDetail(user,'mail').message.friendlyInvitation,undefined);
});
