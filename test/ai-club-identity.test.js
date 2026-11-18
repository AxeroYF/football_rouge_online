import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {aiClubBadge,aiSquadStrength} from '../versus/ai-clubs.js';
import {CLUB_BADGES} from '../versus/cosmetic-items.js';
import {REAL_PLAYER_BY_ID,REAL_PLAYERS} from '../versus/player-pool.js';

const make = () => new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-17T09:00:00+08:00'),rng:()=>.37});
const user = {id:'identity-manager',nickname:'Identity Manager'};

test('all 16 AI clubs expose existing cosmetic crests in standings and details without inventory grants',()=>{
  const s=make(),before=JSON.stringify(s.state.s4Assets.cosmetics);
  const teams=s.view(user).teams;
  assert.equal(teams.length,16);
  for(const team of teams){
    const badge=team.equippedClubBadge;
    assert.equal(badge.clubName,team.name);
    assert.ok(CLUB_BADGES.some(item=>item.id===badge.id));
    assert.ok(existsSync(new URL('../versus/public'+badge.imageUrl.replace('/versus','').split('?')[0],import.meta.url)));
    assert.deepEqual(s.teamDetail(user,team.id).equippedClubBadge,badge);
  }
  // View can initialize the observer's empty inventory; AI entries must never be created.
  for(const team of teams)assert.equal(s.state.s4Assets.cosmetics.inventory[team.id],undefined);
  assert.equal(before.includes('club-badge'),false);
  const renamed={...s.state.teams[0],name:'别名'};
  assert.equal(aiClubBadge(renamed).clubName,'皇家马德里');
  assert.equal(aiClubBadge({...renamed,ownerId:user.id}),null);
});

for(const cupStatus of ['waiting','active'])test(`joining replaces weakest available squad with cup ${cupStatus}`,()=>{
  const s=make();
  // Place the deliberately weakest squad last, behind the strong club in the cup.
  const weak=s.state.teams.at(-1),strong=s.state.teams[0];
  const players=REAL_PLAYERS.filter(p=>p.grade!=='X').sort((a,b)=>a.overall-b.overall);
  weak.rosterIds=[...players.filter(p=>p.role==='GK').slice(0,3),...players.filter(p=>p.role!=='GK').slice(0,20)].map(p=>p.id);
  s.state.cup.status=cupStatus;
  s.cupStandings=()=>s.state.teams.map((team,index)=>({id:team.id,rank:index+1}));
  const division=weak.division,table=structuredClone(weak.table),fixtures=JSON.stringify(s.state.rounds);
  s.beginDraft(user,'新玩家球队');
  assert.equal(s.state.drafts[user.id].teamId,weak.id);
  s.autoDraft(user);s.finishDraft(user);
  assert.equal(s.accountTeam(user.id).id,weak.id);
  assert.equal(s.accountTeam(user.id).division,division);
  assert.deepEqual(s.accountTeam(user.id).table,table);
  assert.equal(JSON.stringify(s.state.rounds),fixtures);
  assert.equal(strong.ownerId,null);
  assert.equal(s.view(user).teams.find(t=>t.id===weak.id).equippedClubBadge,null);
});

test('pending drafts reserve separate weak seats and repeated requests keep their reservation',()=>{
  const s=make();
  const ranked=s.state.teams.map(team=>({team,...aiSquadStrength(team,REAL_PLAYER_BY_ID)})).sort((a,b)=>a.firstTeam-b.firstTeam||a.squad-b.squad||a.team.id.localeCompare(b.team.id));
  const first={id:'first',nickname:'一'},second={id:'second',nickname:'二'};
  s.beginDraft(first,'第一队');s.beginDraft(second,'第二队');
  assert.equal(s.state.drafts.first.teamId,ranked[0].team.id);
  assert.equal(s.state.drafts.second.teamId,ranked[1].team.id);
  s.beginDraft(first,'再次请求');assert.equal(s.state.drafts.first.teamId,ranked[0].team.id);
});

test('strength uses one goalkeeper and ten outfield players, independent of temporary fitness',()=>{
  const players=Object.fromEntries(Array.from({length:23},(_,i)=>[String(i),{role:i<3?'GK':'ST',overall:i<3?99:70}]));
  const team={rosterIds:Object.keys(players),playerState:{'0':{fitness:0,injuryRounds:3}}};
  assert.equal(aiSquadStrength(team,players).firstTeam,(99+700)/11);
  team.playerState={};assert.equal(aiSquadStrength(team,players).firstTeam,(99+700)/11);
});
