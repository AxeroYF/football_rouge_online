import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_PLAYERS } from "./player-pool.js";
import { drawUniqueMixedPlayers } from "./rules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const configArgument = process.argv.find((argument) => argument.startsWith("--config="));
const configPath = configArgument
  ? path.resolve(here, configArgument.slice("--config=".length))
  : path.join(here, "economy-simulation-config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));

function hash(value) {
  let state = 2166136261;
  for (const character of String(value)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function createRng(seed) {
  let state = hash(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function referencePrice(player) {
  const base = { S:9000, A:4500, B:1800, C:800 }[player.grade] ?? 800;
  return Math.ceil((base + Math.max(0, player.overall - 75) * 120) / 100) * 100;
}

function drawPack(tier, rng) {
  const guaranteedCandidates = tier.guaranteeGrades.length
    ? REAL_PLAYERS.filter((player) => tier.guaranteeGrades.includes(player.grade))
    : [];
  const guaranteed = guaranteedCandidates.length
    ? guaranteedCandidates[Math.floor(rng() * guaranteedCandidates.length)]
    : null;
  return drawUniqueMixedPlayers([], rng, config.choiceCount, guaranteed ? [guaranteed] : []);
}

function disposalOption(player, strategy, rng, sampleSale) {
  const reference = referencePrice(player);
  const release = Math.floor(reference * config.economy.releaseRate);
  if (strategy.type === "release") return { expected:release, proceeds:release, sold:false };
  const listingRate = Math.max(config.economy.minimumListingRate, strategy.listingRate);
  const listing = Math.ceil(reference * listingRate);
  const sellThrough = strategy.sellThroughByGrade[player.grade] ?? 0;
  const saleProceeds = Math.floor(listing * (1 - config.economy.marketFeeRate));
  const expected = sellThrough * saleProceeds + (1 - sellThrough) * release;
  const sold = sampleSale && rng() < sellThrough;
  return { expected, proceeds:sold ? saleProceeds : release, sold };
}

function executeStrategy(players, strategy, rng, sampleSale = true) {
  const ranked = players.map((player) => ({ player, option:disposalOption(player, strategy, rng, false) }))
    .sort((left, right) => right.option.expected - left.option.expected || referencePrice(right.player) - referencePrice(left.player));
  const selected = ranked[0].player;
  return { selected, ...disposalOption(selected, strategy, rng, sampleSale) };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function gradeCounter() {
  return { S:0, A:0, B:0, C:0 };
}

function percentage(value, total) {
  return Number((value * 100 / Math.max(1, total)).toFixed(4));
}

function simulateTier(tier) {
  const rng = createRng(`${config.seed}:${tier.id}:packs`);
  const choiceGrades = gradeCounter();
  const packsContaining = gradeCounter();
  const highestValueSelections = gradeCounter();
  const strategyRuns = Object.fromEntries(config.strategies.map((strategy) => [strategy.id, { nets:[], profitable:0, breakEven:0, sold:0 }]));
  for (let index = 0; index < config.iterationsPerTier; index += 1) {
    const choices = drawPack(tier, rng);
    for (const grade of Object.keys(choiceGrades)) {
      choiceGrades[grade] += choices.filter((player) => player.grade === grade).length;
      if (choices.some((player) => player.grade === grade)) packsContaining[grade] += 1;
    }
    const highest = choices.slice().sort((left, right) => referencePrice(right) - referencePrice(left))[0];
    highestValueSelections[highest.grade] += 1;
    for (const strategy of config.strategies) {
      const result = executeStrategy(choices, strategy, rng);
      const net = result.proceeds - tier.price;
      const run = strategyRuns[strategy.id];
      run.nets.push(net);
      if (net > 0) run.profitable += 1;
      if (net >= 0) run.breakEven += 1;
      if (result.sold) run.sold += 1;
    }
  }
  const strategies = Object.fromEntries(Object.entries(strategyRuns).map(([id, run]) => {
    run.nets.sort((left, right) => left - right);
    const average = run.nets.reduce((sum, value) => sum + value, 0) / run.nets.length;
    return [id, {
      averageNetCoins:Number(average.toFixed(2)),
      profitablePackRatePercent:percentage(run.profitable, run.nets.length),
      breakEvenPackRatePercent:percentage(run.breakEven, run.nets.length),
      marketSaleRatePercent:percentage(run.sold, run.nets.length),
      netCoinsPercentiles:{ p05:percentile(run.nets, .05), p50:percentile(run.nets, .5), p95:percentile(run.nets, .95) },
    }];
  }));
  return {
    tier:{ id:tier.id, price:tier.price, guaranteeGrades:tier.guaranteeGrades },
    choiceCardGradeRatePercent:Object.fromEntries(Object.entries(choiceGrades).map(([grade, count]) => [grade, percentage(count, config.iterationsPerTier * config.choiceCount)])),
    packContainsGradeRatePercent:Object.fromEntries(Object.entries(packsContaining).map(([grade, count]) => [grade, percentage(count, config.iterationsPerTier)])),
    highestValueSelectionGradeRatePercent:Object.fromEntries(Object.entries(highestValueSelections).map(([grade, count]) => [grade, percentage(count, config.iterationsPerTier)])),
    strategies,
  };
}

function simulateBankroll(tier, strategy) {
  const settings = config.bankrollSimulation;
  const rng = createRng(`${config.seed}:${tier.id}:${strategy.id}:bankroll`);
  const finalBalances = [];
  let grew = 0;
  let exhausted = 0;
  let reachedLimit = 0;
  let totalPacks = 0;
  for (let index = 0; index < settings.playersPerTierAndStrategy; index += 1) {
    let balance = settings.startingCoins;
    let packs = 0;
    while (balance >= tier.price && packs < settings.maximumPacksPerPlayer) {
      const result = executeStrategy(drawPack(tier, rng), strategy, rng);
      balance += result.proceeds - tier.price;
      packs += 1;
    }
    finalBalances.push(balance);
    totalPacks += packs;
    if (balance > settings.startingCoins) grew += 1;
    if (balance < tier.price) exhausted += 1;
    if (packs === settings.maximumPacksPerPlayer) reachedLimit += 1;
  }
  finalBalances.sort((left, right) => left - right);
  return {
    averagePacks:Number((totalPacks / settings.playersPerTierAndStrategy).toFixed(3)),
    bankrollGrowthRatePercent:percentage(grew, settings.playersPerTierAndStrategy),
    unableToBuyAnotherPackRatePercent:percentage(exhausted, settings.playersPerTierAndStrategy),
    maximumPackLimitRatePercent:percentage(reachedLimit, settings.playersPerTierAndStrategy),
    finalBalancePercentiles:{ p05:percentile(finalBalances, .05), p50:percentile(finalBalances, .5), p95:percentile(finalBalances, .95) },
  };
}

const tiers = config.packTiers.map(simulateTier);
const bankroll = Object.fromEntries(config.packTiers.map((tier) => [tier.id, Object.fromEntries(
  config.strategies.map((strategy) => [strategy.id, simulateBankroll(tier, strategy)]),
)]));
const warnings = [];
for (const tier of tiers) {
  for (const [strategyId, result] of Object.entries(tier.strategies)) {
    if (result.averageNetCoins >= config.warningThresholds.averageNetCoinsPerPack) warnings.push(`${tier.tier.id}/${strategyId}: non-negative average pack return`);
    if (result.profitablePackRatePercent >= config.warningThresholds.profitablePackRate * 100) warnings.push(`${tier.tier.id}/${strategyId}: high profitable-pack rate`);
    if (bankroll[tier.tier.id][strategyId].bankrollGrowthRatePercent >= config.warningThresholds.bankrollGrowthRate * 100) warnings.push(`${tier.tier.id}/${strategyId}: high bankroll-growth rate`);
  }
}

const output = {
  outputVersion:config.outputVersion,
  generatedAt:new Date().toISOString(),
  seed:config.seed,
  playerPool:{ total:REAL_PLAYERS.length, grades:Object.fromEntries(["S", "A", "B", "C"].map((grade) => [grade, REAL_PLAYERS.filter((player) => player.grade === grade).length])) },
  assumptions:{
    shopOffersThreeUniqueServerAvailablePlayers:true,
    playerAlwaysChoosesHighestExpectedCashReturn:true,
    unsoldMarketListingFallsBackToImmediateRelease:true,
    aiTeamsDoNotBuy:true,
    sellThroughRatesAreScenarioAssumptions:true
  },
  iterationsPerTier:config.iterationsPerTier,
  tiers,
  bankroll,
  warnings,
};

const outputDirectory = path.resolve(here, "../outputs");
const outputPath = path.join(outputDirectory, `ydl-economy-simulation-${config.outputVersion}.json`);
await mkdir(outputDirectory, { recursive:true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Economy simulation generated: ${outputPath}`);
