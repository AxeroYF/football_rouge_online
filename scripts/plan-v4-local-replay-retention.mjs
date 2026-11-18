import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {LeagueShardStore,unwrapTracked} from '../versus/league-shard-store.js';
import {openLocalReplayRetention} from '../versus/v4-host/local-replay-retention.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

// Explicit dry run: there is deliberately no execute/delete command-line flag.
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const match=/^--(root|storage|at)=(.+)$/.exec(arg);if(!match)throw new Error('只接受 --root=标记副本 --storage=json|shards [--at=ISO时间]');return match.slice(1);}));
assert.ok(args.root&&['json','shards'].includes(args.storage));const root=fs.realpathSync(args.root),at=args.at?Date.parse(args.at):Date.now();assert.ok(Number.isSafeInteger(at)&&at>=0);
const statePath=path.join(root,args.storage==='shards'?'league-shards':'league.json');assert.equal(fs.realpathSync(statePath),statePath);
const sourceHashes=dependencyHashes(['scripts/plan-v4-local-replay-retention.mjs']);verifyV4ProtectedFiles();
const readLeague=async()=>args.storage==='shards'?unwrapTracked(new LeagueShardStore(statePath,{backupDir:null}).load()):JSON.parse(fs.readFileSync(statePath,'utf8'));
const manager=await openLocalReplayRetention({root,readLeague,now:()=>at});
try{
  const plan=await manager.plan(),output=path.resolve('outputs/v4-replay-retention-20261118');fs.mkdirSync(output,{recursive:true});
  const report={root,storage:args.storage,at,simulatedClock:Boolean(args.at),plan,scope:'dry-run-only',filesDeleted:0,productionEnabled:false,dependencyHashes:sourceHashes,preservation:verifyV4ProtectedFiles()};
  const file=path.join(output,`plan-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({file,matches:plan.kept+plan.expire.length,payloadBytes:plan.totalBytes,expireCandidates:plan.expire.length,protected:plan.protected.length,filesDeleted:0}));
}finally{await manager.close();}
