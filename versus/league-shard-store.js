import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHARD_SCHEMA_VERSION = 1;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const LARGE_STATE_KEYS = new Set([
  "matches",
  "ledger",
  "s4Assets",
  "s4Packs",
  "completedBroadcasts",
  "inbox",
  "inboxDeleted",
  "matchPredictions",
  "reports",
  "archives",
  "liveRound",
  "liveCupRound",
  "liveSeasonFinalRound",
  "liveWorldCupRound",
  "liveFriendlies",
  "mirrorMarketplace",
]);
const ALL_SCOPES = Object.freeze([
  "core",
  "matches",
  "ledger",
  "assets",
  "packs",
  "broadcasts",
  "inbox",
  "predictions",
  "reports",
  "archives",
  "live",
  "mirrorMarketplace",
]);
const RAW_BY_PROXY = new WeakMap();
const PROXY_BY_RAW = new WeakMap();
const MUTATION_VERSION_BY_RAW = new WeakMap();

function scopeForKey(key) {
  if (["matches"].includes(key)) return "matches";
  if (["ledger"].includes(key)) return "ledger";
  if (["s4Assets"].includes(key)) return "assets";
  if (["s4Packs"].includes(key)) return "packs";
  if (["completedBroadcasts"].includes(key)) return "broadcasts";
  if (["inbox", "inboxDeleted"].includes(key)) return "inbox";
  if (["matchPredictions"].includes(key)) return "predictions";
  if (["reports"].includes(key)) return "reports";
  if (["archives"].includes(key)) return "archives";
  if (["liveRound", "liveCupRound", "liveSeasonFinalRound", "liveWorldCupRound", "liveFriendlies"].includes(key)) return "live";
  if (["mirrorMarketplace"].includes(key)) return "mirrorMarketplace";
  return "core";
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

export function unwrapTracked(value, seen = new WeakMap()) {
  if (!isObject(value)) return value;
  const raw = RAW_BY_PROXY.get(value) ?? value;
  if (seen.has(raw)) return seen.get(raw);
  if (raw instanceof Date) return new Date(raw.getTime());
  const result = Array.isArray(raw) ? [] : {};
  seen.set(raw, result);
  Object.entries(raw).forEach(([key, item]) => { result[key] = unwrapTracked(item, seen); });
  return result;
}

// Read-only identity/version access for derived indexes. Mutations must still go
// through the tracked proxy so dirty scopes and cache invalidation remain correct.
export function trackedRawReference(value) {
  return RAW_BY_PROXY.get(value) ?? value;
}

export function trackedMutationVersion(value) {
  const raw = RAW_BY_PROXY.get(value) ?? value;
  return MUTATION_VERSION_BY_RAW.get(raw)?.version ?? null;
}

export function createTrackedState(state, onDirty) {
  const versionByScope = new Map();
  const versionBox = (scope) => {
    if (!versionByScope.has(scope)) versionByScope.set(scope, { version: 0 });
    return versionByScope.get(scope);
  };
  const markMutation = (scope, property) => {
    const mutationScope = scope === "root" ? scopeForKey(property) : scope;
    versionBox(mutationScope).version += 1;
    onDirty(mutationScope);
  };
  const wrap = (value, scope) => {
    if (!isObject(value)) return value;
    const raw = RAW_BY_PROXY.get(value) ?? value;
    const existing = PROXY_BY_RAW.get(raw);
    if (existing) return existing;
    MUTATION_VERSION_BY_RAW.set(raw, versionBox(scope));
    const proxy = new Proxy(raw, {
      get(target, property, receiver) {
        const child = Reflect.get(target, property, receiver);
        if (scope === "live" && property === "match") return RAW_BY_PROXY.get(child) ?? child;
        return isObject(child) ? wrap(child, scope === "root" ? scopeForKey(property) : scope) : child;
      },
      set(target, property, nextValue, receiver) {
        const changed = Reflect.get(target, property, receiver) !== nextValue;
        const result = Reflect.set(target, property, unwrapTracked(nextValue), receiver);
        if (result && changed) markMutation(scope, property);
        return result;
      },
      deleteProperty(target, property) {
        const existed = Object.hasOwn(target, property);
        const result = Reflect.deleteProperty(target, property);
        if (result && existed) markMutation(scope, property);
        return result;
      },
    });
    RAW_BY_PROXY.set(proxy, raw);
    PROXY_BY_RAW.set(raw, proxy);
    return proxy;
  };
  return wrap(state, "root");
}

function safePart(value) {
  const encoded = Buffer.from(String(value ?? "unknown"), "utf8").toString("base64url");
  return encoded.slice(0, 180) || "unknown";
}

function archiveKey(archive, index) {
  return String(archive?.archiveKey ?? archive?.id ?? `${archive?.season?.id ?? "season"}-${archive?.archivedAt ?? index}-${archive?.reason ?? "archive"}`);
}

function atomicWriteJson(filePath, value, compact = true) {
  mkdirSync(path.dirname(filePath), { recursive:true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, compact ? undefined : 2), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, filePath);
}

function writeNdjson(filePath, values) {
  mkdirSync(path.dirname(filePath), { recursive:true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, filePath);
}

function appendNdjson(filePath, values) {
  if (!values.length) return;
  mkdirSync(path.dirname(filePath), { recursive:true });
  const descriptor = openSync(filePath, "a");
  try {
    writeFileSync(descriptor, values.map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readNdjson(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function relativeToRoot(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function resolveRef(root, reference) {
  if (typeof reference !== "string" || !reference) return null;
  return path.resolve(root, reference);
}

function stateCore(state) {
  return Object.fromEntries(Object.entries(state).filter(([key]) => !LARGE_STATE_KEYS.has(key)));
}

function matchWithoutReport(match) {
  const { report, ...summary } = match ?? {};
  return summary;
}

function matchIdsMatch(left, right) {
  return left && right && left.id === right.id;
}

export class LeagueShardStore {
  constructor(rootPath, options = {}) {
    this.root = path.resolve(rootPath);
    this.backupDir = options.backupDir === undefined ? path.join(this.root, "yellowdogs-league-backups") : options.backupDir;
    this.manifestPath = path.join(this.root, "manifest.json");
    this.revisionsPath = path.join(this.root, "revisions");
    this.manifest = null;
    this.matchReportPaths = new Map();
    this.archivePaths = new Map();
    this.ledgerTail = null;
    this.ledgerCount = 0;
    this.assetTransactionTail = null;
    this.assetTransactionCount = 0;
    this.cleanupIntervalMs = Math.max(10_000, Number(options.cleanupIntervalMs ?? process.env.YDL_SHARD_CLEANUP_INTERVAL_MS ?? DEFAULT_CLEANUP_INTERVAL_MS));
    this.lastCleanupAt = 0;
  }

  exists() {
    return existsSync(this.manifestPath);
  }

  hasUninitializedData() {
    if (!existsSync(this.root)) return false;
    if (!statSync(this.root).isDirectory()) throw new Error(`YellowDogs League shard path is not a directory: ${this.root}`);
    return readdirSync(this.root).length > 0;
  }

  load() {
    if (!this.exists()) return null;
    const candidates = [this.manifestPath];
    if (this.backupDir && existsSync(this.backupDir)) {
      readdirSync(this.backupDir)
        .filter((name) => name.endsWith(".manifest.json"))
        .sort()
        .reverse()
        .forEach((name) => candidates.push(path.join(this.backupDir, name)));
    }
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const manifest = readJson(candidate);
        const state = this.loadManifest(manifest);
        this.manifest = manifest;
        return state;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("YellowDogs League 分片存储无法读取");
  }

  loadManifest(manifest) {
    if (manifest?.schemaVersion !== SHARD_SCHEMA_VERSION || !manifest.shards?.core) {
      throw new Error("YellowDogs League 分片存储版本无效");
    }
    const state = { ...readJson(resolveRef(this.root, manifest.shards.core)) };
    state.matches = this.readMatches(manifest.shards.matches);
    state.ledger = this.readLedger(manifest.shards.ledger);
    state.s4Assets = this.readAssets(manifest.shards.assets);
    state.s4Packs = this.readPacks(manifest.shards.packs);
    state.completedBroadcasts = this.readObjectShard(manifest.shards.broadcasts, []);
    state.inbox = this.readMapShards(manifest.shards.inbox);
    state.inboxDeleted = this.readMapShards(manifest.shards.inboxDeleted);
    state.matchPredictions = this.readObjectShard(manifest.shards.predictions, { schemaVersion:1, markets:{}, bets:[], distributions:[] });
    state.reports = this.readObjectShard(manifest.shards.reports, {});
    state.archives = this.readArchives(manifest.shards.archives);
    const live = this.readObjectShard(manifest.shards.live, { liveRound:null, liveCupRound:null, liveWorldCupRound:null, liveFriendlies:[] });
    state.liveRound = live.liveRound ?? null;
    state.liveCupRound = live.liveCupRound ?? null;
    state.liveSeasonFinalRound = Object.hasOwn(live, "liveSeasonFinalRound") ? live.liveSeasonFinalRound : state.liveSeasonFinalRound ?? null;
    state.liveWorldCupRound = live.liveWorldCupRound ?? null;
    state.liveFriendlies = live.liveFriendlies ?? [];
    this.liveSeasonFinalMigrationNeeded = !Object.hasOwn(live, "liveSeasonFinalRound");
    state.mirrorMarketplace = this.readObjectShard(manifest.shards.mirrorMarketplace, { uploads:{}, usageByDate:{}, settledDates:[] });
    return state;
  }

  readObjectShard(reference, fallback) {
    const filePath = resolveRef(this.root, reference);
    return filePath && existsSync(filePath) ? readJson(filePath) : fallback;
  }

  readMapShards(reference) {
    if (!reference || typeof reference !== "object") return {};
    return Object.fromEntries(Object.entries(reference).map(([key, file]) => [key, this.readObjectShard(file, [])]));
  }

  readMatches(reference) {
    const index = this.readObjectShard(reference, { entries:[] });
    this.matchReportPaths.clear();
    return (index.entries ?? []).map((entry) => {
      if (entry.reportPath) this.matchReportPaths.set(String(entry.id), entry.reportPath);
      const match = { ...(entry.match ?? {}) };
      const reportPath = resolveRef(this.root, entry.reportPath);
      if (reportPath && existsSync(reportPath)) match.report = readJson(reportPath);
      return match;
    });
  }

  readLedger(reference) {
    const segmentPaths = reference?.segments ?? (reference ? [reference] : []);
    const entries = segmentPaths.flatMap((segment) => readNdjson(resolveRef(this.root, segment)));
    this.ledgerCount = entries.length;
    this.ledgerFirstId = entries[0]?.id ?? null;
    this.ledgerTail = entries.at(-1) ?? null;
    return entries;
  }

  readAssets(reference) {
    const meta = this.readObjectShard(reference?.meta, { schemaVersion:1, nextCardSequence:1, ownerships:{}, traitOffers:{}, traitThresholdCompensations:{} });
    const cards = Object.fromEntries(Object.entries(reference?.cards ?? {}).flatMap(([ownerId, file]) => Object.entries(this.readObjectShard(file, {})).map(([cardId, card]) => [cardId, card])));
    const transactionPaths = reference?.transactions?.segments ?? (reference?.transactions ? [reference.transactions] : []);
    const transactions = transactionPaths.flatMap((segment) => readNdjson(resolveRef(this.root, segment)));
    this.assetTransactionCount = transactions.length;
    this.assetTransactionTail = transactions.at(-1) ?? null;
    return { ...meta, cards, transactions };
  }

  readPacks(reference) {
    const meta = this.readObjectShard(reference?.meta, { schemaVersion:1, nextSequence:1, offers:{}, batchOpenings:{}, grants:[], cardGrants:[], legacyRetiredAt:null });
    const inventory = Object.fromEntries(Object.entries(reference?.inventory ?? {}).map(([accountId, file]) => [accountId, this.readObjectShard(file, [])]));
    return { ...meta, inventory };
  }

  readArchives(reference) {
    if (!reference?.entries) return [];
    this.archivePaths.clear();
    return reference.entries.map((entry) => {
      this.archivePaths.set(String(entry.key), entry.path);
      return {
        archiveKey:entry.key,
        reason:entry.reason,
        archivedAt:entry.archivedAt,
        season:entry.season,
        standings:entry.standings ?? [],
        matchCount:Number(entry.matchCount ?? 0),
      };
    });
  }

  readFullArchive(archive) {
    const key = String(archive?.archiveKey ?? archive?.key ?? archive ?? "");
    const reference = this.archivePaths.get(key);
    const filePath = resolveRef(this.root, reference);
    return filePath && existsSync(filePath) ? readJson(filePath) : null;
  }

  save(state, options = {}) {
    mkdirSync(this.root, { recursive:true });
    mkdirSync(this.revisionsPath, { recursive:true });
    const previous = this.manifest ?? { revision:0, shards:{} };
    const requestedScopes = options.forceFull || !options.scopes ? ALL_SCOPES : options.scopes;
    const scopes = new Set(["core", ...requestedScopes]);
    const revision = Number(previous.revision ?? 0) + 1;
    const temporaryRevisionPath = path.join(this.revisionsPath, `.tmp-${revision}-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const revisionPath = path.join(this.revisionsPath, String(revision));
    mkdirSync(temporaryRevisionPath, { recursive:true });
    const shards = { ...(previous.shards ?? {}) };
    if (scopes.has("core") || !shards.core) shards.core = this.writeRevisionJson(temporaryRevisionPath, "core.json", stateCore(state), previous.shards?.core);
    if (scopes.has("matches") || !shards.matches) shards.matches = this.writeMatches(temporaryRevisionPath, revisionPath, state, options, previous.shards?.matches);
    if (scopes.has("ledger") || !shards.ledger) shards.ledger = this.writeLedger(temporaryRevisionPath, state.ledger ?? [], previous.shards?.ledger);
    if (scopes.has("assets") || !shards.assets) shards.assets = this.writeAssets(temporaryRevisionPath, state.s4Assets ?? {}, previous.shards?.assets);
    if (scopes.has("packs") || !shards.packs) shards.packs = this.writePacks(temporaryRevisionPath, state.s4Packs ?? {}, previous.shards?.packs);
    if (scopes.has("broadcasts") || !shards.broadcasts) shards.broadcasts = this.writeRevisionJson(temporaryRevisionPath, "completed-broadcasts.json", state.completedBroadcasts ?? [], previous.shards?.broadcasts);
    if (scopes.has("inbox") || !shards.inbox || !shards.inboxDeleted) {
      shards.inbox = this.writeMapShards(temporaryRevisionPath, "inbox", state.inbox ?? {}, previous.shards?.inbox);
      shards.inboxDeleted = this.writeMapShards(temporaryRevisionPath, "inbox-deleted", state.inboxDeleted ?? {}, previous.shards?.inboxDeleted);
    }
    if (scopes.has("predictions") || !shards.predictions) shards.predictions = this.writeRevisionJson(temporaryRevisionPath, "predictions.json", state.matchPredictions ?? {}, previous.shards?.predictions);
    if (scopes.has("reports") || !shards.reports) shards.reports = this.writeRevisionJson(temporaryRevisionPath, "reports.json", state.reports ?? {}, previous.shards?.reports);
    if (scopes.has("archives") || !shards.archives) shards.archives = this.writeArchives(temporaryRevisionPath, revisionPath, state.archives ?? [], previous.shards?.archives);
    if (scopes.has("live") || !shards.live || this.liveSeasonFinalMigrationNeeded) shards.live = this.writeRevisionJson(temporaryRevisionPath, "live.json", {
      liveRound:state.liveRound ?? null,
      liveCupRound:state.liveCupRound ?? null,
      liveSeasonFinalRound:state.liveSeasonFinalRound ?? null,
      liveWorldCupRound:state.liveWorldCupRound ?? null,
      liveFriendlies:state.liveFriendlies ?? [],
    });
    if (scopes.has("mirrorMarketplace") || !shards.mirrorMarketplace) shards.mirrorMarketplace = this.writeRevisionJson(temporaryRevisionPath, "mirror-marketplace.json", state.mirrorMarketplace ?? { uploads:{}, usageByDate:{}, settledDates:[] }, previous.shards?.mirrorMarketplace);
    renameSync(temporaryRevisionPath, revisionPath);
    const manifest = {
      schemaVersion:SHARD_SCHEMA_VERSION,
      revision,
      updatedAt:Number(state.updatedAt ?? Date.now()),
      stateVersion:Number(state.version ?? 2),
      shards:this.finalizeRevisionRefs(shards, temporaryRevisionPath, revisionPath),
    };
    atomicWriteJson(this.manifestPath, manifest);
    this.manifest = manifest;
    this.liveSeasonFinalMigrationNeeded = false;
    const now = Date.now();
    if (!this.lastCleanupAt || now - this.lastCleanupAt >= this.cleanupIntervalMs) {
      this.cleanupRevisions(manifest);
      this.lastCleanupAt = now;
    }
    this.refreshPersistenceCursors(state);
    return manifest;
  }

  writeRevisionJson(revisionPath, fileName, value, previousReference = null) {
    const serialized = JSON.stringify(value);
    const previousPath = resolveRef(this.root, previousReference);
    if (previousPath && existsSync(previousPath) && readFileSync(previousPath, "utf8") === serialized) return previousReference;
    const filePath = path.join(revisionPath, fileName);
    atomicWriteJson(filePath, value);
    return relativeToRoot(this.root, filePath);
  }

  writeMapShards(revisionPath, directoryName, values, previousReferences = {}) {
    const references = {};
    Object.entries(values).forEach(([key, value]) => {
      references[key] = this.writeRevisionJson(revisionPath, `${directoryName}/${safePart(key)}.json`, value, previousReferences[key]);
    });
    return references;
  }

  writeMatches(revisionPath, committedRevisionPath, state, options, previousReference) {
    const previousIndex = this.readObjectShard(previousReference, { entries:[] });
    const previousEntries = new Map((previousIndex.entries ?? []).map((entry) => [String(entry.id), entry]));
    const selectedIds = options.matchIds ? new Set(options.matchIds.map(String)) : null;
    const entries = (state.matches ?? []).map((match) => {
      const id = String(match.id);
      const previousEntry = previousEntries.get(id);
      let reportPath = previousEntry?.reportPath ?? this.matchReportPaths.get(id) ?? null;
      const shouldWriteReport = Boolean(match.report) && (!reportPath || selectedIds?.has(id) || options.forceFull || !previousEntry);
      if (shouldWriteReport) {
        const reportFile = path.join(revisionPath, "reports", `${safePart(id)}.json`);
        atomicWriteJson(reportFile, match.report);
        reportPath = relativeToRoot(this.root, path.join(committedRevisionPath, "reports", `${safePart(id)}.json`));
      }
      return { id, match:matchWithoutReport(match), reportPath };
    });
    const indexPath = path.join(revisionPath, "matches-index.json");
    const indexValue = { schemaVersion:1, entries };
    const previousIndexPath = resolveRef(this.root, previousReference);
    if (previousIndexPath && existsSync(previousIndexPath) && readFileSync(previousIndexPath, "utf8") === JSON.stringify(indexValue)) {
      this.matchReportPaths = new Map(entries.filter((entry) => entry.reportPath).map((entry) => [entry.id, entry.reportPath]));
      return previousReference;
    }
    atomicWriteJson(indexPath, indexValue);
    this.matchReportPaths = new Map(entries.filter((entry) => entry.reportPath).map((entry) => [entry.id, entry.reportPath]));
    return relativeToRoot(this.root, indexPath);
  }

  writeLedger(revisionPath, entries, previousReference) {
    const previousEntries = previousReference?.segments ?? (previousReference ? [previousReference] : []);
    const canAppend = previousEntries.length > 0
      && entries.length >= this.ledgerCount
      && matchIdsMatch(entries[0], this.ledgerCount ? { id:this.ledgerFirstId } : entries[0])
      && (!this.ledgerTail || matchIdsMatch(entries[this.ledgerCount - 1], this.ledgerTail));
    if (canAppend && entries.length === this.ledgerCount) return { segments:previousEntries, count:entries.length };
    const newEntries = canAppend ? entries.slice(this.ledgerCount) : entries;
    if (!newEntries.length && previousEntries.length) return { segments:previousEntries, count:entries.length };
    const segmentPath = path.join(revisionPath, "ledger.ndjson");
    writeNdjson(segmentPath, newEntries);
    const segments = canAppend ? [...previousEntries, relativeToRoot(this.root, segmentPath)] : [relativeToRoot(this.root, segmentPath)];
    this.ledgerCount = entries.length;
    this.ledgerTail = entries.at(-1) ?? null;
    this.ledgerFirstId = entries[0]?.id ?? null;
    return { segments, count:entries.length };
  }

  writeAssets(revisionPath, assets, previousReference) {
    const { cards = {}, transactions = [], ...meta } = assets;
    const cardsByOwner = {};
    Object.values(cards).forEach((card) => {
      const ownerId = String(card.ownerId ?? "unknown");
      cardsByOwner[ownerId] ??= {};
      cardsByOwner[ownerId][card.id] = card;
    });
    const cardRefs = {};
    Object.entries(cardsByOwner).forEach(([ownerId, ownerCards]) => {
      cardRefs[ownerId] = this.writeRevisionJson(revisionPath, `cards/${safePart(ownerId)}.json`, ownerCards, previousReference?.cards?.[ownerId]);
    });
    const previousSegments = previousReference?.transactions?.segments ?? (previousReference?.transactions ? [previousReference.transactions] : []);
    const canAppend = previousSegments.length > 0
      && transactions.length >= this.assetTransactionCount
      && (!this.assetTransactionTail || transactions[this.assetTransactionCount - 1]?.id === this.assetTransactionTail.id);
    const newTransactions = canAppend ? transactions.slice(this.assetTransactionCount) : transactions;
    let transactionSegments = previousSegments;
    if (newTransactions.length || !previousSegments.length || !canAppend) {
      const transactionPath = path.join(revisionPath, "asset-transactions.ndjson");
      writeNdjson(transactionPath, newTransactions);
      transactionSegments = canAppend ? [...previousSegments, relativeToRoot(this.root, transactionPath)] : [relativeToRoot(this.root, transactionPath)];
    }
    this.assetTransactionCount = transactions.length;
    this.assetTransactionTail = transactions.at(-1) ?? null;
    return {
      meta:this.writeRevisionJson(revisionPath, "assets-meta.json", meta, previousReference?.meta),
      cards:cardRefs,
      transactions:{ segments:transactionSegments, count:transactions.length },
    };
  }

  writePacks(revisionPath, packs, previousReference = null) {
    const { inventory = {}, ...meta } = packs;
    const targetRevisionPath = revisionPath;
    const inventoryRefs = {};
    Object.entries(inventory).forEach(([accountId, items]) => {
      inventoryRefs[accountId] = this.writeRevisionJson(targetRevisionPath, `packs/${safePart(accountId)}.json`, items, previousReference?.inventory?.[accountId]);
    });
    return {
      meta:this.writeRevisionJson(targetRevisionPath, "packs-meta.json", meta, previousReference?.meta),
      inventory:inventoryRefs,
    };
  }

  writeArchives(revisionPath, committedRevisionPath, archives, previousReference) {
    const previousEntries = new Map((previousReference?.entries ?? []).map((entry) => [String(entry.key), entry]));
    const entries = archives.map((archive, index) => {
      const key = archiveKey(archive, index);
      const previous = previousEntries.get(key);
      let archivePath = previous?.path ?? this.archivePaths.get(key) ?? null;
      const previousPath = resolveRef(this.root, archivePath);
      if (!previousPath || !existsSync(previousPath)) {
        const filePath = path.join(revisionPath, "archives", `${safePart(key)}.json`);
        atomicWriteJson(filePath, archive);
        archivePath = relativeToRoot(this.root, path.join(committedRevisionPath, "archives", `${safePart(key)}.json`));
      }
      return {
        key,
        path:archivePath,
        reason:archive.reason,
        archivedAt:archive.archivedAt,
        season:archive.season,
        standings:archive.standings ?? [],
        matchCount:Number(archive.matchCount ?? archive.matches?.length ?? 0),
      };
    });
    this.archivePaths = new Map(entries.map((entry) => [entry.key, entry.path]));
    const indexPath = path.join(revisionPath, "archives-index.json");
    atomicWriteJson(indexPath, { schemaVersion:1, entries });
    return { index:relativeToRoot(this.root, indexPath), entries };
  }

  toRevisionRefs(value, revisionPath) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => this.toRevisionRefs(item, revisionPath));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.toRevisionRefs(item, revisionPath)]));
  }

  finalizeRevisionRefs(value, temporaryRevisionPath, revisionPath) {
    const temporaryPrefix = relativeToRoot(this.root, temporaryRevisionPath);
    const committedPrefix = relativeToRoot(this.root, revisionPath);
    if (typeof value === "string") {
      return value.startsWith(`${temporaryPrefix}/`)
        ? `${committedPrefix}/${value.slice(temporaryPrefix.length + 1)}`
        : value;
    }
    if (Array.isArray(value)) return value.map((item) => this.finalizeRevisionRefs(item, temporaryRevisionPath, revisionPath));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.finalizeRevisionRefs(item, temporaryRevisionPath, revisionPath)]));
  }

  cleanupRevisions(manifest) {
    if (!existsSync(this.revisionsPath)) return;
    const referenced = new Set();
    const queuedFiles = new Set();
    const pendingFiles = [];
    const queueReferenceIndex = (reference) => {
      const filePath = resolveRef(this.root, reference);
      if (!filePath || queuedFiles.has(filePath)) return;
      const fileName = path.basename(filePath);
      if (fileName !== "matches-index.json" && fileName !== "archives-index.json") return;
      queuedFiles.add(filePath);
      pendingFiles.push(filePath);
    };
    const collect = (value) => {
      if (typeof value === "string" && value.startsWith("revisions/")) {
        referenced.add(value.split("/")[1]);
        queueReferenceIndex(value);
      }
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(manifest.shards);
    if (this.backupDir && existsSync(this.backupDir)) {
      readdirSync(this.backupDir).filter((name) => name.endsWith(".manifest.json")).forEach((name) => {
        try { collect(readJson(path.join(this.backupDir, name)).shards); } catch { /* ignore an incomplete backup */ }
      });
    }
    while (pendingFiles.length) {
      const filePath = pendingFiles.pop();
      try {
        const serialized = readFileSync(filePath, "utf8");
        for (const match of serialized.matchAll(/"(revisions\/[^"\\]+)"/g)) collect(match[1]);
      } catch { /* ignore a partial or missing shard index */ }
    }
    const recent = readdirSync(this.revisionsPath)
      .filter((name) => /^\d+$/.test(name))
      .sort((left, right) => Number(right) - Number(left))
      .slice(0, 2);
    recent.forEach((name) => referenced.add(name));
    readdirSync(this.revisionsPath).forEach((name) => {
      if (name.startsWith(".tmp-") || /^\d+$/.test(name) && !referenced.has(name)) rmSync(path.join(this.revisionsPath, name), { recursive:true, force:true });
    });
  }

  refreshPersistenceCursors(state) {
    this.ledgerCount = state.ledger?.length ?? 0;
    this.ledgerFirstId = state.ledger?.[0]?.id ?? null;
    this.ledgerTail = state.ledger?.at(-1) ?? null;
    this.assetTransactionCount = state.s4Assets?.transactions?.length ?? 0;
    this.assetTransactionTail = state.s4Assets?.transactions?.at(-1) ?? null;
  }

  backupSnapshot(targetPath) {
    if (!this.exists()) return null;
    mkdirSync(path.dirname(targetPath), { recursive:true });
    atomicWriteJson(targetPath, readJson(this.manifestPath), false);
    return targetPath;
  }
}

export const LEAGUE_SHARD_SCOPES = ALL_SCOPES;
export const isLeagueShardPath = (value) => Boolean(value && !String(value).toLowerCase().endsWith(".json"));
