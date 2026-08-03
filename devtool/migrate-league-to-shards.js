import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LeagueShardStore } from "../versus/league-shard-store.js";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error("用法：node devtool/migrate-league-to-shards.js <league.json> <shard-directory>");
  process.exit(2);
}

const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
if (existsSync(outputPath) && readdirSync(outputPath).length) {
  console.error(`目标目录不为空，为避免覆盖数据而停止：${outputPath}`);
  process.exit(2);
}
const source = JSON.parse(readFileSync(inputPath, "utf8"));
const store = new LeagueShardStore(outputPath);
store.save(source, { forceFull:true });
const restored = store.load();

function ids(value, selector = (entry) => entry?.id) {
  return (value ?? []).map(selector).filter(Boolean).map(String).sort();
}

function sameIds(left, right) {
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}

const sourceCards = Object.values(source.s4Assets?.cards ?? {});
const restoredCards = Object.values(restored.s4Assets?.cards ?? {});
const sourceTransactions = source.s4Assets?.transactions ?? [];
const restoredTransactions = restored.s4Assets?.transactions ?? [];
const checks = {
  version:restored.version === source.version,
  teams:restored.teams?.length === source.teams?.length,
  rounds:restored.rounds?.length === source.rounds?.length,
  matches:restored.matches?.length === source.matches?.length && sameIds(restored.matches, source.matches),
  ledger:restored.ledger?.length === source.ledger?.length && sameIds(restored.ledger, source.ledger),
  cards:restoredCards.length === sourceCards.length && sameIds(restoredCards, sourceCards),
  assetTransactions:restoredTransactions.length === sourceTransactions.length && sameIds(restoredTransactions, sourceTransactions),
  archives:restored.archives?.length === source.archives?.length,
  activeCards:Object.values(restored.s4Assets?.cards ?? {}).filter((card) => card.status === "active").length
    === Object.values(source.s4Assets?.cards ?? {}).filter((card) => card.status === "active").length,
  listings:restored.listings?.length === source.listings?.length,
};
const report = {
  input:inputPath,
  inputBytes:statSync(inputPath).size,
  output:outputPath,
  manifest:store.manifest,
  counts:{
    teams:restored.teams?.length ?? 0,
    rounds:restored.rounds?.length ?? 0,
    matches:restored.matches?.length ?? 0,
    ledger:restored.ledger?.length ?? 0,
    cards:restoredCards.length,
    activeCards:restoredCards.filter((card) => card.status === "active").length,
    assetTransactions:restoredTransactions.length,
    archives:restored.archives?.length ?? 0,
    listings:restored.listings?.length ?? 0,
  },
  checks,
  ok:Object.values(checks).every(Boolean),
};
writeFileSync(path.join(outputPath, "migration-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output:report.output, counts:report.counts, checks:report.checks, ok:report.ok }, null, 2));
if (!report.ok) process.exitCode = 1;
