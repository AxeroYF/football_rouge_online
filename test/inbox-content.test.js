import test from 'node:test';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {REAL_PLAYER_BY_ID} from '../versus/player-pool.js';
import {inboxStructuredMarkup,inboxPlainBodyMarkup,inboxNavigation,inboxContext} from '../versus/public/inbox-content.js';
import {inboxCategory} from '../versus/public/inbox-rules.js';

const NOW=Date.parse('2026-11-17T12:00:00+08:00'), user={id:'content-owner',nickname:'主队'};
function setup(){
  let now=NOW;
  const service=new YellowDogsLeagueService({statePath:null,backupDir:null,now:()=>now,rng:()=>.37});
  service.beginDraft(user,'主队');service.autoDraft(user);service.finishDraft(user);
  const team=service.accountTeam(user.id),other=service.state.teams.find(t=>t.id!==team.id);
  service.state.inbox[team.id]=[];service.state.season.startedAt=NOW;
  const record={id:'league-content',competition:'league',round:1,homeId:team.id,awayId:other.id,homeName:team.name,awayName:other.name,score:[2,1],playedAt:NOW,autoRotations:[[{outName:'轮休队员',inName:'替补队员',reason:'体能不足'}],[]]};
  service.state.matches.push(record);
  return {service,team,other,record,advance:()=>{now+=1000;}};
}
test('league settlement folds rewards, rotation and next-event availability into one mail; repeat is asset-idempotent',()=>{
  const {service,team,record,advance}=setup();
  const id=team.rosterIds[0];team.playerState[id].injuryRounds=2;team.playerState[id].cupSuspension=1;team.playerState[id].suspension=3;
  service.nextOpponent=()=>({name:'杯赛对手',competition:'cup',competitionName:'杯赛',venue:'away'});
  service.state.matches.unshift({...record,id:'cup-same-round',competition:'cup'});
  service.payRewards(1);service.createRoundInbox(1);
  const [mail]=service.inbox(team);assert.equal(service.inbox(team).length,1);
  assert.equal(mail.matchId,record.id);assert.deepEqual(mail.payload.results.map(r=>r.id),[record.id]);
  assert.equal(mail.payload.autoRotations.length,1);assert.equal(mail.payload.nextAvailability.suspended[0].rounds,1);
  assert.equal(mail.payload.suspended[0].rounds,3);assert.ok(mail.payload.rewards.some(r=>r.amount>0));
  assert.match(inboxStructuredMarkup(mail),/联赛停赛3场/);
  assert.ok(mail.payload.rewards.some(r=>r.packType==='private-mixed'&&r.quantity>0));
  const balance=service.wallet(user.id).balance, ledger=service.state.ledger.length;
  service.readInbox(user,mail.id,{compact:true});advance();service.payRewards(1);service.createRoundInbox(1);
  const repeat=service.inbox(team)[0];assert.equal(repeat.readAt,NOW);assert.equal(repeat.updatedAt,mail.updatedAt);
  assert.equal(service.wallet(user.id).balance,balance);assert.equal(service.state.ledger.length,ledger);
  service.deleteInbox(user,mail.id);service.createRoundInbox(1);assert.equal(service.inbox(team).length,0);assert.equal(service.wallet(user.id).balance,balance);
});
test('cup reward joins its exact fixture, never the other leg; repeated grants do not duplicate',()=>{
  const {service,team,other,record}=setup();service.state.matches=[];service.state.cup.knockout={quarterfinals:[],semifinals:[],final:[]};
  service.createKnockoutStage('quarterfinals',[team.id,other.id]);
  const tie=service.state.cup.knockout.quarterfinals[0], event={id:'cup-quarterfinals-leg2',stage:'quarterfinals',round:2,leg:2};
  const cupRecord={...record,id:'cup-leg2',competition:'cup',cupStage:'quarterfinals',legNumber:2};
  tie.legs[1].matchId=cupRecord.id;service.state.matches.push(cupRecord);
  service.createCupMatchInbox(team,other,{...cupRecord,id:'cup-leg1',legNumber:1},{...event,leg:1});
  service.createCupMatchInbox(team,other,cupRecord,event);service.grantCupReward(team.id,event,'advance');
  assert.equal(service.inbox(team).length,2);assert.equal(service.inbox(team).find(m=>m.matchId==='cup-leg1').payload.rewards.length,0);
  const mail=service.inbox(team).find(m=>m.matchId==='cup-leg2');assert.equal(mail.payload.rewards[0].quantity,2);
  assert.equal(service.grantCupReward(team.id,event,'advance'),null);service.createCupMatchInbox(team,other,cupRecord,event);
  assert.equal(service.inbox(team).find(m=>m.matchId==='cup-leg2').payload.rewards.length,1);
  assert.match(inboxStructuredMarkup(mail),/晋级奖励/);
});
test('cup reward without a match keeps standalone notification',()=>{
  const {service,team}=setup();service.grantCupReward(team.id,{id:'unlinked-final',stage:'final',round:4,leg:1},'champion');
  assert.equal(service.inbox(team)[0].type,'reward');assert.ok(inboxNavigation(service.inbox(team)[0]).some(([id])=>id==='packs'));
});
test('routine digest is bounded, duplicate-safe and preserves read state; important mail stays separate',()=>{
  const {service,team,advance}=setup();
  const event={id:'activity-1',type:'announcement',summary:'第一次强化'};
  service.pushActivityInbox(team,event);const original=service.inbox(team)[0];service.readInbox(user,original.id,{compact:true});advance();
  service.pushActivityInbox(team,event);assert.equal(service.inbox(team)[0].updatedAt,original.updatedAt);
  for(let i=2;i<=45;i++)service.pushActivityInbox(team,{...event,id:`activity-${i}`,summary:`强化${i}`});
  const digest=service.inbox(team)[0];assert.equal(digest.payload.entries.length,40);assert.equal(digest.payload.total,45);assert.equal(digest.readAt,NOW);assert.equal(digest.updatedAt,NOW+1000);assert.equal(inboxCategory(digest),'announcements');
  service.pushInbox(team,{id:'important-trade',type:'trade-public',body:'重要交易'});service.pushInbox(team,{id:'admin',type:'admin-update',body:'管理员通知'});
  assert.equal(service.inbox(team).length,3);
});
test('enhancement notifications use digest only for other players',()=>{
  const {service,team,other}=setup();other.ownerId='other-owner';other.ownerName='其他玩家';
  const player=REAL_PLAYER_BY_ID[team.rosterIds[0]];
  service.notifyEnhancementSuccess(team,player,{upgradeLevel:6},{success:true,resultId:'enhancement-a',chance:50,beforeLevel:5,materialLevel:5});
  assert.equal(service.inbox(team).length,0);assert.equal(service.inbox(other)[0].type,'activity-digest');
  service.notifyEnhancementTraitBinding(team,player,{upgradeLevel:7},{name:'测试特性'},{id:'trait-a',unlockLevel:7});
  assert.equal(service.inbox(other).length,1);assert.equal(service.inbox(other)[0].payload.total,2);
});
test('friendly participants retain individual actionable invitations and schedules; observers get a digest',()=>{
  const {service,team}=setup();
  for (const id of ['friendly-recipient','friendly-observer']) {
    const account={id,nickname:id};service.beginDraft(account,id);service.autoDraft(account);service.finishDraft(account);
  }
  const other=service.accountTeam('friendly-recipient'),observer=service.accountTeam('friendly-observer');
  for (const recipient of [team,other,observer]) service.state.inbox[recipient.id]=[];
  service.createFriendlyInvitation(user,other.id,{compact:true});
  const invitation=service.state.friendlyInvitations.at(-1);
  assert.equal(service.inbox(other).find(m=>m.type==='friendly-invite').action.status,'pending');
  service.resolveFriendlyInvitation({id:other.ownerId},invitation.id,'accept',{compact:true});
  assert.equal(service.inbox(other).find(m=>m.type==='friendly-invite').action.status,'accepted');
  assert.equal(service.inbox(other).filter(m=>m.type==='friendly').length,1);
  assert.equal(service.inbox(team).filter(m=>m.type==='friendly').length,1);
  assert.equal(service.inbox(observer).length,1);assert.equal(service.inbox(observer)[0].type,'activity-digest');
  assert.equal(service.inbox(observer)[0].payload.entries[0].destination,'television');
});
test('daily results retain competition labels and render concise summaries without rewriting overview reports',()=>{
  const {service,team,record}=setup();service.state.matches.push({...record,id:'cup-today',competition:'cup',cupStage:'final',cupRound:4,round:undefined,legNumber:1});
  const report=service.buildDailyReport(team);const cup=report.today.results.find(r=>r.matchId==='cup-today');assert.equal(cup.competition,'cup');assert.equal(cup.label,'决赛');
  const html=inboxStructuredMarkup({type:'daily-report',report});assert.match(html,/今日赛果/);assert.match(html,/杯赛 · 决赛/);assert.doesNotMatch(html,/第undefined轮/);
});
test('structured and plain content escapes untrusted text; long notices retain full content',()=>{
  const {service,team,record}=setup();service.sendMatchSettlement(team,record);const mail=service.inbox(team)[0];mail.payload.ownName='<img src=x onerror=alert(1)>';
  const html=inboxStructuredMarkup(mail);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.match(html,/data-inbox-nav="squad"/);assert.match(html,/<details/);
  const text='通知说明\n'+('<script>内容</script>'.repeat(50));const plain=inboxPlainBodyMarkup({type:'admin-update',body:text});
  assert.match(plain,/<details/);assert.equal((plain.match(/&lt;script&gt;/g)??[]).length,50);assert.ok(inboxContext(mail).includes(`${team.division}级联赛`));
  assert.deepEqual(inboxNavigation({type:'reward',payload:{packIds:['p'],cardIds:['c']}}),[['packs','查看礼包'],['cards','查看球员卡']]);
});
