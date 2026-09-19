import {canUseTerritory} from '../../shared/config/diplomacy.mjs';
import {constructionProjectState,assertConstructionSlot} from '../../shared/buildings/construction-limit.mjs';
import {oilDeposit} from '../../shared/config/oil-deposits.mjs';
import {DISTRICT_RULES} from '../../shared/buildings/district-yields.mjs';
import { buildingVisibility } from '../../shared/buildings/building-visibility.mjs';
import { facilityEffects, facilityEffectText, headquartersLevel, HEADQUARTERS_FANS } from '../../shared/config/facility-levels.mjs';
import { sponsoredStadiumName, activeSponsorContracts } from '../../shared/config/sponsorship.mjs';
import { facilityArtIcon } from '../../shared/config/facility-art.mjs';
import { SCOUTING_RULES } from "../../shared/config/scouting.mjs";
import crypto from "node:crypto";
import {
  BUILDING_DEFINITIONS,
  BUILDING_RULES,
  BUILDING_TYPES,
  buildingDefinition,
  publicBuildingCatalog,
} from "../../shared/config/buildings.mjs";

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

function cleanBuildingName(value) {
  const name = String(value ?? "").trim();
  if (name.length < 2) fail("体育场名称至少需要2个字符");
  if (name.length > 30) fail("体育场名称不能超过30个字符");
  return name;
}

function defaultStadiumName(account) {
  const teamName = String(account?.draft?.teamName ?? account?.nickname ?? "球队").trim() || "球队";
  return `${teamName}主体育场`.slice(0, 30);
}

export class BuildingService {
  constructor({
    economy,
    now = Date.now,
    createBuildingId = () => `building:${crypto.randomBytes(8).toString("hex")}`,
    isCoastal = () => false,
    getProduction = null,
    getAccount = () => null,
    save = () => {},
  } = {}) {
    if (!economy) throw new Error("BuildingService requires an economy service");
    this.economy = economy;
    this.now = now;
    this.createBuildingId = createBuildingId;
    this.isCoastal = isCoastal;
    this.oilDeposit = oilDeposit;
    this.getProduction = getProduction;
    this.getAccount = getAccount;
    this.save = save;
  }

  catalog() {
    return [...publicBuildingCatalog(), ...(this.wonders?.catalog()??[])];
  }

  createRecord(type, {
    name = null,
    builtAt = this.now(),
    level = 1,
    status = "active",
    constructionStartedAt = null,
    completesAt = null,
  } = {}) {
    const definition = buildingDefinition(type);
    if (!definition) fail("设施类型不存在");
    const normalizedLevel = Math.max(1, Math.min(definition.costsGold.length, Number(level) || 1));
    return {
      id: this.createBuildingId(),
      facilitySchemaVersion:2,
      type: definition.type,
      level: normalizedLevel,
      status: status === "constructing" ? "constructing" : "active",
      name: definition.customName ? cleanBuildingName(name ?? definition.label) : null,
      constructionStartedAt: Number(constructionStartedAt ?? 0) || null,
      completesAt: Number(completesAt ?? 0) || null,
      builtAt: builtAt === null ? null : Number(builtAt) || this.now(),
      updatedAt: Number(constructionStartedAt ?? builtAt ?? 0) || this.now(),
    };
  }

  settleConstructions(world) {
    if (!world) return false;
    if (this.getProduction) {
      const pending = Object.values(world.territories ?? {}).flatMap(t => t.buildings ?? []).filter(b => b.status === "constructing" || b.upgradeTo);
      if (!pending.length) return false;
      this.save();
      return pending.some(b => b.status === "active");
    }
    const now = this.now();
    let changed = false;
    for (const territory of Object.values(world.territories ?? {})) {
      let territoryChanged = false;
      for (const building of territory.buildings ?? []) {
        if (building.status !== "constructing") continue;
        const completesAt = Number(building.completesAt ?? 0);
        if (!completesAt || completesAt > now) continue;
        building.status = "active";
        building.builtAt = completesAt;
        building.updatedAt = now;
        territoryChanged = true;
      }
      if (!territoryChanged) continue;
      territory.version = Number(territory.version ?? 0) + 1;
      changed = true;
    }
    if (!changed) return false;
    world.revision = Number(world.revision ?? 0) + 1;
    this.save();
    return true;
  }

