import test from "node:test";
import assert from "node:assert/strict";
import { createTrainingController, trainingPanelMarkup, trainingPickerMarkup, trainingResultMarkup, trainingProgress } from "../client/buildings/training-controller.js";
import { createCampaignStore } from "../client/core/campaign-store.js";
import { PLAYER_ATTRIBUTE_LABELS } from "../shared/config/player-attributes.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const players = ["ATT", "MID", "DEF", "GK"].map((pool) => ({ id: pool, playerId: pool, pool, name: `${pool}球员`, grade: "C", overall: 70, attributes: Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map((key) => [key, 70])), canTrain: true }));
const baseView = { building: { id: "b", level: 1, status: "active" }, territoryId: "t", territoryLabel: "测试地块", capacity: 1, tasks: [], players, serverNow: 1000 };
function fixture() {
  let clock = 1000, timer;
  const document = { addEventListener() {} };
  const facilityActions = { innerHTML: "", hidden: true }, demolitions = [];
  const panelContent = { innerHTML: "" }, pickerContent = { innerHTML: "" }, title = { textContent: "" };
  const root = () => ({ hidden: true, ownerDocument: document, events: {}, querySelectorAll() { return []; }, addEventListener(name, fn) { this.events[name] = fn; } });
  const windowRoot = { ...root(), querySelector: selector => selector === "[data-facility-actions]" ? facilityActions : panelContent };
  const pickerRoot = { ...root(), querySelector: (selector) => selector === "[data-training-picker-title]" ? title : pickerContent };
  const notifications = { ...root(), innerHTML: "" };
  const state = { playerId: "p", setupComplete: true, buildings: { territories: { t: { buildings: [baseView.building] } } }, draft: { roster: players }, training: { tasks: [], serverNow: 1000 } };
  const store = createCampaignStore(state), requests = [], toasts = [];
  const request = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  const controller = createTrainingController({ onDemolish: value => demolitions.push(value), windowRoot, pickerRoot, notifications, getCampaignState: store.getState, getCampaignRequest: () => request, campaignStore: store, showToast: (message) => toasts.push(message), now: () => clock, setIntervalImpl(fn) { timer = fn; } });
  const click = (element, selector, dataset = {}) => element.events.click({ target: { closest: (value) => value === selector ? { dataset } : null } });
  return { controller, facilityActions, demolitions, windowRoot, pickerRoot, notifications, panelContent, pickerContent, title, requests, store, toasts, click, tick: () => timer(), setTime: (time) => { clock = time; } };
}

test("four position frames contain level-based seats and picker shows only matching players", () => {
  const html = trainingPanelMarkup(baseView);
  assert.equal((html.match(/class="training-group"/g) ?? []).length, 4);
  assert.equal((html.match(/data-training-slot=/g) ?? []).length, 4);
  assert.equal((trainingPanelMarkup({ ...baseView, capacity: 3 }).match(/data-training-slot=/g) ?? []).length, 12);
  const picker = trainingPickerMarkup(players, "ATT");
  assert.match(picker, /ATT球员/); assert.doesNotMatch(picker, /MID球员|DEF球员|GK球员/);
  assert.match(trainingPickerMarkup([{ ...players[0], training: { taskId: "busy" } }], "ATT"), /data-training-player="ATT" disabled/);
});

test("completed results show all 26 values with only earned gains highlighted", () => {
  const html = trainingResultMarkup(players[0], { passing: 2, reflexes: 3 });
  assert.equal((html.match(/<dt>/g) ?? []).length, 26);
  assert.equal((html.match(/class="is-improved"/g) ?? []).length, 2);
  assert.match(html, /本次训练 \+5/); assert.match(html, /<em>\+2<\/em>/); assert.match(html, /<em>\+3<\/em>/);
  assert.equal(trainingProgress({ startedAt: 1000, completesAt: 601000 }, 301000).percent, 50);
});

