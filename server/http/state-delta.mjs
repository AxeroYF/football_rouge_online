import {createHash} from 'node:crypto';
// Stateless versions: no per-player copies of the world retained on the server.
export function stateDelta(state,header) {
 let previous={};try{const parsed=JSON.parse(String(header??'{}'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))previous=parsed;}catch{}
 const versions={},patch={};
 for(const [key,value] of Object.entries(state)){
  const json=JSON.stringify(value);if(json===undefined)continue;
  const version=createHash('sha256').update(json).digest('base64url').slice(0,16);
  versions[key]=version;if(previous[key]!==version)patch[key]=value;
 }
 return {statePatch:patch,stateVersions:versions};
}
