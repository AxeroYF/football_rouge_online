import crypto from "node:crypto";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";
import {
  LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE,
  PLAYER_PACK_DEFINITIONS,
  PLAYER_PACK_GRADE_WEIGHTS,
  PLAYER_PACK_TYPES,
} from "../../shared/config/player-packs.mjs";

export const PLAYER_INVENTORY_SCHEMA_VERSION = 2;

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function weightedGrade(weights, random) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const target = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
  let cursor = 0;
  for (const [grade, weight] of entries) {
    cursor += weight;
    if (target < cursor) return grade;
  }
  return entries.at(-1)[0];
}

function publicOpening(opening, playersById) {
  if (!opening) return null;
  return {
    id: opening.id,
    packType: opening.packType,
    packName: PLAYER_PACK_DEFINITIONS[opening.packType]?.name ?? opening.packType,
    openedAt: opening.openedAt,
    cards: opening.candidateIds
      .map((playerId) => playersById.get(playerId))
      .filter(Boolean)
      .map(createPlayerCardViewModel),
  };
}

export class PlayerPackService {
  constructor({
    playerDatabase = [],
    random = Math.random,
    now = Date.now,
    createOpeningId = () => `pack-opening:${crypto.randomBytes(8).toString("hex")}`,
  } = {}) {
    this.playerDatabase = playerDatabase.filter((player) => player?.id && player.isX !== true);
    this.playersById = new Map(this.playerDatabase.map((player) => [String(player.id), player]));
    this.random = random;
    this.now = now;
    this.createOpeningId = createOpeningId;
  }

  migrateAccount(account) {
    const previous = account.inventory && typeof account.inventory === "object" ? account.inventory : {};
    const previousPacks = previous.packs && typeof previous.packs === "object" ? previous.packs : {};
    const legacyCount = nonNegativeInteger(previousPacks[LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE]);
    const packs = {};
    let changed = previous.schemaVersion !== PLAYER_INVENTORY_SCHEMA_VERSION
      || !previous.packs
      || previous.pendingOpening === undefined
      || Object.keys(previousPacks).some((type) => !PLAYER_PACK_DEFINITIONS[type]);
    for (const type of Object.keys(PLAYER_PACK_DEFINITIONS)) {
      const count = nonNegativeInteger(previousPacks[type])
        + (type === PLAYER_PACK_TYPES.EXOTIC ? legacyCount : 0);
      if (previousPacks[type] !== count) changed = true;
      packs[type] = count;
    }
    let pendingOpening = previous.pendingOpening ?? null;
    if (pendingOpening?.packType === LEGACY_NEW_TERRITORY_CONQUEST_PACK_TYPE) {
      pendingOpening = { ...pendingOpening, packType:PLAYER_PACK_TYPES.EXOTIC };
      changed = true;
    }
    const pendingDefinition = PLAYER_PACK_DEFINITIONS[pendingOpening?.packType];
    const validPending = pendingOpening
      && pendingDefinition
      && typeof pendingOpening.id === "string"
      && Array.isArray(pendingOpening.candidateIds)
      && pendingOpening.candidateIds.length === pendingDefinition.choiceCount
      && pendingOpening.candidateIds.every((playerId) => this.playersById.has(String(playerId)));
    if (pendingOpening && !validPending) {
      const type = pendingOpening.packType;
      if (PLAYER_PACK_DEFINITIONS[type]) packs[type] = nonNegativeInteger(packs[type]) + 1;
      pendingOpening = null;
      changed = true;
    }
    account.inventory = {
      schemaVersion: PLAYER_INVENTORY_SCHEMA_VERSION,
      packs,
      pendingOpening,
    };
    return changed;
  }

  publicInventory(account) {
    this.migrateAccount(account);
    const packs = Object.values(PLAYER_PACK_DEFINITIONS).map((definition) => ({
      ...definition,
      count: nonNegativeInteger(account.inventory.packs[definition.type]),
    }));
    return {
      schemaVersion: PLAYER_INVENTORY_SCHEMA_VERSION,
      totalPacks: packs.reduce((sum, pack) => sum + pack.count, 0),
      packs,
      pendingOpening: publicOpening(account.inventory.pendingOpening, this.playersById),
    };
  }

  addPacks(account, packType, countValue) {
    const definition = PLAYER_PACK_DEFINITIONS[packType];
    if (!definition) throw new Error("未知球员卡包");
    const count = Number(countValue);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error("卡包数量必须是正整数");
    this.migrateAccount(account);
    account.inventory.packs[packType] = nonNegativeInteger(account.inventory.packs[packType]) + count;
    return { type:packType, name:definition.name, count };
  }

  drawCandidates(account, packType) {
    const weights = PLAYER_PACK_GRADE_WEIGHTS[packType];
    if (!weights) throw new Error("该卡包暂不支持开启");
    const ownedIds = new Set((account.draft?.roster ?? []).map((player) => String(player.id)));
    const available = this.playerDatabase.filter((player) => !ownedIds.has(String(player.id)));
    if (available.length < 3) throw new Error("可获取的未拥有球员不足三名");
    const selected = [];
    while (selected.length < 3) {
      const grade = weightedGrade(weights,this.random);
      const blocked = new Set(selected.map((player) => String(player.id)));
      const exact = available.filter((player) => player.grade === grade && !blocked.has(String(player.id)));
      const fallback = available.filter((player) => !blocked.has(String(player.id)));
      const candidates = exact.length ? exact : fallback;
      const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, Number(this.random()) || 0) * candidates.length));
      selected.push(candidates[index]);
    }
    return selected;
  }

  open(account, packTypeValue) {
    if (!account.setupComplete || !account.draft) throw new Error("请先完成初始建队");
    const packType = String(packTypeValue ?? "");
    const definition = PLAYER_PACK_DEFINITIONS[packType];
    if (!definition) throw new Error("未知球员卡包");
    this.migrateAccount(account);
    if (account.inventory.pendingOpening) {
      if (account.inventory.pendingOpening.packType !== packType) throw new Error("请先完成当前卡包的球员选择");
      return publicOpening(account.inventory.pendingOpening, this.playersById);
    }
    if (nonNegativeInteger(account.inventory.packs[packType]) < 1) throw new Error("该卡包数量不足");
    const candidates = this.drawCandidates(account, packType);
    account.inventory.packs[packType] -= 1;
    account.inventory.pendingOpening = {
      id: this.createOpeningId(),
      packType,
      candidateIds: candidates.map((player) => String(player.id)),
      openedAt: this.now(),
    };
    return publicOpening(account.inventory.pendingOpening, this.playersById);
  }

  choose(account, openingIdValue, playerIdValue) {
    this.migrateAccount(account);
    const opening = account.inventory.pendingOpening;
    if (!opening || opening.id !== String(openingIdValue ?? "")) throw new Error("待选择的卡包不存在");
    const playerId = String(playerIdValue ?? "");
    if (!opening.candidateIds.includes(playerId)) throw new Error("该球员不在本次卡包候选中");
    if ((account.draft?.roster ?? []).some((player) => String(player.id) === playerId)) throw new Error("该球员已经属于你的球队");
    const source = this.playersById.get(playerId);
    if (!source) throw new Error("候选球员已经失效");
    account.draft.roster.push(structuredClone(source));
    account.inventory.pendingOpening = null;
    return createPlayerCardViewModel(source);
  }
}
