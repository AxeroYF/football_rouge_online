import fs from 'node:fs';
import path from 'node:path';
import { convertS4Accounts } from '../shared/account-import/s4-accounts.mjs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('用法: node scripts/import-s4-accounts.mjs SOURCE.json NEW-campaign-accounts.json');
const result = convertS4Accounts(JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, '')));
fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ importedAccounts: Object.keys(result.accounts).length, sourceSessionsImported: false, campaignProgress: 'new' }));
