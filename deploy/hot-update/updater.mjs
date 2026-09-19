import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});
export function safeFile(root,relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\')||path.posix.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe relative path: '+relative);
 let p=path.resolve(root);for(const part of relative.split('/')){p=path.join(p,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Symlink is not supported: '+p);}return p;
}
function files(root){const result=[];function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Backup contains symlink: '+p);if(entry.isDirectory())visit(p);else if(entry.isFile()){const s=fs.statSync(p);result.push({path:path.relative(root,p).split(path.sep).join('/'),sha256:hash(p),mode:s.mode&0o777,uid:s.uid,gid:s.gid});}else throw Error('Unsupported data file: '+p);}}visit(root);return result;}
function copy(source,target,meta){fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});fs.copyFileSync(source,target);fs.chmodSync(target,meta?.mode??0o644);if(process.platform!=='win32'&&meta)fs.chownSync(target,meta.uid,meta.gid);}
export function verifyBundle(bundle){const m=read(path.join(bundle,'MANIFEST.json'));if(m.kind!=='rougelite-hot-update'||!m.files?.length)throw Error('Invalid hot update manifest');
 const seen=new Set();for(const f of m.files){if(seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid manifest entry');seen.add(f.path);
 if(/^(data|seed|outputs|handoff)\//.test(f.path)||f.path.startsWith('assets/player-profiles/')||/^assets\/data\/s4-/.test(f.path)||f.path.split('/').some(x=>x.startsWith('.')))throw Error('Protected path in payload: '+f.path);
 if(hash(safeFile(path.join(bundle,'payload'),f.path))!==f.sha256)throw Error('Payload checksum mismatch: '+f.path);
 }return m;
}
export function preflight({bundle,app,data}){const manifest=verifyBundle(bundle);
 for(const root of [app,data])if(!fs.statSync(root).isDirectory()||fs.realpathSync(root)!==path.resolve(root))throw Error('Invalid or linked target directory: '+root);
 if(path.resolve(app)===path.parse(path.resolve(app)).root||path.resolve(data)===path.parse(path.resolve(data)).root)throw Error('Root directory is forbidden');
 if(!fs.existsSync(path.join(app,'server.mjs'))||!fs.existsSync(path.join(data,'campaign-accounts.json')))throw Error('Existing game installation/save is required');
 for(const item of manifest.files)safeFile(app,item.path);
 // Incremental bundles require their exact base, while permitting an idempotent reapply.
 const replacements=new Map(manifest.files.map(f=>[f.path,f.sha256]));
 for(const item of manifest.requiredBaseFiles??[]){
  const target=safeFile(app,item.path);
  if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw Error('Incremental baseline missing: '+item.path+'; install '+manifest.baseline+' first');
  const installed=hash(target);
  if(installed!==item.sha256&&installed!==replacements.get(item.path))throw Error('Incremental baseline mismatch: '+item.path+'; install '+manifest.baseline+' first');
 }
 const lock=read(path.join(app,'package-lock.json'));for(const d of manifest.dependencies){if(lock.packages[d.path]?.version!==d.version||read(safeFile(app,d.path+'/package.json')).version!==d.version)throw Error('Runtime dependency mismatch: '+d.path);}
 read(path.join(data,'campaign-accounts.json'));return manifest;
}
function loadBackup(backup,app,data){const m=read(path.join(backup,'BACKUP.json'));if(m.app!==path.resolve(app)||m.data!==path.resolve(data)||m.ready!==true)throw Error('Backup belongs to a different installation or is incomplete');
 for(const f of m.files.filter(x=>x.existed))if(hash(safeFile(path.join(backup,'app'),f.path))!==f.sha256)throw Error('Backup code checksum mismatch: '+f.path);
 for(const f of m.dataFiles)if(hash(safeFile(path.join(backup,'data'),f.path))!==f.sha256)throw Error('Backup data checksum mismatch: '+f.path);return m;
}
function restore(backup,app,data){const m=loadBackup(backup,app,data);
 for(const f of m.files){const target=safeFile(app,f.path);if(f.existed)copy(safeFile(path.join(backup,'app'),f.path),target,f);else if(fs.existsSync(target)){if(!fs.lstatSync(target).isFile())throw Error('New file target changed: '+target);fs.unlinkSync(target);}}
 // Preserve the current save before restoring the matched pre-update snapshot.
 const preserved=data+'.before-rollback-'+Date.now();fs.renameSync(data,preserved);fs.mkdirSync(data,{mode:m.dataMode});
 try{for(const f of m.dataFiles)copy(safeFile(path.join(backup,'data'),f.path),safeFile(data,f.path),f);if(process.platform!=='win32')fs.chownSync(data,m.dataUid,m.dataGid);}catch(e){e.message+='; current data preserved at '+preserved;throw e;}
 return preserved;
}
export async function applyUpdate(options){const {bundle,app,data,backupRoot,stop,start,health,log=console.log}=options,manifest=preflight(options);
 fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});const lock=path.join(backupRoot,'.hot-update-lock');fs.mkdirSync(lock,{mode:0o700});
 const backup=path.join(backupRoot,manifest.version+'-'+Date.now()),record={version:manifest.version,app:path.resolve(app),data:path.resolve(data),files:[],dataFiles:[],ready:false};let stopped=false,changed=false;
 try{
  stopped=true;await stop();fs.mkdirSync(backup,{mode:0o700});const ds=fs.statSync(data);Object.assign(record,{dataMode:ds.mode&0o777,dataUid:ds.uid,dataGid:ds.gid,dataFiles:files(data)});
  for(const f of record.dataFiles)copy(safeFile(data,f.path),safeFile(path.join(backup,'data'),f.path),{...f,mode:0o600});
  for(const f of manifest.files){const target=safeFile(app,f.path),existed=fs.existsSync(target);if(existed&&!fs.statSync(target).isFile())throw Error('File target is not a file: '+target);const stat=fs.statSync(existed?target:f.path.startsWith('assets/')?path.join(app,'assets'):app),entry={path:f.path,existed,mode:existed?stat.mode&0o777:0o644,uid:stat.uid,gid:stat.gid};if(existed){entry.sha256=hash(target);copy(target,safeFile(path.join(backup,'app'),f.path),entry);}record.files.push(entry);}
  record.ready=true;write(path.join(backup,'BACKUP.json'),record);log('Backup: '+backup);changed=true;
  for(const [i,f]of manifest.files.entries())copy(safeFile(path.join(bundle,'payload'),f.path),safeFile(app,f.path),record.files[i]);
  for(const f of manifest.files)if(hash(safeFile(app,f.path))!==f.sha256)throw Error('Installed checksum mismatch: '+f.path);
  await start();if(!await health())throw Error('New version health check failed');
  write(path.join(backup,'RESULT.json'),{status:'installed',version:manifest.version,at:new Date().toISOString()});log('Installed: '+manifest.version);return {backup,version:manifest.version};
 }catch(error){if(changed){try{await stop();const preserved=restore(backup,app,data);await start();if(!await health())throw Error('Old version health check failed');log('Automatically rolled back. Failed-version data: '+preserved);error.message+='; automatically rolled back';}catch(recovery){error.message+='; rollback needs attention: '+recovery.message;}}
  else if(stopped){try{await start();}catch(restart){error.message+='; could not restart original service: '+restart.message;}}throw error;
 }finally{fs.rmdirSync(lock);}
}
export async function rollbackUpdate({backup,app,data,backupRoot,stop,start,health,log=console.log}){
 if(!path.resolve(backup).startsWith(path.resolve(backupRoot)+path.sep))throw Error('Backup must be inside configured backup directory');loadBackup(backup,app,data);
 const lock=path.join(backupRoot,'.hot-update-lock');fs.mkdirSync(lock,{mode:0o700});try{await stop();const preserved=restore(backup,app,data);await start();if(!await health())throw Error('Rollback health check failed');log('Rollback complete; newer data preserved at '+preserved);return {preserved};}finally{fs.rmdirSync(lock);}
}