test("empty seat opens player cards; direct start locks double clicks and completion opens gains", async () => {
  const f = fixture(); f.controller.open({ territoryId: "t", buildingId: "b" });
  f.requests[0].resolve(structuredClone(baseView)); await flush();
  f.click(f.windowRoot, "[data-training-pool]", { trainingPool: "ATT", trainingSlot: "0" });
  assert.equal(f.pickerRoot.hidden, false); assert.match(f.pickerContent.innerHTML, /ATT球员/);
  assert.doesNotMatch(f.pickerContent.innerHTML, /MID球员/);
  f.click(f.pickerRoot, "[data-training-player]", { trainingPlayer: "ATT" });
  f.click(f.pickerRoot, "[data-training-player]", { trainingPlayer: "ATT" });
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].url, "/api/campaign/training/start");
  assert.equal(f.requests[1].options.body.pool, "ATT"); assert.equal(f.requests[1].options.body.slot, 0);
  const task = { id: "train", buildingId: "b", territoryId: "t", playerId: "ATT", playerName: "ATT球员", pool: "ATT", slot: 0, status: "working", startedAt: 1000, completesAt: 601000 };
  f.requests[1].resolve({ task, state: { ...f.store.getState(), training: { tasks: [task], serverNow: 1000 } } }); await flush();
  f.requests[2].resolve({ ...baseView, tasks: [task] }); await flush();
  assert.equal(f.pickerRoot.hidden, true); assert.match(f.panelContent.innerHTML, /data-training-progress="train"/);
  f.store.setState({ ...f.store.getState(), training: { tasks: [{ ...task, status: "completed", gains: { passing: 5 } }], serverNow: 601000 } });
  assert.match(f.panelContent.innerHTML, /训练完成/);
  f.click(f.windowRoot, "[data-training-pool]", { trainingPool: "ATT", trainingSlot: "0" });
  assert.equal(f.pickerRoot.hidden, false); assert.match(f.pickerContent.innerHTML, /26 项能力/);
  assert.match(f.pickerContent.innerHTML, /本次训练 \+5/); assert.match(f.title.textContent, /训练提升/);
  f.controller.close();
});

test("switching or closing facilities ignores stale reads and failed starts retain the same retry ID", async () => {
  const f = fixture(); f.controller.open({ territoryId: "t", buildingId: "old" });
  f.controller.open({ territoryId: "t", buildingId: "b" });
  f.requests[1].resolve(structuredClone(baseView)); await flush();
  f.requests[0].resolve({ ...baseView, territoryLabel: "过期响应" }); await flush();
  assert.doesNotMatch(f.panelContent.innerHTML, /过期响应/);
  f.click(f.windowRoot, "[data-training-pool]", { trainingPool: "ATT", trainingSlot: "0" });
  f.click(f.pickerRoot, "[data-training-player]", { trainingPlayer: "ATT" });
  const id = f.requests[2].options.body.requestId;
  f.requests[2].reject(new Error("network error")); await flush();
  f.requests[3].resolve(structuredClone(baseView)); await flush();
  f.click(f.pickerRoot, "[data-training-player]", { trainingPlayer: "ATT" });
  assert.equal(f.requests[4].options.body.requestId, id);
  f.controller.close(); f.requests[4].reject(new Error("late failure")); await flush();
  assert.equal(f.windowRoot.hidden, true); assert.equal(f.pickerRoot.hidden, true);
});


