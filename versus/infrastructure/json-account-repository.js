import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonAccountRepository {
  constructor(filePath, io = fs) { this.filePath = filePath; this.io = io; }

  load() {
    if (!this.filePath) return null;
    try {
      const saved = JSON.parse(this.io.readFileSync(this.filePath, 'utf8'));
      if (!saved || typeof saved.accounts !== 'object' || !saved.accounts || Array.isArray(saved.accounts)
        || Object.values(saved.accounts).some(a => !a || typeof a.key !== 'string' || !a.key || typeof a.id !== 'string' || typeof a.token !== 'string')
        || new Set(Object.values(saved.accounts).map(a => a.key)).size !== Object.keys(saved.accounts).length
        || (saved.lineups != null && (typeof saved.lineups !== 'object' || Array.isArray(saved.lineups)))) {
        throw new Error('Invalid account save schema');
      }
      return saved;
    } catch (cause) {
      if (cause.code === 'ENOENT') return null;
      throw new Error('账号存档读取失败，已停止加载以保护原文件；请检查文件权限或恢复备份', { cause });
    }
  }

  save(state) {
    const serialized = JSON.stringify(state);
    if (!this.filePath) return serialized;
    const io = this.io;
    io.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = io.openSync(temporary, 'wx');
      io.writeFileSync(descriptor, serialized, 'utf8');
      io.fsyncSync(descriptor);
      io.closeSync(descriptor);
      descriptor = undefined;
      io.renameSync(temporary, this.filePath);
    } finally {
      if (descriptor !== undefined) io.closeSync(descriptor);
      if (io.existsSync(temporary)) io.unlinkSync(temporary);
    }
    return serialized;
  }
}
