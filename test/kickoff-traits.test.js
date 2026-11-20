import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {YDL_TRAIT_CARDS} from '../versus/trait-pool.js';
import {createSourceSnapshot} from '../versus/v4-adapter/source-snapshot.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {createLiveV4Match} from '../versus/v4-adapter/live-match.js';
import {createMatch,advanceMatch,exportCheckpoint,restoreCheckpoint,refreshMatchPlayerEffects} from '../versus/v4/engine.js';
import {createPlayerReportLedger} from '../versus/v4-host/player-report.js';
import {createMatchCommentary} from '../versus/v4-host/match-commentary.js';
import {captainModifiers} from '../versus/v4/captaincy.js';
import {captainStyleModifiers} from '../versus/public/captain-rules.js';
import {s4EffectiveOverall} from '../versus/s4-balance.js';
import {ydlContentSection} from '../versus/ydl-content-store.js';
import {VERSION} from '../versus/v4/world.js';
import {publicEvent} from '../versus/v4-stream/codec.js';

function setup(traitsFor = () => ["sponsor-entry"],statePath=null) {
  const user={id:'kickoff-traits-test',nickname:'测试'};
  const now=Date.parse('2026-11-19T10:01:00+08:00');
  const service=new YellowDogsLeagueService({statePath,backupDir:null,now:()=>now,rng:()=>.37});
  service.beginDraft(user,'测试队');service.autoDraft(user);service.finishDraft(user);
  const team=service.accountTeam(user.id);
  const fixture=service.state.rounds[0].fixtures.find(f=>[f.homeId,f.awayId].includes(team.id));
  const side=Number(fixture.awayId===team.id);
  const seats=service.prepareFixtureMatch(fixture,1,now,{matchEngine:'v4'}).seats;
  for(const p of seats[side].players) service.representativeCard(user.id,p.id).traitIds=traitsFor(p);
  const snapshot=createSourceSnapshot({league:service.state,catalog:REAL_PLAYERS,traitCatalog:YDL_TRAIT_CARDS,bondCatalog:S4_BOND_CATALOG});
  const input=compileRealMatch(snapshot,{...fixture,fixtureId:'traits',seed:'kickoff-test',duration:60}).input;
  return {user,service,team,fixture,side,input,now};
}

test('队长激励按真实失球触发，连续扩大分差只播报一次',()=>{
  const {input,side}=setup(()=>[]);
  const team=input.teams[side];
  team.captainId=team.players[0].id;
  for(const style of ['inspiring','calm']){
    team.captainStyle=style;
    const match=createMatch(input),s=match.state;
    const scorer=s.players.find(p=>p.side!==side && p.role==='ST');
    for(let goals=1;goals<=3;goals++){
      s.phase='playing';
      s.rules.restartTouch=null;
      s.ball={mode:'loose',holder:null,flight:null,lastTouch:scorer.key,x:side?104.9:0.1,y:34,z:0,vz:0,vx:side?15:-15,vy:0};
      advanceMatch(match,1);
      assert.equal(s.score[1-side],goals);
      const rows=match.events.filter(e=>e.type==='captainBoost');
      assert.equal(rows.length,Number(goals>=(style==='inspiring'?1:2)));
      if(rows.length)assert.equal(rows[0].actor,`${side}:${team.captainId}`);
    }
  }
});

test('管理员正式目录提供四种新卡；疯狗随战术启停，卷王决胜阶段只回体一次',()=>{
  const ids=['high-press-hound','overtime-grinder','captain-boss','nine-dragons-coffin'];
  assert.deepEqual(ydlContentSection('traits').traits.filter(t=>ids.includes(t.id)&&t.status==='active').map(t=>t.id),ids);
  const {input,side}=setup(p=>p.role==='GK'?['overtime-grinder']:['high-press-hound']);
  const team=input.teams[side];
  for(const plan of Object.values(team.sourcePlans))Object.assign(plan,{style:'balanced',defensiveBlock:'midBlock'});
  team.sourcePlans.leading.defensiveBlock='highPress';
  team.sourceBondCatalog=[];
  const match=createMatch(input),s=match.state;
  const p=s.players.find(p=>p.side===side&&p.active&&p.role!=='GK');
  const original=p.attributes.tackling;
  s.activePlans[side]='leading';refreshMatchPlayerEffects(match);
  assert.equal(p.attributes.tackling,Math.min(99,original+6));
  assert.ok(match.events.some(e=>e.actor===p.key&&e.text.includes('疯狗来了')));
  s.activePlans[side]='normal';refreshMatchPlayerEffects(match);
  assert.equal(p.attributes.tackling,original);
  const gk=s.players.find(p=>p.side===side&&p.active&&p.role==='GK');
  gk.fitness=42;
  s.clock.period=3;refreshMatchPlayerEffects(match);
  assert.equal(gk.fitness,100);
  assert.equal(gk.attributes.reflexes,Math.min(99,gk.baseAttributes.reflexes+6));
  gk.fitness=74;s.phase='shootout';refreshMatchPlayerEffects(match);
  assert.equal(gk.fitness,74);
  assert.equal(match.events.filter(e=>e.actor===gk.key&&e.text.includes('卷王来了')).length,1);
  const direct=createMatch(input);direct.state.phase='shootout';refreshMatchPlayerEffects(direct);
  assert.ok(direct.events.some(e=>e.text.includes('卷王来了！点球大战')));
});

