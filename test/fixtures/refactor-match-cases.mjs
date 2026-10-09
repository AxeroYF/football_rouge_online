import {readFileSync} from 'node:fs';
import {buildAccountMatchSeat} from '../../shared/football/account-match-seat.mjs';

export function refactorMatchTeams() {
  const catalog = JSON.parse(readFileSync(new URL('../../assets/data/s4-player-catalog.json', import.meta.url), 'utf8')).filter(p=>!p.isX);
  const roster = [['GK',2],['DEF',7],['MID',7],['ATT',6]].flatMap(([pool,n])=>catalog.filter(p=>p.pool===pool).slice(0,n));
  return ['home','away'].map(id=>buildAccountMatchSeat({id,nickname:id,draft:{teamName:id,roster:structuredClone(roster).map((p,i)=>({...p,id:`${id}-${i}`,state:{fitness:85+i%16}}))}}));
}

export const refactorMatchCases = ['sunny','rain','storm','snow','superStorm'].flatMap(weather=>[
  {weather}, {weather,forceOwnGoal:true}, {weather,forceBrawl:true}, {weather,forceBlackWhistle:true},
]).map((options,index)=>({...options,seed:`r43-refactor-${index}`,possessionChains:36,dotReplayEnabled:true}));
