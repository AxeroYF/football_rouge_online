import test from 'node:test';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {createInboxPager} from '../versus/public/inbox-pager.js';
const NOW=Date.parse('2026-11-17T12:00:00+08:00'),user={id:'paged-owner',nickname:'分页玩家'};
function fixture(){
  let now=NOW;const service=new YellowDogsLeagueService({statePath:null,backupDir:null,pagedInbox:true,now:()=>now,rng:()=>.37});
  service.beginDraft(user,'分页队');service.autoDraft(user);service.finishDraft(user);
  const team=service.accountTeam(user.id);service.state.inbox[team.id]=[];
  return {service,team,advance:ms=>{now+=ms;}};
}
function seed(service,team,count,type='reward') {
  service.state.inbox[team.id]=Array.from({length:count},(_,i)=>({id:`mail-${String(i).padStart(5,'0')}`,type,title:`邮件${i}`,summary:'摘要',body:'大正文'.repeat(5000),report:{detail:'大报告'.repeat(5000)},createdAt:NOW,updatedAt:NOW,readAt:null,payload:{packType:'private-mixed'}}));
}
test('league and mutation views send counters only; lists are bounded summaries, details are recipient-scoped',()=>{
  const {service,team}=fixture();seed(service,team,100);
  const view=service.view(user,{includePlayerDirectory:false});assert.equal(view.inbox,undefined);assert.equal(view.inboxMeta.total,100);
  const page=service.inboxList(user);assert.equal(page.messages.length,25);assert.equal(page.hasNext,true);
  assert.equal(page.messages[0].body,undefined);assert.equal(page.messages[0].report,undefined);assert.equal(page.messages[0].payload,undefined);
  const detail=service.inboxDetail(user,page.messages[0].id);assert.ok(detail.message.body.length>1000);assert.equal(detail.message.readAt,null);
  assert.ok(JSON.stringify(page).length<20000);assert.ok(JSON.stringify(detail).length>20000);
  assert.throws(()=>service.inboxDetail({id:'not-owner'},page.messages[0].id),/没有加入/);
  const other={id:'other-paged-owner',nickname:'其他玩家'};service.beginDraft(other,'其他队');service.autoDraft(other);service.finishDraft(other);
  assert.throws(()=>service.inboxDetail(other,page.messages[0].id),/已删除|保留期限/);
  assert.equal(service.cardTradeMutationView(user).inbox,undefined);
});
test('keyset pagination is deterministic at identical timestamps and ignores newer arrivals until refresh',()=>{
  const {service,team}=fixture();seed(service,team,100);
  const first=service.inboxList(user),ids=first.messages.map(m=>m.id);
  service.pushInbox(team,{id:'new-later',type:'reward',createdAt:NOW+1});
  let page=first;
  while(page.hasNext){page=service.inboxList(user,{cursor:page.nextCursor,anchor:first.anchor});ids.push(...page.messages.map(m=>m.id));}
  assert.equal(ids.length,100);assert.equal(new Set(ids).size,100);assert.ok(!ids.includes('new-later'));
  assert.equal(service.inboxList(user).messages[0].id,'new-later');
  assert.throws(()=>service.inboxList(user,{cursor:{createdAt:'bad',id:'x'}}),/分页/);
});
test('valid pending mail has no retention cap; expired or finished actions become ordinary',()=>{
  const {service,team,advance}=fixture();seed(service,team,2000,'friendly-invite');
  service.state.friendlyInvitations=service.state.inbox[team.id].map(m=>({id:m.id,status:'pending',createdAt:NOW,expiresAt:NOW+7200000}));
  service.state.inbox[team.id].forEach(m=>{m.payload={friendlyInvitationId:m.id};m.createdAt=NOW-100*86400000;m.updatedAt=m.createdAt;});
  assert.equal(service.pruneInbox(team),0);assert.equal(service.inboxList(user,{category:'action'}).total,2000);
  advance(7200000);assert.equal(service.pruneInbox(team),2000);
});
test('retention keeps unread rewards ahead of read rewards and isolates noise; cleaning does not touch assets',()=>{
  const {service,team,advance}=fixture();const balance=service.wallet(user.id).balance,packs=service.grantS4Pack(user.id,'private-mixed',2).map(p=>p.id);
  service.pushInbox(team,{id:'unread-reward',type:'reward'});
  for(let i=0;i<210;i++)service.state.inbox[team.id].push({id:`read-${i}`,type:'reward',createdAt:NOW+i,updatedAt:NOW+i,readAt:NOW+999});
  for(let i=0;i<160;i++)service.state.inbox[team.id].push({id:`noise-${i}`,type:'activity-digest',createdAt:NOW+i,updatedAt:NOW+i,readAt:null});
  service.pruneInbox(team);const mails=service.state.inbox[team.id];assert.equal(mails.filter(m=>m.type==='reward').length,200);assert.ok(mails.some(m=>m.id==='unread-reward'));assert.equal(mails.filter(m=>m.type==='activity-digest').length,40);
  advance(8*86400000);service.pruneInbox(team);assert.equal(service.inboxMeta(team).total,200);
  advance(53*86400000);service.pruneInbox(team);assert.equal(service.inboxMeta(team).total,0);
  assert.equal(service.wallet(user.id).balance,balance);assert.deepEqual(service.s4PackInventory(user.id).map(p=>p.id),packs);
});
test('bulk snapshots cover all pages, ignore later arrivals, recheck status and are idempotent',()=>{
  const {service,team}=fixture();seed(service,team,100,'reward');
  const read=service.inboxSelection(user,{category:'rewards',operation:'read'});assert.equal(read.count,100);
  service.pushInbox(team,{id:'new-reward',type:'reward'});
  const receipt=service.applyInboxSelection(user,read.token);assert.equal(receipt.changed,100);assert.equal(receipt.meta.unreadCount,1);assert.equal(receipt.inbox,undefined);
  assert.equal(service.applyInboxSelection(user,read.token).changed,100);
  const remove=service.inboxSelection(user,{category:'rewards',operation:'delete-read'});
  // One selected mail becomes a valid action between confirmation and apply.
  const pending=service.state.inbox[team.id][0];pending.type='trade-offer';pending.payload={tradeOfferId:'live'};service.state.cardTradeOffers.push({id:'live',status:'pending'});
  const deleted=service.applyInboxSelection(user,remove.token);assert.equal(deleted.deletedCount,99);assert.equal(deleted.meta.total,2);
  assert.ok(service.state.inbox[team.id].some(m=>m.id===pending.id));assert.ok(service.state.inbox[team.id].some(m=>m.id==='new-reward'));
});
test('selection tokens expire and cannot cross accounts; compact single deletion avoids view construction',()=>{
  const {service,team,advance}=fixture();seed(service,team,2);
  const token=service.inboxSelection(user,{operation:'delete'}).token;
  const other={id:'token-other',nickname:'其他'};service.beginDraft(other,'其他');service.autoDraft(other);service.finishDraft(other);
  assert.throws(()=>service.applyInboxSelection(other,token),/失效/);advance(120001);assert.throws(()=>service.applyInboxSelection(user,token),/失效/);
  service.view=()=>{throw new Error('must not build a league view');};
  assert.equal(service.deleteInbox(user,'mail-00000',{compact:true}).deletedCount,1);
});
test('reading stale detail cannot acknowledge a newer update',()=>{
  const {service,team,advance}=fixture();service.pushInbox(team,{id:'updated',type:'notice',body:'旧正文'});
  const detail=service.inboxDetail(user,'updated');advance(1000);service.pushInbox(team,{id:'updated',type:'notice',body:'新正文'});
  const read=service.readInbox(user,'updated',{compact:true,expectedUpdatedAt:detail.message.updatedAt});assert.equal(read.stale,true);assert.equal(service.inboxDetail(user,'updated').message.readAt,null);
});
test('failed deletion restores mail and can be retried without affecting rewards',()=>{
  const {service,team}=fixture();seed(service,team,2);
  const selection=service.inboxSelection(user,{operation:'delete'}),save=service.save;
  service.save=()=>{throw new Error('磁盘写入失败');};
  assert.throws(()=>service.applyInboxSelection(user,selection.token),/磁盘/);
  assert.equal(service.inboxMeta(team).total,2);assert.equal((service.state.inboxDeleted[team.id] ?? []).length,0);
  assert.throws(()=>service.deleteInbox(user,'mail-00000',{compact:true}),/磁盘/);assert.equal(service.inboxMeta(team).total,2);
  service.save=save;assert.equal(service.applyInboxSelection(user,selection.token).deletedCount,2);
  assert.equal(service.deleteInbox(user,'mail-00000',{compact:true}).deletedCount,0);
});
test('continuous read activity flushes within five seconds and persistence failures have bounded retries',t=>{
  const {service}=fixture();let writes=0;service.statePath='test-stub-only';service.save=()=>{writes++;};
  t.mock.timers.enable({apis:['setTimeout','Date'],now:NOW});
  for(let i=0;i<50;i++){service.scheduleInboxReadPersist();t.mock.timers.tick(100);}
  assert.equal(writes,1);
  t.mock.method(console,'error',()=>{});writes=0;service.save=()=>{writes++;throw new Error('temporary disk error');};
  service.scheduleInboxReadPersist();for(let i=0;i<5;i++)t.mock.timers.tick(5000);
  assert.equal(writes,4);assert.equal(service.inboxReadPersistTimer,null);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('client ignores old category and old account responses without corrupting global unread totals',async()=>{
  let scope='a';const calls=[];const pager=createInboxPager({getScope:()=>scope,request:()=>{const d=deferred();calls.push(d);return d.promise;}});
  pager.ensureLoaded({category:'all',unreadOnly:false});pager.ensureLoaded({category:'rewards',unreadOnly:false});
  calls[1].resolve({messages:[{id:'right'}],meta:{revision:2,unreadCount:150},total:1});await new Promise(r=>setTimeout(r,0));
  calls[0].resolve({messages:[{id:'wrong'}],meta:{revision:1,unreadCount:999},total:1});await new Promise(r=>setTimeout(r,0));
  assert.equal(pager.state.page.messages[0].id,'right');assert.equal(pager.state.meta.unreadCount,150);
  const pending=pager.open('right');scope='b';calls[2].resolve({message:{id:'right'},meta:{revision:3}});await pending;assert.equal(pager.state.detail,null);
});
test('client rapid detail selection only reads the current mail; detail failure is retryable',async()=>{
  const calls=[];const pager=createInboxPager({getScope:()=> 'a',request:(path,body)=>{const d=deferred();calls.push({path,body,...d});return d.promise;}});
  const a=pager.open('a'),b=pager.open('b');calls[0].resolve({message:{id:'a'}});await a;assert.equal(calls.length,2);
  calls[1].reject(new Error('网络中断'));await b;assert.match(pager.state.detailError,/网络中断/);
  const retry=pager.open('b');calls[2].resolve({message:{id:'b',readAt:10},meta:{revision:1,unreadCount:80}});await retry;
  assert.equal(pager.state.detail.id,'b');assert.equal(pager.state.detailError,null);assert.equal(pager.state.meta.unreadCount,80);
});
test('older list response cannot roll back a read receipt; changing category cancels the detail spinner',async()=>{
  const calls=[];const pager=createInboxPager({getScope:()=> 'a',request:()=>{const d=deferred();calls.push(d);return d.promise;}});
  const loading=pager.load();pager.sync({revision:2,unreadCount:0});
  calls[0].resolve({messages:[{id:'old',readAt:null}],meta:{revision:1,unreadCount:1}});
  await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,2);assert.equal(pager.state.page,null);
  calls[1].resolve({messages:[{id:'old',readAt:10}],meta:{revision:2,unreadCount:0}});await loading;
  assert.equal(pager.state.page.messages[0].readAt,10);
  const open=pager.open('old');assert.equal(pager.state.detailLoading,true);
  pager.ensureLoaded({category:'rewards',unreadOnly:false});assert.equal(pager.state.detailLoading,false);
  calls[2].resolve({message:{id:'old',readAt:10}});await open;assert.equal(pager.state.detail,null);
  calls[3].resolve({messages:[],meta:{revision:2,unreadCount:0}});await new Promise(r=>setTimeout(r,0));
});