test("squad switch combines with seat position and survives campaign refresh", async () => {
  const f = fixture();
  const roster = [
    { ...players[0], id: "away", playerId: "away", name: "远征前锋", expedition: true },
    { ...players[0], id: "home", playerId: "home", name: "留守前锋", expedition: false },
    { ...players[1], id: "mid", playerId: "mid", name: "远征中场", expedition: true },
  ];
  f.controller.open({ territoryId: "t", buildingId: "b" });
  f.requests[0].resolve({ ...baseView, players: roster }); await flush();
  f.click(f.windowRoot, "[data-training-pool]", { trainingPool: "ATT", trainingSlot: "0" });
  assert.match(f.pickerContent.innerHTML, /远征前锋/); assert.match(f.pickerContent.innerHTML, /留守前锋/);
  assert.doesNotMatch(f.pickerContent.innerHTML, /远征中场/);
  f.click(f.pickerRoot, "[data-training-squad]", { trainingSquad: "expedition" });
  assert.match(f.pickerContent.innerHTML, /远征前锋/); assert.doesNotMatch(f.pickerContent.innerHTML, /留守前锋|远征中场/);
  f.store.setState({ ...f.store.getState(), draft: { roster }, playerSquads: { assignments: { away: "expedition", home: "garrison", mid: "expedition" } } });
  assert.match(f.pickerContent.innerHTML, /远征前锋/); assert.doesNotMatch(f.pickerContent.innerHTML, /留守前锋/);
  f.click(f.pickerRoot, "[data-training-squad]", { trainingSquad: "garrison" });
  assert.match(f.pickerContent.innerHTML, /留守前锋/); assert.doesNotMatch(f.pickerContent.innerHTML, /远征前锋/);
  f.click(f.pickerRoot, "[data-training-squad]", { trainingSquad: "all" });
  assert.match(f.pickerContent.innerHTML, /远征前锋/); assert.match(f.pickerContent.innerHTML, /留守前锋/);
  f.controller.close();
});


