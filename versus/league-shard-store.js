import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {applyShardGarbageCollection,planShardGarbageCollection} from "./infrastructure/shard-references.js";
import {measureRuntimeSync} from "../src/runtime-metrics.js";
import {ColdJsonCache,compressColdJson} from "./infrastructure/cold-json-cache.js";
import {attachDeferredReport,copyDeferredReport,deferredReport,reportMetadata,storedReportMetadata} from "./infrastructure/lazy-match-report.js";

const SHARD_SCHEMA_VERSION = 2;
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
  "seasonFinalTournament",
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
  "seasonFinal",
]);
const RAW_BY_PROXY = new WeakMap();
const PROXY_BY_RAW = new WeakMap();
const MUTATION_VERSION_BY_RAW = new WeakMap();
const SUBTREE_VERSION_BY_RAW = new WeakMap();

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
  if (key === "seasonFinalTournament") return "seasonFinal";
  return "core";
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function copyTracked(value, seen, preserveDeferred) {
  if (!isObject(value)) return value;
  const raw = RAW_BY_PROXY.get(value) ?? value;
  if (seen.has(raw)) return seen.get(raw);
  if (raw instanceof Date) return new Date(raw.getTime());
  const result = Array.isArray(raw) ? [] : {};
  seen.set(raw, result);
  for (const key of Object.keys(raw)) {
    if (preserveDeferred && key === "report" && copyDeferredReport(raw, result)) continue;
    result[key] = copyTracked(raw[key], seen, preserveDeferred);
  }
  return result;
}
export function unwrapTracked(value, seen = new WeakMap()) { return copyTracked(value, seen, false); }
export function matchReportMetadata(value) { return storedReportMetadata(trackedRawReference(value)); }

// Read-only identity/version access for derived indexes. Mutations must still go
// through the tracked proxy so dirty scopes and cache invalidation remain correct.
export function trackedRawReference(value) {
  return RAW_BY_PROXY.get(value) ?? value;
}

