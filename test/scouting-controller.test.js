import test from "node:test";
import assert from "node:assert/strict";
import { createScoutingController } from "../client/buildings/scouting-controller.js";
import { createCampaignStore } from "../client/core/campaign-store.js";
import { SCOUTING_RULES, scoutingLevel } from "../shared/config/scouting.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ getTerritoryInfo = () => null } = {}) {
  let localTime = 1000, tick;
  const document = { addEventListener() {}, activeElement: null };
  const facilityActions = { innerHTML: "", hidden: true }, demolitions = [];
  const content = { innerHTML: "" }, meteors = { innerHTML: "", get firstElementChild() { return this.innerHTML ? {} : null; }, replaceChildren() { this.innerHTML = ""; } };
  function element() {
    const classes = new Set(), events = {};
    return {
      hidden: true, dataset: {}, ownerDocument: document, innerHTML: "", events, classes,
      classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
      closest() { return null; }, setAttribute() {},
      querySelector(selector) { return selector === "[data-facility-actions]" ? facilityActions : selector === "[data-scout-content]" ? content : selector === "[data-scout-meteors]" ? meteors : null; },
      querySelectorAll() { return []; }, addEventListener(name, listener) { events[name] = listener; },
    };
  }
  const windowRoot = element(), selectionRoot = element(), notifications = element(), requests = [];
  const initial = { playerId: "p", setupComplete: true, wallet: { gold: 1000 }, scouting: { rules: SCOUTING_RULES, tasks: [], serverNow: 1000 }, buildings: { territories: {} } };
  const store = createCampaignStore(initial);
  const request = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  const controller = createScoutingController({ onDemolish: value => demolitions.push(value), windowRoot, selectionRoot, notifications, getCampaignState: store.getState, getCampaignRequest: () => request, campaignStore: store, getTerritoryInfo, now: () => localTime, setIntervalImpl(callback) { tick = callback; } });
  const detail = (label) => ({ kind:"legacy", building: { id: label, status: "active", level: 1 }, territoryLabel: label, rules: SCOUTING_RULES, levelRules: scoutingLevel(1), serverNow: 1000 });
  const unit = (label="设施A") => ({...detail(label),kind:"unit",territoryId:"a",canDiscover:true,scout:{id:"scout-a",name:"Oliver Reed",level:1,territoryId:"a",territoryLabel:label,status:"idle",movableTerritoryIds:["b"]}});
  const center = label => ({...detail(label),kind:"center",scouts:[],capacity:2,recruitAvailable:2});
  const click = (selector, dataset = {}) => windowRoot.events.click({ target: { closest: (value) => value === selector ? { dataset } : null } });
  return { controller, content, meteors, facilityActions, demolitions, windowRoot, selectionRoot, notifications, requests, store, detail, unit, center, click, tick:()=>tick(), setTime:value=>localTime=value };
}

test("switching facilities or closing ignores stale scout detail responses", async () => {
  const f = fixture();
  f.controller.open({ territoryId: "a", buildingId: "a" });
  f.controller.open({ territoryId: "b", buildingId: "b" });
  f.requests[1].resolve(f.center("正确设施B")); await flush();
  f.requests[0].resolve(f.center("过期设施A")); await flush();
  assert.equal(f.windowRoot.hidden, false);
  assert.equal(f.selectionRoot.hidden, true);
  assert.match(f.content.innerHTML, /正确设施B/); assert.doesNotMatch(f.content.innerHTML, /过期设施A/);
  f.controller.open({ territoryId: "c", buildingId: "c" });
  f.controller.close(); f.requests[2].resolve(f.center("设施C")); await flush();
  assert.equal(f.windowRoot.hidden, true);
});