test("training cards sort by descending effective ability within each squad without mutating the roster", () => {
  const roster = [
    { ...players[0], playerId: "low", overall: 65, expedition: true },
    { ...players[0], playerId: "high", overall: 91, expedition: false },
    { ...players[0], playerId: "boosted", overall: 80, effectiveOverall: 94, expedition: true },
  ];
  const order = (squadFilter) => [...trainingPickerMarkup(roster, "ATT", { squadFilter }).matchAll(/data-training-player="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order("all"), ["boosted", "high", "low"]);
  assert.deepEqual(order("expedition"), ["boosted", "low"]);
  assert.deepEqual(order("garrison"), ["high"]);
  assert.deepEqual(roster.map((player) => player.playerId), ["low", "high", "boosted"]);
});


test("occupied seats render the matching player's card before the progress bar", () => {
  const task = { id: "train", buildingId: "b", pool: "ATT", slot: 0, playerId: "ATT", playerName: "ATT球员", status: "working" };
  const player = { ...players[0], art: { url: "/assets/test-att.png" }, upgradeLevel: 2 };
  const html = trainingPanelMarkup({ ...baseView, tasks: [task], players: [player] });
  assert.match(html, /training-seat-card/);
  assert.match(html, /src="\/assets\/test-att.png"/);
  assert.match(html, /player-card-enhancement/);
  assert.ok(html.indexOf('data-player-card-id="ATT"') < html.indexOf('data-training-progress="train"'));
  const completed = trainingPanelMarkup({ ...baseView, tasks: [{ ...task, status: "completed" }], players: [player] });
  assert.match(completed, /training-seat-card/); assert.match(completed, /查看能力提升/);
});

test("all active training notices keep ticking while the panel is closed and clear on completion or account switch", () => {
  const f = fixture();
  const tasks = [0, 1].map((i) => ({ id: `task-${i}`, buildingId: `b-${i}`, pool: "ATT", playerName: `球员${i}`, startedAt: 1000, completesAt: 601000, status: "working" }));
  f.store.setState({ ...f.store.getState(), training: { tasks: [...tasks, { ...tasks[0], id: "done", playerName: "已完成球员", status: "completed" }], serverNow: 1000 } });
  assert.equal(f.notifications.hidden, false);
  assert.match(f.notifications.innerHTML, /球员0/); assert.match(f.notifications.innerHTML, /球员1/);
  assert.doesNotMatch(f.notifications.innerHTML, /已完成球员/);
  const bar = { dataset: { trainingProgress: "task-0" }, value: null, line: { style: {} }, setAttribute(name, value) { this.value = value; }, querySelector() { return this.line; } };
  const countdown = { dataset: { trainingCountdown: "task-0" }, textContent: "" };
  f.notifications.querySelectorAll = (selector) => selector === "[data-training-progress]" ? [bar] : [countdown];
  const html = f.notifications.innerHTML;
  f.controller.close(); f.setTime(301000); f.tick();
  assert.equal(f.windowRoot.hidden, true);
  assert.equal(bar.value, "50"); assert.equal(bar.line.style.width, "50%");
  assert.equal(countdown.textContent, "剩余 05:00");
  assert.equal(f.notifications.innerHTML, html);
  f.store.setState({ ...f.store.getState(), training: { tasks: tasks.map((task) => ({ ...task, status: "completed" })), serverNow: 601000 } });
  assert.equal(f.notifications.hidden, true); assert.equal(f.notifications.innerHTML, "");
  f.store.setState({ ...f.store.getState(), training: { tasks, serverNow: 1000 } });
  assert.equal(f.notifications.hidden, false);
  f.store.setState({ playerId: "other", setupComplete: true });
  assert.equal(f.notifications.hidden, true);
});


test("notification cancellation works with panel closed, locks repeated clicks and allows error retry", async () => {
  const f = fixture();
  const task = { id: "cancel-me", buildingId: "b", pool: "ATT", playerName: "ATT球员", status: "working", startedAt: 1000, completesAt: 601000 };
  f.store.setState({ ...f.store.getState(), training: { tasks: [task], serverNow: 1000 } });
  assert.match(f.notifications.innerHTML, /data-training-cancel="cancel-me"/);
  f.click(f.notifications, "[data-training-cancel]", { trainingCancel: task.id });
  f.click(f.notifications, "[data-training-cancel]", { trainingCancel: task.id });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/campaign/training/cancel");
  assert.deepEqual(f.requests[0].options.body, { taskId: task.id });
  assert.match(f.notifications.innerHTML, /data-training-cancel="cancel-me" disabled/);
  f.requests[0].reject(new Error("temporary failure")); await flush();
  assert.doesNotMatch(f.notifications.innerHTML, /data-training-cancel="cancel-me" disabled/);
  f.click(f.notifications, "[data-training-cancel]", { trainingCancel: task.id });
  f.requests[1].resolve({ task: { ...task, status: "cancelled" }, state: { ...f.store.getState(), training: { tasks: [], serverNow: 1000 } } }); await flush();
  assert.equal(f.notifications.hidden, true); assert.equal(f.windowRoot.hidden, true);
  assert.match(f.toasts.at(-1), /已取消/);
});


test("finish result locks repeat actions, persists clearing and closes only the result", async () => {
  const f = fixture();
  const task = { id: "done", buildingId: "b", pool: "ATT", slot: 0, playerId: "ATT", playerName: "ATT球员", status: "completed", gains: { passing: 5 } };
  f.controller.open({ territoryId: "t", buildingId: "b" });
  f.requests[0].resolve({ ...structuredClone(baseView), tasks: [task] }); await flush();
  f.click(f.windowRoot, "[data-training-pool]", { trainingPool: "ATT", trainingSlot: "0" });
  assert.match(f.pickerContent.innerHTML, /training-result-body/);
  assert.match(f.pickerContent.innerHTML, /training-result-actions/);
  assert.match(f.pickerContent.innerHTML, /data-training-finish/);
  f.click(f.pickerRoot, "[data-training-finish]");
  f.click(f.pickerRoot, "[data-training-finish]");
  f.click(f.pickerRoot, "[data-training-again]");
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].url, "/api/campaign/training/finish");
  assert.deepEqual(f.requests[1].options.body, { taskId: "done" });
  assert.match(f.pickerContent.innerHTML, /26 项能力/);
  assert.match(f.pickerContent.innerHTML, /data-training-finish type="button" disabled/);
  f.requests[1].resolve({ task: { ...task, status: "finished" }, state: f.store.getState() }); await flush();
  f.requests[2].resolve(structuredClone(baseView)); await flush();
  assert.equal(f.pickerRoot.hidden, true);
  assert.equal(f.windowRoot.hidden, false);
  assert.doesNotMatch(f.panelContent.innerHTML, /is-occupied|查看能力提升/);
  assert.match(f.toasts.at(-1), /席位已腾空/);
});

