import {setTestWar} from './diplomacy-fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { FogService } from "../server/application/fog-service.mjs";
import { CampaignService } from "../campaign-service.mjs";
import { createTerritoryWorld } from "../territory-model.js";

function index() {
  return { territories: ["a", "b", "c", "d", "island", "remote"].map((id, i) => ({
    territoryId:id, name:id, country:"测试", countryCode:"TST", region:"europe", playable:true, spawnAllowed:true,
    initialOwner:{ type:"neutral", id:null }, centroid:[i, 40], bounds:[i,40,i+.5,40.5],
    landNeighbors: ({ a:["b"], b:["a","c"], c:["b","d"], d:["c"] })[id] ?? [],
    maritimeNeighbors:id === "a" ? ["island"] : [], cityIds:[], clubIds:[],
  })) };
}
function own(world, id, playerId) {
  Object.assign(world.territories[id], { ownerType:playerId ? "player" : "neutral", ownerId:playerId });
}
function model() {
  const territoryIndex=index(), world=createTerritoryWorld(territoryIndex), account={ id:"p", homeTerritoryId:"a" };
  own(world,"a","p");
  return { world, account, territoryIndex, fog:new FogService({territoryIndex, now:()=>1234}) };
}

test("full preview does not explore the world or record encounters", () => {
  const {fog,account,world}=model(); account.homeTerritoryId=null; own(world,"b","q");
  assert.equal(fog.update(account,world).view.enabled,false); assert.equal(account.fog,undefined);
  account.homeTerritoryId="a";
  const view=fog.update(account,world).view;
  assert.deepEqual(view.visibleTerritoryIds,["a","b","island"]);
  assert.deepEqual(view.exploredTerritoryIds,view.visibleTerritoryIds);
  assert.deepEqual(view.metPlayerIds,["q"]);
  assert.equal(account.fog.firstMetAt.q,1234);
});

test("sight is one neighbour ring including straits and does not flood through neighbours", () => {
  const {fog,account,world}=model();
  assert.deepEqual(fog.update(account,world).view.visibleTerritoryIds,["a","b","island"]);
  own(world,"c","p");
  assert.deepEqual(fog.update(account,world).view.visibleTerritoryIds,["a","b","c","d","island"]);
  own(world,"a",null);
  const view=fog.update(account,world).view;
  assert.deepEqual(view.visibleTerritoryIds,["b","c","d"]);
  assert.ok(view.exploredTerritoryIds.includes("a")); assert.ok(view.exploredTerritoryIds.includes("island"));
  assert.ok(!view.exploredTerritoryIds.includes("remote"));
});

test("encounters survive loss of sight and JSON reload, but reset with a new season", () => {
  const {fog,account,world}=model(); own(world,"b","q");
  fog.update(account,world); own(world,"a",null); own(world,"d","p");
  const restored=JSON.parse(JSON.stringify(account));
  const view=fog.update(restored,world).view;
  assert.deepEqual(view.metPlayerIds,["q"]); assert.equal(restored.fog.firstMetAt.q,1234);
  assert.ok(!view.visibleTerritoryIds.includes("b"));
  assert.equal(fog.update(restored,world).changed,false);
  world.seasonId="season-new";
  const fresh=fog.update(restored,world).view;
  assert.deepEqual(fresh.metPlayerIds,[]); assert.ok(!fresh.exploredTerritoryIds.includes("a"));
});

test("one-sided adjacency data still produces mutual encounters for offline players", () => {
  const {fog,account,world}=model(); own(world,"island","q");
  const other={id:"q",homeTerritoryId:"island"};
  fog.refreshAll(new Map([["p",account],["q",other]]),world);
  assert.deepEqual(account.fog.metPlayerIds,["q"]); assert.deepEqual(other.fog.metPlayerIds,["p"]);
});