test("start locks repeated clicks and notifications open the same task with shared meteors", async () => {
  const f = fixture();
  f.controller.openUnit("scout-a");
  f.requests[0].resolve(f.unit("设施A")); await flush();
  f.click("[data-scout-start]"); f.click("[data-scout-start]");
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].options.body.scoutId, "scout-a");
  assert.ok(f.requests[1].options.body.requestId);
  f.requests[1].reject(new Error("temporary network error")); await flush();
  f.requests[2].resolve(f.unit("设施A")); await flush();
  const working = { id: "working", scoutId:"scout-a", territoryId: "a", buildingId: "a", territoryLabel: "设施A", startedAt: 1000, completesAt: 601000, status: "working", cards: [] };
  f.store.setState({ ...f.store.getState(), scouting: { rules: SCOUTING_RULES, scouts:[{...f.unit().scout,status:"working"}], tasks: [working], serverNow: 301000 } });
  assert.match(f.notifications.innerHTML, /球探发掘中/);
  assert.doesNotMatch(f.notifications.innerHTML, /data-scout-open-task|<button/);
  const requestCount = f.requests.length;
  f.notifications.events.click({ target: { closest: selector => selector === "[data-scout-open-task]" ? ({ dataset: { scoutOpenTask: "working" } }) : null } });
  assert.equal(f.requests.length, requestCount);
  const task = { id: "task", scoutId:"scout-a", territoryId: "a", buildingId: "a", territoryLabel: "设施A", startedAt: 1000, completesAt: 601000, status: "ready", cards: [0, 1, 2].map((i) => ({ playerId: `card-${i}`, name: `候选${i}`, grade: "C", overall: 70 })) };
  f.store.setState({ ...f.store.getState(), scouting: { rules: SCOUTING_RULES, scouts:[{...f.unit().scout,status:"ready"}], tasks: [task], serverNow: 601000 } });
  assert.match(f.notifications.innerHTML, /打开 · 选择球员/);
  assert.equal(f.notifications.hidden, false);
  assert.equal(f.windowRoot.hidden, false);
  assert.equal(f.selectionRoot.hidden, true);
  assert.doesNotMatch(f.meteors.innerHTML, /inventory-opening-meteors/);
  assert.match(f.content.innerHTML, /查看结果/);
  f.click("[data-scout-results]");
  assert.equal(f.windowRoot.hidden, true);
  assert.equal(f.selectionRoot.hidden, false);
  assert.match(f.meteors.innerHTML, /inventory-opening-meteors/);
  f.controller.close();
  f.notifications.events.click({ target: { closest: selector => selector === "[data-scout-open-task]" ? ({ dataset: { scoutOpenTask: "task" } }) : null } });
  const last = f.requests.at(-1);
  assert.match(last.url, /unit\?scoutId=scout-a/);
  last.resolve({ ...f.unit("设施A"), task }); await flush();
  assert.match(f.content.innerHTML, /候选0/);
  f.controller.close();
});


test("selecting a result directly locks the claim and permits retry", async () => {
  const f = fixture();
  const task = { id: "task", territoryId: "a", buildingId: "a", territoryLabel: "设施A", startedAt: 0, completesAt: 1000, status: "ready", cards: [0, 1, 2].map((i) => ({ playerId: `card-${i}`, name: `候选${i}`, grade: "C", overall: 70 })) };
  const detail = { ...f.detail("设施A"), task };
  f.store.setState({ ...f.store.getState(), scouting: { rules: SCOUTING_RULES, tasks: [task], serverNow: 1000 } });
  f.controller.open(task, { showResults: true });
  f.requests[0].resolve(detail); await flush();
  const clickCard = (id) => f.selectionRoot.events.click({ target: { closest: (selector) => selector === "[data-scout-select]" ? { dataset: { scoutSelect: id } } : null } });
  clickCard("card-1");clickCard("card-2");
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].url, "/api/campaign/scouting/choose");
  assert.deepEqual(f.requests[1].options.body, { taskId: "task", cardId: "card-1" });
  assert.equal((f.content.innerHTML.match(/ disabled/g) ?? []).length, 3);
  f.requests[1].reject(new Error("temporary network error")); await flush();
  f.requests[2].resolve(detail); await flush();
  assert.equal(f.selectionRoot.hidden, false);
  assert.doesNotMatch(f.content.innerHTML, / disabled/);
  clickCard("card-2");
  assert.equal(f.requests[3].options.body.cardId, "card-2");
  f.requests[3].resolve({ player: task.cards[2], state: { ...f.store.getState(), scouting: { rules: SCOUTING_RULES, tasks: [], serverNow: 1000 } } }); await flush();
  f.requests[4].resolve({ ...detail, task: { ...task, status: "claimed", cards: [] } }); await flush();
  assert.equal(f.selectionRoot.hidden, true);
  assert.equal(f.windowRoot.hidden, false);
  assert.equal(f.notifications.hidden, true);
  assert.match(f.content.innerHTML, /球员已加入球队/);
  f.controller.close();
});

