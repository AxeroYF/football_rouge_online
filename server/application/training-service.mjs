import {raidMatchForAccount} from '../../shared/config/elite-raids.mjs';
import { ensureTrainingBases, refreshTrainingGrowth } from "../../shared/football/training-growth.mjs";
import { facilityEffects } from '../../shared/config/facility-levels.mjs';
import crypto from "node:crypto";
import { TRAINING_RULES, TRAINING_POOLS, trainingCapacity, trainingCostGold } from "../../shared/config/training.mjs";
import { PLAYER_ATTRIBUTE_LABELS } from "../../shared/config/player-attributes.mjs";
import { createPlayerCardViewModel } from "../../shared/player-card/player-card-contract.js";

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
const playerId = (player) => String(player.id ?? player.playerId);
export class TrainingService {
  constructor({ buildings, economy = buildings?.economy, territoryIndex, now = Date.now, random = Math.random, save = () => {} }) {
    Object.assign(this, { buildings, economy, territoryIndex, now, random, save });
  }
  tasks(account) { return Object.values(account.training?.tasks ?? {}); }
  transaction(account, action) {
    const before = structuredClone(account);
    try { const value = action(); this.save(); return value; }
    catch (error) { for (const key of Object.keys(account)) delete account[key]; Object.assign(account, before); throw error; }
  }
  publicTask(task) {
    const { id, requestId, buildingId, territoryId, pool, slot, playerId, playerName, startedAt, completesAt, completedAt } = task;
    return { id, requestId, buildingId, territoryId, pool, slot, playerId, playerName, startedAt, completesAt,
      raidPause: task.raidPause ? {...task.raidPause} : null, costGold: task.costGold ?? 0, refundedGold: task.refundedGold ?? 0, overallBefore: task.overallBefore ?? null, overallAfter: task.overallAfter ?? null,
      status: task.finishedAt != null ? "finished" : task.cancelledAt != null ? "cancelled" : completedAt == null ? "working" : "completed", gains: completedAt == null ? null : task.gains };
  }
  settle(account) {
    const due = this.tasks(account).filter((task) => task.completedAt == null && task.cancelledAt == null && task.completesAt <= this.now());
    if (!due.length) return false;
    this.transaction(account, () => {
      for (const task of due) {
        const player = account.draft?.roster?.find((entry) => playerId(entry) === task.playerId);
        if (!player) fail("训练球员数据不存在", 409);
        refreshTrainingGrowth(player);
        ensureTrainingBases(player);
        task.overallBefore = Number(player.effectiveOverall ?? player.overall);
        player.effectiveAttributes = { ...player.attributes, ...player.effectiveAttributes };
        player.trainingBonuses = { ...player.trainingBonuses };
        task.plannedGains ??= { ...task.gains };
        task.gains = {};
        for (const [key, gain] of Object.entries(task.plannedGains)) {
          const current = Math.max(Number(player.attributes[key]), Number(player.effectiveAttributes[key]));
          const applied = Number.isFinite(current) ? Math.max(0, Math.min(gain, Math.floor(TRAINING_RULES.attributeMaximum - current))) : 0;
          if (applied > 0) {
            task.gains[key] = applied;
            player.trainingBonuses[key] = Number(player.trainingBonuses[key] ?? 0) + applied;
          }
        }
        refreshTrainingGrowth(player);
        task.overallAfter = Number(player.effectiveOverall ?? player.overall);
        // A pending main card may be enhanced. Do not charge for points that
        // can no longer fit under the attribute cap when the session completes.
        const planned = Object.values(task.plannedGains).reduce((sum, n) => sum + n, 0);
        const applied = Object.values(task.gains).reduce((sum, n) => sum + n, 0);
        const refund = planned > applied ? Math.floor((task.costGold ?? 0) * (planned - applied) / planned) : 0;
        if (refund > 0) { this.economy.adjust(account, refund, "training-cap-refund"); task.refundedGold = refund; }
        delete player.card;
        if (player.training?.taskId === task.id) delete player.training;
        task.completedAt = this.now();
      }
    });
    return true;
  }
  publicState(account) {
    // Select latest first so dismissed results never reveal an older session.
    const latest = new Map();
    for (const task of this.tasks(account)) latest.set(`${task.buildingId}:${task.pool}:${task.slot}`, task);
    return { rules: {...TRAINING_RULES,attributePoints:this.wonders?.modifiers(account).trainingPoints??TRAINING_RULES.attributePoints,canSelectAttribute:this.wonders?.modifiers(account).trainingSelection??false}, tasks: [...latest.values()].filter((task) => task.cancelledAt == null && task.finishedAt == null).map((task) => this.publicTask(task)), serverNow: this.now() };
  }
  details(account, world, territoryId, buildingId) {
    this.settle(account);
    this.buildings.settleConstructions(world);
    const territory = this.buildings.ownedTerritory(account, world, territoryId);
    const building = territory.buildings.find((entry) => entry.id === buildingId && entry.type === "training-center");
    if (!building) fail("训练中心不存在", 404);
    const metadata = this.territoryIndex?.territories.find((entry) => entry.territoryId === territoryId);
    return { building: this.buildings.publicBuilding(building), territoryId, gold: account.gold ?? 0,
      territoryLabel: metadata ? `${metadata.country} · ${metadata.name}` : territoryId,
      capacity: trainingCapacity(building.level), ...this.publicState(account),
      players: (account.draft?.roster ?? []).map((player) => ({ ...createPlayerCardViewModel(player),
        training: player.training ?? null,
        costGold: trainingCostGold(player), canAfford: (account.gold ?? 0) >= trainingCostGold(player),
        expedition: account.playerSquads?.assignments?.[playerId(player)] === "expedition",
        canTrain: !player.medical && this.headroom(player) >= (this.wonders?.modifiers(account).trainingPoints??TRAINING_RULES.attributePoints),
      })),
    };
  }
  headroom(player) {
    return Object.keys(PLAYER_ATTRIBUTE_LABELS).reduce((sum, key) => {
      const value = Math.max(Number(player.attributes?.[key]), Number(player.effectiveAttributes?.[key] ?? player.attributes?.[key]));
      return sum + (Number.isFinite(value) ? Math.max(0, Math.floor(TRAINING_RULES.attributeMaximum - value)) : 0);
    }, 0);
  }
  gains(player, points = TRAINING_RULES.attributePoints, attribute = null, coreBias = 0) {
    const gains = {};
    if(attribute){
      if(!Object.hasOwn(PLAYER_ATTRIBUTE_LABELS,attribute))fail("请选择有效训练属性");
      const value=Math.max(Number(player.attributes?.[attribute]),Number(player.effectiveAttributes?.[attribute]??player.attributes?.[attribute]));
      if(!Number.isFinite(value)||value>=TRAINING_RULES.attributeMaximum)fail("指定属性已达到上限");
      gains[attribute]=1;
    }
    for (let i = attribute?1:0; i < points; i += 1) {
      const keys = Object.keys(PLAYER_ATTRIBUTE_LABELS).filter((key) => {
        const value = Math.max(Number(player.attributes?.[key]), Number(player.effectiveAttributes?.[key] ?? player.attributes?.[key]));
        return Number.isFinite(value) && value + (gains[key] ?? 0) + 1 <= TRAINING_RULES.attributeMaximum;
      });
      if (!keys.length) fail(`该球员可提升的能力不足 ${points} 点`);
      const roll = Math.max(0, Math.min(.999999999, Number(this.random()) || 0));
      const corePools={ATT:['finishing','offBall','dribbling','pace','heading','composure'],MID:['passing','vision','firstTouch','decisions','dribbling','stamina'],DEF:['tackling','marking','positioning','strength','heading','pace'],GK:['goalkeeping','reflexes','positioning','composure','agility','jumping']};
      const core=keys.filter(key=>(corePools[player.pool]??[]).includes(key));
      const targeted=coreBias>0 && core.length && roll<coreBias;
      const pool=targeted?core:keys;
      const sample=coreBias>0?Math.max(0,Math.min(.999999999,Number(this.random())||0)):roll;
      const key = pool[Math.floor(sample * pool.length)];
      gains[key] = (gains[key] ?? 0) + 1;
    }
    return gains;
  }
  finish(account, taskId) {
    const task = this.tasks(account).find((entry) => entry.id === taskId);
    if (!task) fail("训练任务不存在", 404);
    if (task.finishedAt != null) return this.publicTask(task);
    if (task.cancelledAt != null) fail("该训练已取消", 409);
    if (task.completedAt == null) {
      if (this.now() < task.completesAt) fail("训练尚未完成", 409);
      this.settle(account);
    }
    // Growth has already been applied by settle; only dismiss this result.
    return this.transaction(account, () => {
      task.finishedAt = this.now();
      return this.publicTask(task);
    });
  }
  cancel(account, taskId) {
    const task = this.tasks(account).find((entry) => entry.id === taskId);
    if (!task) fail("训练任务不存在", 404);
    if (task.cancelledAt != null || task.completedAt != null) return this.publicTask(task);
    // At the deadline completion wins; a late cancel must not discard earned growth.
    if (this.now() >= task.completesAt) {
      this.settle(account);
      return this.publicTask(task);
    }
    return this.transaction(account, () => {
      task.cancelledAt = this.now();
      const refund = task.costGold ?? 0;
      if (refund > 0) { this.economy.adjust(account, refund, "training-cancel-refund"); task.refundedGold = refund; }
      const player = account.draft?.roster?.find((entry) => playerId(entry) === task.playerId);
      if (player?.training?.taskId === task.id) delete player.training;
      return this.publicTask(task);
    });
  }
  start(account, world, { territoryId, buildingId, pool, slot, playerId: id, requestId, attribute = null } = {}) {
    if (!account.setupComplete || !account.draft?.roster) fail("请先完成初始建队");
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9:_-]{8,100}$/.test(requestId)) fail("无效的训练请求编号");
    this.settle(account);
    const existing = this.tasks(account).find((task) => task.requestId === requestId);
    if (existing) {
      if (existing.buildingId !== buildingId || existing.territoryId !== territoryId || existing.pool !== pool || existing.slot !== slot || existing.playerId !== id || (existing.attribute??null)!==attribute) fail("请求编号已用于另一项训练", 409);
      return this.publicTask(existing);
    }
    const view = this.details(account, world, territoryId, buildingId);
    if (view.building.status !== "active") fail("训练中心尚未建成或不可用", 409);
    if (!Object.hasOwn(TRAINING_POOLS, pool) || !Number.isInteger(slot) || slot < 0 || slot >= view.capacity) fail("无效的训练席位");
    const player = account.draft.roster.find((entry) => playerId(entry) === id);
    if (!player || player.pool !== pool) fail("请选择对应位置的本队球员");
    if(player.coalitionLoan)fail("已借调联军，归队后才能训练",409);
    if(player.medical)fail("治疗中的球员不能训练",409);
    if (player.training || this.tasks(account).some((task) => task.playerId === id && task.completedAt == null && task.cancelledAt == null)) fail("该球员正在训练", 409);
    if (this.tasks(account).some((task) => task.buildingId === buildingId && task.pool === pool && task.slot === slot && task.completedAt == null && task.cancelledAt == null)) fail("训练席位已被占用", 409);
    const expedition = account.playerSquads?.assignments?.[id] === "expedition";
    if(raidMatchForAccount(world,account.id))fail('豪门远征比赛结束后才能训练',409);
    if (expedition && (world.eliteChallenges?.[account.id] || Object.values(world.activeChallenges ?? {}).some((challenge) => challenge.attackerId === account.id))) fail("远征比赛结束后才能安排该球员训练", 409);
    if(attribute&&!this.wonders?.modifiers(account).trainingSelection)fail("阿尔罕布拉宫建成后可指定训练属性",403);
    const costGold = trainingCostGold(player);
    if ((account.gold ?? 0) < costGold) fail(`金币不足，本次训练需要 ${costGold.toLocaleString("en-US")} 金币`, 409);
    const gains = this.gains(player,this.wonders?.modifiers(account).trainingPoints??TRAINING_RULES.attributePoints,attribute,facilityEffects("training-center",view.building.level).coreBias);
    return this.transaction(account, () => {
      this.economy.spend(account, costGold, "player-training");
      const task = { costGold, refundedGold: 0, overallAtStart: Number(player.effectiveOverall ?? player.overall), id: `training:${crypto.randomUUID()}`, requestId, territoryId, buildingId, pool, slot,
        playerId: id, playerName: player.name, startedAt: this.now(), completesAt: this.now() + TRAINING_RULES.durationMs,
        completedAt: null, gains, attribute };
      account.training ??= { tasks: {} };
      account.training.tasks[task.id] = task;
      player.training = { taskId: task.id, completesAt: task.completesAt };
      return this.publicTask(task);
    });
  }
}