test('队霸通过正式比赛编译放大队长修正，离场即时失效',()=>{
  const {service,fixture,now,side}=setup(()=>['captain-boss']);
  const {seats,matchOptions}=service.prepareFixtureMatch(fixture,1,now,{matchEngine:'v4'});
  const seat=seats[side],captain=seat.players.find(p=>p.active);
  seat.captainId=captain.id;seat.captainStyle='disciplined';
  const normal=captainStyleModifiers({...seat,players:[{...captain,traits:[],traitDefinitions:[]}]});
  const live=createLiveV4Match(seats,{...matchOptions,duration:60});
  const match=live.spatial;
  const amplified=captainModifiers(match.state,side);
  assert.equal(amplified.cardMultiplier,1+(normal.cardMultiplier-1)*2);
  assert.equal(match.state.input.teams[side].captainId,captain.id);
  assert.equal(live.events.filter(e=>e.text.includes('队霸来了')).length,1);
  const active=match.state.players.find(p=>p.side===side&&p.id===captain.id);
  active.active=false;
  assert.equal(captainModifiers(match.state,side).cardMultiplier,1);
});

test('九龙每队锁定一张本体卡；借用传奇、断点重放、重复结算和同名副卡不改变扣点归属',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-wear-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'league.json');
  const {service,user,team,fixture,side,input,now}=setup(()=>['spirit-possession','nine-dragons-coffin'],statePath);
  const match=createMatch(input),eligible=match.state.players.filter(p=>p.side===side&&p.active);
  const [winner]=eligible.slice().sort((a,b)=>b.carrierBaseOverall-a.carrierBaseOverall||a.id.localeCompare(b.id,'en'));
  assert.deepEqual(eligible.filter(p=>p.nineDragonsActive).map(p=>p.id),[winner.id]);
  assert.ok(winner.spiritForm);
  assert.equal(winner.fixedFitness,100);
  assert.equal(match.events.filter(e=>e.text.includes('九龙拉棺启动')).length,1);
  const resumed=restoreCheckpoint(exportCheckpoint(match));
  const card=service.state.s4Assets.cards[winner.matchCardId],base=REAL_PLAYERS.find(p=>p.id===winner.id);
  const other={...card,id:'duplicate-card',upgradeLevel:8};
  service.state.s4Assets.cards[other.id]=other;
  const ledger=createPlayerReportLedger(input,VERSION);
  advanceMatch(resumed,10000);ledger.consume(resumed.events);
  const report=ledger.finish(resumed.state);
  for(const [competition,abandoned] of [['friendly',false],['league',true]]){
    service.settleNineDragons({id:'ignored',competition,report:{...report,abandoned}});
    assert.equal(card.permanentOverallPenalty??0,0);
  }
  const record=service.finalizeFixture(fixture,1,{report});
  service.settleNineDragons(record);
  assert.equal(card.ownerId,user.id);assert.equal(card.permanentOverallPenalty,1);
  assert.equal(other.permanentOverallPenalty??0,0);
  const loss=service.sendMatchSettlement(team,record).payload.nineDragonsWear;
  assert.equal(loss.cardId,card.id);assert.equal(loss.before-loss.after,1);
  assert.ok(report.importantEvents.some(e=>e.type==='nineDragonsWear'));
  assert.equal(s4EffectiveOverall(base,card),s4EffectiveOverall(base,card.upgradeLevel)-1);
  service.save({forceFull:true,skipDailyBackup:true});
  const reloaded=new YellowDogsLeagueService({statePath,backupDir:null,now:()=>now});
  assert.equal(reloaded.state.s4Assets.cards[card.id].permanentOverallPenalty,1);
  const persisted=reloaded.state.matches.find(m=>m.id===record.id);
  assert.ok(persisted.report.importantEvents.some(e=>e.type==='nineDragonsWear'));
  reloaded.settleNineDragons(persisted);
  assert.equal(reloaded.state.s4Assets.cards[card.id].permanentOverallPenalty,1);
  card.permanentOverallPenalty=base.overall-50;
  service.settleNineDragons({...record,id:'floor',competition:'cup'});
  assert.equal(card.permanentOverallPenalty,base.overall-50);
});