test("clicking outside result cards returns to the panel without claiming", async () => {
  const f = fixture();
  const task = { id: "task", territoryId: "a", buildingId: "a", status: "ready", cards: [] };
  f.controller.open(task, { showResults: true });
  f.requests[0].resolve({ ...f.detail("设施A"), task }); await flush();
  f.selectionRoot.events.click({ target: { closest: () => null } });
  assert.equal(f.selectionRoot.hidden, true);
  assert.equal(f.windowRoot.hidden, false);
  assert.equal(f.requests.length, 1);
  f.controller.close();
});

test("scout candidates use the shared flip once; polling preserves nodes and reopening stays revealed",async()=>{
 const f=fixture();let html='',writes=0;
 Object.defineProperty(f.content,'innerHTML',{get:()=>html,set(value){html=value;writes++}});
 const task={id:'flip-task',territoryId:'a',buildingId:'a',territoryLabel:'设施A',status:'ready',cards:[0,1,2].map(i=>({playerId:'candidate-'+i,name:'候选'+i,grade:'A',overall:80}))};
 f.store.setState({...f.store.getState(),scouting:{rules:SCOUTING_RULES,tasks:[task],serverNow:1000}});
 f.controller.open(task,{showResults:true});f.requests[0].resolve({...f.detail('a'),task});await flush();
 assert.equal((html.match(/inventory-choice-card is-revealing/g)??[]).length,3);
 assert.deepEqual([...html.matchAll(/--reveal-index:(\d)/g)].map(m=>m[1]),['0','1','2']);
 const previousWrites=writes;
 f.store.setState({...f.store.getState(),scouting:{...f.store.getState().scouting,serverNow:2000}});
 assert.equal(writes,previousWrites,'Polling must not restart the animation by replacing candidates');
 f.controller.close();f.controller.open(task,{showResults:true});f.requests[1].resolve({...f.detail('a'),task});await flush();
 assert.equal((html.match(/inventory-choice-card is-revealed/g)??[]).length,3);
 f.controller.close();
});


test("center recruits one scout at a time, locks repeats and recovers a lost response into slots",async()=>{
  const f=fixture(), center={...f.center("非首都中心"),building:{id:"center-b",level:1,status:"active"},territoryId:"b"};
  f.controller.open({territoryId:"b",buildingId:"center-b"});
  f.requests[0].resolve(center);await flush();
  assert.doesNotMatch(f.content.innerHTML,/data-scout-start|暂无球探|0 \/ 2/);
  assert.equal((f.content.innerHTML.match(/data-scout-recruit=/g)??[]).length,1);
  assert.equal((f.content.innerHTML.match(/scout-unit-slot is-empty/g)??[]).length,2);
  assert.match(f.content.innerHTML,/>招募球探<\/button>/);
  f.click("[data-scout-recruit]",{scoutRecruit:"1"});f.click("[data-scout-recruit]",{scoutRecruit:"1"});
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].url,"/api/campaign/scouting/recruit");
  assert.equal(f.requests[1].options.body.territoryId,"b");
  assert.equal(f.requests[1].options.body.buildingId,"center-b");
  assert.equal(f.requests[1].options.body.count,1);
  const firstRequestId=f.requests[1].options.body.requestId;
  f.requests[1].reject(Error("response lost"));await flush();
  f.requests[2].resolve({...center,scouts:[f.unit().scout],recruitAvailable:1});await flush();
  assert.match(f.content.innerHTML,/Oliver Reed/);
  assert.equal((f.content.innerHTML.match(/scout-unit-slot is-empty/g)??[]).length,1);
  assert.doesNotMatch(f.content.innerHTML,/data-scout-recruit="1" disabled/);
  f.click("[data-scout-recruit]",{scoutRecruit:"1"});
  assert.equal(f.requests[3].options.body.count,1);
  assert.notEqual(f.requests[3].options.body.requestId,firstRequestId);
  f.requests[3].reject(Error("response lost"));await flush();
  f.requests[4].resolve({...center,scouts:[f.unit().scout,{...f.unit().scout,id:"scout-b",name:"James Walker"}],recruitAvailable:0});await flush();
  assert.match(f.content.innerHTML,/Oliver Reed/);assert.match(f.content.innerHTML,/James Walker/);
  assert.equal((f.content.innerHTML.match(/scout-unit-slot scout-unit-row/g)??[]).length,2);
  assert.doesNotMatch(f.content.innerHTML,/scout-unit-slot is-empty|data-scout-recruit="2"/);
  assert.match(f.content.innerHTML,/data-scout-recruit="1" disabled/);
  f.click("[data-scout-recruit]",{scoutRecruit:"1"});
  assert.equal(f.requests.length,5);
  f.controller.close();
});

