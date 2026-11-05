// Offline conversion only. Analysis is the default; no report or event is discarded.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {LeagueShardStore,unwrapTracked} from '../versus/league-shard-store.js';
import {collectShardReferences} from '../versus/infrastructure/shard-references.js';
import {auditLeagueStorage} from '../scripts/audit-league-storage.mjs';

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(unwrapTracked(value)))).digest('hex');
function contentDigests(store,state) {
  // Stream logical records into hashes, rather than expanding all reports at once.
  const {matches,seasonFinalTournament,archives,...rest}=state;
  const finals=seasonFinalTournament?{...seasonFinalTournament,matches:undefined}:null;
  return {rest:digest(rest),finals:digest(finals),matches:(matches??[]).map(digest),finalMatches:(seasonFinalTournament?.matches??[]).map(digest),archives:(archives??[]).map(a=>digest(store.readFullArchive(a)??a))};
}

export function optimizeLeagueStorage(input,{apply=false,offline=false,expectedRevision,backupDir,service='football-s4'}={}) {
  const root=fs.realpathSync(path.resolve(input));
  const directory=backupDir===undefined?path.join(root,'yellowdogs-league-backups'):backupDir;
  const head=path.join(root,'manifest.json'),original=fs.readFileSync(head,'utf8'),manifest=JSON.parse(original);
  collectShardReferences(root,manifest);
  const before=auditLeagueStorage(root,{backupDirectory:directory??path.join(root,'yellowdogs-league-backups')});
  if(!apply)return{status:'dry-run',schemaVersion:manifest.schemaVersion,revision:manifest.revision,before};
  if(!offline)throw new Error('Apply requires --offline and a stopped game server');
  if(!Number.isInteger(expectedRevision)||expectedRevision!==manifest.revision)throw new Error('Apply requires the unchanged --expected-revision=N');
  if(!directory)throw new Error('Apply requires a backup directory');
  if(process.platform==='linux'&&spawnSync('systemctl',['is-active','--quiet',service],{stdio:'ignore'}).status===0)throw new Error('Stop the game service before converting storage');
  const lock=path.join(root,'.storage-maintenance.lock'),descriptor=fs.openSync(lock,'wx');
  let rollback;
  try {
    const store=new LeagueShardStore(root,{backupDir:directory});
    // Reject automatic fallback: migration must start from the exact reviewed head.
    const state=store.loadManifest(manifest);store.manifest=manifest;
    const expected=contentDigests(store,state);
    if(fs.readFileSync(head,'utf8')!==original)throw new Error('Manifest changed during verification; conversion cancelled');
    fs.mkdirSync(directory,{recursive:true});rollback=path.join(directory,`before-storage-v2-${manifest.revision}-${Date.now()}.manifest.json`);
    store.backupSnapshot(rollback);
    // Keep both formats available until post-write verification completes.
    store.lastCleanupAt=Date.now();
    store.save(state,{forceFull:true});
    const verified=new LeagueShardStore(root,{backupDir:directory}),reloaded=verified.loadManifest(store.manifest);
    collectShardReferences(root,store.manifest);
    if(JSON.stringify(contentDigests(verified,reloaded))!==JSON.stringify(expected))throw new Error('Logical record validation failed; use the preserved rollback manifest');
    return{status:'converted',previousRevision:manifest.revision,revision:store.manifest.revision,schemaVersion:store.manifest.schemaVersion,rollback,before,after:auditLeagueStorage(root,{backupDirectory:directory}),verified:true};
  } finally {fs.closeSync(descriptor);fs.unlinkSync(lock);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2),input=args.shift();
    if(!input)throw new Error('Usage: node devtool/optimize-league-storage.js ROOT [--apply --offline --expected-revision=N] [--backup-dir=PATH] [--service=NAME]');
    const option=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
    console.log(JSON.stringify(optimizeLeagueStorage(input,{apply:args.includes('--apply'),offline:args.includes('--offline'),expectedRevision:option('expected-revision')===undefined?undefined:Number(option('expected-revision')),backupDir:option('backup-dir'),service:option('service')}),null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