  migrate({ accounts, world } = {}) {
    if (!world) return false;
    let changed = false;
    for (const territory of Object.values(world.territories ?? {})) {
      if (!Array.isArray(territory.buildings)) {
        territory.buildings = [];
        changed = true;
      }
      if (territory.scoutingCenter && !territory.buildings.some((building) => building.type === BUILDING_TYPES.SCOUT_CENTER)) {
        territory.buildings.push(this.createRecord(BUILDING_TYPES.SCOUT_CENTER, {
          builtAt: territory.scoutingCenter.builtAt,
          level: territory.scoutingCenter.level,
        }));
        changed = true;
      }
      if (Object.hasOwn(territory, "scoutingCenter")) {
        delete territory.scoutingCenter;
        changed = true;
      }
    }
    for (const account of accounts?.values?.() ?? []) {
      const territoryId = account.homeTerritoryId ?? world.players?.[account.id]?.capitalTerritoryId ?? null;
      const territory = world.territories?.[territoryId];
      if (!territory || territory.ownerId !== account.id || territory.capitalOf !== account.id) continue;
      if (territory.buildings.some(b=>b.type===BUILDING_TYPES.CLUB_HEADQUARTERS)) continue;
      const legacy = territory.buildings.find(b=>b.type===BUILDING_TYPES.MAIN_STADIUM && !b.facilitySchemaVersion && !b.buildMethod);
      if (legacy) {
        legacy.legacyStadiumName=legacy.name; legacy.type=BUILDING_TYPES.CLUB_HEADQUARTERS; legacy.name=null; legacy.facilitySchemaVersion=2;
      } else territory.buildings.push(this.createRecord(BUILDING_TYPES.CLUB_HEADQUARTERS,{builtAt:account.createdAt}));
      territory.version=Number(territory.version??0)+1; changed=true;
    }
    if (changed) world.revision = Number(world.revision ?? 0) + 1;
    return changed;
  }

  ensureCapitalHeadquarters(account, world, territoryId) {
    const territory=this.ownedTerritory(account,world,territoryId);
    if(territory.capitalOf!==account.id)fail("俱乐部总部只能建立在首都地块");
    let headquarters=territory.buildings.find(b=>b.type===BUILDING_TYPES.CLUB_HEADQUARTERS);
    if(!headquarters){headquarters=this.createRecord(BUILDING_TYPES.CLUB_HEADQUARTERS);territory.buildings.push(headquarters);territory.version=Number(territory.version??0)+1;world.revision=Number(world.revision??0)+1;}
    return headquarters;
  }
  // Compatibility for older setup callers: the capital anchor is now headquarters.
  ensureCapitalStadium(account,world,territoryId){return this.ensureCapitalHeadquarters(account,world,territoryId);}

  ownedTerritory(account, world, territoryIdValue) {
    if (!world || !account?.setupComplete) fail("请先完成初始建队");
    const territoryId = String(territoryIdValue ?? "");
    const territory = world.territories?.[territoryId];
    if (!territory) fail("目标地块不存在");
    if (territory.ownerType !== "player" || territory.ownerId !== account.id) fail("只能管理自己的领地设施", 403);
    territory.buildings ??= [];
    return territory;
  }

  countOwnedType(account, world, type) {
    return Object.values(world?.territories ?? {})
      .filter((territory) => territory.ownerType === "player" && territory.ownerId === account.id)
      .reduce((sum, territory) => sum + (territory.buildings ?? []).filter((building) => building.type === type).length, 0);
  }

  slotLimit(account, territory) {
    return territory.capitalOf === account.id
      ? BUILDING_RULES.capitalSlotLimit
      : BUILDING_RULES.standardTerritorySlotLimit;
  }

