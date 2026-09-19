import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignStore } from "../client/core/campaign-store.js";
import { constructionProgress, createConstructionNotifications } from "../client/buildings/construction-notifications.js";

const building = { id: "build-1", type: "port", level: 1, status: "constructing", constructionStartedAt: 1000, completesAt: 61000 };
function initialState() {
  return { playerId: "p", scouting: { serverNow: 11000 }, buildings: {
    catalog: [{ type: "port", label: "港口", iconPath: "/assets/building-icons-v2/port.png" }],
    territories: { home: { ownerId: "p", canManage: true, buildings: [{ ...building }] } },
  } };
}
function fixture(state = initialState()) {
  let time = 6000, html = "", writes = 0, timerId = 0;
  const nodes = new Map(), events = {}, timers = new Map(), located = [];
  const root = { hidden: true, addEventListener: (type, fn) => { events[type] = fn; }, removeEventListener: type => { delete events[type]; },
    querySelectorAll: selector => nodes.get(selector) ?? [] };
  Object.defineProperty(root, "innerHTML", { get: () => html, set(value) {
    html = value; writes++; nodes.clear();
    for (const kind of ["progress", "time", "percent"]) {
      nodes.set(`[data-construction-${kind}]`, [...value.matchAll(new RegExp(`data-construction-${kind}="([^"]+)"`, "g"))].map(match => ({
        dataset: { ["construction" + kind[0].toUpperCase() + kind.slice(1)]: match[1] }, textContent: "", style: {}, attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; }, querySelector() { return this; },
      })));
    }
  } });
  const store = createCampaignStore(state);
  const controller = createConstructionNotifications({ notifications: root, campaignStore: store,
    getTerritoryLabel: id => id === "home" ? "冰岛 · 东北区" : id, onLocate: id => located.push(id), now: () => time,
    setIntervalImpl: callback => { timers.set(++timerId, callback); return timerId; }, clearIntervalImpl: id => timers.delete(id) });
  return { root, store, controller, timers, located, get writes() { return writes; },
    node: kind => nodes.get(`[data-construction-${kind}]`)[0],
    advance(ms) { time += ms; for (const callback of [...timers.values()]) callback(); },
    click(id) { events.click({ target: { closest: () => ({ dataset: { constructionLocate: id } }) } }); },
  };
}

test("construction notices restore own jobs with server time and tick without replacing interactive cards", () => {
  const state = initialState();
  state.buildings.territories.other = { ownerId: "q", canManage: false, buildings: [{ ...building, id: "secret" }] };
  state.buildings.territories.home.buildings.push({ ...building, id: "old-active", status: "active" });
  const f = fixture(state);
  assert.equal(f.root.hidden, false); assert.match(f.root.innerHTML, /港口|冰岛 · 东北区/);
  assert.doesNotMatch(f.root.innerHTML, /secret|old-active/);
  assert.equal(f.node("time").textContent, "剩余 00:50");
  assert.equal(f.node("progress").attributes["aria-valuenow"], "17");
  const writes = f.writes;
  f.advance(1000);
  assert.equal(f.node("time").textContent, "剩余 00:49"); assert.equal(f.writes, writes);
  f.click("build-1"); assert.deepEqual(f.located, ["home"]);
  f.controller.destroy(); assert.equal(f.timers.size, 0);
});

test("local countdown waits for server completion and the completed notice expires once", () => {
  const f = fixture(); f.advance(50000);
  assert.equal(f.node("time").textContent, "等待完工确认…");
  assert.doesNotMatch(f.root.innerHTML, /设施建成/);
  const next = structuredClone(f.store.getState()); next.scouting.serverNow = 61000;
  next.buildings.territories.home.buildings[0].status = "active";
  f.store.setState(next);
  assert.match(f.root.innerHTML, /设施建成/); assert.equal(f.node("time").textContent, "已完成");
  f.advance(7999); assert.equal(f.root.hidden, false);
  f.advance(1); assert.equal(f.root.hidden, true); assert.equal(f.timers.size, 0);
  f.store.setState(structuredClone(next)); assert.equal(f.root.hidden, true);
  f.controller.destroy();
});

test("losing ownership or switching account clears tasks and stale location clicks", () => {
  const f = fixture();
  const next = structuredClone(f.store.getState()); next.buildings.territories.home.ownerId = "q";
  f.store.setState(next); assert.equal(f.root.hidden, true); assert.equal(f.timers.size, 0);
  f.click("build-1"); assert.deepEqual(f.located, []);
  f.store.setState(initialState()); assert.equal(f.root.hidden, false);
  f.store.setState({ playerId: "other" }); assert.equal(f.root.hidden, true);
  f.store.setState(null); assert.equal(f.root.hidden, true); f.controller.destroy();
});

test("progress stays bounded and missing timestamps never generate NaN CSS", () => {
  assert.deepEqual(constructionProgress(building, 0), { percent: 0, remaining: 61000 });
  assert.deepEqual(constructionProgress(building, 62000), { percent: 100, remaining: 0 });
  assert.deepEqual(constructionProgress({ completesAt: 61000 }, 20000), { percent: 0, remaining: 41000 });
  assert.deepEqual(constructionProgress({}, 20000), { percent: 0, remaining: null });
});

test('wonder race notice survives polling and does not become a false completion notice',()=>{
 const f=fixture();const state=structuredClone(f.store.getState());state.buildings.territories.home.buildings=[];state.wonders={competitionNotices:[{id:'race',label:'埃菲尔铁塔',winnerName:'对手俱乐部',refundProduction:25,rewardId:'refund'}]};state.neutralRewards={pending:[{id:'refund'}]};f.store.setState(state);assert.equal(f.root.hidden,false);assert.match(f.root.innerHTML,/已率先建成/);assert.match(f.root.innerHTML,/25 一次性生产力/);assert.match(f.root.innerHTML,/data-wonder-race-reward/);assert.match(f.root.innerHTML,/>已读<\/button>/);assert.doesNotMatch(f.root.innerHTML,/设施建成|data-construction-progress/);const writes=f.writes;f.store.setState(structuredClone(state));assert.equal(f.writes,writes);state.wonders.competitionNotices=[];f.store.setState(state);assert.equal(f.root.hidden,true);f.controller.destroy();
});
