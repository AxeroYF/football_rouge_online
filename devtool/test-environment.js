import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(here, "../data/s4-test");

mkdirSync(dataDirectory, { recursive:true });

process.env.APP_ENV ??= "test";
process.env.YDL_MATCH_ENGINE ??= "v2";
process.env.APP_LABEL ??= "S4 测试服";
process.env.VERSUS_HOST ??= "127.0.0.1";
process.env.DEVTOOL_PORT ??= "4328";
process.env.VERSUS_PUBLIC_ONLY = "1";
process.env.VERSUS_ACCOUNTS_PATH ??= path.join(dataDirectory, "versus-accounts.json");
process.env.YELLOWDOGS_LEAGUE_PATH ??= path.join(dataDirectory, "yellowdogs-league.json");
