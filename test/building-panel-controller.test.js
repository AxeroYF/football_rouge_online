import { wonderHoverMarkup, facilityHoverMarkup } from "../client/buildings/wonder-hover-controller.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildingPanelMarkup,
  createBuildingPanelController,
  formatConstructionTime,
} from "../client/buildings/building-panel-controller.js";

const catalog = [{
  type: "scout-center",
  label: "球探中心",
  iconPath: "/assets/building-icons-v2/scout-center.png",
  buildable: true,
  buildCostGold: 5_000,
  buildCostProduction: 400,
  coastalOnly: false,
}];

test("building panel renders preview, two build methods and no upgrade action", () => {
  const now = 100_000;
  const markup = buildingPanelMarkup({
    view: {
      canManage: true,
      slotLimit: 3,
      occupiedSlots: 1,
      availableSlots: 2,
      availableTypes: ["scout-center"],
      buildings: [{
        id: "building-1",
        type: "main-stadium",
        label: "主体育场",
        name: "测试主体育场",
        level: 1,
        status: "constructing",
        constructionStartedAt: now - 30_000,
        completesAt: now + 30_000,
      }],
    },
    catalog,
    territoryLabel: "英国 - 高地",
    walletGold: 1_000_000,
    now,
  });
  assert.match(markup, /测试主体育场/);
  assert.match(markup, /building-preview-meta/);
  assert.match(markup, /LV\.1/);
  assert.match(markup, /施工中 · 00:30/);
  assert.match(markup, /5,000/);
  assert.match(markup, /data-build-type="scout-center"/);
  assert.doesNotMatch(markup, /data-upgrade|升级设施|立即升级/);
  assert.equal(formatConstructionTime(60_000), "01:00");
});

test("building panel hides construction menu for territory visitors", () => {
  const markup = buildingPanelMarkup({
    view: { canManage: false, slotLimit: null, buildings: [], availableTypes: [] },
    catalog,
  });
  assert.match(markup, /仅可预览/);
  assert.doesNotMatch(markup, /data-build-type/);
});

test("app embeds buildings in the territory inspector and refreshes live state", () => {
  const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const stylesSource = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const territoryControllerSource = fs.readFileSync(new URL("../client/territory/territory-controller.js", import.meta.url), "utf8");
  assert.match(appSource, /createBuildingPanelController/);
  assert.match(appSource, /buildingPanelController\?\.refreshFromState\(\)/);
  assert.match(indexSource, /id="building-panel"/);
  const inspector = indexSource.slice(indexSource.indexOf('<aside id="territory-inspector"'),indexSource.indexOf('</aside>',indexSource.indexOf('<aside id="territory-inspector"')));
  assert.match(inspector, /id="building-panel"/);
  assert.doesNotMatch(indexSource, /id="territory-building-button"|id="building-panel-close"/);
  assert.doesNotMatch(indexSource, /PROVINCE INTELLIGENCE|territory-links|territory-assets|territory-id/);
  assert.match(territoryControllerSource, /state\.ownerType !== ownerTypes\.NEUTRAL/);
  assert.match(territoryControllerSource, /onBuildingsChange\(buildingEntryVisible \? territoryId : null\)/);
  assert.match(stylesSource, /\.building-build-option/);
});


function inlineFixture() {
  const requests=[],renderedInspectors=[],demolitions=[],timers=new Set();
  const panel={hidden:true,classList:{add(){},remove(){}}};
  const content={innerHTML:"",addEventListener(type,listener){this[type]=listener;}};
  let state={wallet:{gold:100000},buildings:{catalog,territories:{}},world:{}};
  const controller=createBuildingPanelController({
    onDemolish:(target,button)=>demolitions.push({target,button}),
    documentRef:{querySelector:selector=>selector === "#building-panel" ? panel : selector === "#building-panel-content" ? content : null},
    getCampaignState:()=>state,getTerritoryMetadata:id=>({country:"国家",name:id}),
    getCampaignRequest:()=> (path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),
    campaignStore:{setState(next){state=next;}},applyCampaignWorldSnapshot(){},refreshTerritoryDisplay(){},
    renderTerritoryInspector:id=>renderedInspectors.push(id),updateTopbarWallet(){},
    setIntervalImpl:callback=>{timers.add(callback);return callback;},clearIntervalImpl:callback=>timers.delete(callback),
  });
  return {controller,panel,content,requests,renderedInspectors,demolitions,timers,get state(){return state;}};
}
const viewFor=(name)=>({canManage:true,slotLimit:3,occupiedSlots:1,availableSlots:2,availableTypes:["scout-center"],
  buildings:[{id:name,name,type:"scout-center",level:1,status:"active"}]});
const settle=async()=>{await Promise.resolve();await Promise.resolve();};

