import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolveAdminPassword} from './src/runtime-config.js';

const envFile = fileURLToPath(new URL('.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.argv.includes('--v4-schedule')) process.env.YDL_V4_SCHEDULE = '1';
process.env.VERSUS_PUBLIC_ONLY ??= '1';
process.env.APP_ENV ??= 'development';
resolveAdminPassword();
await import('./devtool/server.js');
