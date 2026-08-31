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
      return JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
    } catch {
      return null;
    }
  }

  save({ accounts, world, version = CAMPAIGN_SAVE_VERSION }) {
    if (!this.dataPath) return;
    fs.mkdirSync(path.dirname(this.dataPath), { recursive: true });
    fs.writeFileSync(this.dataPath, JSON.stringify({ version, accounts, world }, null, 2));
  }
}