test("switching selected territory starts its own read and ignores late responses after switch or close",async()=>{
  const f=inlineFixture();
  f.controller.open("A");f.controller.open("A");
  assert.equal(f.requests.length,1,"Inspector refresh must not refetch the same selection");
  f.controller.open("B");assert.equal(f.requests.length,2);
  f.requests[1].resolve(viewFor("B设施"));await settle();
  assert.match(f.content.innerHTML,/B设施/);
  f.requests[0].resolve(viewFor("A设施"));await settle();
  assert.match(f.content.innerHTML,/B设施/);assert.doesNotMatch(f.content.innerHTML,/A设施/);
  f.controller.open("A");const snapshot=f.content.innerHTML;
  f.controller.close();f.requests[2].resolve(viewFor("晚到设施"));await settle();
  assert.equal(f.panel.hidden,true);assert.equal(f.content.innerHTML,snapshot);assert.equal(f.timers.size,0);
});

test("construction keeps its original territory when the user selects another territory mid-request",async()=>{
  const f=inlineFixture();f.controller.open("A");f.requests[0].resolve(viewFor("A设施"));await settle();
  const pending=f.content.click({target:{closest:selector=>selector==="[data-build-type]"?{disabled:false,dataset:{buildType:"scout-center",buildMethod:"production"}}:null}});
  assert.deepEqual(f.requests[1].options.body,{territoryId:"A",type:"scout-center",buildMethod:"production"});
  f.controller.open("B");f.requests[2].resolve(viewFor("B设施"));await settle();
  f.requests[1].resolve({state:f.state,territory:viewFor("A新设施")});await pending;
  assert.equal(f.controller.getOpenTerritoryId(),"B");assert.match(f.content.innerHTML,/B设施/);
  assert.doesNotMatch(f.content.innerHTML,/A新设施/);assert.deepEqual(f.renderedInspectors,["B"]);
  f.controller.close();
});

test("zero-capacity construction remains pending and does not render as finished",()=>{
  const html=buildingPanelMarkup({
    view:{canManage:true,ownerId:'me',slotLimit:3,occupiedSlots:1,availableSlots:2,availableTypes:['club-shop'],
      production:{capacity:0,activeProjects:1,allocation:0},
      buildings:[{id:'paused',type:'training-center',label:'训练中心',status:'constructing',level:1,completesAt:null,
        productionWork:{required:60000,completed:24000,updatedAt:1000,allocation:0,schedule:[]}}]},
    catalog:[{type:'club-shop',label:'俱乐部商店',buildable:true,buildCostGold:5000,buildCostProduction:250}],walletGold:100000,now:90000,
  });
  assert.match(html,/等待生产力/);assert.match(html,/40\.0%/);assert.match(html,/开工后等待产能/);assert.doesNotMatch(html,/已建成/);
});

test("production stays available below the gold price; both buttons disable while submitting",()=>{
 const view={canManage:true,slotLimit:3,occupiedSlots:1,availableSlots:2,availableTypes:['scout-center'],buildings:[],production:{capacity:50,activeProjects:0}};
 const html=buildingPanelMarkup({view,catalog,walletGold:0});
 assert.match(html,/<button[^>]+data-build-method="gold"[^>]+disabled/);
 assert.doesNotMatch(html,/<button[^>]+data-build-method="production"[^>]+disabled/);
 assert.match(html,/400/);assert.doesNotMatch(html,/预计|工期/);
 const busy=buildingPanelMarkup({view,catalog,walletGold:10000,buildPending:true});
 assert.equal((busy.match(/<button[^>]+disabled/g)||[]).length,2);
});

for(const buildMethod of ['gold','production'])test("controller sends explicit "+buildMethod+" and suppresses repeated submissions",async()=>{
 const f=inlineFixture();f.controller.open("A");f.requests[0].resolve(viewFor("A设施"));await settle();
 const click=()=>f.content.click({target:{closest:selector=>selector==='[data-build-type]'?{disabled:false,dataset:{buildType:'scout-center',buildMethod}}:null}});
 const pending=click();await click();assert.equal(f.requests.length,2);
 assert.deepEqual(f.requests[1].options.body,{territoryId:'A',type:'scout-center',buildMethod});
 f.requests[1].resolve({state:f.state,territory:viewFor("新设施"),building:{status:buildMethod==='gold'?'active':'constructing',remainingConstructionMs:480000}});await pending;f.controller.close();
});

const wonderView = (label = "测试奇观", canBuild = true) => ({...viewFor("普通设施"),availableWonders:[{
  wonderId:"test-wonder",type:"wonder:test-wonder",label,iconPath:"/wonder.png",effectText:"球迷增长加成",
  canBuild,checks:[{label:"地形条件",met:canBuild}],construction:{totalProduction:1000},
}]});

