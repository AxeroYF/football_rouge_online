import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {openCanonicalLocalStorageSettlement} from '../versus/v4-host/canonical-storage-settlement.js';
import {runShadowJob} from '../versus/v4-host/shadow-job.js';
import {createEngineBundle} from '../versus/v4-rollout/bundle.js';
import {dependencyHashes} from '../scripts/v4-source-hashes.mjs';
import {VERSION} from '../versus/v4/world.js';

export async function retentionFixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'v4-replay-retention-')),bundleDirectory=path.join(root,'engine');
  await fs.writeFile(path.join(root,'v4-local-storage.json'),JSON.stringify({format:'yffm-v4-canonical-local-settlement-1'}));
  const bundle=await createEngineBundle(bundleDirectory,{sourceRoot:process.cwd(),engineVersion:VERSION,files:dependencyHashes(['versus/v4/engine.js'])});
  let time=1794934800000;const now=()=>time,createService=options=>new YellowDogsLeagueService(options),sourceCatalog={catalog:REAL_PLAYERS,traitCatalog:[],bondCatalog:S4_BOND_CATALOG};
  const service=createService({statePath:path.join(root,'league.json'),backupDir:null,now,rng:()=>.5});service.save({skipDailyBackup:true});
  const bridge=await openCanonicalLocalStorageSettlement({root,service,createService,sourceCatalog,now});
  const request={seasonId:service.state.season.id,roundNumber:1,duration:60,enginePin:{engineVersion:VERSION,sourceDigest:bundle.sourceDigest}},round=await bridge.beginRound(request),jobs=[];
  await fs.mkdir(path.join(root,'league-queue-'+round.key,'jobs'),{recursive:true});
  for(const task of round.tasks){const directory=path.join(root,'league-queue-'+round.key,'jobs',task.fixture.id);await runShadowJob({directory,bundleDirectory,sourceDigest:bundle.sourceDigest,envelope:task.envelope});jobs.push(directory);}
  time+=3600000;for(const [index,task] of round.tasks.entries())await bridge.settleJob(jobs[index],task.context);await bridge.finishRound(request);time+=3*86400000;
  return {root,bridge,round,jobs,now,advance(ms){time+=ms;},readLeague:async()=>(await bridge.read()).state.league};
}
