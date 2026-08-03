import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildS4BalanceSeat } from "../s4-balance-report.js";
import { publicV2Match, simulateV2Match } from "./match-engine-v2.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const argument = (name, fallback = null) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const numeric = (name, fallback) => Number(argument(name, fallback));

const seed = argument("seed", "ydl-v2-cli");
const chains = numeric("chains", 180);
const weather = argument("weather", "sunny");
const referee = argument("referee", "standard");
const output = argument("output");
const teams = [
  buildS4BalanceSeat(seed, "home", argument("home-archetype", "standard")),
  buildS4BalanceSeat(seed, "away", argument("away-archetype", "standard")),
];
const match = simulateV2Match(teams, {
  seed,
  possessionChains:chains,
  weather,
  referee,
  forceBlackWhistle:process.argv.includes("--force-black-whistle"),
});
const report = publicV2Match(match);
if (output) await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output:output ? path.resolve(output) : null, score:report.score, finished:report.finished, abandoned:report.abandoned, eventCount:report.events.length, eventTypes:[...new Set(report.events.map((event) => event.type))], commentary:report.commentary.slice(-8) }, null, 2));