test('正式赛11名带资首发独立生效并结算；重试不重复发钱，杯赛按轮次计价',()=>{
  const {service,user,team,fixture,side,input}=setup();
  const match=createMatch(input);
  const starters=match.state.players.filter(p=>p.side===side && p.active);
  assert.equal(starters.filter(p=>p.sponsorEntry).length,11);
  assert.ok(match.state.players.filter(p=>!p.active).every(p=>!p.sponsorEntry));
  for(const [i,p] of starters.entries()) assert.equal(p.baseAttributes.pace,input.teams[side].players[i].baseAttributes.pace*.9);
  assert.equal(match.events.filter(e=>e.traitOpening && e.side===side).length,11);
  const ledger=createPlayerReportLedger(input,VERSION);
  advanceMatch(match,10000);ledger.consume(match.events);
  const report=ledger.finish(match.state);
  const record=service.finalizeFixture(fixture,1,{report});
  const entries=()=>service.state.ledger.filter(row=>row.type==='sponsor-entry'&&row.accountId===user.id);
  const units={A:750,B:500};
  assert.equal(entries()[0].amount,11*units[record.division]);
  service.finalizeFixture(fixture,1,{report});
  assert.equal(entries().length,1);
  const mail=service.sendMatchSettlement(team,record);
  assert.equal(mail.payload.rewards.find(r=>r.sponsorCount===11).amount,entries()[0].amount);
  const teams=report.teams.map(t=>service.state.teams.find(row=>row.id===t.id));
  const balance=service.wallet(user.id).balance;
  for(const [stage,unit] of Object.entries({roundOf16:1800,quarterfinals:2000,semifinals:2500,final:3000})){
    const cup={...record,id:'cup-'+stage,competition:'cup',cupStage:stage};
    service.settleEntrySponsors(cup,teams);
    service.settleEntrySponsors(cup,teams);
    assert.equal(entries().at(-1).amount,11*unit);
  }
  assert.equal(service.wallet(user.id).balance-balance,11*(1800+2000+2500+3000));
  for(const division of ['A','B']){
    service.settleEntrySponsors({...record,id:'league-'+division,division},teams);
    assert.equal(entries().at(-1).amount,11*units[division]);
  }
  const before=service.wallet(user.id).balance;
  service.settleEntrySponsors({...record,id:'abandoned',report:{...report,abandoned:true}},teams);
  service.settleEntrySponsors({...record,id:'friendly',competition:'friendly'},teams);
  assert.equal(service.wallet(user.id).balance,before);
});

test('友谊赛和AI训练入口禁用带资，梭哈结果和专属解说在断点恢复后保持一致',()=>{
  const {service,user,fixture,input,side,now}=setup();
  service.actualMatchEngine='v4';
  const training=service.createAiTraining(user,{formation:'4-3-3',averageOverall:82});
  const practice=service.liveAiTrainings.get(training.broadcast.code).match;
  assert.ok(practice.spatial.state.players.some(p=>p.traitDefinitions.some(t=>t.id==='sponsor-entry')));
  assert.ok(practice.spatial.state.players.every(p=>!p.sponsorEntry));
  assert.ok(!practice.events.some(e=>e.text.includes('带资进组')));
  const {seats,matchOptions}=service.prepareFixtureMatch(fixture,1,now,{competitionMode:'friendly',matchEngine:'v4'});
  const live=createLiveV4Match(seats,{...matchOptions,duration:60});
  assert.ok(live.spatial.state.players.every(p=>!p.sponsorEntry));
  assert.ok(!live.events.some(e=>e.text.includes('带资进组')));
  const card=YDL_TRAIT_CARDS.find(t=>t.id==='all-in-gamble');
  const source=input.teams[side].players[0];
  source.traitDefinitions=[card];
  const outcomes=new Set();
  for(let i=0;i<40 && outcomes.size<2;i++){
    const match=createMatch({...input,competitionMode:'friendly',seed:'dice-'+i});
    const p=match.state.players.find(p=>p.id===source.id&&p.side===side);
    outcomes.add(p.allInMultiplier);
    assert.equal(p.baseAttributes.pace,Math.min(99,source.baseAttributes.pace*p.allInMultiplier));
    const restored=restoreCheckpoint(exportCheckpoint(match));
    assert.deepEqual(restored.state.players,match.state.players);
    const commentary=createMatchCommentary();
    commentary.consume(restored.events.map(e=>publicEvent(e)).filter(Boolean),input.teams);
    const lines=commentary.feed([]).filter(e=>e.type==='traitActivated');
    assert.equal(lines.length,1);
    assert.ok(lines[0].text.includes(p.allInMultiplier>1?'+8%':'-8%'));
    assert.equal(lines[0].level,'critical');
  }
  assert.deepEqual(outcomes,new Set([.92,1.08]));
});

test('带资首发真实破门触发补丁的进球解说，友谊赛同一球回到常规解说',()=>{
  const {input,side}=setup();
  for(const competitionMode of ['cup','friendly']){
    const match=createMatch({...input,competitionMode});
    const s=match.state, scorer=s.players.find(p=>p.side===side && p.role==='ST');
    s.rules.restartTouch=null;
    s.ball={mode:'loose',holder:null,flight:null,lastTouch:scorer.key,x:side?0.1:104.9,y:34,
      z:0,vz:0,vx:side?-15:15,vy:0};
    advanceMatch(match,1);
    const goal=match.events.find(e=>e.type==='goal');
    assert.equal(goal.actor,scorer.key);
    const commentary=createMatchCommentary();
    commentary.consume([publicEvent(goal)],input.teams);
    const [row]=commentary.feed([]);
    assert.equal(row.text.includes('赞助商在看台上笑开了花'),competitionMode==='cup');
  }
});
