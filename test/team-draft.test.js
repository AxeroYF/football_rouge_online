import test from 'node:test';
import {addLegacyXPlayer} from './helpers/legacy-x-player.js';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {REAL_PLAYERS,REAL_PLAYER_BY_ID,isXPlayer} from '../versus/player-pool.js';
import {TEAM_DRAFT_FORMATIONS,TEAM_DRAFT_STYLES} from '../versus/public/team-draft-config.js';
import {generateTeamDraft,draftStyleScore,recommendDraftLineup} from '../versus/team-draft.js';
import {batchDraftMarkup,createBatchRevealController} from '../versus/public/team-draft-ui.js';
import {startLocalServer} from './helpers/local-server.js';

const user={id:'batch-manager',nickname:'Batch Manager'};
const make=(options={})=>new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-13T10:00:00+08:00'),rng:()=>.37,...options});
function complete(service,attempt=1){for(let stage=0;stage<3;stage++)service.revealBatchDraft(user,{stage,attempt});return service.draftView(user).current;}

test('three batches reveal only their own players and retries do not consume chances',()=>{
  const s=make();assert.throws(()=>s.beginDraft(user,'Batch FC',{formation:'invalid'}),/有效/);assert.equal(s.state.drafts[user.id],undefined);
  s.beginDraft(user,'Batch FC',{formation:'4-3-3',style:'control'});
  assert.equal(s.draftView(user).attemptsUsed,0);
  assert.throws(()=>s.revealBatchDraft(user,{stage:1,attempt:1}),/前场/);
  const first=s.revealBatchDraft(user,{stage:0,attempt:1}).draft;
  assert.equal(first.current.players.length,6);assert.ok(first.current.players.every(p=>p.stage===0));
  const hidden=s.state.drafts[user.id].current.entries.filter(e=>e.stage>0).map(e=>e.id);
  hidden.forEach(id=>assert.equal(JSON.stringify(first).includes(id),false));
  assert.deepEqual(s.revealBatchDraft(user,{stage:0,attempt:1}).draft,first);
  assert.equal(s.beginDraft(user,'Other',{formation:'5-4-1'}).draft.attemptsUsed,1);
  assert.throws(()=>s.revealBatchDraft(user,{stage:2,attempt:1}),/顺序/);
  assert.throws(()=>s.resetDraft(user,{attempt:1}),/三批/);
  assert.throws(()=>s.finishDraft(user),/完整/);
  assert.throws(()=>s.favoriteBatchDraft(user,{attempt:1,saved:true}),/完整/);
  assert.throws(()=>s.configureBatchDraft(user,{style:'press'}),/尚未结束/);
  const full=complete(s);assert.equal(full.players.length,22);assert.equal(full.players.filter(p=>p.starter).length,11);assert.equal(full.players.filter(p=>p.role==='GK').length,2);
  assert.equal(s.draftView(user).attemptsUsed,1);
});

test('all formations and styles generate usable 22-player squads and matching tactical principles',()=>{
  for(const formation of Object.keys(TEAM_DRAFT_FORMATIONS))for(const style of Object.keys(TEAM_DRAFT_STYLES)){
    const draft=generateTeamDraft({formation,style},new Set(),()=>.37,1);
    assert.equal(new Set(draft.entries.map(e=>e.id)).size,22);
    assert.equal(draft.entries.filter(e=>e.starter).length,11);
    assert.ok(draft.entries.every(e=>!isXPlayer(e.id)));
    assert.deepEqual(draft.entries.filter(e=>e.starter).map(e=>[e.role,e.position.x,e.position.y]),TEAM_DRAFT_FORMATIONS[formation]);
    assert.equal(draft.plan.tacticalModelVersion,"principles-1");
  }
});

test('style weighting favors the selected football qualities in real player draws',()=>{
  let state=1234567;const rng=()=>((state=(state*1664525+1013904223)>>>0)/4294967296);
  const totals={control:0,press:0};
  for(const style of ['control','press']){
    state=1234567;
    for(let n=0;n<80;n++){
      const entries=generateTeamDraft({formation:'4-3-3',style},new Set(),rng,n).entries.filter(e=>e.role!=='GK');
      totals[style]+=entries.reduce((sum,e)=>sum+draftStyleScore(REAL_PLAYER_BY_ID[e.id],'control')-draftStyleScore(REAL_PLAYER_BY_ID[e.id],'press'),0)/entries.length;
    }
  }
  assert.ok(totals.control/80>totals.press/80+.5,JSON.stringify(totals));
});