  publicBuilding(building, account = null) {
    if(building.wonderId)return this.wonders?.publicBuilding(building)??null;
    const definition = buildingDefinition(building.type);
    if (!definition) return null;
    const level = Math.max(1, Math.min(definition.costsGold.length, Number(building.level) || 1));
    const completesAt = Number(building.completesAt ?? 0) || null;
    const constructing = building.status === "constructing";
    return {
      raidSuppressed:Boolean(building.raidSuppressed),
      id: building.id,
      type: definition.type,
      label: definition.label,
      iconPath: facilityArtIcon(building.type, building.level) ?? definition.iconPath,
      level,
      maxLevel: definition.costsGold.length,
      status: constructing ? "constructing" : building.status === "inactive" ? "inactive" : "active",
      name: building.type==='airport'?`${account?.draft?.teamName??account?.nickname??'俱乐部'}机场`:definition.customName ? sponsoredStadiumName(account, String(building.name ?? definition.label), this.now()) : null,
      ...(definition.customName ? { nameLocked:activeSponsorContracts(account,this.now()).some(c=>c.type==="stadium") } : {}),
      builtAt: Number(building.builtAt ?? 0) || null,
      updatedAt: Number(building.updatedAt ?? 0) || null,
      constructionStartedAt: Number(building.constructionStartedAt ?? 0) || null,
      completesAt,
      remainingConstructionMs: constructing ? (completesAt === null ? null : Math.max(0, completesAt - this.now())) : 0,
      ...(building.buildMethod ? { buildMethod: building.buildMethod } : {}),
      ...(building.buildCostProduction ? { buildCostProduction: building.buildCostProduction } : {}),
      ...(building.productionWork ? { productionWork: structuredClone(building.productionWork) } : {}),
      upgradeEnabled: BUILDING_RULES.upgradesEnabled && definition.costsGold.length > 1,
      nextUpgradeCostGold: BUILDING_RULES.upgradesEnabled && level < definition.costsGold.length ? definition.costsGold[level] : null,
      effects:facilityEffects(building.type,level),
      effectText:facilityEffectText(building.type,level),
      seatingCapacity:building.type===BUILDING_TYPES.MAIN_STADIUM?facilityEffects(building.type,level).seatingCapacity:null,
      upgradeTo:building.upgradeTo??null,
      upgradeStartedAt:building.upgradeStartedAt??null,
      upgradeCompletedAt:building.upgradeCompletedAt??null,
      nextUpgradeCostProduction:level<definition.costsGold.length?definition.costsProduction[level]:null,
      nextEffectText:level<definition.costsGold.length?facilityEffectText(building.type,level+1):null,
      capabilities: [...definition.capabilities],
    };
  }

  productionView(account, world) {
    if (!this.getProduction) return null;
    const capacity = this.getProduction(account, world);
    const projects=constructionProjectState(account,world);
    return {capacity,...projects,allocation:projects.activeProjects?capacity/projects.activeProjects:0,
      nextProjectAllocation:capacity/(projects.activeProjects+1)};
  }

  territoryView(account, world, territoryIdValue, includeWonders = true) {
    const territoryId = String(territoryIdValue ?? "");
    const territory = world?.territories?.[territoryId];
    if (!territory) fail("目标地块不存在");
    territory.buildings ??= [];
    const canManage = territory.ownerType === "player" && territory.ownerId === account?.id;
    const slotLimit = canManage ? this.slotLimit(account, territory) : null;
    const occupiedSlots = territory.buildings.length;
    const availableTypes = canManage && !territory.raidSuppression && occupiedSlots < slotLimit
      ? Object.values(BUILDING_DEFINITIONS)
        .filter((definition) => definition.buildable)
        .filter(definition=>!definition.maxPerPlayer||this.countOwnedType(account,world,definition.type)<definition.maxPerPlayer)
        .filter((definition) => definition.type !== BUILDING_TYPES.SCOUT_CENTER || this.countOwnedType(account, world, definition.type) < SCOUTING_RULES.maxCentersPerPlayer)
        .filter((definition) => !territory.buildings.some((building) => building.type === definition.type))
        .filter(definition=>!definition.oilOnly || this.oilDeposit(territoryId))
        .filter((definition) => !definition.coastalOnly || this.isCoastal(territoryId))
        .map((definition) => definition.type)
      : [];
    return {
      territoryId,
      ownerId: territory.ownerId ?? null,
      canManage,
      raidSuppression:territory.raidSuppression??null,
      ...(canManage && this.getProduction ? { production: this.productionView(account, world) } : {}),
      isCapital: Boolean(territory.capitalOf),
      slotLimit,
      occupiedSlots,
      availableSlots: slotLimit === null ? null : Math.max(0, slotLimit - occupiedSlots),
      availableTypes,
      oilDeposit:this.oilDeposit(territoryId),
      ...(canManage&&includeWonders&&this.getDistrictPreview?{buildPreviews:Object.fromEntries(availableTypes.filter(type=>DISTRICT_RULES[type]).map(type=>[type,this.getDistrictPreview(account,world,territoryId,type,1)]))}:{}),
      ...(canManage && includeWonders && this.wonders ? {availableWonders:territory.raidSuppression?[]:this.wonders.available(account,territoryId)} : {}),
      headquartersLevel:canManage?headquartersLevel(account,world):null,
      fans:canManage?Number(account.resources?.fans??0):null,
      scoutCenterCount: canManage ? this.countOwnedType(account, world, BUILDING_TYPES.SCOUT_CENTER) : null,
      scoutCenterLimit: SCOUTING_RULES.maxCentersPerPlayer,
      buildings: territory.buildings.map((building) => {const value=buildingVisibility(this.publicBuilding(building,this.getAccount(territory.ownerId)??(canManage?account:null)),world,account?.id,territory.ownerId);if(value&&building.type==='airport')value.canUseAirport=building.status==='active'&&!building.raidSuppressed&&!territory.raidSuppression&&canUseTerritory(world,account?.id,territoryId);if(value&&canManage&&this.getRuntimeEffect)value.runtimeEffectText=this.getRuntimeEffect(account,territoryId,building);if(value&&canManage&&includeWonders&&this.getDistrictPreview&&DISTRICT_RULES[building.type]){value.siteYield=this.getDistrictPreview(account,world,territoryId,building.type,building.level,building.id);if(building.level<5)value.nextSiteYield=this.getDistrictPreview(account,world,territoryId,building.type,building.level+1,building.id);}return value&&canManage&&building.type==='medical-center'&&this.medical?{...value,medical:this.medical.view(account,territoryId,building.id)}:value;}).filter(Boolean),
    };
  }

