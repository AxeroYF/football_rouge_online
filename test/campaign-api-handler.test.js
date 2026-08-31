import assert from "node:assert/strict";
import test from "node:test";
import {
  createCampaignApiHandler,
  readJsonBody,
} from "../server/http/campaign-api-handler.mjs";

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = String(body ?? "");
    },
  };
}

function postRequest(body, headers = {}) {
  return {
    method: "POST",
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

test("campaign API handler exposes building catalog, territory view and mutations", async () => {
  const account = { id: "account", nickname: "经理" };
  const calls = [];
  const campaign = {
    authenticate: (token) => {
      assert.equal(token, "session-token");
      return account;
    },
    buildingCatalog: () => [{ type: "port" }],
    territoryBuildings: (value, territoryId) => ({ territoryId, canManage: value === account }),
    buildTerritoryBuilding: (value, territoryId, type) => {
      calls.push(["build", value.id, territoryId, type]);
      return { building: { type } };
    },
    upgradeTerritoryBuilding: (value, territoryId, buildingId) => {
      calls.push(["upgrade", value.id, territoryId, buildingId]);
      return { building: { id: buildingId, level: 2 } };
    },
    renameTerritoryBuilding: (value, territoryId, buildingId, name) => {
      calls.push(["rename", value.id, territoryId, buildingId, name]);
      return { building: { id: buildingId, name } };
    },
  };
  const handler = createCampaignApiHandler({ campaign });
  const auth = { authorization: "Bearer session-token" };

  const catalogResponse = responseRecorder();
  await handler({ method: "GET", headers: auth }, catalogResponse, "/api/campaign/buildings/catalog", "/api/campaign/buildings/catalog");
  assert.deepEqual(JSON.parse(catalogResponse.body), { catalog: [{ type: "port" }] });

  const territoryResponse = responseRecorder();
  await handler({ method: "GET", headers: auth }, territoryResponse, "/api/campaign/territory/buildings", "/api/campaign/territory/buildings?id=home");
  assert.deepEqual(JSON.parse(territoryResponse.body), { territoryId: "home", canManage: true });

  for (const [pathname, body] of [
    ["/api/campaign/territory/buildings/build", { territoryId: "home", type: "port" }],
    ["/api/campaign/territory/buildings/upgrade", { territoryId: "home", buildingId: "building-1" }],
    ["/api/campaign/territory/buildings/rename", { territoryId: "home", buildingId: "building-1", name: "新主场" }],
  ]) {
    const response = responseRecorder();
    await handler(postRequest(body, auth), response, pathname, pathname);
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(calls, [
    ["build", "account", "home", "port"],
    ["upgrade", "account", "home", "building-1"],
    ["rename", "account", "home", "building-1", "新主场"],
  ]);
});

test("campaign API handler keeps registration and authenticated state contracts", async () => {
  const account = { id: "account", nickname: "经理" };
  const campaign = {
    register: (nickname, password) => ({ token: `${nickname}:${password}` }),
    authenticate: (token) => {
      assert.equal(token, "session-token");
      return account;
    },
    state: (value) => {
      assert.equal(value, account);
      return { wallet: { gold: 100 } };
    },
  };
  const handler = createCampaignApiHandler({ campaign });

  const registrationResponse = responseRecorder();
  await handler(
    postRequest({ nickname: "经理", password: "secret12" }),
    registrationResponse,
    "/api/campaign/register",
    "/api/campaign/register",
  );
  assert.equal(registrationResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(registrationResponse.body), { token: "经理:secret12" });

  const stateResponse = responseRecorder();
  await handler(
    { method: "GET", headers: { authorization: "Bearer session-token" } },
    stateResponse,
    "/api/campaign/state",
    "/api/campaign/state",
  );
  assert.equal(stateResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(stateResponse.body), {
    profile: { id: "account", nickname: "经理" },
    state: { wallet: { gold: 100 } },
  });
});

test("campaign API handler exposes the authenticated YOOGLE player directory", async () => {
  const account = { id: "account", nickname: "经理" };
  const campaign = {
    authenticate: () => account,
    playerDirectory: (value) => {
      assert.equal(value, account);
      return { total: 1, players: [{ id: "player-1", name: "测试球员" }] };
    },
  };
  const handler = createCampaignApiHandler({ campaign });
  const response = responseRecorder();
  await handler(
    { method: "GET", headers: { authorization: "Bearer session-token" } },
    response,
    "/api/campaign/player-directory",
    "/api/campaign/player-directory",
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    playerDirectory: { total: 1, players: [{ id: "player-1", name: "测试球员" }] },
  });
});

test("campaign API request parsing keeps payload limits and invalid JSON errors", async () => {
  const invalidRequest = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("{invalid");
    },
  };
  await assert.rejects(() => readJsonBody(invalidRequest), (error) => error.statusCode === 400);

  const oversizedRequest = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("12345");
    },
  };
  await assert.rejects(
    () => readJsonBody(oversizedRequest, { maximumBytes: 4 }),
    (error) => error.statusCode === 413,
  );
});
