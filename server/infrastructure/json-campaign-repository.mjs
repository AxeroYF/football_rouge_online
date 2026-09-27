import {writeChunkedJson} from './chunked-json.mjs';
import {performance} from 'node:perf_hooks';
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CAMPAIGN_SAVE_VERSION = 4;

export class JsonCampaignRepository {
  constructor({ dataPath = null } = {}) {
    this.dataPath = dataPath;
  }

  load() {
    if (!this.dataPath || !fs.existsSync(this.dataPath)) return null;
    try {
      const saved=JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
      this.loadedMapVersion=saved.world?.mapVersion??null;
      return saved;
    } catch (error) {
      throw new Error('账号存档读取失败；已停止加载以避免覆盖，请检查备份与文件权限', { cause: error });
    }
  }

  save({ accounts, world, version = CAMPAIGN_SAVE_VERSION }) {
    if (!this.dataPath) return;
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    if(world?.mapVersion&&world.mapVersion!==this.loadedMapVersion&&fs.existsSync(this.dataPath)){
      const backup=this.dataPath+".pre-"+world.mapVersion.replace(/[^a-zA-Z0-9_-]/g,"")+".bak";
      if(!fs.existsSync(backup))fs.copyFileSync(this.dataPath,backup,fs.constants.COPYFILE_EXCL);
    }
    const temporaryPath = `${this.dataPath}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    const started=performance.now();
    try {
      descriptor = fs.openSync(temporaryPath, "wx");
      // Compact JSON reduces synchronous serialization and disk work; atomic fsync/rename stays unchanged.
      const bytes=writeChunkedJson({ version, accounts, world },chunk=>fs.writeFileSync(descriptor,chunk));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.dataPath);
      this.loadedMapVersion=world?.mapVersion??null;
      this.lastSave={count:(this.lastSave?.count??0)+1,totalBytes:(this.lastSave?.totalBytes??0)+bytes,bytes,durationMs:Math.round((performance.now()-started)*100)/100,at:Date.now()};
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }
}