  accountView(account, world) {
    const territoryIds = world?.players?.[account.id]?.territoryIds ?? [];
    return {
      rules: { ...BUILDING_RULES },
      catalog: this.catalog(),
      territories: Object.fromEntries(territoryIds.map((territoryId) => [
        territoryId,
        this.territoryView(account, world, territoryId, false),
      ])),
    };
  }

  build(account, world, territoryIdValue, typeValue, buildMethod, onCreated = null) {
    if(String(typeValue).startsWith("wonder:")){if(!this.wonders)fail("奇观尚未开放",503);const result=this.wonders.build(account,String(territoryIdValue),String(typeValue).slice(7),buildMethod);return {...result,territory:this.territoryView(account,world,territoryIdValue)};}
    if (buildMethod !== "gold" && buildMethod !== "production") fail("请选择金币建造或生产力建造");
    this.settleConstructions(world);
    const territoryId = String(territoryIdValue ?? "");
    const territory = this.ownedTerritory(account, world, territoryId);
    if(territory.raidSuppression)fail('地块受豪门压制，恢复后才能建造',409);
    const definition = buildingDefinition(typeValue);
    if (!definition) fail("设施类型不存在");
    if (!definition.buildable) fail("该设施不能手动建造");
    if(definition.oilOnly&&!this.oilDeposit(territoryId))fail("油井只能建造在有石油资源的地块",403);
    if(definition.maxPerPlayer && this.countOwnedType(account,world,definition.type)>=definition.maxPerPlayer)fail(`每名玩家最多建造 ${definition.maxPerPlayer} 座${definition.label}（含施工中）`,409);
    if (definition.capitalOnly && territory.capitalOf !== account.id) fail("该设施只能建立在首都地块");
    if (definition.coastalOnly && !this.isCoastal(territoryId)) fail("港口只能建立在拥有海岸线的地块");
    if (territory.buildings.some((building) => building.type === definition.type)) fail("该地块已经拥有同类设施", 409);
    if (territory.buildings.length >= this.slotLimit(account, territory)) fail("该地块没有可用建筑槽位", 409);
    if (definition.type === BUILDING_TYPES.SCOUT_CENTER && this.countOwnedType(account, world, definition.type) >= SCOUTING_RULES.maxCentersPerPlayer) fail("每位玩家最多修建 1 座球探中心（含施工中）", 409);
    if (buildMethod === "production" && !this.getProduction) fail("生产力建造暂不可用", 503);
    if (buildMethod === "production") assertConstructionSlot(account,world);
    const beforeAccount = structuredClone(account), beforeTerritory = structuredClone(territory), revision = world.revision;
    try {
      if (buildMethod === "gold") this.economy.spend(account, definition.costsGold[0], `building-build:${definition.type}`);
      const constructionStartedAt = this.now();
      const building = this.createRecord(definition.type, {
        status: buildMethod === "gold" ? "active" : "constructing",
        constructionStartedAt,
        completesAt: buildMethod === "gold" ? constructionStartedAt : null,
        builtAt: buildMethod === "gold" ? constructionStartedAt : null,
      });
      building.buildMethod = buildMethod;
      if (buildMethod === "production") {
        building.buildCostProduction = definition.buildCostProduction;
        building.productionWork = {
          required: definition.buildCostProduction * BUILDING_RULES.productionPeriodMs,
          completed: 0, updatedAt: constructionStartedAt, ownerId: account.id,
        };
      }
      territory.buildings.push(building);
      onCreated?.(building);
      territory.version = Number(territory.version ?? 0) + 1;
      world.revision = Number(world.revision ?? 0) + 1;
      this.save();
      return { building: this.publicBuilding(building, account), territory: this.territoryView(account, world, territoryId) };
    } catch (error) {
      for (const key of Object.keys(account)) delete account[key];
      Object.assign(account, beforeAccount);
      for (const key of Object.keys(territory)) delete territory[key];
      Object.assign(territory, beforeTerritory);
      world.revision = revision;
      throw error;
    }
  }

