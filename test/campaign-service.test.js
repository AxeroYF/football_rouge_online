import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CampaignService, LINE_KEYS, PLAYER_CATALOG_VERSION, STARTING_GOLD } from "../campaign-service.mjs";
import { PLAYER_PACK_TYPES } from "../shared/config/player-packs.mjs";

test("generated player catalog retains all 26 S4 attributes", () => {
  const catalog = JSON.parse(readFileSync(new URL("../assets/data/s4-player-catalog.json", import.meta.url), "utf8"));
  assert.ok(catalog.length > 700);
  assert.ok(catalog.every((player) => Object.keys(player.attributes ?? {}).length === 26));
  assert.equal(catalog.find((player) => player.id === "legend-kroos")?.attributes?.passing, 96);
  assert.deepEqual(
    ["s4-fc26-192366", "s4-fc26-234577", "s4-fc26-218667", "s4-retired-thierry-henry"].map((id) => {
      const player = catalog.find((candidate) => candidate.id === id);
      return [player.id, player.overall, player.grade];
    }),
    [
      ["s4-fc26-192366", 87, "A"],
      ["s4-fc26-234577", 86, "A"],
      ["s4-fc26-218667", 88, "A"],
      ["s4-retired-thierry-henry", 93, "S"],
    ],
  );
});