function campaignFixture() {
  const territoryIndex=index(), world=createTerritoryWorld(territoryIndex);
  const accounts={};
  for(const [id,home,ids,name] of [["p","a",["a"],"自己"],["q","remote",["b","remote"],"近邻"],["r","d",["d"],"Hidden Secret Team"]]) {
    accounts[id]={id,nickname:name,setupComplete:true,homeTerritoryId:home,draft:{teamName:name,roster:[],offer:[]}};
    world.players[id]={territoryIds:ids,capitalTerritoryId:home}; ids.forEach(t=>own(world,t,id));
  }
  let saved={accounts,world};
  const repository={load:()=>structuredClone(saved),save(value){saved=structuredClone(value);}};
  const service=new CampaignService({territoryIndex,repository,catalog:[],now:()=>1700000000000});
  return {service,account:service.accounts.get("p"),repository,territoryIndex};
}

test("account state sends only visible land, weather and encountered player identities", () => {
  const {service,account}=campaignFixture();
  const state=service.state(account);
  assert.deepEqual(Object.keys(state.world.territories).sort(),["a","b","island"]);
  assert.deepEqual(Object.keys(state.world.weather.territories).sort(),["a","b","island"]);
  assert.deepEqual(Object.keys(state.world.players).sort(),["p","q"]);
  assert.equal(state.world.players.q.homeTerritoryId,null);
  assert.deepEqual(state.world.players.q.territoryIds,["b"]);
  assert.ok(!JSON.stringify(state.world).includes("Hidden Secret Team"));
  assert.ok(state.interactions.players.some(p=>p.teamName==="Hidden Secret Team"));
  assert.ok(state.interactions.players.every(p=>p.homeTerritoryId===undefined));
  assert.deepEqual(state.fog.metPlayerIds,["q"]);
});

test("hidden intel, buildings, blind challenges and hidden battle polling are rejected", () => {
  const {service,account}=campaignFixture();
  const denied=fn=>assert.throws(fn,error=>error.statusCode===403);
  denied(()=>service.territoryIntel(account,"d"));
  denied(()=>service.territoryBuildings(account,"d"));
  denied(()=>service.challengeTerritory(account,"d"));
  assert.equal(service.world.aiGarrisons.d,undefined);
  service.world.activeChallenges.d={id:"hidden-battle",territoryId:"d",attackerId:"q",defenderId:"r"};
  denied(()=>service.challengeStatus(account,"hidden-battle"));
});

test("visible battle summaries redact unencountered attackers and hidden sources", () => {
  const {service,account}=campaignFixture();
  service.world.activeChallenges.b={id:"challenge:r",territoryId:"b",attackerId:"r",attackerTeamName:"Hidden Secret Team",defenderId:"q",defenderName:"近邻",fromTerritoryIds:["d"]};
  const summary=service.state(account).world.activeChallenges.b;
  assert.equal(summary.attackerId,null); assert.equal(summary.id,null); assert.equal(summary.sourceTerritoryId,null);
  assert.equal(summary.attackerTeamName,"未相遇球队");
  assert.throws(()=>service.challengeStatus(account,"challenge:r"),error=>error.statusCode===403);
});

test("sea surveying reveals reachable coast cells and records an encounter beyond land sight", () => {
  const {service,account}=campaignFixture();
  assert.ok(!service.state(account).fog.visibleTerritoryIds.includes("d"));
  service.challenges.maritimeRoutes=()=>({sourceTerritoryId:"a",sourcePoint:[0,40],routes:[{targetTerritoryId:"b"},{targetTerritoryId:"d"}]});
  const result=service.maritimeRoutes(account,"a",[0,40]);
  assert.deepEqual(result.routes,[{targetTerritoryId:"b"},{targetTerritoryId:"d"}]);
  assert.ok(result.state.fog.visibleTerritoryIds.includes("d"));
  assert.ok(result.state.fog.metPlayerIds.includes("r"));
  assert.ok(!result.state.fog.visibleTerritoryIds.includes("c"));
  assert.ok(service.accounts.get("r").fog.metPlayerIds.includes("p"));
  assert.ok(!service.fogView(service.accounts.get("r")).visibleTerritoryIds.includes("a"));
  account.expeditionPiece.movement={toTerritoryId:"a",arrivesAt:Infinity};
  const lost=service.fogView(account);
  assert.ok(!lost.visibleTerritoryIds.includes("d"));
  assert.ok(!lost.exploredTerritoryIds.includes("d"));
});

