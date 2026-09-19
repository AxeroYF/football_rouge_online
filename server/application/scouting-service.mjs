import {movementUseOil} from '../../shared/config/movement-oil.mjs';
import { facilityEffects } from '../../shared/config/facility-levels.mjs';
import crypto from "node:crypto";
import { SCOUTING_RULES, scoutingLevel } from "../../shared/config/scouting.mjs";
import { CORE_COUNTRY_CODES, coreCountryForNationality } from "../../shared/config/countries.mjs";
import { BUILDING_DEFINITIONS } from "../../shared/config/buildings.mjs";
import { territoryTravelEstimate } from "../domain/expedition-piece.mjs";
import { SCOUT_TOKEN_URL, normalizeScoutName, scoutEnglishName, scoutMoveTargets, ownsScoutTerritory, canDiscoverScoutTerritory, canVisitScoutTerritory, settleScoutUnits } from "../../shared/scouting/scout-units.mjs";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import { createPlayerCardInstance } from "../domain/player-card-instance.mjs";

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function weighted(weights, roll) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  let cursor = roll * total;
  for (const [key, weight] of Object.entries(weights)) { cursor -= weight; if (cursor < 0) return key; }
  return Object.keys(weights).at(-1);
}
function requestKey(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{8,100}$/.test(value)) fail("无效的请求编号");
  return value;
}
function initialize(account) {
  account.scouting ??= {};
  account.scouting.tasks ??= {};
  account.scouting.units ??= {};
  account.scouting.recruitRequests ??= {};
  account.scouting.schemaVersion = 2;
  return account.scouting;
}
function boundedInsert(records, id, value, limit = 20) {
  records[id] = value;
  while (Object.keys(records).length > limit) delete records[Object.keys(records)[0]];
}