test("same-center scouts remain distinct targets and movement confirms the chosen destination",async()=>{
  const f=fixture();
  const promise=f.controller.planMove("scout-a","b");
  f.requests[0].resolve(f.unit());await flush();
  assert.equal(f.requests[1].url,"/api/campaign/scouting/estimate");
  assert.deepEqual(f.requests[1].options.body,{scoutId:"scout-a",territoryId:"b"});
  f.requests[1].resolve({estimate:{toTerritoryId:"b",fromTerritoryId:"a",durationMs:60000,path:["a","b"]}});await promise;
  assert.match(f.content.innerHTML,/确认移动/);
  f.click("[data-scout-confirm-move]");f.click("[data-scout-confirm-move]");
  assert.equal(f.requests.length,3);
  assert.equal(f.requests[2].options.body.scoutId,"scout-a");
  assert.equal(f.requests[2].options.body.territoryId,"b");
  f.controller.close();f.requests[2].reject(Error("response lost"));await flush();
  assert.equal(f.windowRoot.hidden,true);
  f.controller.openUnit("scout-a");f.controller.openUnit("scout-b");
  f.requests[4].resolve({...f.unit("B的地块"),scout:{...f.unit().scout,id:"scout-b",name:"James Walker"}});await flush();
  f.requests[3].resolve(f.unit("A的地块"));await flush();
  assert.match(f.content.innerHTML,/James Walker/);assert.doesNotMatch(f.content.innerHTML,/Oliver Reed/);
  f.controller.close();
});
test("discovery retry identity is released when a lost response is recovered from the server",async()=>{
  const f=fixture();f.controller.openUnit("scout-a");f.requests[0].resolve(f.unit());await flush();
  f.click("[data-scout-start]");const firstId=f.requests[1].options.body.requestId;
  f.requests[1].reject(Error("response lost"));await flush();
  f.requests[2].resolve({...f.unit(),task:{id:"claimed-task",scoutId:"scout-a",status:"claimed",cards:[]}});await flush();
  f.click("[data-scout-start]");
  assert.notEqual(f.requests[3].options.body.requestId,firstId);
  f.controller.close();f.requests[3].reject(Error("closed"));await flush();
});


