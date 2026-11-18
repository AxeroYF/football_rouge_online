import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function dependencyHashes(entries,workspace=process.cwd()){
  const seen=new Map(),root=path.resolve(workspace);
  const visit=file=>{
    const absolute=path.resolve(file),relative=path.relative(root,absolute).replaceAll('\\','/');
    if(relative.startsWith('../')||path.isAbsolute(relative))throw new Error('Source dependency escapes workspace');
    if(seen.has(relative))return;
    const bytes=fs.readFileSync(absolute);seen.set(relative,createHash('sha256').update(bytes).digest('hex'));
    const source=bytes.toString('utf8');
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*|\bimport\s*\()(['"])(\.[^'"\r\n]+)\1/g)){
      const target=path.resolve(path.dirname(absolute),match[2]);if(fs.existsSync(target)&&fs.statSync(target).isFile())visit(target);
    }
  };
  entries.forEach(visit);return Object.fromEntries([...seen].sort(([a],[b])=>a.localeCompare(b)));
}
