import {mkdir, copyFile, rename, open, rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function createQueuedJsonWriter(filePath, backupPath = null) {
  let tail = Promise.resolve();
  return {
    write(value) {
      // Capture each command before another command changes the shared object.
      const snapshot = JSON.stringify(value, null, 2) + '\n';
      const pending = tail.then(async () => {
        await mkdir(path.dirname(filePath), {recursive:true});
        const temporary = `${filePath}.${randomUUID()}.tmp`;
        const backupTemporary = backupPath ? `${backupPath}.${randomUUID()}.tmp` : null;
        try {
          if (backupPath) {
            try { await copyFile(filePath, backupTemporary); await rename(backupTemporary, backupPath); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          const descriptor = await open(temporary, 'wx');
          try { await descriptor.writeFile(snapshot, 'utf8'); await descriptor.sync(); }
          finally { await descriptor.close(); }
          await rename(temporary, filePath);
        } finally {
          await rm(temporary, {force:true});
          if (backupTemporary) await rm(backupTemporary, {force:true});
        }
      });
      tail = pending.catch(() => {});
      return pending;
    },
    flush() { return tail; },
  };
}
