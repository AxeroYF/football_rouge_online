// Read-only: resolves current/backup references and counts bytes. Never writes or deletes save data.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const INDEX_NAME = /(?:^|\d+-)(?:matches|archives|season-final)-index\.json$/;
const DAILY_BACKUP = /^\d{4}-\d{2}-\d{2}\.manifest\.json$/;
const JSON_LIMIT = 64 * 1024 * 1024;
const within = (root, file) => file === root || file.startsWith(root + path.sep);

export function auditLeagueStorage(input, options = {}) {
  const root = fs.realpathSync(path.resolve(input));
  const backupDirectory = path.resolve(options.backupDirectory ?? path.join(root, 'yellowdogs-league-backups'));
  const warnings = [];
  const readJson = file => {
    if (fs.statSync(file).size > JSON_LIMIT) throw new Error('JSON exceeds 64 MiB audit limit: ' + path.basename(file));
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  function graph(manifest) {
    const references = new Set(), indexes = [];
    function collect(value) {
      if (typeof value === 'string' && value.startsWith('revisions/')) {
        const file = path.resolve(root,value);
        if (!within(root,file)) throw new Error('Reference escapes shard directory');
        if (references.has(value)) return;
        references.add(value);
        if (INDEX_NAME.test(path.basename(value))) indexes.push({file,match:!/-?archives-index\.json$/.test(file)});
      } else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    const {archives,...otherShards}=manifest.shards;
    collect(otherShards);collect(archives?.index);for(const entry of archives?.entries??[])collect(entry.path);
    while (indexes.length) {const {file,match}=indexes.pop();for(const entry of readJson(file).entries??[])collect(match?entry.reportPath:entry.path);}
    return references;
  }
  const manifest = readJson(path.join(root,'manifest.json'));
  const current = graph(manifest), protectedReferences = new Set(current);
  let backupCount = 0, specialBackupCount = 0, invalidBackups = 0;
  if (fs.existsSync(backupDirectory)) for (const name of fs.readdirSync(backupDirectory)) {
    if (!name.endsWith('.manifest.json')) continue;
    backupCount++; if (!DAILY_BACKUP.test(name)) specialBackupCount++;
    try { for (const reference of graph(readJson(path.join(backupDirectory,name)))) protectedReferences.add(reference); }
    catch(error) { invalidBackups++; warnings.push('Backup graph could not be read: '+name+': '+error.message); }
  }
  const protectedRevisions = new Set([...protectedReferences].map(ref=>ref.split('/')[1]));
  const revisionsRoot = path.join(root,'revisions');
  const revisions = fs.existsSync(revisionsRoot) ? fs.readdirSync(revisionsRoot).filter(name=>/^\d+$/.test(name)).sort((a,b)=>Number(a)-Number(b)) : [];
  const grace = new Set(revisions.slice(-2));
  const totals = {files:0,logicalBytes:0,allocatedFileBytes:0,currentReferencedBytes:0,backupOnlyReferencedBytes:0,unreferencedInProtectedRevisionBytes:0,unprotectedRevisionBytes:0,recentGraceOnlyBytes:0,otherBytes:0,liveCheckpointBytes:0,temporaryRevisionBytes:0};
  const groups = {}, largest = [], found = new Set(); let allocatedKnown = true;
  function* files(directory) {
    for(const item of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,item.name);
      if(item.isSymbolicLink()){warnings.push('Skipped symbolic link: '+path.relative(root,file));continue;}
      if(item.isDirectory()) yield* files(file);
      else if(item.isFile()) yield file;
    }
  }
  for(const file of files(root)) {
    const relative=path.relative(root,file).split(path.sep).join('/'), stat=fs.statSync(file), size=stat.size;
    totals.files++; totals.logicalBytes+=size;
    if(Number.isFinite(stat.blocks))totals.allocatedFileBytes+=stat.blocks*512;else allocatedKnown=false;
    const revision=relative.startsWith('revisions/')?relative.split('/')[1]:null;
    if(protectedReferences.has(relative))found.add(relative);
    if(current.has(relative))totals.currentReferencedBytes+=size;
    else if(protectedReferences.has(relative))totals.backupOnlyReferencedBytes+=size;
    else if(revision&&protectedRevisions.has(revision))totals.unreferencedInProtectedRevisionBytes+=size;
    else if(revision&&/^\d+$/.test(revision)){totals.unprotectedRevisionBytes+=size;if(grace.has(revision))totals.recentGraceOnlyBytes+=size;}
    else totals.otherBytes+=size;
    if(relative.startsWith('.live/'))totals.liveCheckpointBytes+=size;
    if(revision?.startsWith('.tmp-'))totals.temporaryRevisionBytes+=size;
    const name=path.basename(file).replace(/^\d+-/,'');
    const group=relative.includes('/cards/')?'cards':relative.includes('/reports/')?'match-reports':relative.includes('/archives/')?'archives':name;
    groups[group]??={files:0,bytes:0};groups[group].files++;groups[group].bytes+=size;
    largest.push({file:relative,bytes:size});largest.sort((a,b)=>b.bytes-a.bytes);if(largest.length>12)largest.pop();
  }
  const missingReferences=[...protectedReferences].filter(ref=>!found.has(ref));
  if(!allocatedKnown)totals.allocatedFileBytes=null;
  if(missingReferences.length)warnings.push(missingReferences.length+' referenced files are missing');
  return {generatedAt:new Date().toISOString(),root,revision:manifest.revision,readOnly:true,revisionDirectories:revisions.length,protectedRevisionDirectories:protectedRevisions.size,currentReferences:current.size,backupCount,specialBackupCount,invalidBackups,missingReferences:missingReferences.length,totals,currentReferencedShare:totals.logicalBytes?totals.currentReferencedBytes/totals.logicalBytes:0,largestGroups:Object.entries(groups).map(([group,value])=>({group,...value})).sort((a,b)=>b.bytes-a.bytes).slice(0,16),largestFiles:largest,warnings,notes:['Byte categories are diagnostics, not deletion instructions. Backup references and the latest two revisions are protected.','Take a stopped-service or read-only snapshot for a consistent audit; a live save can change the graph while scanning.','Allocated bytes cover regular files only and exclude directory metadata; df/du remain necessary for the entire disk.']};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if(!process.argv[2]){console.error('Usage: node scripts/audit-league-storage.mjs <shard-directory> [--backup-dir=<directory>]');process.exitCode=2;}
  else {
    const backup=process.argv.find(arg=>arg.startsWith('--backup-dir='))?.slice('--backup-dir='.length);
    try{console.log(JSON.stringify(auditLeagueStorage(process.argv[2],{backupDirectory:backup}),null,2));}
    catch(error){console.error(error.message);process.exitCode=1;}
  }
}