  upgrade(account,world,territoryIdValue,buildingIdValue,{buildMethod,expectedLevel,requestId}={}) {
    if(!['gold','production'].includes(buildMethod))fail("请选择金币升级或生产力升级");
    if(typeof requestId!=='string'||!/^[A-Za-z0-9:_-]{8,128}$/.test(requestId))fail("升级请求编号无效");
    const signature=JSON.stringify([territoryIdValue,buildingIdValue,buildMethod,expectedLevel]);
    const previous=account.facilityUpgradeRequests?.[requestId];
    if(previous){if(previous.signature!==signature)fail("请求编号已用于其他升级",409);return {building:previous.building,territory:this.territoryView(account,world,territoryIdValue)};}
    this.settleConstructions(world);
    const territory=this.ownedTerritory(account,world,territoryIdValue);
    const building=territory.buildings.find(b=>b.id===String(buildingIdValue));
    const definition=buildingDefinition(building?.type);
    if(!building||!definition)fail("设施不存在");
    const level=Number(building.level)||1;
    if(building.status!=='active'||building.upgradeTo)fail("设施尚未建成或正在升级",409);
    if(level>=definition.costsGold.length)fail("该设施已经达到最高等级",409);
    if(expectedLevel!==level)fail("设施等级已变化，请刷新后重试",409);
    if(building.type===BUILDING_TYPES.CLUB_HEADQUARTERS){if(Number(account.resources?.fans??0)<HEADQUARTERS_FANS[level])fail(`升级需要 ${HEADQUARTERS_FANS[level]} 球迷`);}
    else if(headquartersLevel(account,world)<level+1)fail(`请先将俱乐部总部升级至 LV${level+1}`);
    if(buildMethod==='production'&&!this.getProduction)fail("生产力升级暂不可用",503);
    if(buildMethod==='production')assertConstructionSlot(account,world);
    const beforeAccount=structuredClone(account),beforeTerritory=structuredClone(territory),revision=world.revision;
    try{
      if(buildMethod==='gold'){this.economy.spend(account,definition.costsGold[level],`building-upgrade:${building.type}:lv${level+1}`);building.level=level+1;building.upgradeCompletedAt=this.now();}
      else {building.upgradeTo=level+1;building.upgradeStartedAt=this.now();building.completesAt=null;building.productionWork={required:definition.costsProduction[level]*BUILDING_RULES.productionPeriodMs,completed:0,updatedAt:this.now(),ownerId:account.id};}
      building.updatedAt=this.now();territory.version=Number(territory.version??0)+1;world.revision=Number(world.revision??0)+1;
      account.facilityUpgradeRequests??={};account.facilityUpgradeRequests[requestId]={signature,building:this.publicBuilding(building,account)};
      this.save();return {building:this.publicBuilding(building,account),territory:this.territoryView(account,world,territoryIdValue)};
    }catch(error){for(const k of Object.keys(account))delete account[k];Object.assign(account,beforeAccount);for(const k of Object.keys(territory))delete territory[k];Object.assign(territory,beforeTerritory);world.revision=revision;throw error;}
  }

  cancelUpgrade(account,world,territoryId,buildingId){
    const territory=this.ownedTerritory(account,world,territoryId),building=territory.buildings.find(b=>b.id===buildingId);
    if(!building?.upgradeTo)fail("该设施没有进行中的升级",409);
    const before=structuredClone(building),revision=world.revision,version=territory.version;
    try{delete building.upgradeTo;delete building.upgradeStartedAt;delete building.productionWork;building.completesAt=null;building.updatedAt=this.now();territory.version=Number(version??0)+1;world.revision=Number(revision??0)+1;this.save();return {territory:this.territoryView(account,world,territoryId)};}
    catch(error){for(const k of Object.keys(building))delete building[k];Object.assign(building,before);territory.version=version;world.revision=revision;throw error;}
  }

