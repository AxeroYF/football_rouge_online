import {createStreamPlayback} from '../v4-stream/playback.js';

// Reuse the existing login's player ID and device token. Neither the caller nor
// the browser supplies ownerSide; the canonical host determines it per request.
export function createAccountPlayback({playerId,accountToken,fetcher=fetch,...options}){
  if(typeof playerId!=='string'||!playerId||typeof accountToken!=='string'||!accountToken)throw new Error('需要现有账号登录凭证');
  return createStreamPlayback({lookAheadSeconds:60,...options,token:accountToken,fetcher:(url,init)=>fetcher(url,{...init,headers:{...init.headers,'X-Player-Id':encodeURIComponent(playerId)}})});
}
