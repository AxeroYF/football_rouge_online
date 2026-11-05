import {isV3} from "./model-config.js";

function hash(value) {
  let state=2166136261;
  for(let i=0;i<value.length;i++)state=Math.imul(state^value.charCodeAt(i),16777619);
  return state>>>0;
}
function generator(seed) {
  let state=hash(seed);
  return () => {
    state+=0x6D2B79F5;
    let value=state;
    value=Math.imul(value^value>>>15,value|1);
    value^=value+Math.imul(value^value>>>7,value|61);
    return ((value^value>>>14)>>>0)/4294967296;
  };
}

// Randomly permuted strata reduce streak variance. Every cell is visited once
// per block; independent draws are mixed in to retain match-to-match variation.
// Channels depend on seed and action, never on who is winning or team strength.
export function matchOutcomeRoll(match, channel) {
  if(!isV3(match.parameters))return match.rng();
  const config=match.parameters.v3.sampling;
  const counters=match.outcomeSampleCounters??=Object.create(null);
  const index=Number(counters[channel]??0);counters[channel]=index+1;
  const size=config.bucketSize,cycle=Math.floor(index/size),position=index%size;
  const seed=String(match.simulationSeed??"yffm-v3")+":"+channel;
  const mix=generator(seed+":mix:"+index);
  const regularity=channel.startsWith("goal:")?config.goalRegularity:config.stageRegularity;
  if(mix()>=regularity)return mix();
  const rng=generator(seed+":block:"+cycle);
  const permutation=Array.from({length:size},(_,i)=>i);
  for(let i=size-1;i>0;i--){const j=Math.floor(rng()*(i+1));[permutation[i],permutation[j]]=[permutation[j],permutation[i]];}
  return (permutation[position]+mix())/size;
}