export class ScoutingService {
  constructor({ playerDatabase, buildings, economy, territoryIndex, now = Date.now, random = Math.random, save = () => {} }) {
    Object.assign(this, { playerDatabase, buildings, economy, territoryIndex, now, random, save });
    this.metadataById = new Map((territoryIndex?.territories ?? []).map(entry => [entry.territoryId, entry]));
  }
  roll() { return Math.max(0, Math.min(0.999999999, Number(this.random()) || 0)); }
  tasks(account) { return Object.values(account.scouting?.tasks ?? {}); }
  units(account) { return Object.values(account.scouting?.units ?? {}); }
  label(id) {
    const metadata = this.metadataById.get(id);
    return metadata ? `${metadata.country} · ${metadata.name}` : id ?? "暂无驻扎地";
  }
  unit(account, id) {
    const unit = account.scouting?.units?.[id];
    if (!unit || unit.id !== id) fail("球探不存在", 404);
    return unit;
  }
  unitTask(account, id) { return this.tasks(account).filter(task => task.scoutId === id).at(-1) ?? null; }
  publicTask(task) {
    const status = task.claimedAt != null ? "claimed" : this.now() >= task.completesAt ? "ready" : "working";
    return {
      id: task.id, scoutId: task.scoutId ?? null, scoutName: task.scoutName ?? null,
      buildingId: task.buildingId, territoryId: task.territoryId,
      territoryLabel: task.territoryLabel, level: task.level, countryCode: task.countryCode,
      raidPause: task.raidPause ? {...task.raidPause} : null, coreCountry: task.coreCountry, startedAt: task.startedAt, completesAt: task.completesAt,
      roundCount:task.roundCount??1,completedRounds:Math.min(task.roundCount??1,Math.max(0,Math.floor((Math.max(this.now(),task.raidPause?.until??0)-task.startedAt)/(task.roundDurationMs??(task.completesAt-task.startedAt))))),
      rounds:status==='ready'&&task.rounds?task.rounds.map((r,index)=>({index,cards:r.candidates.map(createPlayerCardViewModel)})):[],
      costGold:task.costGold,
      status, cards: status === "ready" ? task.candidates.map(createPlayerCardViewModel) : [],
      selectedCardId: task.selectedCardId ?? null,
    };
  }
  publicUnit(account, unit, world) {
    const task = this.unitTask(account, unit.id);
    const activeTask = task && task.claimedAt == null ? this.publicTask(task) : null;
    const status = activeTask?.status ?? (unit.movement ? "moving" : unit.territoryId ? "idle" : "stranded");
    return {
      id: unit.id, name: unit.name, level: activeTask?.level??this.activeCenter(account,world)?.level??unit.level, tokenUrl: SCOUT_TOKEN_URL,
      originTerritoryId: unit.originTerritoryId, originBuildingId: unit.originBuildingId,
      territoryId: unit.territoryId, territoryLabel: this.label(unit.territoryId),
      movement: unit.movement ? structuredClone(unit.movement) : null, status,
      taskId: activeTask?.id ?? null, task: activeTask,
      movableTerritoryIds: status === "idle" && world
        ? this.moveTargets(account, world, unit.territoryId) : [],
    };
  }
  publicState(account, world) {
    return {
      rules: {...this.levelRules(account,world),choiceCount:this.wonders?.modifiers(account).scoutChoices??SCOUTING_RULES.choiceCount}, capacity: this.levelRules(account,world).scoutCapacity,
      scouts: this.units(account).map(unit => this.publicUnit(account, unit, world)),
      tasks: this.tasks(account).filter(task => task.claimedAt == null).map(task => this.publicTask(task)),
      serverNow: this.now(),
    };
  }
  // Only runs on repository hydration; existing paid discoveries remain claimable.
  migrate(accounts, world) {
    let changed = false;
    for (const account of accounts.values()) {
      const needsMigration = account.scouting?.schemaVersion !== 2;
      if (needsMigration && (account.setupComplete || account.scouting)) { initialize(account); changed = true; }
      const aliases = this.territoryIndex?.territoryIdAliases ?? {};
      for (const task of this.tasks(account)) {
        if (aliases[task.territoryId]) { task.territoryId = aliases[task.territoryId]; changed = true; }
      }
      for (const unit of this.units(account)) {
        for (const key of ["territoryId", "originTerritoryId"]) {
          if (aliases[unit[key]]) { unit[key] = aliases[unit[key]]; changed = true; }
        }
        if (unit.movement) {
          for (const key of ["fromTerritoryId", "toTerritoryId"]) {
            if (aliases[unit.movement[key]]) { unit.movement[key] = aliases[unit.movement[key]]; changed = true; }
          }
          unit.movement.path = (unit.movement.path ?? []).map(id => { if (aliases[id]) changed = true; return aliases[id] ?? id; });
        }
      }
      if (!world) continue;
      const centers = Object.entries(world.territories ?? {}).filter(([territoryId]) => ownsScoutTerritory(account, world, territoryId))
        .flatMap(([territoryId, territory]) => (territory.buildings ?? []).filter(building => building.type === "scout-center").map(building => ({ territoryId, building })))
        .sort((left, right) => Number(right.building.level) - Number(left.building.level)
          || Number(left.building.status !== "active") - Number(right.building.status !== "active")
          || Number(left.building.constructionStartedAt ?? left.building.builtAt ?? 0) - Number(right.building.constructionStartedAt ?? right.building.builtAt ?? 0)
          || left.building.id.localeCompare(right.building.id));
      for (const entry of centers.slice(SCOUTING_RULES.maxCentersPerPlayer)) {
        const territory = world.territories[entry.territoryId];
        territory.buildings = territory.buildings.filter(building => building.id !== entry.building.id);
        territory.version = Number(territory.version ?? 0) + 1;
        world.revision = Number(world.revision ?? 0) + 1;
        // Upgrades were not publicly open. Return the original base construction cost once.
        const refund = needsMigration ? BUILDING_DEFINITIONS["scout-center"].costsGold[0] : 0;
        if (refund) this.economy.adjust(account, refund, "scout-center-consolidation");
        const state = initialize(account);
        state.legacyCenters ??= [];
        state.legacyCenters.push({ territoryId: entry.territoryId, building: structuredClone(entry.building), refundGold: refund });
        state.legacyCenters = state.legacyCenters.slice(-20);
        changed = true;
      }
      changed = settleScoutUnits(account, world, this.now()) || changed;
    }
    return changed;
  }
  settle(account, world) {
    if (!this.units(account).length || !world) return false;
    const before = structuredClone(account.scouting.units);
    if (!settleScoutUnits(account, world, this.now())) return false;
    try { this.save(); return true; }
    catch (error) { account.scouting.units = before; throw error; }
  }
  activeCenter(account,world){return Object.values(world?.territories??{}).filter(t=>t.ownerId===account.id).flatMap(t=>t.buildings??[]).find(b=>b.type==='scout-center'&&b.status==='active');}
  levelRules(account,world){const center=this.activeCenter(account,world);const effects=facilityEffects('scout-center',center?.level??1);return {...SCOUTING_RULES,...effects,costGold:Math.ceil(effects.costGold*(this.wonders?.modifiers(account).recurringExpenseMultiplier??1)),level:center?.level??1,available:Boolean(center)};}
  center(account, world, territoryId, buildingId) {
    this.buildings.settleConstructions(world);
    const territory = this.buildings.ownedTerritory(account, world, territoryId);
    const building = territory.buildings.find(entry => entry.id === buildingId && entry.type === "scout-center");
    if (!building) fail("球探中心不存在", 404);
    return building;
  }
  details(account, world, territoryId, buildingId) {
    const building = this.center(account, world, territoryId, buildingId);
    this.settle(account, world);
    const state = this.publicState(account, world);
    return {
      kind: "center", building: this.buildings.publicBuilding(building), territoryId,
      territoryLabel: this.label(territoryId), rules: state.rules,
      scouts: state.scouts, capacity: state.capacity,
      recruitAvailable: Math.max(0, state.capacity - state.scouts.length),
      legacyTasks: state.tasks.filter(task => !task.scoutId), serverNow: this.now(),
    };
  }
  unitDetails(account, world, scoutId) {
    this.settle(account, world);
    const unit = this.unit(account, scoutId);
    const metadata = this.metadataById.get(unit.territoryId);
    return {
      kind: "unit", scout: this.publicUnit(account, unit, world),
      territoryId: unit.territoryId, territoryLabel: this.label(unit.territoryId),
      neutralTerritory:world.territories[unit.territoryId]?.ownerType==='neutral',
      countryCode: metadata?.countryCode ?? null, coreCountry: CORE_COUNTRY_CODES.includes(metadata?.countryCode),
      rules: {...this.levelRules(account,world),choiceCount:this.wonders?.modifiers(account).scoutChoices??SCOUTING_RULES.choiceCount,durationMs:SCOUTING_RULES.durationMs*(this.wonders?.nearby(account,"eiffel-tower",unit.territoryId)?.6:1)}, levelRules: scoutingLevel(this.levelRules(account,world).level),
      task: this.unitTask(account, scoutId) ? this.publicTask(this.unitTask(account, scoutId)) : null,
      canDiscover: this.levelRules(account,world).available && canDiscoverScoutTerritory(account, world, unit.territoryId), serverNow: this.now(),
    };
  }
  taskDetails(account, taskId) {
    const task = this.tasks(account).find(entry => entry.id === taskId);
    if (!task) fail("发掘任务不存在", 404);
    return { kind: "legacy", task: this.publicTask(task), rules: SCOUTING_RULES, levelRules: scoutingLevel(task.level),
      territoryId: task.territoryId, territoryLabel: task.territoryLabel, canDiscover: false, serverNow: this.now() };
  }
  recruit(account, world, { territoryId, buildingId, count = 1, requestId } = {}) {
    requestKey(requestId);
    if (!account.setupComplete || !account.draft) fail("请先完成初始建队");
    if (!Number.isInteger(count) || count < 1 || count > SCOUTING_RULES.recruitBatchLimit) fail("每次可招募 1～2 名球探");
    const prior = account.scouting?.recruitRequests?.[requestId];
    if (prior) {
      if (prior.buildingId !== buildingId || prior.territoryId !== territoryId || prior.count !== count) fail("该请求编号已用于另一项招募", 409);
      return prior.unitIds.map(id => this.publicUnit(account, this.unit(account, id), world));
    }
    const building = this.center(account, world, territoryId, buildingId);
    if (building.status !== "active") fail("球探中心尚未建成或不可用", 409);
    if (this.units(account).length + count > this.levelRules(account,world).scoutCapacity) fail(`当前最多拥有 ${this.levelRules(account,world).scoutCapacity} 名球探`, 409);
    const cost = count * SCOUTING_RULES.recruitCostGold;
    if (Number(account.gold) < cost) fail("金币不足");
    return this.transaction(account, () => {
      const state = initialize(account);
      if (cost) this.economy.spend(account, cost, "scout-recruit");
      const recruited = [];
      for (let index = 0; index < count; index++) {
        const unit = {
          id: `scout:${crypto.randomUUID()}`, name: scoutEnglishName(this.units(account).map(entry => entry.name), () => this.roll()),
          level: Math.max(1, Math.min(5, Number(building.level) || 1)), createdAt: this.now(),
          originBuildingId: buildingId, originTerritoryId: territoryId, territoryId, movement: null,
        };
        state.units[unit.id] = unit; recruited.push(unit);
      }
      boundedInsert(state.recruitRequests, requestId, { territoryId, buildingId, count, unitIds: recruited.map(unit => unit.id) });
      return recruited.map(unit => this.publicUnit(account, unit, world));
    });
  }
  rename(account, world, {scoutId, name} = {}) {
    const unit = this.unit(account, scoutId);
    let nextName;
    try { nextName = normalizeScoutName(name); } catch(error) { fail(error.message); }
    if(unit.name === nextName)return this.publicUnit(account,unit,world);
    return this.transaction(account,()=>{
      unit.name = nextName;
      for(const task of this.tasks(account))if(task.scoutId===scoutId&&task.claimedAt==null)task.scoutName=nextName;
      return this.publicUnit(account,unit,world);
    });
  }
  requireIdle(account, unit) {
    const task = this.unitTask(account, unit.id);
    if (task && task.claimedAt == null) fail("请先完成当前发掘并选择球员", 409);
    if (unit.movement) fail("球探正在移动，抵达后才能操作", 409);
  }
  moveTargets(account,world,sourceId) {
    const visible=new Set(this.fog?.update(account,world).view.visibleTerritoryIds??[]);
    return scoutMoveTargets(account,world,sourceId).filter(id=>world.territories[id].ownerType!=="neutral"||visible.has(id));
  }
  estimate(account, world, { scoutId, territoryId, useOil = true } = {}) {
    movementUseOil(useOil);
    this.settle(account, world);
    const unit = this.unit(account, scoutId);
    this.requireIdle(account, unit);
    if (!this.moveTargets(account,world,unit.territoryId).includes(territoryId) && territoryId!==unit.territoryId) fail("球探只能移动到己方、盟友或当前可见的中立地块", 403);
    if (unit.territoryId === territoryId) fail("球探已在该地块");
    if (!canVisitScoutTerritory(account, world, unit.territoryId)) fail("球探没有可出发的地块", 403);
    const base = territoryTravelEstimate(this.territoryIndex, unit.territoryId, territoryId);
    const estimate=this.oil?this.oil.estimate(account,base,'scout',{useOil}):base;
    return { ...estimate, routeMode:"direct", path:[unit.territoryId, territoryId], stepDurationMs:estimate.durationMs };
  }
  move(account, world, { scoutId, territoryId, requestId, useOil = true } = {}) {
    movementUseOil(useOil);
    requestKey(requestId); this.settle(account, world);
    const unit = this.unit(account, scoutId);
    const prior = unit.moveRequests?.[requestId];
    if (prior) {
      if (prior.territoryId !== territoryId || (prior.useOil ?? true) !== useOil) fail("该请求编号已用于其他行程或移动方式", 409);
      return this.publicUnit(account, unit, world);
    }
    const estimate = this.estimate(account, world, { scoutId, territoryId, useOil });
    return this.transaction(account, () => {
      const startedAt = this.now();
      this.oil?.spend(account,estimate);
      unit.movement = { id: requestId, ...estimate, startedAt, arrivesAt: startedAt + estimate.durationMs };
      unit.moveRequests ??= {};
      boundedInsert(unit.moveRequests, requestId, { territoryId, useOil });
      return this.publicUnit(account, unit, world);
    });
  }
  cancelMove(account, world, scoutId, movementId) {
    this.settle(account, world);
    const unit = this.unit(account, scoutId);
    if (!unit.movement) return this.publicUnit(account, unit, world);
    if (!movementId || movementId !== unit.movement.id) fail("球探行程已变化，请刷新后重试", 409);
    return this.transaction(account, () => {
      unit.movement = null;
      return this.publicUnit(account, unit, world);
    });
  }
  draw(level, countryCode, choiceCount = SCOUTING_RULES.choiceCount) {
    const rules = scoutingLevel(level);
    const database = this.playerDatabase.filter((player) => player?.id && player.isX !== true && ["C", "B", "A", "S"].includes(player.grade));
    const normal = database.filter((player) => rules.gradeWeights[player.grade] > 0);
    if (normal.length < choiceCount) fail("当前球员库不足以提供三名候选，请稍后再试");
    const selected = [];
    const core = CORE_COUNTRY_CODES.includes(countryCode);
    for (let index = 0; index < choiceCount; index += 1) {
      const unused = (player) => !selected.some((card) => card.cardDefinitionId === (player.cardDefinitionId ?? player.id));
      const legendary = this.roll() < rules.legendaryChance;
      const grade = legendary ? "S" : weighted(rules.gradeWeights, this.roll());
      let pool = database.filter((player) => player.grade === grade && unused(player));
      if (!pool.length) pool = normal.filter(unused);
      if (!pool.length) fail("当前球员库无法提供三名不同的候选球员");
      const preferred = (player) => core ? coreCountryForNationality(player.nationality) === countryCode : !coreCountryForNationality(player.nationality);
      const usePreferred = this.roll() < SCOUTING_RULES.regionalBias;
      const regional = pool.filter((player) => preferred(player) === usePreferred);
      if (regional.length) pool = regional;
      const source = pool[Math.floor(this.roll() * pool.length)];
      const enhancement = Number(weighted(SCOUTING_RULES.enhancementWeights, this.roll()));
      selected.push(createPlayerCardInstance(source, enhancement));
    }
    return selected;
  }