test("two closed-panel movement notices keep separate identities and cancellation preserves the other scout",async()=>{
  const f=fixture();
  const movement=id=>({id,fromTerritoryId:"origin",toTerritoryId:"destination",startedAt:1000,arrivesAt:121000});
  const units=[{...f.unit().scout,status:"moving",movement:movement("trip-a")},{...f.unit().scout,id:"scout-b",name:"James Walker",status:"moving",movement:movement("trip-b")}];
  const update=scouts=>f.store.setState({...f.store.getState(),scouting:{...f.store.getState().scouting,scouts}});
  update(units);
  assert.equal(f.windowRoot.hidden,true);assert.equal(f.notifications.hidden,false);
  assert.match(f.notifications.innerHTML,/Oliver Reed/);assert.match(f.notifications.innerHTML,/James Walker/);
  assert.equal((f.notifications.innerHTML.match(/data-scout-move-progress=/g)??[]).length,2);
  const notifyClick=(selector,dataset)=>f.notifications.events.click({target:{closest:value=>value===selector?{dataset}:null}});
  notifyClick("[data-scout-cancel-move]",{scoutCancelMove:"scout-a",scoutMovementId:"outdated"});
  assert.equal(f.requests.length,0);
  notifyClick("[data-scout-cancel-move]",{scoutCancelMove:"scout-a",scoutMovementId:"trip-a"});
  notifyClick("[data-scout-cancel-move]",{scoutCancelMove:"scout-a",scoutMovementId:"trip-a"});
  assert.equal(f.requests.length,1);
  assert.deepEqual(f.requests[0].options.body,{scoutId:"scout-a",movementId:"trip-a"});
  f.requests[0].resolve({state:{...f.store.getState(),scouting:{...f.store.getState().scouting,scouts:[{...units[0],status:"idle",movement:null},units[1]]}}});await flush();
  assert.doesNotMatch(f.notifications.innerHTML,/data-scout-move-progress="scout-a"/);
  assert.match(f.notifications.innerHTML,/data-scout-move-progress="scout-b"/);
  assert.equal(f.windowRoot.hidden,true);
  update(units.map(unit=>({...unit,status:"idle",movement:null})));
  assert.equal(f.notifications.hidden,true);
});
test("movement progress ticks in both surfaces without replacing notice nodes and survives panel closure",async()=>{
  const f=fixture(), movement={id:"trip-a",fromTerritoryId:"a",toTerritoryId:"b",startedAt:1000,arrivesAt:121000};
  const unit={...f.unit().scout,status:"moving",movement};
  f.store.setState({...f.store.getState(),scouting:{...f.store.getState().scouting,scouts:[unit]}});
  const makeNodes=()=>{
    const bar={dataset:{scoutMoveProgress:unit.id,scoutMovementId:movement.id},attributes:{},setAttribute(k,v){this.attributes[k]=v;},line:{style:{}},querySelector(){return this.line;}};
    const time={dataset:{scoutMoveCountdown:unit.id,scoutMovementId:movement.id}},percent={dataset:{scoutMovePercent:unit.id,scoutMovementId:movement.id}};
    return {bar,time,percent,query:selector=>selector==="[data-scout-move-progress]"?[bar]:selector==="[data-scout-move-countdown]"?[time]:selector==="[data-scout-move-percent]"?[percent]:[]};
  };
  const panel=makeNodes(),notice=makeNodes();
  f.windowRoot.querySelectorAll=panel.query;f.notifications.querySelectorAll=notice.query;
  const html=f.notifications.innerHTML;
  f.controller.openUnit(unit.id);f.requests[0].resolve({...f.unit(),scout:unit});await flush();
  assert.ok(f.windowRoot.classes.has("is-scout-moving"));
  f.setTime(31000);f.tick();
  for(const nodes of [panel,notice]){
    assert.equal(nodes.bar.line.style.width,"25.0%");assert.equal(nodes.bar.attributes["aria-valuenow"],"25");
    assert.equal(nodes.time.textContent,"01:30");assert.equal(nodes.percent.textContent,undefined);assert.doesNotMatch(f.content.innerHTML,/data-scout-move-percent/);
  }
  assert.equal(f.notifications.innerHTML,html);
  f.controller.close();f.setTime(121000);f.tick();
  assert.equal(f.windowRoot.hidden,true);assert.equal(notice.bar.line.style.width,"100.0%");assert.equal(notice.percent.textContent,undefined);
  assert.equal(notice.time.textContent,"正在同步位置…");
});
test("arrival updates country forecasts from territory metadata and keeps a live task's country",async()=>{
  const f=fixture({getTerritoryInfo:id=>id==="b"?{countryCode:"DEU"}:null});
  f.controller.openUnit("scout-a");f.requests[0].resolve({...f.unit(),countryCode:"ESP",coreCountry:true});await flush();
  assert.match(f.content.innerHTML,/西班牙 80%/);
  const scout={...f.unit().scout,territoryId:"b",territoryLabel:"德国 · 柏林"};
  f.store.setState({...f.store.getState(),world:{territories:{b:{ownerId:"p"}}},scouting:{...f.store.getState().scouting,scouts:[scout]}});
  assert.match(f.content.innerHTML,/德国 80%/);assert.doesNotMatch(f.content.innerHTML,/西班牙 80%/);
  const task={id:"paid",scoutId:scout.id,countryCode:"ESP",status:"working",startedAt:1000,completesAt:601000};
  f.store.setState({...f.store.getState(),scouting:{...f.store.getState().scouting,tasks:[task],scouts:[{...scout,status:"working"}]}});
  assert.match(f.content.innerHTML,/西班牙 80%/);assert.doesNotMatch(f.content.innerHTML,/德国 80%/);
  f.controller.close();
});


test("center footer routes demolition to its own building and never appears for the mobile scout", async () => {
  const f=fixture(); f.controller.open({territoryId:"a",buildingId:"center"});
  f.requests[0].resolve(f.center("center")); await flush();
  assert.equal(f.facilityActions.hidden,false);
  assert.match(f.facilityActions.innerHTML,/升级设施/);
  f.click("[data-facility-demolish]");
  assert.deepEqual(f.demolitions,[{territoryId:"a",buildingId:"center"}]);
  f.controller.openUnit("scout-a"); f.requests[1].resolve(f.unit()); await flush();
  assert.equal(f.facilityActions.hidden,true);
  f.click("[data-facility-demolish]");
  assert.equal(f.demolitions.length,1);
});

