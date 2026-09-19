import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import {researchedEnhancementChance} from '../../shared/config/advanced-research.mjs';
import { refreshTrainingGrowth } from "../../shared/football/training-growth.mjs";
import { activeExpeditionPlayerIds } from './expedition-fitness-service.mjs';
import { repairTacticsLineups } from "../../shared/config/tactics-repair.mjs";
import crypto from "node:crypto";
import { S4_ENHANCEMENT, s4EnhancementAbilityBonus, s4EnhancementChanceForLevels, s4EnhancementProtectionCost, enhancementFamily } from "../../shared/config/enhancement.mjs";
import { YDL_TRAIT_BY_ID } from "../../engine/s4-v2.1/versus/trait-pool.js";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const id = (player) => String(player.id ?? player.playerId);
const level = (player) => Number(player.upgradeLevel ?? 0);
const traitIds = (player) => (player.traits ?? []).map((trait) => typeof trait === "string" ? trait : trait.id).filter(Boolean);
export class EnhancementService {
  constructor({ economy, now = Date.now, random = Math.random, save = () => {} }) { Object.assign(this, { economy, now, random, save }); }
  data(account) { return account.enhancement ?? { requests: {}, offers: {}, history: [] }; }
  transaction(account, action) {
    const before = structuredClone(account);
    try { account.enhancement ??= { requests: {}, offers: {}, history: [] }; const result = action(); this.save(); return structuredClone(result); }
    catch (error) { for (const key of Object.keys(account)) delete account[key]; Object.assign(account, before); throw error; }
  }
  pending(account, cardId) { return Object.values(this.data(account).offers).find((offer) => offer.cardId === cardId && offer.status === "pending"); }
  publicState(account) {
    return { ...S4_ENHANCEMENT, researchLevels:{...account.formationResearch?.topicLevels}, protectionCostMultiplier:this.wonders?.modifiers(account).protectionCostMultiplier??1, history: this.data(account).history.slice(-50).reverse(),
      traitOffers: Object.values(this.data(account).offers).filter((offer) => offer.status === "pending") };
  }
  isStarter(value, playerId) {
    return Boolean(value && typeof value === "object" && Object.entries(value).some(([key, item]) =>
      (["starters", "starterIds"].includes(key) && Array.isArray(item) && item.includes(playerId)) || (typeof item === "object" && this.isStarter(item, playerId))));
  }
  cardLabels(account, player) {
    const squad = account.playerSquads?.assignments?.[id(player)] ?? "garrison";
    return [player.training ? "训练中" : null,
      this.isStarter(account.tactics?.squads?.[squad] ?? account.tactics, id(player)) ? (squad === "expedition" ? "远征首发" : "留守首发") : null].filter(Boolean);
  }
  blocked(account, world, player, material = false) {
    if(raidMatchForAccount(world,account.id))return '豪门远征比赛进行中';
    if(player.coalitionLoan)return "已借调联军，归队后才能强化";
    if(player.medical)return "治疗中的球员不能强化或作为素材";
    if(activeExpeditionPlayerIds(world,account.id).has(id(player)))return "远征比赛进行中，参赛球员暂时不能强化或作为素材";
    if (player.locked || player.state?.locked) return "球员卡已锁定";
    if (!material && this.pending(account, id(player))) return "请先为主卡绑定强化特性";
    return null;
  }
  removeMaterialFromTactics(account, material) {
    account.tactics = repairTacticsLineups(account.tactics, account.draft.roster, account.playerSquads, { previousRoster:[...account.draft.roster, material] });
  }
  details(account, world) {
    return { ...this.publicState(account), cards: (account.draft?.roster ?? []).map((player) => ({ ...createPlayerCardViewModel(player),
      mainBlocked: this.blocked(account, world, player), materialBlocked: this.blocked(account, world, player, true),
      trainingBonuses: player.trainingBonuses ?? {}, labels: this.cardLabels(account, player), squad: account.playerSquads?.assignments?.[id(player)] ?? "garrison" })) };
  }
  request(account, options, kind, action) {
    if (!account.setupComplete || !account.draft) fail("请先完成初始建队");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(String(options.requestId ?? ""))) fail("强化请求标识无效");
    const signature = JSON.stringify([kind, options.mainCardId, options.materialCardId, options.useProtection === true, options.playerId, options.mainLevel, options.materialLevel, options.quantity]);
    const prior = this.data(account).requests[options.requestId];
    if (prior) { if (prior.signature !== signature) fail("强化请求标识与原请求不一致", 409); return structuredClone(prior.result); }
    return this.transaction(account, () => {
      const result = action();
      account.enhancement.requests[options.requestId] = { signature, result: structuredClone(result) };
      return result;
    });
  }
  applyLevel(player, nextLevel) {
    refreshTrainingGrowth(player);
    const oldBonus = s4EnhancementAbilityBonus(level(player));
    const bases = (values) => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key,
      Number(value) >= 99 && Number.isFinite(player.referenceAttributes?.[key])
        ? Number(player.referenceAttributes[key]) : Number(value) - oldBonus - Number(player.trainingBonuses?.[key] ?? 0)]));
    player.enhancementBaseAttributes ??= bases(player.attributes);
    player.enhancementBaseEffectiveAttributes ??= bases(player.effectiveAttributes ?? player.attributes);
    const bonus = s4EnhancementAbilityBonus(nextLevel);
    const enhance = (base) => Object.fromEntries(Object.entries(base).map(([key, value]) => [key, Math.max(1, Math.min(99, value + Number(player.trainingBonuses?.[key] ?? 0) + bonus))]));
    player.baseOverall ??= Number(player.overall) - oldBonus;
    player.overall = player.baseOverall + bonus; player.effectiveOverall = player.overall;
    player.attributes = enhance(player.enhancementBaseAttributes); player.effectiveAttributes = enhance(player.enhancementBaseEffectiveAttributes);
    player.upgradeLevel = nextLevel; player.upgradeBonus = bonus;
    // Preserve existing IDs referenced by tactics; mark the upgraded record as an independent saved card.
    player.cardDefinitionId ??= id(player); player.cardInstanceId ??= id(player); delete player.card;
  }
  offer(account, player, result) {
    const chosen = player.enhancementTraitIds ?? [];
    const unlockLevel = S4_ENHANCEMENT.traitUnlockLevels[chosen.length];
    if (unlockLevel == null || level(player) < unlockLevel) return null;
    const available = Object.values(YDL_TRAIT_BY_ID).filter((trait) => !traitIds(player).includes(trait.id) && (trait.eligibleRoleGroups.includes("ANY") || trait.eligibleRoleGroups.includes(player.pool)));
    const traits = [];
    while (available.length && traits.length < 3) {
      const trait = available.splice(Math.min(available.length - 1, Math.floor(Math.max(0, this.random()) * available.length)), 1)[0];
      traits.push({ id: trait.id, name: trait.name, summary: trait.summary, eligibleRoleGroups: trait.eligibleRoleGroups });
    }
    if (!traits.length) return null;
    const offer = { id: `enhancement-trait:${crypto.randomUUID()}`, cardId: id(player), status: "pending", unlockLevel, upgradeLevel: level(player), traits, createdAt: this.now() };
    account.enhancement.offers[offer.id] = offer; return structuredClone(offer);
  }
  perform(account, world, { mainCardId, materialCardId, useProtection = false }) {
    const roster = account.draft.roster, main = roster.find((p) => id(p) === mainCardId), material = roster.find((p) => id(p) === materialCardId);
    if (!main || !material) fail("请选择本队有效的主卡和副卡");
    if (main === material) fail("主卡和副卡不能是同一张卡");
    if (enhancementFamily(main) !== enhancementFamily(material)) fail("强化只允许使用同名球员卡");
    for (const [player, isMaterial] of [[main, false], [material, true]]) { const reason = this.blocked(account, world, player, isMaterial); if (reason) fail(reason, 409); }
    const beforeLevel = level(main), materialLevel = level(material);
    if (!Number.isInteger(beforeLevel) || beforeLevel < 0 || beforeLevel >= 8) fail("主卡已经达到最高强化等级");
    if (!Number.isInteger(materialLevel) || materialLevel < 0 || materialLevel > beforeLevel) fail("主卡等级不能低于副卡等级，请交换主副卡");
    const chance = researchedEnhancementChance(account,beforeLevel, materialLevel), protectionUsed = useProtection === true && chance < 100;
    const protectionCost = protectionUsed ? Math.ceil(s4EnhancementProtectionCost(chance)*(this.wonders?.modifiers(account).protectionCostMultiplier??1)) : 0;
    if (protectionCost) this.economy.spend(account, protectionCost, "player-enhancement-protection");
    const success = this.random() * 100 < chance, afterLevel = success ? beforeLevel + 1 : protectionUsed || beforeLevel < 3 ? beforeLevel : beforeLevel - 1;
    const mainCard = createPlayerCardViewModel(main), materialCard = createPlayerCardViewModel(material);
    this.applyLevel(main, afterLevel);
    account.draft.roster = roster.filter((p) => p !== material);
    this.removeMaterialFromTactics(account, material);
    if (account.playerSquads?.assignments) delete account.playerSquads.assignments[id(material)];
    for (const offer of Object.values(account.enhancement.offers)) if (offer.cardId === id(material) && offer.status === "pending") offer.status = "cancelled";
    for (const task of Object.values(account.training?.tasks ?? {})) if (task.playerId === id(material)) {
      if (task.completedAt != null) task.finishedAt ??= this.now();
      else if (task.cancelledAt == null) {
        task.cancelledAt = this.now();
        if ((task.costGold ?? 0) > 0 && (task.completesAt == null || this.now() < task.completesAt)) {
          this.economy.adjust(account, task.costGold, "training-cancel-refund");
          task.refundedGold = task.costGold;
        }
      }
    }
    const result = { id: `enhancement:${crypto.randomUUID()}`, success, chance, beforeLevel, materialLevel, afterLevel, protectionUsed, protectionCost, mainCard, materialCard, card: createPlayerCardViewModel(main), createdAt: this.now() };
    result.traitOffer = success ? this.offer(account, main, result) : null;
    account.enhancement.history.push(structuredClone(result)); account.enhancement.history = account.enhancement.history.slice(-50);
    return result;
  }
  enhance(account, world, options) { return this.request(account, options, "single", () => this.perform(account, world, options)); }
  batch(account, world, options) {
    return this.request(account, options, "batch", () => {
      const { playerId, mainLevel, materialLevel, quantity } = options;
      if (!Number.isInteger(mainLevel) || mainLevel < 0 || mainLevel > 2) fail("批量合卡仅支持主卡 +0～+2，+4 及以上请逐张合成并绑定特性");
      if (!Number.isInteger(materialLevel) || materialLevel < 0 || materialLevel > mainLevel) fail("副卡等级不能高于主卡");
      if (!Number.isSafeInteger(quantity) || quantity < 1) fail("请选择有效的合成数量");
      const cards = () => account.draft.roster.filter((p) => enhancementFamily(p) === playerId);
      const starting = cards();
      const mainCount = starting.filter((p) => level(p) === mainLevel && !this.blocked(account, world, p)).length;
      const materialCount = starting.filter((p) => level(p) === materialLevel && !this.blocked(account, world, p, true)).length;
      const maximum = mainLevel === materialLevel ? Math.min(Math.floor(mainCount / 2), materialCount) : Math.min(mainCount, materialCount);
      const outcomes = [];
      for (let i = 0; i < Math.min(quantity, maximum); i++) {
        const available = cards();
        const material = available.find((p) => level(p) === materialLevel && !this.blocked(account, world, p, true));
        const main = available.find((p) => p !== material && level(p) === mainLevel && !this.blocked(account, world, p));
        if (!main || !material) break;
        outcomes.push(this.perform(account, world, { mainCardId: id(main), materialCardId: id(material) }));
      }
      if (!outcomes.length) fail("没有足够的可用同名卡，请检查等级、训练及首发状态");
      return { quantity: outcomes.length, successCount: outcomes.filter((r) => r.success).length, failureCount: outcomes.filter((r) => !r.success).length,
        chance: researchedEnhancementChance(account,mainLevel, materialLevel), outcomes, finalLevelCounts: cards().reduce((counts, p) => ({ ...counts, [level(p)]: (counts[level(p)] ?? 0) + 1 }), {}) };
    });
  }
  chooseTrait(account, { offerId, traitId }) {
    const offer = this.data(account).offers[offerId], player = account.draft?.roster?.find((p) => id(p) === offer?.cardId);
    if (!offer || !player || offer.status === "cancelled") fail("强化特性候选不存在", 404);
    if (offer.status === "chosen") { if (offer.chosenTraitId !== traitId) fail("该特性已经选择", 409); return createPlayerCardViewModel(player); }
    if(activeExpeditionPlayerIds(this.world,account.id).has(id(player)))fail("远征比赛进行中，结束后才能绑定强化特性",409);
    if (!offer.traits.some((trait) => trait.id === traitId) || !YDL_TRAIT_BY_ID[traitId]) fail("请选择候选中的强化特性");
    return this.transaction(account, () => {
      const trait = YDL_TRAIT_BY_ID[traitId];
      if (!traitIds(player).includes(traitId)) player.traits = [...(player.traits ?? []), { id: trait.id, name: trait.name, summary: trait.summary }];
      player.enhancementTraitIds = [...new Set([...(player.enhancementTraitIds ?? []), traitId])];
      player.cardInstanceId ??= id(player); delete player.card;
      offer.status = "chosen"; offer.chosenTraitId = traitId; offer.chosenAt = this.now();
      this.offer(account, player);
      return createPlayerCardViewModel(player);
    });
  }
}
