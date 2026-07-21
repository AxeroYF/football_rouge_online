import { simulateMatch, simulateMany } from "./model.js";
import { makeExampleTeams } from "./teams.js";

function argument(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const matches = Number(argument("matches", "10000"));
const seed = argument("seed", "demo");
const { home, away } = makeExampleTeams();

const sample = simulateMatch(home, away, { seed, recordEvents: true });
const batch = simulateMany(home, away, { matches, seed });

console.log("\n单场样例");
console.log(sample.homeTeam + " " + sample.score.home + "-" + sample.score.away + " " + sample.awayTeam);
console.table(sample.stats);
console.table(sample.events.filter((event) => ["goal", "redCard", "injury"].includes(event.type)));

console.log("\n蒙特卡洛：" + matches.toLocaleString("zh-CN") + " 场");
console.table(batch.probabilities);
console.table(batch.averages);
console.table(batch.commonScorelines);
