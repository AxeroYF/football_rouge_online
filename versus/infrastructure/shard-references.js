import {existsSync,readFileSync,readdirSync,realpathSync,rmdirSync,statSync,unlinkSync} from 'node:fs';
import path from 'node:path';

// Compaction prefixes index names with a sequence. Recognize the logical index
// after any number of such prefixes, including data compacted by older releases.
export function shardIndexName(reference) {
  const name = path.basename(reference).replace(/^(?:\d+-)+/, '');
  return ['matches-index.json','archives-index.json','season-final-index.json'].includes(name) ? name : null;
}
function inside(root,file) { return file === root || file.startsWith(root + path.sep); }
function resolve(root,reference) {
  const file = path.resolve(root,reference);
  if(!inside(root,file))throw new Error('Shard reference escapes storage directory');
  return file;
}

export function collectShardReferences(rootPath,manifest) {
  const root=path.resolve(rootPath),realRoot=realpathSync(root),references=new Set(),indexes=[];
  function collect(value) {
    if(typeof value==='string'&&value.startsWith('revisions/')) {
      const file=resolve(root,value);
      if(references.has(file))return;
      if(!existsSync(file))throw new Error('Missing referenced shard: '+value);
      if(!inside(realRoot,realpathSync(file)))throw new Error('Shard reference resolves outside storage directory');
      references.add(file);
      if(shardIndexName(file))indexes.push({file,kind:shardIndexName(file)});
    } else if(Array.isArray(value))value.forEach(collect);
    else if(value&&typeof value==='object')Object.values(value).forEach(collect);
  }
  if(!manifest?.shards?.core)throw new Error('Invalid shard manifest');
  const {archives,...otherShards}=manifest.shards;
  collect(otherShards);
  collect(archives?.index);
  for(const entry of archives?.entries??[])collect(entry.path);
  while(indexes.length){
    const {file,kind}=indexes.pop(),index=JSON.parse(readFileSync(file,'utf8'));
    for(const entry of index.entries??[])collect(kind==='archives-index.json'?entry.path:entry.reportPath);
  }
  return references;
}

// Build and validate the full reference graph BEFORE planning any deletion.
// Only committed revision files and abandoned temporary revisions older than a
// day are eligible. Fresh temporary work is left alone.
export function planShardGarbageCollection(rootPath,manifest,{backupDir=path.join(rootPath,'yellowdogs-league-backups'),maximumFiles=Infinity,now=Date.now()}={}) {
  const root=path.resolve(rootPath),references=collectShardReferences(root,manifest);
  if(backupDir&&existsSync(backupDir))for(const name of readdirSync(backupDir)) {
    if(!name.endsWith('.manifest.json'))continue;
    const backup=JSON.parse(readFileSync(path.join(backupDir,name),'utf8'));
    for(const file of collectShardReferences(root,backup))references.add(file);
  }
  const revisionsRoot=path.join(root,'revisions');
  const revisions=existsSync(revisionsRoot)?readdirSync(revisionsRoot).filter(name=>/^\d+$/.test(name)).sort((a,b)=>Number(a)-Number(b)):[];
  const recent=new Set(revisions.slice(-2)),protectedRevisions=new Set([...references].map(file=>path.relative(revisionsRoot,file).split(path.sep)[0]));
  const files=[],directories=[];let deletableFiles=0,deletableBytes=0,deletableRevisionDirectories=0,deletableTemporaryDirectories=0;
  function visit(directory) {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const file=resolve(root,path.relative(root,path.join(directory,entry.name)));
      if(entry.isSymbolicLink())throw new Error('Refusing shard cleanup with symbolic links');
      if(entry.isDirectory())visit(file);
      else if(entry.isFile()&&!references.has(file)){
        const bytes=statSync(file).size;deletableFiles++;deletableBytes+=bytes;
        if(files.length<maximumFiles)files.push({file,bytes});
      }
    }
    directories.push(directory);
  }
  for(const revision of revisions) {
    if(recent.has(revision))continue;
    const directory=path.join(revisionsRoot,revision);
    if(!inside(realpathSync(root),realpathSync(directory)))throw new Error('Revision resolves outside storage directory');
    visit(directory);
    if(!protectedRevisions.has(revision))deletableRevisionDirectories++;
  }
  if(existsSync(revisionsRoot))for(const entry of readdirSync(revisionsRoot,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^\.tmp-(?:\d+-|compact-)/.test(entry.name))continue;
    const directory=path.join(revisionsRoot,entry.name);
    if(now-statSync(directory).mtimeMs<86_400_000)continue;
    if(!inside(realpathSync(root),realpathSync(directory)))throw new Error('Temporary revision resolves outside storage directory');
    visit(directory);deletableTemporaryDirectories++;
  }
  return {root,revision:Number(manifest.revision),files,directories,deletableFiles,deletableBytes,deletableRevisionDirectories,deletableTemporaryDirectories,protectedRevisionDirectories:new Set([...protectedRevisions,...recent]).size};
}

export function applyShardGarbageCollection(plan) {
  const current=JSON.parse(readFileSync(path.join(plan.root,'manifest.json'),'utf8'));
  if(Number(current.revision)!==plan.revision)throw new Error('Shard manifest changed during cleanup; retry on a stable revision');
  let deletedFiles=0,deletedBytes=0;
  for(const {file,bytes} of plan.files){
    if(!inside(plan.root,file)||!inside(realpathSync(plan.root),realpathSync(file)))throw new Error('Cleanup target escapes storage directory');
    unlinkSync(file);deletedFiles++;deletedBytes+=bytes;
  }
  for(const directory of plan.directories){
    try{rmdirSync(directory);}catch(error){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(error.code))throw error;}
  }
  return {deletedFiles,deletedBytes,remainingFiles:plan.deletableFiles-deletedFiles};
}
