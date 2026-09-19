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
    buildTerritoryBuilding: (value, territoryId, type, buildMethod) => {
      calls.push(["build", value.id, territoryId, type, buildMethod]);
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
    ["/api/campaign/territory/buildings/build", { territoryId: "home", type: "port", buildMethod: "production" }],
    ["/api/campaign/territory/buildings/upgrade", { territoryId: "home", buildingId: "building-1" }],
    ["/api/campaign/territory/buildings/rename", { territoryId: "home", buildingId: "building-1", name: "新主场" }],
  ]) {
    const response = responseRecorder();
    await handler(postRequest(body, auth), response, pathname, pathname);
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(calls, [
    ["build", "account", "home", "port", "production"],
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

test("campaign API estimates, starts and cancels expedition movement", async () => {
  const account={id:"account",nickname:"经理"};
  const calls=[];
  const campaign={
    authenticate:()=>account,
    estimateExpedition:(value,territoryId,options)=>{calls.push(["estimate",value.id,territoryId,options.useOil]);return {estimate:{durationMs:60_000}};},
    moveExpedition:(value,territoryId,options)=>{calls.push(["move",value.id,territoryId,options.useOil]);return {expeditionPiece:{moving:true}};},
    cancelExpedition:(value)=>{calls.push(["cancel",value.id]);return {expeditionPiece:{moving:false}};},
  };
  const handler=createCampaignApiHandler({campaign});
  const auth={authorization:"Bearer session-token"};
  for(const [pathname,body] of [
    ["/api/campaign/expedition/estimate",{territoryId:"target",useOil:false}],
    ["/api/campaign/expedition/move",{territoryId:"target",useOil:false}],
    ["/api/campaign/expedition/cancel",{}],
  ]) {
    const response=responseRecorder();
    await handler(postRequest(body,auth),response,pathname,pathname);
    assert.equal(response.statusCode,200);
  }
  assert.deepEqual(calls,[["estimate","account","target",false],["move","account","target",false],["cancel","account"]]);
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

test("campaign API handler opens inventory packs and commits one chosen player", async () => {
  const account = { id:"account", nickname:"经理" };
  const calls = [];
  const campaign = {
    authenticate:() => account,
    openPlayerPack:(value,packType) => {
      calls.push(["open",value.id,packType]);
      return { opening:{ id:"opening-1" } };
    },
    choosePlayerPackCard:(value,openingId,playerId) => {
      calls.push(["choose",value.id,openingId,playerId]);
      return { player:{ playerId } };
    },
  };
  const handler = createCampaignApiHandler({campaign});
  const auth = { authorization:"Bearer session-token" };
  const openResponse = responseRecorder();
  await handler(postRequest({packType:"exotic-player-pack"},auth),openResponse,"/api/campaign/inventory/packs/open","/api/campaign/inventory/packs/open");
  assert.deepEqual(JSON.parse(openResponse.body),{opening:{id:"opening-1"}});
  const chooseResponse = responseRecorder();
  await handler(postRequest({openingId:"opening-1",playerId:"player-1"},auth),chooseResponse,"/api/campaign/inventory/packs/choose","/api/campaign/inventory/packs/choose");
  assert.deepEqual(JSON.parse(chooseResponse.body),{player:{playerId:"player-1"}});
  assert.deepEqual(calls,[
    ["open","account","exotic-player-pack"],
    ["choose","account","opening-1","player-1"],
  ]);
});

test("campaign API assigns one player to expedition or garrison", async () => {
  const account = { id:"account", nickname:"经理" };
  const calls = [];
  const campaign = {
    authenticate:() => account,
    assignPlayerSquad:(value,playerId,squadId) => {
      calls.push([value.id,playerId,squadId]);
      return { playerSquads:{ assignments:{ [playerId]:squadId } } };
    },
  };
  const handler = createCampaignApiHandler({campaign});
  const response = responseRecorder();
  await handler(postRequest({playerId:"player-1",squadId:"garrison"},{authorization:"Bearer session-token"}),response,"/api/campaign/squads/assign","/api/campaign/squads/assign");
  assert.equal(response.statusCode,200);
  assert.deepEqual(JSON.parse(response.body),{state:{playerSquads:{assignments:{"player-1":"garrison"}}}});
  assert.deepEqual(calls,[["account","player-1","garrison"]]);
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

test("scouting endpoints use authenticated account and forward task identities", async () => {
  const account = { id: "owner" }, calls = [];
  const campaign = {
    authenticate(token) { assert.equal(token, "scout-token"); return account; },
    scoutingDetails(user, territoryId, buildingId) { calls.push(["detail", user.id, territoryId, buildingId]); return {}; },
    startScouting(user, body) { calls.push(["start", user.id, body]); return {}; },
    chooseScoutingPlayer(user, taskId, cardId) { calls.push(["choose", user.id, taskId, cardId]); return {}; },
  };
  const handler = createCampaignApiHandler({ campaign }), headers = { authorization: "Bearer scout-token" };
  await handler({ method: "GET", headers }, responseRecorder(), "/api/campaign/scouting/center", "/api/campaign/scouting/center?territoryId=t&buildingId=b");
  for (const [operation, body] of [["start", { territoryId: "t", buildingId: "b", requestId: "once-only" }], ["choose", { taskId: "task", cardId: "card" }]]) {
    const response = responseRecorder();
    await handler(postRequest(body, headers), response, `/api/campaign/scouting/${operation}`, `/api/campaign/scouting/${operation}`);
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(calls, [["detail", "owner", "t", "b"], ["start", "owner", { territoryId: "t", buildingId: "b", requestId: "once-only" }], ["choose", "owner", "task", "card"]]);
});


test("training routes use authenticated account and forward the selected seat and player", async () => {
  const calls = [], account = { id: "owner" };
  const campaign = {
    authenticate(token) { assert.equal(token, "training-token"); return account; },
    trainingDetails(user, territoryId, buildingId) { calls.push(["details", user.id, territoryId, buildingId]); return {}; },
    startTraining(user, body) { calls.push(["start", user.id, body]); return {}; },
    cancelTraining(user, taskId) { calls.push(["cancel", user.id, taskId]); return {}; },
    finishTraining(user, taskId) { calls.push(["finish", user.id, taskId]); return {}; },
  };
  const handler = createCampaignApiHandler({ campaign }), headers = { authorization: "Bearer training-token" };
  await handler({ method: "GET", headers }, responseRecorder(), "/api/campaign/training/center", "/api/campaign/training/center?territoryId=t&buildingId=b");
  const body = { territoryId: "t", buildingId: "b", pool: "ATT", slot: 0, playerId: "p", requestId: "training-once" };
  await handler(postRequest(body, headers), responseRecorder(), "/api/campaign/training/start", "/api/campaign/training/start");
  await handler(postRequest({ taskId: "training-task" }, headers), responseRecorder(), "/api/campaign/training/cancel", "/api/campaign/training/cancel");
  await handler(postRequest({ taskId: "training-task" }, headers), responseRecorder(), "/api/campaign/training/finish", "/api/campaign/training/finish");
  assert.deepEqual(calls, [["details", "owner", "t", "b"], ["start", "owner", body], ["cancel", "owner", "training-task"], ["finish", "owner", "training-task"]]);
});

test("enhancement routes authenticate and forward only the current account to single, batch and trait operations",async()=>{
 const account={id:"owner"},calls=[];
 const handler=createCampaignApiHandler({campaign:{authenticate(token){assert.equal(token,"token");return account;},enhancementDetails(user){assert.equal(user,account);return {cards:[]};},mutateEnhancement(user,action,body){calls.push([user.id,action,body]);return {};}}});
 const headers={authorization:"Bearer token"},response=responseRecorder();
 await handler({method:"GET",headers},response,"/api/campaign/enhancement","/api/campaign/enhancement");assert.equal(response.statusCode,200);
 for(const [route,action] of [["enhance","single"],["batch","batch"],["trait","trait"]]){
  const body={requestId:"enhance-1234",ownerId:"forged"};
  await handler(postRequest(body,headers),responseRecorder(),`/api/campaign/enhancement/${route}`,`/api/campaign/enhancement/${route}`);
  assert.deepEqual(calls.at(-1),["owner",action,body]);
 }
});

test("draft pool opening and choosing forward the round and saved offer identity under account authentication", async () => {
  const calls=[],account={id:"draft-account"};
  const handler=createCampaignApiHandler({campaign:{
    authenticate:()=>account,
    openDraftPool:(value,pool,pickNumber)=>{calls.push(["open",value.id,pool,pickNumber]);return {draft:{offerId:"saved-offer"}};},
    choose:(value,playerId,offerId)=>{calls.push(["choose",value.id,playerId,offerId]);return {setupComplete:false};},
  }});
  const auth={authorization:"Bearer token"};
  for(const [pathname,body] of [
    ["/api/campaign/draft/open",{pool:"ATT",pickNumber:1}],
    ["/api/campaign/draft/choose",{playerId:"chosen-card",offerId:"saved-offer"}],
  ]){
    const response=responseRecorder();await handler(postRequest(body,auth),response,pathname,pathname);
    assert.equal(response.statusCode,200);
  }
  assert.deepEqual(calls,[["open","draft-account","ATT",1],["choose","draft-account","chosen-card","saved-offer"]]);
});

test("mobile scout endpoints authenticate and preserve scout, center and movement identities",async()=>{
  const account={id:"p"},calls=[], auth={authorization:"Bearer session"};
  const campaign={authenticate(token){assert.equal(token,"session");return account;},
    scoutUnitDetails:(a,id)=>{calls.push(["unit",a.id,id]);return {};},
    scoutingTaskDetails:(a,id)=>{calls.push(["task",a.id,id]);return {};},
    recruitScouts:(a,body)=>{calls.push(["recruit",a.id,body]);return {};},
    estimateScoutMove:(a,body)=>{calls.push(["estimate",a.id,body]);return {};},
    moveScout:(a,body)=>{calls.push(["move",a.id,body]);return {};},
    cancelScoutMove:(a,id,movement)=>{calls.push(["cancel",a.id,id,movement]);return {};}};
  const handler=createCampaignApiHandler({campaign});
  for(const [path,query] of [["unit","scoutId=scout-a"],["task","taskId=old-task"]]){
    const response=responseRecorder(), route="/api/campaign/scouting/"+path;
    await handler({method:"GET",headers:auth},response,route,route+"?"+query);
    assert.equal(response.statusCode,200);
  }
  const bodies={recruit:{territoryId:"non-capital",buildingId:"center",count:2,requestId:"recruit-one"},
    estimate:{scoutId:"scout-a",territoryId:"b"},move:{scoutId:"scout-a",territoryId:"b",requestId:"move-one"},
    "cancel-move":{scoutId:"scout-a",movementId:"move-one"}};
  for(const [action,body] of Object.entries(bodies)){
    const response=responseRecorder(),route="/api/campaign/scouting/"+action;
    await handler(postRequest(body,auth),response,route,route);assert.equal(response.statusCode,200);
  }
  assert.deepEqual(calls,[["unit","p","scout-a"],["task","p","old-task"],["recruit","p",bodies.recruit],["estimate","p",bodies.estimate],["move","p",bodies.move],["cancel","p","scout-a","move-one"]]);
});


test("demolition endpoints authenticate and pass exact facility and request IDs", async () => {
  const calls=[], account={id:"p"};
  const campaign={
    authenticate(token){assert.equal(token,"session-token");return account;},
    previewBuildingDemolition(value,territoryId,buildingId){calls.push(["preview",value,territoryId,buildingId]);return {canDemolish:true};},
    demolishTerritoryBuilding(value,options){calls.push(["demolish",value,options]);return {demolishedBuildingId:options.buildingId};},
  };
  const handler=createCampaignApiHandler({campaign}), headers={authorization:"Bearer session-token"};
  const path="/api/campaign/territory/buildings/demolish-preview", response=responseRecorder();
  await handler({method:"GET",headers},response,path,path+"?territoryId=a&buildingId=center");
  assert.equal(JSON.parse(response.body).canDemolish,true);
  const body={territoryId:"a",buildingId:"center",requestId:"request-001"}, result=responseRecorder();
  await handler(postRequest(body,headers),result,"/api/campaign/territory/buildings/demolish","/api/campaign/territory/buildings/demolish");
  assert.deepEqual(calls,[["preview",account,"a","center"],["demolish",account,body]]);
  const unauth=createCampaignApiHandler({campaign:{authenticate(){throw Object.assign(Error("请登录"),{statusCode:401});}}});
  await assert.rejects(()=>unauth(postRequest(body),responseRecorder(),"/api/campaign/territory/buildings/demolish","/api/campaign/territory/buildings/demolish"),/请登录/);
});

test('scout rename route forwards only the authenticated account and requested unit/name',async()=>{
 const account={id:'owner'},calls=[];
 const campaign={authenticate:token=>{assert.equal(token,'session');return account;},renameScout:(owner,body)=>{calls.push([owner,body]);return {scout:{id:body.scoutId,name:body.name}};}};
 const handler=createCampaignApiHandler({campaign}),response=responseRecorder(),url='/api/campaign/scouting/rename';
 await handler(postRequest({scoutId:'scout-a',name:'南美观察员'},{authorization:'Bearer session'}),response,url,url);
 assert.equal(response.statusCode,200);assert.equal(calls[0][0],account);assert.deepEqual(calls[0][1],{scoutId:'scout-a',name:'南美观察员'});
});


test('fan preference route authenticates and forwards only the selected preference',async()=>{
 const actor={id:'fans-owner'};let called=false;
 const handler=createCampaignApiHandler({campaign:{authenticate:token=>{assert.equal(token,'fan-token');return actor;},setFanPreference:(account,preference)=>{assert.equal(account,actor);assert.equal(preference,'science');called=true;return {state:{resources:{fans:{preference}}}};}}});
 const response=responseRecorder();await handler(postRequest({preference:'science',fans:999999,accountId:'other'},{authorization:'Bearer fan-token'}),response,'/api/campaign/resources/fans/preference');assert.ok(called);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).state.resources.fans.preference,'science');
});

test("wonder preview API authenticates and delegates to the current player's overview",async()=>{
 const account={id:'preview-player'},payload={wonders:[{wonderId:'belem-tower',collection:{current:3,required:10}}]};
 const handler=createCampaignApiHandler({campaign:{authenticate(token){assert.equal(token,'preview-token');return account;},wonderPreview(actor){assert.equal(actor,account);return payload;}}});
 const response=responseRecorder();await handler({method:'GET',headers:{authorization:'Bearer preview-token'}},response,'/api/campaign/wonders','/api/campaign/wonders');assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),payload);
});

test('wonder cancellation requires authentication and passes only explicit target identifiers',async()=>{
 const account={id:'owner'},calls=[];const campaign={authenticate:token=>{if(token!=='valid')throw Object.assign(Error('unauthorized'),{statusCode:401});return account;},cancelWonderConstruction:(a,t,b)=>{calls.push([a.id,t,b]);return {cancelledBuildingId:b,refundProduction:0};}};const handler=createCampaignApiHandler({campaign}),path='/api/campaign/wonders/cancel';
 const denied=responseRecorder();await assert.rejects(handler(postRequest({territoryId:'t',buildingId:'w'}),denied,path,path),error=>error.statusCode===401);assert.equal(calls.length,0);
 const response=responseRecorder();await handler(postRequest({territoryId:'t',buildingId:'w',refundProduction:999},{authorization:'Bearer valid'}),response,path,path);assert.equal(response.statusCode,200);assert.deepEqual(calls,[['owner','t','w']]);assert.equal(JSON.parse(response.body).refundProduction,0);
});

test('formation research endpoints always use authenticated account, including cancellation',async()=>{
 const account={id:'authenticated'},calls=[];const campaign={authenticate:token=>{assert.equal(token,'session-token');return account;},formationResearch:{mutate:(a,action,body)=>calls.push({account:a,action,body})},state:a=>({playerId:a.id})};const handler=createCampaignApiHandler({campaign});
 for(const action of ['confirm','rename','start','cancel']){const response=responseRecorder();await handler(postRequest({playerId:'forged',revision:1},{authorization:'Bearer session-token'}),response,'/api/campaign/research/'+action,'/api/campaign/research/'+action);assert.equal(response.statusCode,200);assert.equal(calls.at(-1).account,account);assert.equal(calls.at(-1).action,action);}
});


test('notice acknowledgements bypass match settlement, self details and full world projection',async()=>{
 const account={id:'me'},calls=[];
 const campaign={authenticate:()=>account,diplomacy:{mutate:(a,body)=>{assert.equal(a,account);calls.push(body);return {};},details:()=>{throw Error('must not project cards');}},state:()=>{throw Error('must not project world');},settleDueChallenges:()=>{throw Error('must not run matches');}};
 const handler=createCampaignApiHandler({campaign});
 for(const action of ['read-news','read']){
  const response=responseRecorder();await handler(postRequest({action,targetId:action==='read-news'?'me':'other',eventId:'event',requestId:'request-1'}),response,'/api/campaign/interactions','/api/campaign/interactions');
  assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),{acknowledged:true});assert.ok(response.body.length<100);
 }
 assert.equal(calls.length,2);
});

test('research reward API binds the authenticated player and current job',async()=>{
 const account={id:'owner'},body={rewardId:'old-reward',jobId:'active-job'},result={appliedResearch:25,state:{formationResearch:{active:{completed:25}}}};
 const handler=createCampaignApiHandler({campaign:{authenticate:token=>{assert.equal(token,'token');return account;},assignNeutralResearch:(owner,options)=>{assert.equal(owner,account);assert.deepEqual(options,body);return result;}}});
 const response=responseRecorder(),url='/api/campaign/rewards/research';await handler(postRequest(body,{authorization:'Bearer token'}),response,url,url);
 assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body),result);
});