  demolitionPreview(account, world, territoryId, buildingId) {
    const territory = this.ownedTerritory(account, world, territoryId);
    const building = territory.buildings.find(entry => entry.id === buildingId);
    if (!building) fail("设施不存在或已拆除", 404);
    if (!buildingDefinition(building.type)?.buildable) fail(building.type === BUILDING_TYPES.CLUB_HEADQUARTERS ? "俱乐部总部为首都核心设施，不能拆除" : "该设施不支持拆除", 409);
    const training = Object.values(account.training?.tasks ?? {}).some(task =>
      task.buildingId === buildingId && task.completedAt == null && task.cancelledAt == null);
    const treating = Object.values(account.medicalTasks ?? {}).some(task => task.buildingId === buildingId && !task.closedAt);
    const sponsored = building.type === BUILDING_TYPES.MAIN_STADIUM && activeSponsorContracts(account,this.now()).some(c=>c.type==='stadium');
    const blockedReason = training ? "请先完成或取消该中心正在进行的训练" : treating ? "请先完成或取消该中心正在进行的治疗" : sponsored ? "球场冠名合同期间不能拆除主体育场" : null;
    return {
      territoryId, building: this.publicBuilding(building), refundGold: 0, releasedSlots: 1,
      canDemolish: !blockedReason, blockedReason,
      cancelsConstruction: building.status === 'constructing' || Boolean(building.upgradeTo),
      preservesScouts: building.type === BUILDING_TYPES.SCOUT_CENTER,
    };
  }

  demolish(account, world, { territoryId, buildingId, requestId } = {}) {
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9:_-]{8,100}$/.test(requestId)) fail("无效的拆除请求编号");
    const territory = this.ownedTerritory(account, world, territoryId);
    const prior = account.buildingDemolitions?.find(entry => entry.requestId === requestId);
    if (prior) {
      if (prior.territoryId !== territoryId || prior.buildingId !== buildingId) fail("请求编号已用于另一座设施", 409);
      return { demolishedBuildingId: buildingId, territory: this.territoryView(account, world, territoryId) };
    }
    const preview = this.demolitionPreview(account, world, territoryId, buildingId);
    if (!preview.canDemolish) fail(preview.blockedReason, 409);
    this.settleConstructions(world);
    const beforeAccount = structuredClone(account), beforeTerritory = structuredClone(territory), revision = world.revision;
    try {
      territory.buildings = territory.buildings.filter(entry => entry.id !== buildingId);
      // Completed growth is already applied. Dismiss only this facility's result cards.
      for (const task of Object.values(account.training?.tasks ?? {})) {
        if (task.buildingId === buildingId && task.completedAt != null && task.finishedAt == null) task.finishedAt = this.now();
      }
      // Mobile scouts and paid discoveries survive the removal of their recruiting center.
      account.buildingDemolitions = [...(account.buildingDemolitions ?? []), { requestId, territoryId, buildingId, demolishedAt: this.now() }].slice(-20);
      territory.version = Number(territory.version ?? 0) + 1;
      world.revision = Number(world.revision ?? 0) + 1;
      this.save();
      return { demolishedBuildingId: buildingId, territory: this.territoryView(account, world, territoryId) };
    } catch (error) {
      for (const key of Object.keys(account)) delete account[key];
      Object.assign(account, beforeAccount);
      for (const key of Object.keys(territory)) delete territory[key];
      Object.assign(territory, beforeTerritory);
      world.revision = revision;
      throw error;
    }
  }

  rename(account, world, territoryIdValue, buildingIdValue, nameValue) {
    if (activeSponsorContracts(account,this.now()).some(c=>c.type==="stadium")) fail("球场冠名合同期间不能更改主场名称",409);
    const territoryId = String(territoryIdValue ?? "");
    const territory = this.ownedTerritory(account, world, territoryId);
    const building = territory.buildings.find((candidate) => candidate.id === String(buildingIdValue ?? ""));
    if (!building) fail("设施不存在");
    const definition = buildingDefinition(building.type);
    if (!definition?.customName) fail("该设施不支持自定义名称");
    building.name = cleanBuildingName(nameValue);
    building.updatedAt = this.now();
    territory.version = Number(territory.version ?? 0) + 1;
    world.revision = Number(world.revision ?? 0) + 1;
    this.save();
    return { building: this.publicBuilding(building, account), territory: this.territoryView(account, world, territoryId) };
  }
}