  transaction(account, action) {
    const before = structuredClone(account);
    try { const result = action(); this.save(); return result; }
    catch (error) {
      for (const key of Object.keys(account)) delete account[key];
      Object.assign(account, before);
      throw error;
    }
  }
  start(account, world, { scoutId, territoryId, requestId, rounds = 1 } = {}) {
    if (!account.setupComplete || !account.draft) fail("请先完成初始建队");
    requestKey(requestId);
    if (!scoutId) fail("请先招募并选择一名球探");
    if(!Number.isInteger(rounds)||rounds<1||rounds>SCOUTING_RULES.maxQueueRounds)fail('每次发掘队列为 1～20 轮');
    const existing = this.tasks(account).find(task => task.requestId === requestId);
    if (existing) {
      if ((existing.roundCount??1)!==rounds || existing.scoutId !== scoutId || (territoryId && existing.territoryId !== territoryId)) fail("该请求编号已用于另一名球探或地块", 409);
      return this.publicTask(existing);
    }
    this.settle(account, world);
    const unit = this.unit(account, scoutId);
    this.requireIdle(account, unit);
    if (!canDiscoverScoutTerritory(account, world, unit.territoryId)) fail("只能在自己或盟友的领地发掘球员，中立地块仅供探索", 403);
    if (territoryId && unit.territoryId !== territoryId) fail("球探位置已变化，请刷新后重试", 409);
    const rules=this.levelRules(account,world);
    if(!rules.available)fail("请先建造球探中心",409);
    if(this.tasks(account).filter(t=>t.scoutId&&t.claimedAt==null&&t.completesAt>this.now()).length>=rules.scoutCapacity)fail("球探中心并行容量已满",409);
    if (Number(account.gold) < rules.costGold*rounds) fail("金币不足");
    const metadata = this.metadataById.get(unit.territoryId);
    if (!metadata) fail("球探所在地信息不存在", 404);
    const queue=Array.from({length:rounds},()=>({candidates:this.draw(rules.level,metadata.countryCode,this.wonders?.modifiers(account).scoutChoices??SCOUTING_RULES.choiceCount)}));
    const candidates=queue[0].candidates,roundDurationMs=SCOUTING_RULES.durationMs*(this.wonders?.nearby(account,"eiffel-tower",unit.territoryId)?.6:1);
    return this.transaction(account, () => {
      this.economy.spend(account, rules.costGold*rounds, "scouting-start");
      unit.level=rules.level;
      const task = {
        id: `scouting:${crypto.randomUUID()}`, requestId, scoutId, scoutName: unit.name,
        territoryId: unit.territoryId, buildingId: unit.originBuildingId,
        territoryLabel: this.label(unit.territoryId), countryCode: metadata.countryCode,
        coreCountry: CORE_COUNTRY_CODES.includes(metadata.countryCode),
        costGold:rules.costGold*rounds,roundCount:rounds,roundDurationMs,rounds:queue,level: rules.level, startedAt: this.now(), completesAt: this.now() + roundDurationMs*rounds,
        candidates, claimedAt: null,
      };
      initialize(account).tasks[task.id] = task;
      return this.publicTask(task);
    });
  }
  claimQueue(account,taskId,cardIds){
    const task=this.tasks(account).find(t=>t.id===taskId);if(!task)fail('发掘任务不存在',404);
    const rounds=task.rounds??[{candidates:task.candidates}];
    if(!Array.isArray(cardIds)||cardIds.length!==rounds.length||cardIds.some(id=>typeof id!=='string'))fail('每轮必须选择一名球员');
    const cards=rounds.map((r,i)=>r.candidates.find(c=>c.id===cardIds[i]));if(cards.some(c=>!c))fail('所选球员不属于对应轮次');
    if(task.claimedAt!=null){if(JSON.stringify(task.selectedCardIds??[task.selectedCardId])!==JSON.stringify(cardIds))fail('本队列已经领取了其他球员',409);return cards.map(createPlayerCardViewModel);}
    if(this.now()<task.completesAt)fail('发掘队列尚未全部完成',409);
    if(!account.setupComplete||!account.draft?.roster)fail('球队状态异常');
    return this.transaction(account,()=>{account.draft.roster.push(...structuredClone(cards));task.selectedCardIds=[...cardIds];task.selectedCardId=cardIds.length===1?cardIds[0]:null;task.claimedAt=this.now();return cards.map(createPlayerCardViewModel);});
  }
  choose(account, taskId, cardId) {
    const task = this.tasks(account).find((entry) => entry.id === taskId);
    if (!task) fail("发掘任务不存在", 404);
    if((task.roundCount??1)>1)fail('请为每一轮选择球员后统一领取',409);
    if (task.claimedAt != null) {
      if (task.selectedCardId !== cardId) fail("本次发掘已经选择了其他球员", 409);
      return createPlayerCardViewModel(task.candidates.find((card) => card.id === cardId));
    }
    if (this.now() < task.completesAt) fail("球员发掘尚未完成", 409);
    const card = task.candidates.find((entry) => entry.id === cardId);
    if (!card) fail("该球员不在本次候选中");
    if (!account.setupComplete || !account.draft?.roster) fail("球队状态异常");
    return this.transaction(account, () => {
      account.draft.roster.push(structuredClone(card));
      task.selectedCardId = card.id;
      task.claimedAt = this.now();
      return createPlayerCardViewModel(card);
    });
  }
}
