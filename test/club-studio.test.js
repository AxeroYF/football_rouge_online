import test from 'node:test';
import assert from 'node:assert/strict';
import {clubSquad,ownClubView,clubRosterMarkup} from '../client/social/club-presentation.js';
import {posterMarkup,posterPlayers} from '../client/share/roster-poster.js';
import {defaultPositions} from '../shared/football/account-match-seat.mjs';
function fixture(){
 const roles=['GK','CB','CB','LB','RB','CM','CM','AM','ST','LW','RW'];
 const roster=Array.from({length:44},(_,i)=>({id:'p'+i,playerId:'p'+i,name:'球员'+i,pool:i%11===0?'GK':i%11<5?'DEF':i%11<8?'MID':'ATT',role:roles[i%11],overall:80,grade:'A',club:'测试俱乐部',nationality:'法国',state:{fitness:97},upgradeLevel:i===0?2:0}));
 const tactics={squads:Object.fromEntries(['expedition','garrison'].map((id,n)=>{const players=roster.slice(n*22,n*22+11);return [id,{starters:players.map(p=>p.id),positions:defaultPositions(players),formation:'4-3-3'}];}))};
 return {playerId:'club',nickname:'经理',draft:{teamName:'测试 <球队>',roster},playerSquads:{assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))},tactics,leagueRegistration:{playerIds:['p0','p24'],tactics:{starters:['p0','p24']},conditions:{}},wallet:{gold:987654321},token:'private-token'};
}
test('club projections and export do not mutate squads, tactics or registration',()=>{
 const state=fixture(),before=structuredClone(state);for(const scope of ['expedition','garrison','league']){clubSquad(state,scope);posterPlayers(state,scope,'roster');}ownClubView(state);assert.deepEqual(state,before);
 const data=clubSquad(state);assert.equal(data.players.length,11);assert.equal(data.roster.length,22);assert.equal(data.players[0].player.upgradeLevel,2);
 assert.deepEqual(new Set(clubSquad(state,'league').roster.map(p=>p.playerId)),new Set(['p0','p24']));
});
test('export uses common card markup, escapes titles and includes only display data',()=>{
 const state=fixture(),{data,players}=posterPlayers(state,'expedition','roster');
 const html=posterMarkup({teamName:state.draft.teamName,title:'<img onerror=bad>',squad:'expedition',mode:'roster',data,players,page:0,date:'2026/9/28'});
 assert.equal((html.match(/data-player-card-skin=/g)??[]).length,20);assert.match(html,/&lt;img onerror=bad&gt;/);assert.match(html,/测试 &lt;球队&gt;/);assert.doesNotMatch(html,/987654321|private-token|fitness|data-player-card-action/);
 const next=posterMarkup({teamName:'test',squad:'expedition',mode:'roster',data,players,page:1,date:'today'});assert.equal((next.match(/data-player-card-skin=/g)??[]).length,2);
});
test('club gallery is bounded and supports lazy loading without full roster fetch',()=>{
 assert.match(clubRosterMarkup([],100,0,false),/cards-load/);
 const players=clubSquad(fixture()).roster;const html=clubRosterMarkup(players,22);assert.equal((html.match(/data-player-card-skin=/g)??[]).length,12);assert.match(html,/data-card-render=/);assert.match(html,/roster-next/);
});