export function trackedMutationVersion(value) {
  const raw = RAW_BY_PROXY.get(value) ?? value;
  return MUTATION_VERSION_BY_RAW.get(raw)?.version ?? null;
}
export function trackedSubtreeVersion(value) { return SUBTREE_VERSION_BY_RAW.get(trackedRawReference(value))?.version ?? null; }

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
  const wrap = (value, scope, valuePath = [], subtree = null) => {
    if (!isObject(value)) return value;
    const raw = RAW_BY_PROXY.get(value) ?? value;
    const existing = PROXY_BY_RAW.get(raw);
    if (existing) return existing;
    if (!subtree && valuePath && ((valuePath.length === 3 && ["s4Assets:cards", "s4Packs:inventory"].includes(valuePath.slice(0, 2).join(":"))) || (valuePath.length === 2 && ["inbox", "inboxDeleted"].includes(valuePath[0])))) {
      subtree = { version:0 };
      SUBTREE_VERSION_BY_RAW.set(raw, subtree);
    }
    MUTATION_VERSION_BY_RAW.set(raw, versionBox(scope));
    const proxy = new Proxy(raw, {
      get(target, property, receiver) {
        const child = Reflect.get(target, property, receiver);
        if (scope === "live" && property === "match") return RAW_BY_PROXY.get(child) ?? child;
        const nextScope = scope === "root" ? scopeForKey(property) : scope;
        const nextPath = !subtree && valuePath && ["root", "assets", "packs", "inbox"].includes(scope) ? [...valuePath, property] : null;
        return isObject(child) ? wrap(child, nextScope, nextPath, subtree) : child;
      },
      set(target, property, nextValue, receiver) {
        const changed = property === "report" && deferredReport(target) || Reflect.get(target, property, receiver) !== nextValue;
        const result = Reflect.set(target, property, copyTracked(nextValue, new WeakMap(), true), receiver);
        if (result && changed) { if (subtree) subtree.version++; markMutation(scope, property); }
        return result;
      },
      deleteProperty(target, property) {
        const existed = Object.hasOwn(target, property);
        const result = Reflect.deleteProperty(target, property);
        if (result && existed) { if (subtree) subtree.version++; markMutation(scope, property); }
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

function atomicWriteSerialized(filePath, serialized) {
  mkdirSync(path.dirname(filePath), { recursive:true });
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, serialized, typeof serialized === "string" ? "utf8" : undefined);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, filePath);
}
function atomicWriteJson(filePath, value, compact = true) { atomicWriteSerialized(filePath, JSON.stringify(value, null, compact ? undefined : 2)); }

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
  return Object.fromEntries(Object.keys(match ?? {}).filter(key => key !== "report").map(key => [key, match[key]]));
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
    this.seasonFinalReportPaths = new Map();
    this.coldCache = new ColdJsonCache({ maxBytes:options.coldCacheBytes ?? 8 * 1024 * 1024, maxEntries:options.coldCacheEntries ?? 16 });
    this.ownerCardSnapshots = new Map();
    this.mapSnapshots = new Map();
    this.ledgerTail = null;
    this.ledgerCount = 0;
    this.assetTransactionTail = null;
    this.assetTransactionCount = 0;
    this.cleanupIntervalMs = Math.max(10_000, Number(options.cleanupIntervalMs ?? process.env.YDL_SHARD_CLEANUP_INTERVAL_MS ?? DEFAULT_CLEANUP_INTERVAL_MS));
    this.lastCleanupAt = 0;
    this.maxLogSegments = Math.max(4, Math.min(1024, Number(options.maxLogSegments ?? process.env.YDL_SHARD_MAX_LOG_SEGMENTS ?? 64)) || 64);
    this.maxCleanupFiles = Math.max(16, Math.min(10000, Number(options.maxCleanupFiles ?? process.env.YDL_SHARD_GC_MAX_FILES ?? 256)) || 256);
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
    if (![1, SHARD_SCHEMA_VERSION].includes(manifest?.schemaVersion) || !manifest.shards?.core) {
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
    if (manifest.shards.seasonFinal) state.seasonFinalTournament = this.readSeasonFinal(manifest.shards.seasonFinal);
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

  readColdJson(reference) { return this.coldCache.read(resolveRef(this.root, reference)); }

  readMatchEntries(entries, paths) {
    paths.clear();
    return (entries ?? []).map(entry => {
      const match = { ...(entry.match ?? {}) };
      if (entry.reportPath) {
        if (!existsSync(resolveRef(this.root, entry.reportPath))) throw new Error(`Missing match report: ${entry.reportPath}`);
        paths.set(String(entry.id), entry.reportPath);
        attachDeferredReport(match, { reference:entry.reportPath, metadata:entry.reportMeta ?? null, read:reference => this.readColdJson(reference) });
      }
      return match;
    });
  }

  readSeasonFinal(reference) {
    const index = this.readObjectShard(reference, null);
    if (!index?.tournament) { this.seasonFinalReportPaths.clear(); return null; }
    return { ...index.tournament, matches:this.readMatchEntries(index.entries, this.seasonFinalReportPaths) };
  }

  readObjectShard(reference, fallback) {
    const filePath = resolveRef(this.root, reference);
    // An absent optional reference has a default; a broken committed reference
    // must fail so load() can try a backup instead of silently dropping data.
    return filePath ? readJson(filePath) : fallback;
  }

  readMapShards(reference) {
    if (!reference || typeof reference !== "object") return {};
    return Object.fromEntries(Object.entries(reference).map(([key, file]) => [key, this.readObjectShard(file, [])]));
  }

  readMatches(reference) {
    const index = this.readObjectShard(reference, { entries:[] });
    return this.readMatchEntries(index.entries, this.matchReportPaths);
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
    return filePath && existsSync(filePath) ? this.coldCache.read(filePath, { copy:true }) : null;
  }

  save(state, options = {}) {
    const previous = this.manifest;
    const cursors = Object.fromEntries(["ledgerTail", "ledgerCount", "ledgerFirstId", "assetTransactionTail", "assetTransactionCount", "liveSeasonFinalMigrationNeeded"].map(key => [key, this[key]]));
    const maps = Object.fromEntries(["matchReportPaths", "seasonFinalReportPaths", "archivePaths", "ownerCardSnapshots", "mapSnapshots"].map(key => [key, new Map(this[key])]));
    try { return this.saveRevision(state, options); }
    catch (error) {
      if (this.manifest === previous) { Object.assign(this, cursors, maps); }
      throw error;
    }
  }

  saveRevision(state, options) {
    mkdirSync(this.root, { recursive:true });
    mkdirSync(this.revisionsPath, { recursive:true });
    const previous = this.manifest ?? { revision:0, shards:{} };
    if (previous.schemaVersion === 1 && this.backupDir) {
      const rollbackPath = path.join(this.backupDir, `before-storage-v2-${previous.revision}.manifest.json`);
      if (!existsSync(rollbackPath)) this.backupSnapshot(rollbackPath);
    }
    const requestedScopes = options.forceFull || !options.scopes ? ALL_SCOPES : options.scopes;
    const scopes = new Set(["core", ...requestedScopes]);
    let revision = Number(previous.revision ?? 0) + 1;
    // A failed manifest commit can leave an unreferenced, immutable revision.
    while (existsSync(path.join(this.revisionsPath, String(revision)))) revision++;
    const temporaryRevisionPath = path.join(this.revisionsPath, `.tmp-${revision}-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const revisionPath = path.join(this.revisionsPath, String(revision));
    mkdirSync(temporaryRevisionPath, { recursive:true });
    const shards = { ...(previous.shards ?? {}) };
    if (scopes.has("core") || !shards.core) shards.core = this.writeRevisionJson(temporaryRevisionPath, "core.json", stateCore(state), previous.shards?.core);
    if (scopes.has("matches") || !shards.matches) shards.matches = this.writeMatches(temporaryRevisionPath, revisionPath, state, options, previous.shards?.matches);
    if (scopes.has("seasonFinal") || !shards.seasonFinal) shards.seasonFinal = this.writeSeasonFinal(temporaryRevisionPath, revisionPath, state.seasonFinalTournament, options, previous.shards?.seasonFinal);
    if (scopes.has("ledger") || !shards.ledger) shards.ledger = this.writeLedger(temporaryRevisionPath, state.ledger ?? [], previous.shards?.ledger);
    if (scopes.has("assets") || !shards.assets) shards.assets = this.writeAssets(temporaryRevisionPath, state.s4Assets ?? {}, previous.shards?.assets, options);
    if (scopes.has("packs") || !shards.packs) shards.packs = this.writePacks(temporaryRevisionPath, state.s4Packs ?? {}, previous.shards?.packs, options);
    if (scopes.has("broadcasts") || !shards.broadcasts) shards.broadcasts = this.writeRevisionJson(temporaryRevisionPath, "completed-broadcasts.json", state.completedBroadcasts ?? [], previous.shards?.broadcasts);
    if (scopes.has("inbox") || !shards.inbox || !shards.inboxDeleted) {
      shards.inbox = this.writeMapShards(temporaryRevisionPath, "inbox", state.inbox ?? {}, previous.shards?.inbox, options);
      shards.inboxDeleted = this.writeMapShards(temporaryRevisionPath, "inbox-deleted", state.inboxDeleted ?? {}, previous.shards?.inboxDeleted, options);
    }
    if (scopes.has("predictions") || !shards.predictions) shards.predictions = this.writeRevisionJson(temporaryRevisionPath, "predictions.json", state.matchPredictions ?? {}, previous.shards?.predictions);
    if (scopes.has("reports") || !shards.reports) shards.reports = this.writeRevisionJson(temporaryRevisionPath, "reports.json", state.reports ?? {}, previous.shards?.reports);
    if (scopes.has("archives") || !shards.archives) shards.archives = this.writeArchives(temporaryRevisionPath, revisionPath, state.archives ?? [], previous.shards?.archives, options);
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
    for (const cached of [...this.ownerCardSnapshots.values(), ...this.mapSnapshots.values()]) cached.reference = this.finalizeRevisionRefs(cached.reference, temporaryRevisionPath, revisionPath);
    if (scopes.has("matches") || !previous.shards?.matches) this.deferPersistedMatches(state.matches, this.matchReportPaths);
    if (scopes.has("seasonFinal") || !previous.shards?.seasonFinal) this.deferPersistedMatches(state.seasonFinalTournament?.matches, this.seasonFinalReportPaths);
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
    atomicWriteSerialized(filePath, serialized);
    return relativeToRoot(this.root, filePath);
  }

  writeMapShards(revisionPath, directoryName, values, previousReferences = {}, options = {}) {
    const references = {};
    const prefix = `${directoryName}\0`, present = new Set();
    Object.entries(values).forEach(([key, value]) => {
      const cacheKey = prefix + key, raw = trackedRawReference(value), version = trackedSubtreeVersion(value), cached = this.mapSnapshots.get(cacheKey), previous = previousReferences[key];
      present.add(cacheKey);
      if (!options.forceFull && version !== null && cached && previous && cached.reference === previous && cached.raw === raw && cached.version === version && existsSync(resolveRef(this.root, previous))) references[key] = previous;
      else {
        references[key] = this.writeRevisionJson(revisionPath, `${directoryName}/${safePart(key)}.json`, value, previous);
        this.mapSnapshots.set(cacheKey, { reference:references[key], raw, version });
      }
    });
    for (const key of this.mapSnapshots.keys()) if (key.startsWith(prefix) && !present.has(key)) this.mapSnapshots.delete(key);
    return references;
  }

  writeMatchEntries(revisionPath, committedRevisionPath, matches, options, previousEntries, paths, directory = "reports") {
    const previousById = new Map((previousEntries ?? []).map(entry => [String(entry.id), entry]));
    const selected = options.matchIds ? new Set(options.matchIds.map(String)) : null;
    const entries = (matches ?? []).map(match => {
      const raw = trackedRawReference(match), id = String(raw.id), previous = previousById.get(id);
      const deferred = deferredReport(raw);
      let reportPath = deferred?.reference ?? previous?.reportPath ?? paths.get(id) ?? null;
      let metadata = deferred?.metadata ?? previous?.reportMeta ?? null;
      if (!deferred || options.forceFull || selected?.has(id)) {
        const report = deferred ? deferred.read(deferred.reference) : raw.report;
        metadata = reportMetadata(report);
        if (report) {
          const file = path.join(revisionPath, directory, `${safePart(id)}.json.gz`);
          atomicWriteSerialized(file, compressColdJson(JSON.stringify(report)));
          reportPath = relativeToRoot(this.root, path.join(committedRevisionPath, directory, `${safePart(id)}.json.gz`));
        } else reportPath = null;
      }
      if (deferred) deferred.metadata = metadata;
      return { id, match:matchWithoutReport(match), reportPath, reportMeta:metadata };
    });
    paths.clear();
    entries.filter(entry => entry.reportPath).forEach(entry => paths.set(entry.id, entry.reportPath));
    return entries;
  }

  deferPersistedMatches(matches, paths) {
    for (const match of matches ?? []) {
      const raw = trackedRawReference(match), reference = paths.get(String(raw.id));
      if (!reference) continue;
      const info = deferredReport(raw), metadata = info ? info.metadata : reportMetadata(raw.report);
      attachDeferredReport(raw, { reference, metadata, read:ref => this.readColdJson(ref) });
    }
  }

  writeMatches(revisionPath, committedRevisionPath, state, options, previousReference) {
    const previousIndex = this.readObjectShard(previousReference, { entries:[] });
    const entries = this.writeMatchEntries(revisionPath, committedRevisionPath, state.matches, options, previousIndex.entries, this.matchReportPaths);
    return this.writeRevisionJson(revisionPath, "matches-index.json", { schemaVersion:2, entries }, previousReference);
  }

  writeSeasonFinal(revisionPath, committedRevisionPath, tournament, options, previousReference) {
    const previousIndex = this.readObjectShard(previousReference, { entries:[] });
    const entries = this.writeMatchEntries(revisionPath, committedRevisionPath, tournament?.matches, options, previousIndex.entries, this.seasonFinalReportPaths, "season-final-reports");
    const metadata = tournament ? Object.fromEntries(Object.keys(tournament).filter(key => key !== "matches").map(key => [key, tournament[key]])) : null;
    return this.writeRevisionJson(revisionPath, "season-final-index.json", { schemaVersion:2, tournament:metadata, entries }, previousReference);
  }

  writeLedger(revisionPath, entries, previousReference) {
    const previousEntries = previousReference?.segments ?? (previousReference ? [previousReference] : []);
    const canAppend = previousEntries.length > 0
      && entries.length >= this.ledgerCount
      && matchIdsMatch(entries[0], this.ledgerCount ? { id:this.ledgerFirstId } : entries[0])
      && (!this.ledgerTail || matchIdsMatch(entries[this.ledgerCount - 1], this.ledgerTail));
    if (canAppend && entries.length === this.ledgerCount) return { segments:previousEntries, count:entries.length };
    const coalesce = canAppend && previousEntries.length >= this.maxLogSegments;
    const newEntries = canAppend && !coalesce ? entries.slice(this.ledgerCount) : entries;
    if (!newEntries.length && previousEntries.length) return { segments:previousEntries, count:entries.length };
    const segmentPath = path.join(revisionPath, "ledger.ndjson");
    writeNdjson(segmentPath, newEntries);
    const segments = canAppend && !coalesce ? [...previousEntries, relativeToRoot(this.root, segmentPath)] : [relativeToRoot(this.root, segmentPath)];
    this.ledgerCount = entries.length;
    this.ledgerTail = entries.at(-1) ?? null;
    this.ledgerFirstId = entries[0]?.id ?? null;
    return { segments, count:entries.length };
  }

  writeAssets(revisionPath, assets, previousReference, options = {}) {
    const { cards = {}, transactions = [], ...meta } = assets;
    const cardsByOwner = {};
    Object.values(cards).forEach((card) => {
      const ownerId = String(card.ownerId ?? "unknown");
      cardsByOwner[ownerId] ??= {};
      cardsByOwner[ownerId][card.id] = card;
    });
    const cardRefs = {};
    Object.entries(cardsByOwner).forEach(([ownerId, ownerCards]) => {
      const previous = previousReference?.cards?.[ownerId], cached = this.ownerCardSnapshots.get(ownerId), entries = Object.entries(ownerCards);
      const unchanged = !options.forceFull && cached && previous && cached.reference === previous && cached.cards.size === entries.length && entries.every(([id, card]) => {
        const known = cached.cards.get(id), version = trackedSubtreeVersion(card);
        return version !== null && known?.raw === trackedRawReference(card) && known.version === version;
      });
      if (unchanged && existsSync(resolveRef(this.root, previous))) cardRefs[ownerId] = previous;
      else {
        cardRefs[ownerId] = this.writeRevisionJson(revisionPath, `cards/${safePart(ownerId)}.json`, ownerCards, previous);
        this.ownerCardSnapshots.set(ownerId, { reference:cardRefs[ownerId], cards:new Map(entries.map(([id, card]) => [id, { raw:trackedRawReference(card), version:trackedSubtreeVersion(card) }])) });
      }
    });
    for (const ownerId of this.ownerCardSnapshots.keys()) if (!Object.hasOwn(cardsByOwner, ownerId)) this.ownerCardSnapshots.delete(ownerId);
    const previousSegments = previousReference?.transactions?.segments ?? (previousReference?.transactions ? [previousReference.transactions] : []);
    const canAppend = previousSegments.length > 0
      && transactions.length >= this.assetTransactionCount
      && (!this.assetTransactionTail || transactions[this.assetTransactionCount - 1]?.id === this.assetTransactionTail.id);
    const coalesce = canAppend && previousSegments.length >= this.maxLogSegments;
    const newTransactions = canAppend && !coalesce ? transactions.slice(this.assetTransactionCount) : transactions;
    let transactionSegments = previousSegments;
    if (newTransactions.length || !previousSegments.length || !canAppend) {
      const transactionPath = path.join(revisionPath, "asset-transactions.ndjson");
      writeNdjson(transactionPath, newTransactions);
      transactionSegments = canAppend && !coalesce ? [...previousSegments, relativeToRoot(this.root, transactionPath)] : [relativeToRoot(this.root, transactionPath)];
    }
    this.assetTransactionCount = transactions.length;
    this.assetTransactionTail = transactions.at(-1) ?? null;
    return {
      meta:this.writeRevisionJson(revisionPath, "assets-meta.json", meta, previousReference?.meta),
      cards:cardRefs,
      transactions:{ segments:transactionSegments, count:transactions.length },
    };
  }

  writePacks(revisionPath, packs, previousReference = null, options = {}) {
    const { inventory = {}, ...meta } = packs;
    const inventoryRefs = this.writeMapShards(revisionPath, "packs", inventory, previousReference?.inventory ?? {}, options);
    return {
      meta:this.writeRevisionJson(revisionPath, "packs-meta.json", meta, previousReference?.meta),
      inventory:inventoryRefs,
    };
  }

  writeArchives(revisionPath, committedRevisionPath, archives, previousReference, options = {}) {
    const previousEntries = new Map((previousReference?.entries ?? []).map((entry) => [String(entry.key), entry]));
    const entries = archives.map((archive, index) => {
      const key = archiveKey(archive, index);
      const previous = previousEntries.get(key);
      let archivePath = previous?.path ?? this.archivePaths.get(key) ?? null;
      const previousPath = resolveRef(this.root, archivePath);
      if (!previousPath || !existsSync(previousPath) || options.forceFull && !archivePath.endsWith(".gz")) {
        const fullArchive = previousPath && existsSync(previousPath) ? this.coldCache.read(previousPath) : archive;
        const filePath = path.join(revisionPath, "archives", `${safePart(key)}.json.gz`);
        atomicWriteSerialized(filePath, compressColdJson(JSON.stringify(fullArchive)));
        archivePath = relativeToRoot(this.root, path.join(committedRevisionPath, "archives", `${safePart(key)}.json.gz`));
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
    const index = this.writeRevisionJson(revisionPath, "archives-index.json", { schemaVersion:2, entries }, previousReference?.index);
    return { index, entries };
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
    try {
      return measureRuntimeSync("league.shardCleanup", () => {
        const plan = planShardGarbageCollection(this.root, manifest, { backupDir:this.backupDir, maximumFiles:this.maxCleanupFiles });
        return applyShardGarbageCollection(plan);
      });
    } catch (error) {
      // A corrupt/missing current or backup reference must never turn into data deletion.
      console.warn("YFFM1 分片清理已跳过：", error.message);
      return { skipped:true, error:error.message };
    }
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