test("compact world polling preserves wonders while refreshing their live requirements",async()=>{
 const f=inlineFixture();f.controller.open("A");f.requests[0].resolve(wonderView());await settle();
 f.state.buildings.territories.A=viewFor("更新后的设施");
 f.controller.refreshFromState();
 assert.match(f.content.innerHTML,/测试奇观/);assert.match(f.content.innerHTML,/更新后的设施/);
 assert.equal(f.requests.length,2);
 f.controller.refreshFromState();assert.equal(f.requests.length,2,"Polls coalesce an in-flight detail read");
 f.requests[1].resolve(wonderView("最新奇观条件",false));await settle();
 assert.doesNotMatch(f.content.innerHTML,/最新奇观条件|data-build-type="wonder:test-wonder"/);assert.match(f.content.innerHTML,/暂无满足建造条件/);
 f.controller.close();
});

test("temporary detail read failure keeps the open wonder list and polling recovers",async()=>{
 const f=inlineFixture();f.controller.open("A");f.requests[0].resolve(wonderView());await settle();
 f.controller.refreshFromState();f.requests[1].reject(new Error("temporary network error"));await settle();
 assert.match(f.content.innerHTML,/测试奇观/);assert.doesNotMatch(f.content.innerHTML,/设施信息读取失败/);
 f.controller.refreshFromState();f.requests[2].resolve(wonderView("恢复后条件"));await settle();
 assert.match(f.content.innerHTML,/恢复后条件/);f.controller.close();
});

test("cached wonder requirements do not leak across territory switches or ownership loss",async()=>{
 const f=inlineFixture();f.controller.open("A");f.requests[0].resolve(wonderView());await settle();
 f.controller.refreshFromState();f.controller.open("B");
 assert.doesNotMatch(f.content.innerHTML,/测试奇观/);
 f.requests[1].resolve(wonderView("A迟到的条件"));await settle();assert.doesNotMatch(f.content.innerHTML,/A迟到/);
 f.requests[2].resolve(wonderView("B奇观"));await settle();
 f.state.buildings.territories.B={...viewFor("访客设施"),canManage:false};f.controller.refreshFromState();
 assert.doesNotMatch(f.content.innerHTML,/B奇观|data-build-type="wonder:/);f.controller.close();
});

test("wonder list only exposes eligible names and prices; hover contains escaped effects and requirements",()=>{
 const view=wonderView();view.availableWonders.push({...view.availableWonders[0],wonderId:"blocked",label:"不满足条件的奇观",canBuild:false});
 const html=buildingPanelMarkup({view});assert.match(html,/测试奇观/);assert.match(html,/1 座可建造/);assert.match(html,/data-wonder-info/);assert.match(html,/1,000/);
 assert.doesNotMatch(html,/不满足条件的奇观|球迷增长加成|<details/);
 const w={...view.availableWonders[0],effectText:"加成 <script>bad</script>",dependency:"正式比赛"};
 const info=wonderHoverMarkup(w,s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'));
 assert.match(info,/建设要求/);assert.match(info,/生产力总需求/);assert.match(info,/地形条件/);assert.match(info,/1,000/);assert.match(info,/奇观效果/);assert.match(info,/正式比赛开放后生效/);assert.doesNotMatch(info,/<script>/);
});

test('ordinary facility hover describes current effects, level progression and construction choices',async()=>{
 const {publicBuildingCatalog}=await import('../shared/config/buildings.mjs');
 const {facilityEffectText}=await import('../shared/config/facility-levels.mjs');
 for(const entry of publicBuildingCatalog().filter(e=>e.buildable)){
  const html=facilityHoverMarkup(entry);assert.ok(html.includes(entry.label));assert.ok(html.includes(facilityEffectText(entry.type,1)));assert.ok(html.includes(facilityEffectText(entry.type,5)));assert.match(html,/设施用途|建设费用/);assert.match(html,/金币建造/);assert.match(html,/生产力建造/);
 }
});


test('demolition is available on owned ordinary facility cards and opens the exact facility confirmation',async()=>{
 const f=inlineFixture();f.controller.open('A');f.requests[0].resolve(viewFor('facility-a'));await settle();
 assert.match(f.content.innerHTML,/data-demolish-building="facility-a"/);
 const button={dataset:{demolishBuilding:'facility-a'},disabled:false};f.content.click({target:{closest:s=>s==='[data-demolish-building]'?button:null}});
 assert.deepEqual(f.demolitions,[{target:{territoryId:'A',buildingId:'facility-a'},button}]);
 const html=buildingPanelMarkup({catalog,view:{...viewFor('other'),canManage:false}});assert.doesNotMatch(html,/data-demolish-building/);
});
