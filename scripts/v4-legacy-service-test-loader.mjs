import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
// Test-only substitution at the original module URL, so every other dependency
// is identical. Never writes or replaces the working service file.
export async function load(url,context,nextLoad){
  if(process.env.V4_LEGACY_SERVICE_TEST==='1'&&url===pathToFileURL(path.resolve('versus/league-service.js')).href){
    for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH'])if(!process.env[key]?.startsWith(process.env.V4_LEGACY_TEST_ROOT+path.sep))throw new Error('Legacy comparison requires isolated data paths');
    const source=fs.readFileSync('outputs/v4-host-hardened-20261118/source/versus/league-service.js');
    if(createHash('sha256').update(source).digest('hex')!=='5c22309cad1787835209510b78afa95cd94c22c5f46699fd07d17cebd46adea7')throw new Error('Unexpected frozen service baseline');
    return {format:'module',source:source.toString('utf8'),shortCircuit:true};
  }
  return nextLoad(url,context);
}