test("saved draft players migrate to the production catalog while preserving dynamic state", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "yellowdogs-catalog-migration-"));
  const dataPath = path.join(directory, "campaign.json");
  const source = { ...makeCatalog()[0], overall:87, grade:"A", attributes:{ passing:91 }, state:{ fitness:100, morale:70 } };
  writeFileSync(dataPath, JSON.stringify({ accounts:{ account:{
    id:"account", nickname:"迁移测试", token:"token", setupComplete:false,
    draft:{ teamName:"测试队", roster:[{ ...source, overall:72, grade:"C", attributes:{ passing:42 }, state:{ fitness:63, morale:55 } }], offer:[{ ...source, overall:72 }] },
  } } }));
  try {
    const service = new CampaignService({ dataPath, catalog:[source] });
    const account = service.accounts.get("account");
    assert.equal(account.playerCatalogVersion, PLAYER_CATALOG_VERSION);
    assert.equal(account.draft.roster[0].overall, 87);
    assert.equal(account.draft.roster[0].grade, "A");
    assert.equal(account.draft.roster[0].attributes.passing, 91);
    assert.equal(account.draft.roster[0].state.fitness, 63);
    assert.equal(account.draft.offer[0].overall, 87);
    assert.equal(account.gold,STARTING_GOLD);
    assert.equal(service.state(account).wallet.gold,STARTING_GOLD);
    const persistedAccount=JSON.parse(readFileSync(dataPath,"utf8")).accounts.account;
    assert.equal(persistedAccount.playerCatalogVersion, PLAYER_CATALOG_VERSION);
    assert.equal(persistedAccount.gold,STARTING_GOLD);
    assert.equal(persistedAccount.goldLedger.at(-1).reason,"test-starting-balance");
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

function makeCatalog() {
  return LINE_KEYS.flatMap((pool) => Array.from({ length: 30 }, (_, index) => ({
    id: `${pool}-${index}`,
    name: `${pool} Player ${index}`,
    pool,
    role: pool,
    grade: ["C", "B", "A"][index % 3],
    overall: 70 + (index % 20),
    club: "Test Club",
    nationality: "Test Nation",
    portrait: null,
    isX: false,
  })));
}

function makeDualSquadRoster() {
  const catalog=makeCatalog();
  const roster=[...catalog.filter((player)=>player.pool==="GK").slice(0,2),...catalog.filter((player)=>player.pool==="DEF").slice(0,8),...catalog.filter((player)=>player.pool==="MID").slice(0,6),...catalog.filter((player)=>player.pool==="ATT").slice(0,6)];
  const assignments={};
  for(const pool of LINE_KEYS) roster.filter((player)=>player.pool===pool).forEach((player,index)=>{assignments[player.id]=index%2===0?"expedition":"garrison";});
  return {roster,playerSquads:{schemaVersion:1,assignments}};
}

test("YOOGLE directory includes the full YDL library and marks the current roster", () => {
  const catalog = makeCatalog();
  catalog.push({
    id: "x-library-player",
    name: "X Library Player",
    sourceName: "English X Player",
    pool: "ATT",
    role: "ST",
    secondaryRole: "RW",
    grade: "X",
    overall: 99,
    club: "YDL",
    nationality: "测试",
    attributes: { finishing: 99 },
    isX: true,
  });
  const service = new CampaignService({ catalog, random: () => 0 });
  const account = { draft: { roster: [catalog[0]] } };
  const directory = service.playerDirectory(account);
  const owned = directory.players.find((player) => player.id === catalog[0].id);
  const xPlayer = directory.players.find((player) => player.id === "x-library-player");
  assert.equal(directory.total, catalog.length);
  assert.equal(owned.inRoster, true);
  assert.equal(owned.schemaVersion, 1);
  assert.equal(xPlayer.grade, "X");
  assert.equal(xPlayer.sourceName, "English X Player");
  assert.equal(xPlayer.secondaryRole, "RW");
  assert.equal(service.playerDatabase.some((player) => player.id === xPlayer.id), false);
});

test("registration, login and 22-player draft complete without an X-player step", () => {
  const service = new CampaignService({ catalog: makeCatalog(), random: () => 0 });
  const session = service.register("测试经理", "secret12");
  const account = service.authenticate(session.token);
  assert.equal(session.state.wallet.gold,STARTING_GOLD);
  assert.equal(account.gold,STARTING_GOLD);
  assert.equal(service.login("测试经理", "secret12").state.setupComplete, false);

  let state = service.beginDraft(account, "黄狗测试队");
  while (!state.setupComplete) {
    assert.equal(state.draft.offer.length, 3);
    assert.ok(state.draft.offer.every((player) => player.isX !== true && ["A", "B", "C"].includes(player.grade)));
    state = service.choose(account, state.draft.offer[0].id);
  }

  assert.equal(state.draft.roster.length, 22);
  assert.deepEqual(Object.keys(state.draft.counts), LINE_KEYS);
  assert.ok(LINE_KEYS.every((line) => state.draft.counts[line] >= 2));
  assert.ok(state.draft.roster.every((player) => player.isX !== true));
  assert.equal(state.draft.offer.length, 0);
});


test("gold transactions are integer-only, persistent account resources", () => {
  let now=10_000;
  const service=new CampaignService({catalog:makeCatalog(),random:()=>0,now:()=>now});
  const account=service.authenticate(service.register("金币测试经理","secret12").token);
  now+=1000;
  assert.deepEqual(service.adjustGold(account,25_000,"测试奖励"),{gold:1_025_000});
  now+=1000;
  assert.deepEqual(service.spendGold(account,40_000,"测试购买"),{gold:985_000});
  assert.equal(service.state(account).wallet.gold,985_000);
  assert.deepEqual(account.goldLedger.slice(-2).map((entry)=>[entry.delta,entry.balance,entry.reason]),[
    [25_000,1_025_000,"测试奖励"],
    [-40_000,985_000,"测试购买"],
  ]);
  assert.throws(()=>service.spendGold(account,985_001,"超额消费"),/金币不足/);
  assert.throws(()=>service.adjustGold(account,0,"无效变动"),/非零整数/);
});

test("admin pack management targets one server player without exposing credentials", () => {
  const service=new CampaignService({catalog:makeCatalog(),random:()=>0});
  const first=service.authenticate(service.register("卡包玩家一","secret12").token);
  const second=service.authenticate(service.register("卡包玩家二","secret12").token);
  const before=service.adminPlayerPackManagement();
  assert.equal(before.players.length,2);
  assert.deepEqual(before.packTypes.map(({type})=>type),[
    PLAYER_PACK_TYPES.LEGENDARY,
    PLAYER_PACK_TYPES.EXOTIC,
    PLAYER_PACK_TYPES.RARE,
    PLAYER_PACK_TYPES.COMMON,
  ]);
  assert.doesNotMatch(JSON.stringify(before),/passwordHash|passwordSalt|token/);

  const result=service.grantPlayerPacksToAccount(first.id,PLAYER_PACK_TYPES.EXOTIC,4);
  assert.equal(result.grant.name,"珍奇球员卡包");
  assert.equal(result.player.totalPacks,4);
  assert.equal(service.state(first).inventory.totalPacks,4);
  assert.equal(service.state(second).inventory.totalPacks,0);
  const batch=service.grantPlayerPacksToAllAccounts(PLAYER_PACK_TYPES.COMMON,2);
  assert.equal(batch.recipientCount,2);
  assert.equal(batch.totalPacksGranted,4);
  assert.equal(service.state(first).inventory.totalPacks,6);
  assert.equal(service.state(second).inventory.totalPacks,2);
  assert.throws(()=>service.grantPlayerPacksToAccount("missing",PLAYER_PACK_TYPES.LEGENDARY,1),/玩家不存在/);
});

test("player squad assignments persist one exclusive expedition or garrison membership", () => {
  const service = new CampaignService({ catalog:makeCatalog(), random:() => 0 });
  const account = service.authenticate(service.register("编队测试经理", "secret12").token);
  account.setupComplete = true;
  account.draft = { teamName:"编队测试队", roster:makeCatalog().slice(0,3), offer:[] };
  const playerId = account.draft.roster[0].id;

  let state = service.assignPlayerSquad(account,playerId,"expedition");
  assert.deepEqual(state.playerSquads.squads,[{id:"expedition",name:"远征"},{id:"garrison",name:"留守"}]);
  assert.equal(state.playerSquads.assignments[playerId],"expedition");
  assert.equal(Object.values(state.playerSquads.assignments).filter((squadId)=>squadId==="garrison").length,2);

  state = service.assignPlayerSquad(account,playerId,"garrison");
  assert.equal(state.playerSquads.assignments[playerId],"garrison");
  assert.equal(Object.keys(state.playerSquads.assignments).length,3);

  state = service.assignPlayerSquad(account,playerId,null);
  assert.equal(state.playerSquads.assignments[playerId],"garrison");
  assert.throws(() => service.assignPlayerSquad(account,playerId,"unknown"),/编队不存在/);
  assert.throws(() => service.assignPlayerSquad(account,"missing","expedition"),/球员不在你的球队中/);
});

test("completed teams can persist and reload their tactical workspace", () => {
  const service = new CampaignService({ catalog: makeCatalog(), random: () => 0 });
  const account = service.authenticate(service.register("战术测试经理", "secret12").token);
  account.setupComplete = true;
  const setup=makeDualSquadRoster();
  account.draft = { teamName:"战术测试队", roster:setup.roster, offer:[] };
  account.playerSquads=setup.playerSquads;
  const starters = account.draft.roster.filter((player)=>account.playerSquads.assignments[player.id]==="expedition").map((player) => player.id);
  const positions = Object.fromEntries(starters.map((id,index) => [id,{ x:12+index*7,y:index===0?90:index<=4?68:index<=7?44:20 }]));
  const state = service.saveTactics(account, { formation:"4-3-3",attackStyle:"balanced",defenseStyle:"possession",starters,positions,planSnapshots:{ __s4V2:{ activePositionPreset:"position1" } } });
  assert.deepEqual(state.tactics.starters, starters);
  assert.deepEqual(state.tactics.positions, positions);
  assert.equal(service.state(account).tactics.planSnapshots.__s4V2.activePositionPreset, "position1");
  assert.deepEqual(Object.keys(state.tactics.squads).sort(),["expedition","garrison"]);
  const expeditionPlayers=new Set([...state.tactics.squads.expedition.starters,...state.tactics.squads.expedition.bench]);
  const garrisonPlayers=new Set([...state.tactics.squads.garrison.starters,...state.tactics.squads.garrison.bench]);
  assert.deepEqual([...expeditionPlayers].filter((id)=>garrisonPlayers.has(id)),[]);
});

test("tactical saves atomically synchronize the browser's completed squad assignments", () => {
  const service = new CampaignService({ catalog:makeCatalog(), random:() => 0 });
  const account = service.authenticate(service.register("战术编队同步经理","secret12").token);
  account.setupComplete = true;
  const setup=makeDualSquadRoster();
  account.draft={teamName:"战术编队同步队",roster:setup.roster,offer:[]};
  account.playerSquads={schemaVersion:1,assignments:{}};
  const state=service.saveTactics(account,{playerSquads:setup.playerSquads});
  assert.deepEqual(state.playerSquads.assignments,setup.playerSquads.assignments);
  assert.equal(state.playerSquads.schemaVersion,2);
  assert.equal(state.tactics.squads.expedition.starters.length,11);
  assert.equal(state.tactics.squads.garrison.starters.length,11);
});

test("tactical saves enforce S4 formation boundaries for every position preset", () => {
  const service = new CampaignService({ catalog: makeCatalog(), random: () => 0 });
  const account = service.authenticate(service.register("阵型边界经理", "secret12").token);
  account.setupComplete = true;
  const setup=makeDualSquadRoster();
  account.draft = { teamName:"阵型边界队", roster:setup.roster, offer:[] };
  account.playerSquads=setup.playerSquads;
  const starters = account.draft.roster.filter((player)=>account.playerSquads.assignments[player.id]==="expedition").map((player) => player.id);
  const valid = Object.fromEntries(starters.map((id,index) => [id,{ x:12+index*7,y:index===0?90:index<=4?68:index<=7?44:20 }]));
  const multipleGoalkeepers = structuredClone(valid);
  multipleGoalkeepers[starters[1]].y = 90;
  assert.throws(() => service.saveTactics(account, { starters,positions:multipleGoalkeepers }), /门将必须且只能有一人/);

  const missingMidfield = structuredClone(valid);
  starters.slice(5,8).forEach((id) => { missingMidfield[id].y = 68; });
  assert.throws(() => service.saveTactics(account, { starters,positions:missingMidfield }), /三条外场线/);

  const outOfBounds = structuredClone(valid);
  outOfBounds[starters[2]] = { x:-40,y:68 };
  const state = service.saveTactics(account, { starters,positions:outOfBounds });
  assert.equal(state.tactics.positions[starters[2]].x, 8);
  assert.equal(state.tactics.bench.length, 0);
});
function territory(territoryId, neighbors, initialOwner = { type: "neutral", id: null, name: "中立地区" }) {
  return { territoryId, neighbors, landNeighbors: neighbors, maritimeNeighbors: [], playable: true, spawnAllowed: initialOwner.type === "neutral", initialOwner, cityIds: [], clubIds: [] };
}

const territoryIndex = { territories: [
  territory("a", ["b", "e"]),
  territory("b", ["a", "c", "d"]),
  territory("c", ["b"], { type: "club", id: "club-garrison:c", name: "测试豪门" }),
  territory("d", ["b"]),
  territory("e", ["a"]),
] };

test("shared home claims are permanent, exclusive, colored and cannot border a neutral club", () => {
  const service = new CampaignService({ catalog: makeCatalog(), territoryIndex, random: () => 0 });
  const first = service.authenticate(service.register("主场玩家一", "secret12").token);
  const second = service.authenticate(service.register("主场玩家二", "secret12").token);
  first.setupComplete = true;
  first.draft = { teamName: "红色球队", roster: [], offer: [] };
  second.setupComplete = true;
  second.draft = { teamName: "蓝色球队", roster: [], offer: [] };
  assert.equal(service.state(first).homeSelectionRequired, true);
  assert.throws(() => service.chooseHome(first, "b"), /不能与黄色豪门中立区域直接接壤/);
  assert.throws(() => service.chooseHome(first, "c"), /豪门中立势力/);
  const firstState = service.chooseHome(first, "a");
  assert.equal(firstState.homeTerritoryId, "a");
  assert.equal(firstState.world.territories.a.capitalOf, first.id);
  assert.deepEqual(Object.keys(firstState.world.weather.territories).sort(), ["a", "b", "c", "d", "e"]);
  assert.ok(firstState.world.weather.refreshAt > firstState.world.weather.observedAt);
  assert.throws(() => service.chooseHome(first, "d"), /无法更改/);
  assert.throws(() => service.chooseHome(second, "a"), /其他势力占据/);
  const secondState = service.chooseHome(second, "d");
  assert.equal(secondState.world.territories.d.ownerId, second.id);
  assert.notEqual(secondState.world.players[first.id].color, secondState.world.players[second.id].color);
});

test("territory challenges advance one server chain per slice and reveal the result only after both legs", () => {
  const realCatalog = JSON.parse(readFileSync(new URL("../assets/data/s4-player-catalog.json", import.meta.url), "utf8"));
  let now = 100_000;
  const service = new CampaignService({ catalog:realCatalog, territoryIndex, random:() => 0, now:() => now });
  const roster = [
    ...service.playerDatabase.filter((player) => player.pool === "GK").slice(0, 2),
    ...service.playerDatabase.filter((player) => player.pool === "DEF").slice(0, 7),
    ...service.playerDatabase.filter((player) => player.pool === "MID").slice(0, 7),
    ...service.playerDatabase.filter((player) => player.pool === "ATT").slice(0, 6),
  ];
  const account = service.authenticate(service.register("扩张测试经理", "secret12").token);
  const rival = service.authenticate(service.register("并发挑战经理", "secret12").token);
  for (const [candidate, teamName] of [[account, "黄狗远征队"], [rival, "蓝狗远征队"]]) {
    candidate.setupComplete = true;
    candidate.draft = { teamName, roster:structuredClone(roster), offer:[] };
  }
  service.chooseHome(account, "a");
  service.chooseHome(rival, "d");

  const result = service.challengeTerritory(account, "b");
  assert.equal(result.battle, null);
  assert.equal(result.completed, false);
  assert.equal(result.live.legNumber, 1);
  assert.equal(result.live.broadcast.environment.weather, service.territoryWeather("b", now).type);
  assert.equal(result.live.broadcast.environment.precipitation, service.territoryWeather("b", now).precipitation);
  assert.equal(result.live.broadcast.finished, false);
  assert.equal(result.live.broadcast.events.length, 0);
  assert.equal(service.state(account).activeChallengeId,result.challenge.id);
  assert.deepEqual(service.state(account).attackableTerritoryIds,[]);
  assert.throws(()=>service.challengeTerritory(account,"e"),/已有一场板块挑战正在进行/);
  assert.equal(service.world.territories.b.ownerId, null);
  assert.equal(service.world.activeChallenges.b.id, result.challenge.id);
  assert.equal(result.state.battleHistory.length, 0);

  const rivalState = service.state(rival);
  assert.equal(rivalState.attackableTerritoryIds.includes("b"), false);
  assert.equal(rivalState.world.activeChallenges.b.attackerTeamName, "黄狗远征队");
  assert.equal("battle" in rivalState.world.activeChallenges.b, false);
  assert.equal("outcome" in rivalState.world.activeChallenges.b, false);
  assert.throws(() => service.challengeTerritory(rival, "b"), /正在被其他球队挑战/);
  assert.throws(() => service.completeTerritoryChallenge(account, result.challenge.id), /实时推进中/);

  now += 1000;
  const firstLeg = service.world.activeChallenges.b.live.firstLeg;
  const firstBefore = firstLeg.match.nextChainIndex;
  service.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
  assert.ok(firstLeg.match.nextChainIndex-firstBefore <= 1);
  assert.equal(service.world.territories.b.ownerId, null);
  assert.equal(service.challengeStatus(account,result.challenge.id).battle,null);

  now = result.challenge.firstLegEndsAt;
  while (service.world.activeChallenges.b?.phase === "first-leg") {
    const before=firstLeg.match.nextChainIndex;
    service.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
    assert.ok(firstLeg.match.nextChainIndex-before <= 1);
  }
  assert.equal(service.world.activeChallenges.b.phase,"intermission");
  assert.equal(service.world.territories.b.ownerId,null);

  now=service.world.activeChallenges.b.secondLegStartsAt;
  service.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
  assert.equal(service.world.activeChallenges.b.phase,"second-leg");
  const secondLeg=service.world.activeChallenges.b.live.secondLeg;
  const secondStatus=service.challengeStatus(account,result.challenge.id);
  assert.equal(secondStatus.live.legNumber,2);
  assert.notEqual(secondStatus.live.key,result.live.key);
  assert.deepEqual(secondStatus.live.broadcast.score,[0,0]);
  assert.equal(secondStatus.live.broadcast.events.length,0);
  assert.ok(secondStatus.live.broadcast.teams.every((team)=>Number(team.stats.shots??0)===0 && Number(team.stats.xg??0)===0));
  now=secondLeg.startedAt+160_000;
  let safety=0;
  while (service.world.activeChallenges.b && safety<260) {
    const before=secondLeg.match.nextChainIndex;
    service.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
    assert.ok(secondLeg.match.nextChainIndex-before <= 1);
    safety+=1;
  }
  assert.ok(safety<260);
  assert.equal(service.world.activeChallenges.b,undefined);
  const completed=service.challengeStatus(account,result.challenge.id);
  assert.equal(completed.completed,true);
  assert.ok(["win","loss"].includes(completed.battle.outcome));
  assert.equal(completed.battle.captured,completed.battle.outcome==="win");
  assert.equal(service.world.territories.b.ownerId,completed.battle.captured?account.id:null);
  assert.equal(service.completeTerritoryChallenge(account,result.challenge.id).alreadyCompleted,true);
});
test("active live challenges resume deterministically after a server restart", () => {
  const directory=mkdtempSync(path.join(tmpdir(),"yellowdogs-live-resume-"));
  const dataPath=path.join(directory,"campaign.json");
  const realCatalog=JSON.parse(readFileSync(new URL("../assets/data/s4-player-catalog.json",import.meta.url),"utf8"));
  let now=200_000;
  try {
    const service=new CampaignService({dataPath,catalog:realCatalog,territoryIndex,random:()=>0,now:()=>now});
    const roster=[
      ...service.playerDatabase.filter((player)=>player.pool==="GK").slice(0,2),
      ...service.playerDatabase.filter((player)=>player.pool==="DEF").slice(0,7),
      ...service.playerDatabase.filter((player)=>player.pool==="MID").slice(0,7),
      ...service.playerDatabase.filter((player)=>player.pool==="ATT").slice(0,6),
    ];
    const account=service.authenticate(service.register("断点续赛经理","secret12").token);
    account.setupComplete=true;
    account.draft={teamName:"断点续赛队",roster:structuredClone(roster),offer:[]};
    service.chooseHome(account,"a");
    const started=service.challengeTerritory(account,"b");
    now+=1000;
    service.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
    const savedLeg=service.world.activeChallenges.b.live.firstLeg;
    const savedIndex=savedLeg.match.nextChainIndex;
    const savedScore=[...savedLeg.match.score];
    const savedEvents=structuredClone(savedLeg.match.events);
    service.save();

    const reloaded=new CampaignService({dataPath,catalog:realCatalog,territoryIndex,random:()=>0,now:()=>now});
    const restored=reloaded.world.activeChallenges.b.live.firstLeg;
    assert.equal(typeof restored.match.rng,"function");
    assert.equal(restored.match.nextChainIndex,savedIndex);
    assert.deepEqual(restored.match.score,savedScore);
    assert.deepEqual(restored.match.events,savedEvents);
    assert.ok(Number.isFinite(restored.match.rngState));
    now+=1000;
    const before=restored.match.nextChainIndex;
    service.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
    reloaded.advanceActiveChallenges(now,{maximumMatches:1,maximumChainsPerMatch:1});
    assert.ok(restored.match.nextChainIndex-before<=1);
    assert.deepEqual(restored.match.score,service.world.activeChallenges.b.live.firstLeg.match.score);
    assert.deepEqual(restored.match.events,service.world.activeChallenges.b.live.firstLeg.match.events);
    assert.equal(reloaded.challengeStatus(reloaded.accounts.get(account.id),started.challenge.id).battle,null);
  } finally {
    rmSync(directory,{recursive:true,force:true});
  }
});

test("saved fragmented-country territory ids migrate to the merged country territory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "yellowdogs-territory-migration-"));
  const dataPath = path.join(directory, "campaign.json");
  const mergedIndex = {
    schemaVersion:2,
    territoryIdAliases:{ "old-a":"merged", "old-b":"merged" },
    territories:[territory("merged",["other"]),territory("other",["merged"])],
  };
  writeFileSync(dataPath, JSON.stringify({
    accounts:{ p:{ id:"p",nickname:"迁移玩家",token:"token",setupComplete:true,homeTerritoryId:"old-b",playerCatalogVersion:PLAYER_CATALOG_VERSION,battleHistory:[{ territoryId:"old-a" }] } },
    world:{
      schemaVersion:2,seasonId:"season-01",revision:4,aiGenerationSeed:"seed",
      territories:{
        "old-a":{territoryId:"old-a",ownerType:"player",ownerId:"p",capitalOf:null,version:1},
        "old-b":{territoryId:"old-b",ownerType:"player",ownerId:"p",capitalOf:"p",version:2},
        other:{territoryId:"other",ownerType:"neutral",ownerId:null,capitalOf:null,version:0},
      },
      players:{ p:{playerId:"p",territoryIds:["old-a","old-b"],capitalTerritoryId:"old-b",exiled:false} },
      aiGarrisons:{ "old-a":{territoryId:"old-a"} },
    },
  }));
  try {
    const service = new CampaignService({ dataPath, catalog:makeCatalog(), territoryIndex:mergedIndex });
    const account = service.accounts.get("p");
    assert.equal(account.homeTerritoryId,"merged");
    assert.equal(account.battleHistory[0].territoryId,"merged");
    assert.equal(service.world.territories.merged.ownerId,"p");
    assert.equal(service.world.territories.merged.capitalOf,"p");
    assert.deepEqual(service.world.players.p.territoryIds,["merged"]);
    assert.equal(service.world.players.p.capitalTerritoryId,"merged");
    assert.equal(service.world.aiGarrisons["old-a"],undefined);
    const persisted=JSON.parse(readFileSync(dataPath,"utf8"));
    assert.equal(persisted.accounts.p.homeTerritoryId,"merged");
    assert.ok(persisted.world.territories.merged);
  } finally {
    rmSync(directory,{recursive:true,force:true});
  }
});