test("failed finish retains its result for retry and closing prevents stale responses reopening it", async () => {
  const f = fixture();
  const task = { id: "done", buildingId: "b", pool: "ATT", slot: 0, playerId: "ATT", playerName: "ATT球员", status: "completed", gains: { passing: 5 } };
  const view = { ...structuredClone(baseView), tasks: [task] };
  f.controller.open({ territoryId: "t", buildingId: "b" });
  f.requests[0].resolve(view); await flush();
  f.click(f.windowRoot, "[data-training-pool]", { trainingPool: "ATT", trainingSlot: "0" });
  f.click(f.pickerRoot, "[data-training-finish]");
  f.requests[1].reject(new Error("temporary failure")); await flush();
  f.requests[2].resolve(view); await flush();
  assert.equal(f.pickerRoot.hidden, false);
  assert.doesNotMatch(f.pickerContent.innerHTML, /data-training-finish type="button" disabled/);
  f.click(f.pickerRoot, "[data-training-finish]");
  f.controller.close();
  f.requests[3].resolve({ task: { ...task, status: "finished" }, state: f.store.getState() }); await flush();
  assert.equal(f.windowRoot.hidden, true); assert.equal(f.pickerRoot.hidden, true);
  assert.equal(f.requests.length, 4);
});

test("training footer invokes confirmation for the viewed building and closes after its removal", async () => {
  const f=fixture(); f.controller.open({territoryId:"t",buildingId:"b"});
  f.requests[0].resolve(baseView); await flush();
  assert.equal(f.facilityActions.hidden,false);
  assert.match(f.facilityActions.innerHTML,/data-facility-demolish/);
  f.click(f.windowRoot,"[data-facility-demolish]");
  assert.deepEqual(f.demolitions,[{territoryId:"t",buildingId:"b"}]);
  f.store.setState({...f.store.getState(),buildings:{territories:{t:{buildings:[]}}}});
  assert.equal(f.windowRoot.hidden,true);
});

