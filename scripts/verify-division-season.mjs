import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const out='outputs/league-divisions-20261116';fs.mkdirSync(out,{recursive:true});
const files=['data/ydl-content-overrides.json','data/ydl-player-card-studio.json','data/yellowdogs-league.json'].filter(fs.existsSync);
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),before=Object.fromEntries(files.map(p=>[p,hash(p)]));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-division-season-'));
for(const [env,file] of [['YDL_CONTENT_OVERRIDES_PATH','ydl-content-overrides.json'],['YDL_PLAYER_CARD_STUDIO_PATH','ydl-player-card-studio.json']]){
 process.env[env]=path.join(temp,file);fs.copyFileSync(path.join('data',file),process.env[env]);
}
process.env.YELLOWDOGS_LEAGUE_PATH=path.join(temp,'league.json');process.env.VERSUS_ACCOUNTS_PATH=path.join(temp,'accounts.json');
const {YellowDogsLeagueService}=await import('../versus/league-service.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const s=new YellowDogsLeagueService({statePath:null,now:()=>Date.parse('2026-11-16T10:00:00+08:00'),rng:()=>.37});
const rosters=s.state.teams.map(t=>JSON.stringify(t.rosterIds));
s.recordMatchEvents=false;s.startCup();
const initialTeams=s.state.teams.map(t=>s.teamDetail({id:'observer'},t.id));
fs.writeFileSync(out+'/initial-teams.json',JSON.stringify(initialTeams,null,2));
let cupEvents=0;
for(let round=1;round<=14;round++){
 s.simulateNextRound();
 cupEvents=s.state.cup.events.filter(e=>e.status==='complete').length;
 assert.equal(s.state.season.currentRound,round);
 assert.equal(s.state.seasonFinalTournament,null);
 s.state.teams.forEach((t,i)=>{assert.equal(JSON.stringify(t.rosterIds),rosters[i]);assert.ok(Object.values(t.playerState).every(p=>p.fitness>=0&&p.fitness<=100));});
 console.log(`Completed round ${round}/14; cup events ${cupEvents}/7`);
}
assert.equal(s.state.cup.status,'completed');assert.equal(cupEvents,7);assert.equal(s.state.matches.filter(m=>m.competition==='cup').length,29);
assert.equal(s.state.matches.filter(m=>m.competition==='league').length,112);
assert.ok(s.state.teams.every(t=>t.table.played===14));
assert.ok(Object.values(s.state.playerStats).every(p=>p.isAi));
const rankings=s.standings().map(t=>({...t,name:s.state.teams.find(x=>x.id===t.id).name,table:{...s.state.teams.find(x=>x.id===t.id).table}}));
const settled=s.settleDailySeason({manual:true});assert.ok(settled);
s.resetDailyCompetitions({manual:true,skipBackup:true});
assert.equal(s.state.competitionFormat.movements.length,1);assert.equal(s.state.rounds.length,14);
assert.equal(s.state.teams.filter(t=>t.division==='A').length,8);assert.equal(s.state.teams.filter(t=>t.division==='B').length,8);
assert.equal(s.state.seasonFinalTournament,null);assert.deepEqual(Object.fromEntries(files.map(p=>[p,hash(p)])),before);
fs.writeFileSync(out+'/season-verification.json',JSON.stringify({passed:true,leagueMatches:112,cupMatches:29,cupEvents,rounds:14,rankings,movement:s.state.competitionFormat.movements[0],rostersStable:true,aiStatsSeparated:true,finalDisabled:true,dailySettlementAndReset:true,sourceFilesUnchanged:true,sourceHashes:before},null,2));
console.log('PASS: 112 league + 29 cup matches, daily settlement, promotion/relegation and fresh schedules');
