import {createHash} from 'node:crypto';
import {engineProfile,isV31} from './model-config.js';
import {OFFLINE_ATTRIBUTE_SETTINGS} from '../offline-attribute-settings.js';

function freeze(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
export function configurationDigest(value) {
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function lock(object,key,value) {
  Object.defineProperty(object,key,{value,enumerable:true,writable:false,configurable:false});
}
export function captureMatchConfiguration(match,teams,options={}) {
  if(!isV31(match.parameters))return;
  const snapshot=JSON.parse(JSON.stringify({
    version:1,engineVersion:match.engineVersion,engineProfile:engineProfile(match.parameters),
    modelVersion:match.modelVersion,parameterDigest:configurationDigest(match.parameters),
    simulationSeed:match.simulationSeed,initialTeams:teams,environment:match.environment,
    attributeSettings:OFFLINE_ATTRIBUTE_SETTINGS,adapter:options.configurationContext??null,
    options:{possessionChains:match.possessionChainCount,forceBlackWhistle:match.forceBlackWhistle,
      forceBrawl:match.forceBrawl,forceOwnGoal:match.forceOwnGoal,superStormStopMinute:match.superStormStopMinute,
      diagnosticTrace:Boolean(options.diagnosticTrace)},
  }));
  match.configuration={...snapshot,id:configurationDigest(snapshot)};
  lockMatchConfiguration(match);
}
export function lockMatchConfiguration(match) {
  if(!isV31(match.parameters))return;
  const config=match.configuration;
  if(!config||config.version!==1||config.engineVersion!==match.engineVersion||config.simulationSeed!==match.simulationSeed
    ||config.engineProfile!==match.engineProfile||config.modelVersion!==match.modelVersion
    ||configurationDigest(config.environment)!==configurationDigest(match.environment)
    ||configurationDigest(config.attributeSettings)!==configurationDigest(OFFLINE_ATTRIBUTE_SETTINGS)
    ||config.options.possessionChains!==match.possessionChainCount
    ||config.parameterDigest!==configurationDigest(match.parameters))throw new Error('比赛配置与锁定快照不一致');
  const {id,...snapshot}=config;
  if(configurationDigest(snapshot)!==id)throw new Error('比赛配置摘要校验失败');
  lock(match,'parameters',freeze(match.parameters));
  lock(match,'configuration',freeze(config));
  lock(match,'simulationSeed',config.simulationSeed);
  lock(match,'environment',freeze(match.environment));
  lock(match,'possessionChainCount',match.possessionChainCount);
  for(const key of ['forceBlackWhistle','forceBrawl','forceOwnGoal','superStormStopMinute']) {
    if(match[key]!==config.options[key])throw new Error(`比赛配置发生变化：${key}`);
    lock(match,key,match[key]);
  }
  for(const key of ['engineVersion','engineProfile','modelVersion'])lock(match,key,match[key]);
  if(config.adapter&&Object.hasOwn(match,'regulationOnly')) {
    for(const [key,value] of Object.entries(config.adapter)) {
      if(configurationDigest(match[key])!==configurationDigest(value))throw new Error(`比赛配置发生变化：${key}`);
      lock(match,key,freeze(match[key]));
    }
  }
}
export function matchReliabilitySummary(match) {
  return {configurationId:match.configuration?.id??null,parameterDigest:match.configuration?.parameterDigest??null,
    randomModel:match.randomState?.mode??'legacy-unsaved',recovery:match.randomState?.recovery??'legacy-unsaved',
    engineVersion:match.engineVersion,engineProfile:match.engineProfile};
}
