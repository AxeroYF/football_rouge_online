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

function safeSlotBonus(value) {
  const bonus = Number(value ?? 0);
  return Number.isSafeInteger(bonus) && bonus > 0 ? Math.min(20, bonus) : 0;
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
    slotBonusResolver = () => 0,
    save = () => {},
  } = {}) {
    if (!economy) throw new Error("BuildingService requires an economy service");
    this.economy = economy;
    this.now = now;
    this.createBuildingId = createBuildingId;
    this.isCoastal = isCoastal;
    this.slotBonusResolver = slotBonusResolver;
    this.save = save;
  }

  catalog() {
    return publicBuildingCatalog();
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
      const territory = territoryId ? world.territories?.[territoryId] : null;
      if (!territory || territory.ownerId !== account.id || territory.capitalOf !== account.id) continue;
      if (territory.buildings.some((building) => building.type === BUILDING_TYPES.MAIN_STADIUM)) continue;
      territory.buildings.push(this.createRecord(BUILDING_TYPES.MAIN_STADIUM, {
        name: defaultStadiumName(account),
        builtAt: account.createdAt,
      }));
      territory.version = Number(territory.version ?? 0) + 1;
      changed = true;
    }
    if (changed) world.revision = Number(world.revision ?? 0) + 1;
    return changed;
  }

  ensureCapitalStadium(account, world, territoryId) {
    const territory = this.ownedTerritory(account, world, territoryId);
    if (territory.capitalOf !== account.id) fail("主体育场只能建立在首都地块");
    let stadium = territory.buildings.find((building) => building.type === BUILDING_TYPES.MAIN_STADIUM);
    if (!stadium) {
      stadium = this.createRecord(BUILDING_TYPES.MAIN_STADIUM, { name: defaultStadiumName(account) });
      territory.buildings.push(stadium);
      territory.version = Number(territory.version ?? 0) + 1;
      world.revision = Number(world.revision ?? 0) + 1;
    }
    return stadium;
  }

  ownedTerritory(account, world, territoryIdValue) {
    if (!world || !account?.setupComplete) fail("请先完成初始建队");
    const territoryId = String(territoryIdValue ?? "");
    const territory = world.territories?.[territoryId];
    if (!territory) fail("目标地块不存在");
    if (territory.ownerType !== "player" || territory.ownerId !== account.id) fail("只能管理自己的领地设施", 403);
    territory.buildings ??= [];
    return territory;
  }

  slotLimit(account, territory) {
    const base = territory.capitalOf === account.id
      ? BUILDING_RULES.capitalSlotLimit
      : BUILDING_RULES.standardTerritorySlotLimit;
    return base + safeSlotBonus(this.slotBonusResolver(account, territory));
  }

  publicBuilding(building) {
    const definition = buildingDefinition(building.type);
    if (!definition) return null;
    const level = Math.max(1, Math.min(definition.costsGold.length, Number(building.level) || 1));
    const completesAt = Number(building.completesAt ?? 0) || null;
    const constructing = building.status === "constructing" && Boolean(completesAt) && completesAt > this.now();
    return {
      id: building.id,
      type: definition.type,
      label: definition.label,
      iconPath: definition.iconPath,
      level,
      maxLevel: definition.costsGold.length,
      status: constructing ? "constructing" : building.status === "inactive" ? "inactive" : "active",
      name: definition.customName ? String(building.name ?? definition.label) : null,
      builtAt: Number(building.builtAt ?? 0) || null,
      updatedAt: Number(building.updatedAt ?? 0) || null,
      constructionStartedAt: Number(building.constructionStartedAt ?? 0) || null,
      completesAt,
      remainingConstructionMs: constructing ? Math.max(0, completesAt - this.now()) : 0,
      upgradeEnabled: BUILDING_RULES.upgradesEnabled,
      nextUpgradeCostGold: BUILDING_RULES.upgradesEnabled && level < definition.costsGold.length ? definition.costsGold[level] : null,
      capabilities: [...definition.capabilities],
    };
  }

  territoryView(account, world, territoryIdValue) {
    const territoryId = String(territoryIdValue ?? "");
    const territory = world?.territories?.[territoryId];
    if (!territory) fail("目标地块不存在");
    territory.buildings ??= [];
    const canManage = territory.ownerType === "player" && territory.ownerId === account?.id;
    const slotLimit = canManage ? this.slotLimit(account, territory) : null;
    const occupiedSlots = territory.buildings.length;
    const availableTypes = canManage && occupiedSlots < slotLimit
      ? Object.values(BUILDING_DEFINITIONS)
        .filter((definition) => definition.buildable)
        .filter((definition) => !territory.buildings.some((building) => building.type === definition.type))
        .filter((definition) => !definition.coastalOnly || this.isCoastal(territoryId))
        .map((definition) => definition.type)
      : [];
    return {
      territoryId,
      ownerId: territory.ownerId ?? null,
      canManage,
      isCapital: Boolean(territory.capitalOf),
      slotLimit,
      occupiedSlots,
      availableSlots: slotLimit === null ? null : Math.max(0, slotLimit - occupiedSlots),
      availableTypes,
      buildings: territory.buildings.map((building) => this.publicBuilding(building)).filter(Boolean),
    };
  }

  accountView(account, world) {
    const territoryIds = world?.players?.[account.id]?.territoryIds ?? [];
    return {
      rules: { ...BUILDING_RULES },
      catalog: this.catalog(),
      territories: Object.fromEntries(territoryIds.map((territoryId) => [
        territoryId,
        this.territoryView(account, world, territoryId),
      ])),
    };
  }

  build(account, world, territoryIdValue, typeValue) {
    this.settleConstructions(world);
    const territoryId = String(territoryIdValue ?? "");
    const territory = this.ownedTerritory(account, world, territoryId);
    const definition = buildingDefinition(typeValue);
    if (!definition) fail("设施类型不存在");
    if (!definition.buildable) fail("该设施不能手动建造");
    if (definition.capitalOnly && territory.capitalOf !== account.id) fail("该设施只能建立在首都地块");
    if (definition.coastalOnly && !this.isCoastal(territoryId)) fail("港口只能建立在拥有海岸线的地块");
    if (territory.buildings.some((building) => building.type === definition.type)) fail("该地块已经拥有同类设施", 409);
    if (territory.buildings.length >= this.slotLimit(account, territory)) fail("该地块没有可用建筑槽位", 409);
    this.economy.spend(account, definition.costsGold[0], `building-build:${definition.type}`);
    const constructionStartedAt = this.now();
    const building = this.createRecord(definition.type, {
      status: "constructing",
      constructionStartedAt,
      completesAt: constructionStartedAt + BUILDING_RULES.constructionDurationMs,
      builtAt: null,
    });
    territory.buildings.push(building);
    territory.version = Number(territory.version ?? 0) + 1;
    world.revision = Number(world.revision ?? 0) + 1;
    this.save();
    return { building: this.publicBuilding(building), territory: this.territoryView(account, world, territoryId) };
  }

  upgrade(account, world, territoryIdValue, buildingIdValue) {
    if (!BUILDING_RULES.upgradesEnabled) fail("设施升级暂未开放", 409);
    const territoryId = String(territoryIdValue ?? "");
    const territory = this.ownedTerritory(account, world, territoryId);
    const building = territory.buildings.find((candidate) => candidate.id === String(buildingIdValue ?? ""));
    if (!building) fail("设施不存在");
    const definition = buildingDefinition(building.type);
    const level = Math.max(1, Number(building.level) || 1);
    if (level >= definition.costsGold.length) fail("该设施已经达到最高等级", 409);
    this.economy.spend(account, definition.costsGold[level], `building-upgrade:${definition.type}:lv${level + 1}`);
    building.level = level + 1;
    building.updatedAt = this.now();
    territory.version = Number(territory.version ?? 0) + 1;
    world.revision = Number(world.revision ?? 0) + 1;
    this.save();
    return { building: this.publicBuilding(building), territory: this.territoryView(account, world, territoryId) };
  }

  rename(account, world, territoryIdValue, buildingIdValue, nameValue) {
    const territoryId = String(territoryIdValue ?? "");
    const territory = this.ownedTerritory(account, world, territoryId);
    const building = territory.buildings.find((candidate) => candidate.id === String(buildingIdValue ?? ""));
    if (!building) fail("设施不存在");
    const definition = buildingDefinition(building.type);
    if (!definition.customName) fail("该设施不支持自定义名称");
    building.name = cleanBuildingName(nameValue);
    building.updatedAt = this.now();
    territory.version = Number(territory.version ?? 0) + 1;
    world.revision = Number(world.revision ?? 0) + 1;
    this.save();
    return { building: this.publicBuilding(building), territory: this.territoryView(account, world, territoryId) };
  }
}