function observePicker(f) {
 let html="", writes=0, scroller={scrollTop:0};
 Object.defineProperty(f.pickerContent,"innerHTML",{get:()=>html,set:value=>{html=value;writes++;scroller={scrollTop:0};}});
 f.pickerContent.querySelector=selector=>[".training-card-list",".training-result-body"].includes(selector)?scroller:null;
 return {get writes(){return writes;},get scroller(){return scroller;}};
}
test("training polling retains nested scroll and avoids rebuilding unchanged hydrated cards",async()=>{
 const f=fixture(),dom=observePicker(f);f.controller.open({territoryId:"t",buildingId:"b"});
 f.requests[0].resolve(structuredClone(baseView));await flush();
 f.click(f.windowRoot,"[data-training-pool]",{trainingPool:"ATT",trainingSlot:"0"});
 dom.scroller.scrollTop=650;
 const poll=()=>f.store.setState(structuredClone(f.store.getState()));poll();
 assert.equal(dom.scroller.scrollTop,650,"preserve scroll even when card data changes representation");
 const original=dom.scroller,writes=dom.writes;poll();poll();
 assert.equal(dom.scroller,original);assert.equal(dom.writes,writes);
 const next=structuredClone(f.store.getState());next.draft.roster[0].training={taskId:"elsewhere"};f.store.setState(next);
 assert.match(f.pickerContent.innerHTML,/data-training-player="ATT" disabled/);
 assert.equal(dom.scroller.scrollTop,650,"live eligibility changes retain scroll");
 f.click(f.pickerRoot,"[data-training-squad]",{trainingSquad:"garrison"});assert.equal(dom.scroller.scrollTop,0);
 dom.scroller.scrollTop=300;f.click(f.pickerRoot,"[data-training-picker-close]");
 f.click(f.windowRoot,"[data-training-pool]",{trainingPool:"ATT",trainingSlot:"0"});assert.equal(dom.scroller.scrollTop,0);
 f.controller.close();
});
test("completed training result scroll survives live player updates",async()=>{
 const f=fixture(),dom=observePicker(f),task={id:"done",buildingId:"b",pool:"ATT",slot:0,playerId:"ATT",playerName:"ATT球员",status:"completed",gains:{passing:5}};
 f.controller.open({territoryId:"t",buildingId:"b"});f.requests[0].resolve({...structuredClone(baseView),tasks:[task]});await flush();
 f.click(f.windowRoot,"[data-training-pool]",{trainingPool:"ATT",trainingSlot:"0"});dom.scroller.scrollTop=160;
 f.store.setState({...structuredClone(f.store.getState()),training:{tasks:[task],serverNow:2000}});
 assert.match(f.pickerContent.innerHTML,/26 项能力/);assert.equal(dom.scroller.scrollTop,160);f.controller.close();
});
test("live training eligibility uses the current wonder-adjusted points requirement",async()=>{
 const f=fixture(),player={...players[0],attributes:Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map(key=>[key,99]))};player.attributes.passing=94;
 f.controller.open({territoryId:"t",buildingId:"b"});f.requests[0].resolve({...structuredClone(baseView),players:[player]});await flush();
 f.click(f.windowRoot,"[data-training-pool]",{trainingPool:"ATT",trainingSlot:"0"});
 f.store.setState({...f.store.getState(),draft:{roster:[player]},training:{tasks:[],rules:{attributePoints:6}}});
 assert.match(f.pickerContent.innerHTML,/data-training-player="ATT" disabled/);f.controller.close();
});


test("picker shows actual prices and disables unaffordable cards; result explains rounded rating growth",()=>{
  const html=trainingPickerMarkup([{...players[0],costGold:2000,canAfford:false}],'ATT');
  assert.match(html,/data-training-player="ATT" disabled/);assert.match(html,/2,000 金币/);assert.match(html,/金币不足/);assert.match(html,/全额退款/);
  assert.match(trainingResultMarkup(players[1],{passing:5},{overallBefore:70,overallAfter:71}),/总评 70 → 71（\+1）/);
  assert.match(trainingResultMarkup(players[0],{passing:5},{overallBefore:70,overallAfter:70}),/本次未升档/);
});

test("world polls refresh training affordability and preserve medical restrictions",async()=>{
  const f=fixture();f.controller.open({territoryId:'t',buildingId:'b'});f.requests[0].resolve({...baseView,gold:1000});await flush();
  f.click(f.windowRoot,'[data-training-pool]',{trainingPool:'ATT',trainingSlot:'0'});
  f.store.setState({...f.store.getState(),wallet:{gold:499}});
  assert.match(f.pickerContent.innerHTML,/data-training-player="ATT" disabled/);assert.match(f.pickerContent.innerHTML,/金币不足/);
  f.store.setState({...f.store.getState(),wallet:{gold:1000},draft:{roster:[{...players[0],medical:{taskId:'treatment'}}]}});
  assert.match(f.pickerContent.innerHTML,/data-training-player="ATT" disabled/);assert.match(f.pickerContent.innerHTML,/暂不可训练/);
  f.controller.close();
});
