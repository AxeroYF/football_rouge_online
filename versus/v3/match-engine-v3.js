import {createV2Match,advanceV2Match} from "../v2/match-engine-v2.js";
import {V3_MATCH_PARAMETERS} from "./match-parameters-v3.js";
import {isV32} from "./model-config.js";

export function createV3Match(teams,options={}) {
  return createV2Match(teams,{...options,parameters:options.parameters??V3_MATCH_PARAMETERS});
}
export function simulateV3Match(teams,options={}) {
  const match=createV3Match(teams,options);
  advanceV2Match(match,isV32(match.parameters)?Infinity:match.possessionChainCount,options);
  return match;
}
