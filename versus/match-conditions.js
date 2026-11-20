import {drawVersusReferee,VERSUS_REFEREES} from './match-engine.js';
import {drawYdlV2Weather,YDL_V2_WEATHER} from './v2/ydl-league-engine-adapter.js';
import {V2_MATCH_PARAMETERS} from './v2/match-parameters-v2.js';

export function seededConditions(seed, options = {}) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return { weather:drawYdlV2Weather(rng, { ...options, weatherWeights:V2_MATCH_PARAMETERS.environment.weatherWeights }), referee:drawVersusReferee(rng) };
}

export function fixtureConditions(seasonId,fixture,round,options={}) {
  const seed=options.competitionMode==='friendly'&&fixture.id
    ? `${seasonId}:${fixture.id}` : `${seasonId}:${round}:${fixture.homeId}:${fixture.awayId}`;
  return seededConditions(seed,options);
}

export function cupConditions(seasonId,fixture,event) {
  return fixtureConditions(seasonId,fixture,event.round,{competitionMode:'cup',legNumber:event.leg,allowSuperStorm:['league','swiss'].includes(event.stage)});
}

export function matchEnvironment(key='sunny',referee='standard') {
  const weather=YDL_V2_WEATHER[key];
  if(!weather)throw new Error('未知的比赛天气');
  const rules=V2_MATCH_PARAMETERS.environment;
  return {weather:key,...weather,referee,execution:rules.weatherExecution[key],fatigue:rules.weatherFatigueMultiplier[key],
    weatherEvent:rules.weatherEventPerChain[key]};
}

export function publicMatchWeather(env) {
  const key=env?.weather??'sunny';
  return {key,...YDL_V2_WEATHER[key]};
}

export function publicMatchReferee(env) {
  const key=env?.referee??'standard';
  return {key,...VERSUS_REFEREES[key]};
}

const {events,environment}=V2_MATCH_PARAMETERS;
export const matchIncidentRules=Object.freeze({ownGoal:events.ownGoalPerMatch,blackWhistle:events.blackWhistlePerMatch,
  brawl:events.brawl,injury:events.injuryPerChain,highPress:events.highPressInjury,weatherNotice:events.weatherImpactPerMatch,stormStop:environment.superStormStopMinuteRange});