test('five whole attempts is a hard limit and old candidate can still be selected',()=>{
  const s=make();s.beginDraft(user,'Five FC');let first;
  for(let n=1;n<=5;n++){
    const current=complete(s,n);if(n===1){first=current;s.favoriteBatchDraft(user,{attempt:1,saved:true});}
    if(n<5){s.resetDraft(user,{attempt:n});s.resetDraft(user,{attempt:n});assert.equal(s.draftView(user).attemptsUsed,n);}
  }
  assert.throws(()=>s.resetDraft(user,{attempt:5}),/用完/);
  assert.throws(()=>s.revealBatchDraft(user,{stage:0,attempt:6}),/更新/);
  assert.throws(()=>s.revealBatchDraft(user,{stage:0,attempt:1}),/更新/);
  assert.equal(s.accountTeam(user.id),null);
  const result=s.finishDraft(user,{attempt:1});
  assert.deepEqual(new Set(result.ownTeam.roster.map(p=>p.id)),new Set(first.players.map(p=>p.id)));
  assert.equal(result.ownTeam.roster.filter(p=>p.starter).length,11);
  assert.deepEqual(new Set(result.ownTeam.roster.filter(p=>p.starter).map(p=>p.id)),new Set(first.players.filter(p=>p.starter).map(p=>p.id)));
  assert.equal(result.ownTeam.roster.flatMap(p=>p.cards).length,22);
  assert.equal(s.finishDraft(user,{attempt:1}).ownTeam.roster.flatMap(p=>p.cards).length,22);
  assert.equal(s.state.drafts[user.id],undefined);assert.equal(result.xGrowth,null);
});

test('recommended eleven selects the strongest same-position players across draw pairs',()=>{
  const players=TEAM_DRAFT_FORMATIONS['4-4-2'].flatMap(([role],slot)=>[0,1].map(copy=>({id:`${slot}-${copy}`,role,overall:60-copy,attributes:{}})));
  const defenders=players.filter(p=>p.role==='CB');
  [99,98,62,61].forEach((rating,i)=>defenders[i].overall=rating);
  const lineup=recommendDraftLineup(players,'4-4-2','balanced');
  assert.equal(new Set(lineup.map(p=>p.id)).size,11);
  assert.deepEqual(new Set(lineup.filter(p=>p.role==='CB').map(p=>p.id)),new Set(defenders.slice(0,2).map(p=>p.id)));
  assert.equal(players.find(p=>p.id===lineup.find(p=>p.role==='GK').id).role,'GK');
});

