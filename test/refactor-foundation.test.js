import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCampaignApiClient } from "../client/core/campaign-api-client.js";
import { createCampaignStore } from "../client/core/campaign-store.js";
import {
  CHALLENGE_SECOND_LEG_COOLDOWN_MS,
  CHALLENGE_TOTAL_DURATION_MS,
} from "../shared/config/challenge.mjs";
import { DRAFT_SIZE, LINE_KEYS, MINIMUM_PLAYERS_PER_LINE } from "../shared/config/draft.mjs";
import { GOLD_LEDGER_LIMIT, STARTING_GOLD } from "../shared/config/economy.mjs";
import {
  MARITIME_ANGULAR_SECTOR_DEGREES,
  MARITIME_MAX_RANGE_KM,
} from "../shared/config/maritime.mjs";
import {
  CAMPAIGN_SAVE_VERSION,
  JsonCampaignRepository,
} from "../server/infrastructure/json-campaign-repository.mjs";
import {
  CHALLENGE_SECOND_LEG_COOLDOWN_MS as SERVICE_SECOND_LEG_COOLDOWN_MS,
  CHALLENGE_TOTAL_DURATION_MS as SERVICE_TOTAL_DURATION_MS,
  DRAFT_SIZE as SERVICE_DRAFT_SIZE,
  LINE_KEYS as SERVICE_LINE_KEYS,
  STARTING_GOLD as SERVICE_STARTING_GOLD,
} from "../campaign-service.mjs";
import { SECOND_LEG_COOLDOWN_MS as BROADCAST_SECOND_LEG_COOLDOWN_MS } from "../campaign-broadcast.js";

test("refactored gameplay parameters preserve legacy exports from one source", () => {
  assert.equal(STARTING_GOLD, 1_000_000);
  assert.equal(GOLD_LEDGER_LIMIT, 200);
  assert.equal(DRAFT_SIZE, 22);
  assert.equal(MINIMUM_PLAYERS_PER_LINE, 2);
  assert.deepEqual(LINE_KEYS, ["GK", "DEF", "MID", "ATT"]);
  assert.equal(MARITIME_MAX_RANGE_KM, 900);
  assert.equal(MARITIME_ANGULAR_SECTOR_DEGREES, 12);
  assert.equal(SERVICE_STARTING_GOLD, STARTING_GOLD);
  assert.equal(SERVICE_DRAFT_SIZE, DRAFT_SIZE);
  assert.equal(SERVICE_LINE_KEYS, LINE_KEYS);
  assert.equal(SERVICE_SECOND_LEG_COOLDOWN_MS, CHALLENGE_SECOND_LEG_COOLDOWN_MS);
  assert.equal(SERVICE_TOTAL_DURATION_MS, CHALLENGE_TOTAL_DURATION_MS);
  assert.equal(BROADCAST_SECOND_LEG_COOLDOWN_MS, CHALLENGE_SECOND_LEG_COOLDOWN_MS);
});

test("campaign API client owns token persistence and authenticated requests", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  let request = null;
  const client = createCampaignApiClient({
    storage,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ state: { ready: true } }) };
    },
  });

  assert.equal(client.hasToken(), false);
  client.setToken("session-token");
  assert.equal(client.hasToken(), true);
  const response = await client.request("/api/campaign/state");
  assert.equal(response.state.ready, true);
  assert.equal(request.url, "/api/campaign/state");
  assert.equal(request.options.headers.authorization, "Bearer session-token");

  client.clearToken();
  assert.equal(client.hasToken(), false);
  assert.equal(values.size, 0);
});

test("JSON campaign repository round-trips saves and tolerates invalid legacy files", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "yellowdogs-repository-"));
  const dataPath = path.join(directory, "campaign.json");
  const repository = new JsonCampaignRepository({ dataPath });
  try {
    assert.equal(repository.load(), null);
    repository.save({ accounts: { player: { id: "player", gold: STARTING_GOLD } }, world: { schemaVersion: 4 } });
    const saved = repository.load();
    assert.equal(saved.version, CAMPAIGN_SAVE_VERSION);
    assert.equal(saved.accounts.player.gold, STARTING_GOLD);
    assert.equal(saved.world.schemaVersion, 4);

    writeFileSync(dataPath, "{not-json");
    assert.equal(repository.load(), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("campaign store publishes ordered server snapshot changes", () => {
  const store = createCampaignStore({ revision: 1 });
  const changes = [];
  const unsubscribe = store.subscribe((change) => changes.push(change));
  const next = { revision: 2 };

  assert.equal(store.getVersion(), 0);
  assert.equal(store.setState(next, { source: "poll" }), next);
  assert.equal(store.getState(), next);
  assert.equal(store.getVersion(), 1);
  assert.equal(changes[0].previousState.revision, 1);
  assert.equal(changes[0].state.revision, 2);
  assert.equal(changes[0].source, "poll");
  unsubscribe();
  store.setState({ revision: 3 });
  assert.equal(changes.length, 1);
});