test('rename keeps typed text across polling and failures and applies only to the same account',async()=>{
 const f=fixture(),scout=f.unit().scout;
 f.store.setState({...f.store.getState(),scouting:{...f.store.getState().scouting,scouts:[scout]}});
 f.controller.openUnit(scout.id);f.requests[0].resolve(f.unit());await flush();
 f.click('[data-scout-rename]');
 const type=value=>f.windowRoot.events.input({target:{value,matches:selector=>selector==='[data-scout-name-input]'}});
 const submit=()=>f.windowRoot.events.submit({preventDefault(){},target:{matches:selector=>selector==='[data-scout-rename-form]'}});
 type('南美观察员');f.store.setState(structuredClone(f.store.getState()));assert.match(f.content.innerHTML,/value="南美观察员"/);
 submit();submit();assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1].options.body,{scoutId:scout.id,name:'南美观察员'});
 f.requests[1].reject(Error('保存失败'));await flush();assert.match(f.content.innerHTML,/保存失败/);assert.match(f.content.innerHTML,/value="南美观察员"/);
 submit();const next={...scout,name:'南美观察员'};f.requests[2].resolve({scout:next,state:{...f.store.getState(),scouting:{...f.store.getState().scouting,scouts:[next]}}});await flush();
 assert.doesNotMatch(f.content.innerHTML,/data-scout-name-input/);assert.match(f.content.innerHTML,/南美观察员/);
 f.click('[data-scout-rename]');type('不能写入新账号');submit();f.store.setState({...f.store.getState(),playerId:'other'});f.requests[3].resolve({scout:next,state:{playerId:'p'}});await flush();assert.equal(f.store.getState().playerId,'other');assert.equal(f.windowRoot.hidden,true);
});

test('each queued scouting round reveals its three cards without polling restarting the effect',async()=>{
 const f=fixture(),rounds=[0,1].map(round=>({cards:[0,1,2].map(i=>({playerId:`round-${round}-${i}`,name:`第${round+1}轮球员${i}`,grade:'C',overall:70}))}));
 const task={id:'queued-reveal',scoutId:'scout-a',territoryId:'a',status:'ready',roundCount:2,rounds,cards:rounds[0].cards};
 f.store.setState({...f.store.getState(),scouting:{rules:SCOUTING_RULES,tasks:[task],serverNow:1000}});
 f.controller.openUnit('scout-a',{showResults:true});f.requests[0].resolve({...f.unit(),task});await flush();
 f.click('[data-scout-results]');assert.equal((f.content.innerHTML.match(/inventory-choice-card is-revealing/g)??[]).length,3);
 const background=f.meteors.innerHTML;
 f.selectionRoot.events.click({target:{closest:selector=>selector==='[data-scout-select]'?{dataset:{scoutSelect:'round-0-0'}}:null}});
 assert.match(f.content.innerHTML,/第 2 \/ 2 轮/);assert.equal((f.content.innerHTML.match(/inventory-choice-card is-revealing/g)??[]).length,3);
 const revealed=f.content.innerHTML;f.store.setState(structuredClone(f.store.getState()));
 assert.equal(f.content.innerHTML,revealed);assert.equal(f.meteors.innerHTML,background);f.controller.close();
});


test('scout mode switches update preview without compounding and submit the selected mode',async()=>{
 const f=fixture(),promise=f.controller.planMove('scout-a','b');f.requests[0].resolve(f.unit());await flush();
 f.requests[1].resolve({estimate:{fromTerritoryId:'a',toTerritoryId:'b',durationMs:60000,normalDurationMs:60000,oilRequired:1,oilSpent:1,oilShortage:false,useOil:true,oilMultiplier:1}});await promise;
 const choose=value=>f.windowRoot.events.change({target:{value,matches:s=>s==='[data-scout-use-oil]'}});
 choose('slow');assert.match(f.content.innerHTML,/不耗石油 · 耗时 ×2/);assert.match(f.content.innerHTML,/02:00/);
 choose('fuel');assert.match(f.content.innerHTML,/消耗 1 石油/);assert.match(f.content.innerHTML,/01:00/);
 choose('slow');f.click('[data-scout-confirm-move]');assert.equal(f.requests[2].options.body.useOil,false);
 f.controller.close();f.requests[2].reject(Error('closed'));await flush();
});