test('earlier batches stay open, only the new cards flip sequentially, and the board waits for a full team',()=>{
  const s=make();s.beginDraft(user,'Open FC');s.revealBatchDraft(user,{stage:0,attempt:1});s.revealBatchDraft(user,{stage:1,attempt:1});
  const partial=batchDraftMarkup(s.draftView(user),{renderCard:p=>p.name,animate:true});
  assert.doesNotMatch(partial,/<details|batch-previous|推荐最强首发/);
  assert.equal((partial.match(/class="batch-player /g)??[]).length,12);
  assert.equal((partial.match(/batch-player is-revealing/g)??[]).length,6);
  assert.match(partial,/--batch-delay:3250ms/);
  assert.match(partial,/disabled data-batch-reveal-lock/);
  const rarityView=s.draftView(user);
  const newCards=rarityView.current.players.filter(p=>p.stage===1);
  newCards.forEach((p,i)=>{p.overall=i===0?85:i===1?90:80;p.grade=i===2?'S':'A';p.legendary=false;p.legend=false;});
  const rarity=batchDraftMarkup(rarityView,{renderCard:p=>p.name,animate:true});
  assert.equal((rarity.match(/batch-highlight is-rare/g)??[]).length,1);
  assert.equal((rarity.match(/batch-highlight is-elite/g)??[]).length,2);
  // The low-rated legend still gets gold, and the glow rotates with the card face.
  assert.match(rarity,/<div class="batch-card-front">[^<]+<div class="batch-highlight is-elite"/);
  assert.doesNotMatch(batchDraftMarkup(rarityView,{renderCard:p=>p.name,animate:false}),/batch-highlight/);
  complete(s);const full=batchDraftMarkup(s.draftView(user),{renderCard:p=>p.name,animate:false});
  assert.match(full,/推荐最强首发/);
  assert.equal((full.match(/class="batch-lineup-player /g)??[]).length,11);
  assert.equal((full.match(/class="batch-player /g)??[]).length,22);
  assert.doesNotMatch(full,/is-revealing|disabled data-batch-reveal-lock/);
});

test('sequential reveal keeps actions locked until the last card finishes and cancels on navigation',()=>{
  const tasks=new Map();let n=0;
  const env={setTimeout:(fn,delay)=>{tasks.set(++n,{fn,delay});return n;},clearTimeout:id=>tasks.delete(id)};
  const button={disabled:true,removeAttribute:()=>{}};
  let flipping=true;
  const root={classList:{contains:()=>flipping,remove:()=>{flipping=false;}},querySelectorAll:selector=>selector==='[data-batch-reveal-lock]'?[button]:Array(10).fill({})};
  const controller=createBatchRevealController(env);controller.mount(root);
  assert.ok(tasks.get(1).delay>6000);assert.equal(button.disabled,true);
  tasks.get(1).fn();assert.equal(button.disabled,false);assert.equal(flipping,false);
  flipping=true;controller.mount(root);controller.mount(null);assert.equal(tasks.has(2),false);
});

test('hidden roster and saved candidates reserve players; discarded attempts release them',()=>{
  const s=make();s.beginDraft(user,'Reserved FC');s.revealBatchDraft(user,{stage:0,attempt:1});
  const ids=s.state.drafts[user.id].current.entries.map(e=>e.id);
  assert.ok(ids.every(id=>s.unavailablePlayerIds('another').has(id)));
  const admin=s.adminView();assert.equal(Object.values(admin.pools).reduce((n,p)=>n+p.drafting,0),22);assert.equal(admin.drafts[0].selectedCount,6);
  complete(s);s.favoriteBatchDraft(user,{attempt:1,saved:true});s.resetDraft(user,{attempt:1});
  assert.ok(ids.every(id=>s.unavailablePlayerIds('another').has(id)));
  const other={id:'another',nickname:'Another'};s.beginDraft(other,'Other FC');s.autoDraft(other);
  assert.ok(s.draftView(other).current.players.every(p=>!ids.includes(p.id)));
  s.favoriteBatchDraft(user,{attempt:1,saved:false});
  assert.ok(ids.every(id=>!s.unavailablePlayerIds('third').has(id)));
});

test('insufficient pool does not consume an attempt or reserve a partial team',()=>{
  const s=make();s.beginDraft(user,'Empty FC');s.unavailablePlayerIds=()=>new Set(REAL_PLAYERS.map(p=>p.id));
  assert.throws(()=>s.revealBatchDraft(user,{stage:0,attempt:1}),/不足/);
  assert.equal(s.draftView(user).attemptsUsed,0);assert.equal(s.draftView(user).current,null);
});

for(const storage of ['json','shards'])test(`draft preferences, candidates and reveal progress survive ${storage} reload`,()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'yffm-draft-'));
  try{
    const options={statePath:path.join(dir,storage==='json'?'league.json':'league-state'),backupDir:null};
    let s=make(options);s.beginDraft(user,'Persistent FC',{formation:'3-5-2',style:'press'});const first=complete(s);
    s.favoriteBatchDraft(user,{attempt:1,saved:true});s.resetDraft(user,{attempt:1});s.configureBatchDraft(user,{formation:'5-4-1',style:'counter'});
    s.revealBatchDraft(user,{stage:0,attempt:2});const before=s.draftView(user);
    s=make(options);assert.deepEqual(s.draftView(user),before);
    const result=s.finishDraft(user,{attempt:1});const team=s.accountTeam(user.id);
    assert.deepEqual(new Set(result.ownTeam.roster.map(p=>p.id)),new Set(first.players.map(p=>p.id)));
    assert.deepEqual(Object.values(team.positions),TEAM_DRAFT_FORMATIONS['3-5-2'].map(([,x,y])=>({x,y})));
    assert.equal(team.tacticalPlans.opening.defensiveBlock,'highPress');
    s=make(options);assert.equal(s.accountTeam(user.id).rosterIds.length,22);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy unfinished draft migrates without granting X and acquisition/growth endpoints are paused',()=>{
  const s=make();s.beginDraft(user,'Legacy FC');const draft=s.state.drafts[user.id];delete draft.mode;
  draft.selectedIds=REAL_PLAYERS.filter(p=>!isXPlayer(p)).slice(0,7).map(p=>p.id);
  s.configureBatchDraft(user,{formation:'4-4-2',style:'wing'});assert.equal(s.draftView(user).attemptsUsed,0);
  for(const call of [()=>s.chooseXPlayer(user,'x'),()=>s.configureXPlayer(user,{}),()=>s.chooseXPlayerTrait(user,'x'),()=>s.buyXGrowthPoints(user),()=>s.spendXGrowthPoints(user,'passing',1),()=>s.resetXGrowth(user,'ST','LW'),()=>s.grantXGrowthPointsFromAdmin({points:1})])assert.throws(call,/暂停|关闭/);
  complete(s);assert.ok(s.finishDraft(user).ownTeam.roster.every(p=>!isXPlayer(p)));
});

test('existing X player and its accumulated growth remain playable and unchanged',()=>{
  const s=make();s.beginDraft(user,'Veteran FC');complete(s);s.finishDraft(user);const team=s.accountTeam(user.id);
  const player=REAL_PLAYERS.find(p=>isXPlayer(p));
  s.state.xPlayers.assignments[player.id]=user.id;
  s.state.xPlayers.configs[player.id]={role:player.role,secondaryRole:player.secondaryRole,heightCm:player.heightCm,attributes:{...player.attributes},overall:player.overall};
  const growth=s.xGrowthState(player.id);growth.points=17;growth.earnedPoints=9;
  team.rosterIds.push(player.id);team.playerState[player.id]={fitness:100,suspension:0,injuryRounds:0};
  s.grantS4Card(team,player.id,{grantOwnership:true,acquisitionSource:'legacy-fixture'});
  const state=JSON.stringify(s.state.xPlayers);const view=s.view(user);
  assert.ok(view.ownTeam.roster.some(p=>p.id===player.id));assert.equal(view.xGrowth,null);
  assert.equal(s.settleXGrowthTasks(player.id),0);assert.equal(JSON.stringify(s.state.xPlayers),state);
});

test('candidate markup allows confirming saved teams after final chance without another reveal',()=>{
  const s=make();s.beginDraft(user,'Markup FC');complete(s);s.favoriteBatchDraft(user,{attempt:1,saved:true});s.resetDraft(user,{attempt:1});
  const html=batchDraftMarkup(s.draftView(user),{preview:1,renderCard:p=>p.name});
  assert.match(html,/data-league-finish="1"/);assert.match(html,/返回当前建队进度/);assert.doesNotMatch(html,/data-batch-reveal|data-batch-reroll/);
});

test('public HTTP endpoints support complete batch workflow and reject legacy X acquisition',async t=>{
  const server=await startLocalServer();t.after(()=>server.stop());
  const post=async(route,body)=>(await fetch(server.url+'/api/versus'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
  const account=await post('/register',{nickname:'Batch HTTP',password:'batch-test-password'});assert.equal(account.ok,true);
  const identity={playerId:account.profile.id,accountToken:account.accountToken};
  const started=await post('/league/draft/start',{...identity,teamName:'HTTP FC',formation:'4-2-3-1',style:'vertical'});assert.equal(started.draft.preferences.style,'vertical');
  for(let stage=0;stage<3;stage++){const v=await post('/league/draft/reveal',{...identity,stage,attempt:1});assert.equal(v.draft.current.revealed,stage+1);}
  assert.equal((await post('/league/draft/candidate',{...identity,attempt:1,saved:true})).draft.candidates.length,1);
  assert.equal((await post('/league/draft/reset',{...identity,attempt:1})).league.draft.current,null);
  assert.equal((await post('/league/draft/x-player',{...identity,leaguePlayerId:'x'})).ok,false);
  const result=await post('/league/draft/finish',{...identity,attempt:1});assert.equal(result.league.ownTeam.roster.length,22);assert.equal(result.league.xGrowth,null);
});


test('existing X enhancement and pending trait growth are paused without consuming assets',()=>{
  const s=make();s.beginDraft(user,'Frozen FC');complete(s);s.finishDraft(user);
  const id=addLegacyXPlayer(s,user),card=s.representativeCard(user.id,id);
  const material=s.representativeCard(user.id,s.accountTeam(user.id).rosterIds.find(pid=>!isXPlayer(pid)));
  const before=JSON.stringify(s.state.s4Assets),balance=s.wallet(user.id).balance;
  assert.throws(()=>s.enhanceS4Card(user,card.id,material.id,false),/成长暂时关闭/);
  assert.equal(JSON.stringify(s.state.s4Assets),before);assert.equal(s.wallet(user.id).balance,balance);
  assert.equal(s.createS4EnhancementTraitOffer(user.id,card),null);
  s.state.s4Assets.traitOffers.frozen={id:'frozen',cardId:card.id,playerId:id,ownerId:user.id,status:'pending',traitIds:[]};
  assert.throws(()=>s.chooseS4EnhancementTrait(user,'frozen','any'),/成长暂时关闭/);
  assert.equal(s.state.s4Assets.traitOffers.frozen.status,'pending');
});