test("campaign save/reload preserves exploration without granting all old-save geography", () => {
  const {service,account,repository,territoryIndex}=campaignFixture();
  own(service.world,"c","p"); service.world.players.p.territoryIds.push("c"); service.save();
  assert.ok(account.fog.metPlayerIds.includes("r"));
  own(service.world,"c",null); service.world.players.p.territoryIds=["a"]; service.save();
  const restored=new CampaignService({repository,territoryIndex,catalog:[],now:()=>1700000000000});
  const state=restored.state(restored.accounts.get("p"));
  assert.ok(state.fog.exploredTerritoryIds.includes("d"));
  assert.ok(!state.fog.visibleTerritoryIds.includes("d"));
  assert.ok(!state.fog.exploredTerritoryIds.includes("remote"));
  assert.equal(state.world.players.r.homeTerritoryId,null);
  assert.deepEqual(state.world.players.r.territoryIds,[]);
});

test("naval conquest accepts a newly surveyed target and rejects forged unseen destinations",()=>{
  const {service,account}=campaignFixture();service.challenges.now=()=>Date.parse("2026-09-18T04:00:00Z");setTestWar(service.world,"p","r");
  service.challenges.maritimeRoutes=()=>({sourceTerritoryId:"a",sourcePoint:[0,40],routes:[{targetTerritoryId:"d"}]});
  let challenged=null;
  service.challenges.begin=(_account,target)=>{challenged=target;return {challengeId:"naval-valid"};};
  service.challengeStatus=()=>({completed:false,battle:null});
  const options={maritimeRoute:{sourceTerritoryId:"a",sourcePoint:[0,40]}};
  assert.ok(!service.state(account).fog.visibleTerritoryIds.includes("d"));
  service.challengeTerritory(account,"d",options);
  assert.equal(challenged,"d");
  challenged=null;
  assert.throws(()=>service.challengeTerritory(account,"remote",options),error=>error.statusCode===403);
  assert.equal(challenged,null);
});


test("visible club matches do not require player contact, and spectators cannot locate a hidden source",()=>{
  const {service,account}=campaignFixture();
  service.world.territories.island.ownerType="club";service.world.territories.island.ownerId="club-1";
  service.world.activeChallenges.island={id:"visible-club-match",territoryId:"island",attackerId:"q",attackerTeamName:"近邻",defenderId:"club-1",defenderName:"岛上俱乐部",previousOwner:{type:"club",id:"club-1"},fromTerritoryIds:["remote"]};
  const summary=service.state(account).world.activeChallenges.island;
  assert.equal(summary.defenderName,"岛上俱乐部");assert.equal(summary.id,"visible-club-match");
  const result=service.challengeStatus(account,"visible-club-match");
  assert.equal(result.challenge.sourceTerritoryId,null);assert.equal(result.challenge.defenderId,"club-1");
  assert.deepEqual(service.world.activeChallenges.island.fromTerritoryIds,["remote"]);
});


test("more than 24 accounts retain only current sight while ownership changes remain live", () => {
  const {fog,world}=model();let plans=0;
  fog.spatial={plan(ids){plans++;return [...ids];},visibleIds(plan){return plan;}};
  const accounts=Array.from({length:40},(_,i)=>{const id="many-"+i,home="home-"+i;world.territories[home]={ownerType:"player",ownerId:id};return {id,homeTerritoryId:home};});
  for(const a of accounts)fog.update(a,world);
  for(let round=0;round<3;round++)for(const a of accounts)fog.update(a,world);
  assert.equal(plans,40,"unchanged holdings must not compete for the shared geometry LRU");
  world.territories.extra={ownerType:"neutral",ownerId:null};
  own(world,"extra",accounts[0].id);
  assert.ok(fog.update(accounts[0],world).view.visibleTerritoryIds.includes("extra"));assert.equal(plans,41);
  own(world,"extra",accounts[1].id);
  assert.ok(!fog.update(accounts[0],world).view.visibleTerritoryIds.includes("extra"));
  assert.ok(fog.update(accounts[1],world).view.visibleTerritoryIds.includes("extra"));
  assert.equal(plans,43);
});
