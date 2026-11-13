import {isV31} from './model-config.js';

export const RANDOM_DOMAINS=Object.freeze(['decision','execution','shot','discipline','injury','environment','presentation']);
const ALGORITHM='mulberry32-v1';

function hashSeed(value) {
  let state=2166136261;
  for(const character of String(value)){state^=character.charCodeAt(0);state=Math.imul(state,16777619);}
  return state>>>0;
}
export function randomStream(seed) {return {value:hashSeed(seed)||1,draws:0};}
export function nextRandom(stream) {
  stream.value=(stream.value+0x6D2B79F5)>>>0;
  stream.draws+=1;
  let value=stream.value;
  value=Math.imul(value^value>>>15,value|1);
  value^=value+Math.imul(value^value>>>7,value|61);
  return ((value^value>>>14)>>>0)/4294967296;
}
export function createSerializableMatchRng(seed='ydl-v2',stream=randomStream(seed)) {
  const rng=()=>nextRandom(stream);
  Object.defineProperty(rng,'stream',{value:stream});
  return rng;
}
function validateStream(stream) {
  if(!stream||!Number.isInteger(stream.value)||stream.value<0||stream.value>0xffffffff||!Number.isSafeInteger(stream.draws)||stream.draws<0)throw new Error('比赛随机状态损坏');
}
export function restoreMatchRandom(match,{externalRng}={}) {
  if(match.randomState?.mode==='external') {
    if(typeof externalRng!=='function'&&typeof match.rng!=='function')throw new Error('外部随机函数比赛需要原随机函数，不能保证检查点续赛');
    if(externalRng)match.rng=externalRng;
    return;
  }
  if(match.randomState) {
    if(match.randomState.version!==1||match.randomState.algorithm!==ALGORITHM)throw new Error('不支持的比赛随机状态版本');
    if((match.randomState.mode==='domains')!==isV31(match.parameters))throw new Error('随机模式与比赛版本不一致');
    if(isV31(match.parameters)) {
      if(match.nextChainIndex>0&&!match.outcomeSampleCounters)throw new Error('V3.1 检查点缺少分组采样计数');
      const counters=match.outcomeSampleCounters??{};
      if(Array.isArray(counters)||typeof counters!=='object'||Object.values(counters).some(value=>!Number.isSafeInteger(value)||value<0))throw new Error('比赛分组采样计数损坏');
    }
    if(match.randomState.mode==='domains') {
      for(const name of RANDOM_DOMAINS)validateStream(match.randomState.streams?.[name]);
      match.rng=()=>nextRandom(match.randomState.streams.decision);
    } else if(match.randomState.mode==='legacy') {
      validateStream(match.randomState.stream);
      match.rng=createSerializableMatchRng('',match.randomState.stream);
    } else throw new Error('不支持的比赛随机模式');
    return;
  }
  // Old checkpoints never saved this state. Preserve their historical fallback,
  // and explicitly distinguish migration from exact continuation.
  if(isV31(match.parameters))throw new Error('V3.1 检查点缺少完整随机状态');
  const seed=`${match.simulationSeed??'ydl-v2'}:resume:${match.nextChainIndex??0}:${match.events?.length??0}`;
  match.randomState={version:1,algorithm:ALGORITHM,mode:'legacy',stream:randomStream(seed),recovery:'legacy-fallback',migratedAtChain:match.nextChainIndex??0};
  match.rng=createSerializableMatchRng(seed,match.randomState.stream);
}
export function initializeMatchRandom(match,externalRng) {
  if(externalRng) {
    match.randomState={version:1,algorithm:ALGORITHM,mode:'external',recovery:'external-unserializable'};
    match.rng=externalRng;
  } else if(isV31(match.parameters)) {
    match.randomState={version:1,algorithm:ALGORITHM,mode:'domains',recovery:'exact',streams:Object.fromEntries(RANDOM_DOMAINS.map(name=>[name,randomStream(`${match.simulationSeed}:v3.1:${name}`)]))};
    restoreMatchRandom(match);
  } else {
    match.randomState={version:1,algorithm:ALGORITHM,mode:'legacy',recovery:'exact',stream:randomStream(match.simulationSeed)};
    restoreMatchRandom(match);
  }
}
export function matchRandom(match,domain='decision') {
  if(typeof match.rng!=='function')restoreMatchRandom(match);
  if(match.randomState?.mode==='legacy') {
    if(match.rng.stream)return nextRandom(match.randomState.stream);
    // Preserve the supported V2 test/embedding hook that replaces match.rng.
    match.randomState.mode='external';match.randomState.recovery='external-unserializable';
    return match.rng();
  }
  if(match.randomState?.mode!=='domains')return match.rng();
  if(!RANDOM_DOMAINS.includes(domain))throw new Error(`未知比赛随机领域：${domain}`);
  return nextRandom(match.randomState.streams[domain]);
}
