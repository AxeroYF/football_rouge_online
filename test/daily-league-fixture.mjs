import {coalitionFixture} from './coalition-fixture.mjs';
import {DAILY_LEAGUE} from '../shared/config/daily-league.mjs';
import {ELITE_CLUBS} from '../shared/config/elite-clubs.mjs';
import {DailyLeagueService} from '../server/application/daily-league-service.mjs';
export function leagueFixture({ten=false}={}){
 const f=coalitionFixture();f.tick(Date.parse('2026-09-22T09:49:00+08:00')-f.now);
 if(ten){const source=structuredClone(f.a);for(let i=0;i<6;i++){let a=[...f.s.accounts.values()][i];if(!a){a=structuredClone(source);a.id='league-player-'+i;a.token=a.id;f.s.accounts.set(a.id,a);}a.nickname=f.s.dailyLeague.rules.usernames[i];a.draft.teamName=i===0?'皇家马德里':a.nickname;}
  f.s.eliteChallenges.availableClubs=()=>ELITE_CLUBS;
 }else f.s.dailyLeague=new DailyLeagueService(f.s,{rules:{...DAILY_LEAGUE,usernames:['a','b'],clubIds:[]}});
 const start=()=>{f.tick(60000);f.s.dailyLeague.ensureDay();f.tick(10*60000);};
 return {f,start,get league(){return f.s.dailyLeague;}};
}
