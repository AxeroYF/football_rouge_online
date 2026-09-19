import crypto from 'node:crypto';
import { DRAFT_VERSION, DRAFT_POOLS, GRADE_WEIGHTS, missingDraftGoalkeepers, draftTargetSize, availableDraftPools, hasCurrentDraftOffer } from '../../shared/config/draft.mjs';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const id = card => String(card.id ?? card.playerId);

export class DraftService {
  constructor({ catalog, random = Math.random, save = () => {} }) { Object.assign(this, { catalog, random, save }); }
  transaction(account, action) {
    const before = { draft: structuredClone(account.draft), setupComplete: account.setupComplete };
    try { const changed = action(); if (changed) this.save(); }
    catch (error) { Object.assign(account, before); throw error; }
  }
  prepare(draft) {
    if (draft.version === DRAFT_VERSION) return false;
    const totalPicks = draftTargetSize(draft), keepOffer = hasCurrentDraftOffer(draft);
    Object.assign(draft, { version: DRAFT_VERSION, totalPicks,
      offer: keepOffer ? draft.offer : [], offerId: keepOffer ? draft.offerId : null, offerPool: keepOffer ? draft.offerPool : null,
      roleOfferCounts: draft.roleOfferCounts ?? {}, lastChoice: draft.lastChoice ?? null });
    return true;
  }
  start(account, teamName) {
    if (account.setupComplete) return;
    this.transaction(account, () => {
      account.draft ??= { teamName, roster: [], offer: [] };
      const changed = this.prepare(account.draft);
      if (account.draft.roster.length >= draftTargetSize(account.draft) && !missingDraftGoalkeepers(account.draft.roster)) { account.setupComplete = true; return true; }
      return changed;
    });
  }
  drawOffer(draft, pool) {
    const chosen = new Set(draft.roster.map(id));
    const allowed = this.catalog.filter(card => !card.isX && card.status !== 'draft' && card.pool === pool &&
      DRAFT_POOLS[pool].includes(card.role) && Object.hasOwn(GRADE_WEIGHTS, card.grade) && !chosen.has(id(card)));
    const roles = DRAFT_POOLS[pool].filter(role => allowed.some(card => card.role === role))
      .sort((a, b) => (draft.roleOfferCounts?.[a] ?? 0) - (draft.roleOfferCounts?.[b] ?? 0));
    if (!roles.length) fail('这个位置池暂无可选球员');
    const offer = [];
    while (offer.length < 3) {
      // Balance candidate exposure, without limiting how many players may be chosen in a role.
      const available = allowed.filter(card => !offer.some(selected => id(selected) === id(card)));
      const nextRoles = roles.filter(role => available.some(card => card.role === role))
        .sort((a, b) => offer.filter(card => card.role === a).length - offer.filter(card => card.role === b).length);
      if (!nextRoles.length) break;
      const candidates = available.filter(card => card.role === nextRoles[0]);
      const weights = Object.entries(GRADE_WEIGHTS).filter(([grade]) => candidates.some(card => card.grade === grade));
      let target = Math.min(.999999999, Math.max(0, this.random())) * weights.reduce((sum, [, weight]) => sum + weight, 0);
      const grade = weights.find(([, weight]) => (target -= weight) < 0)?.[0] ?? weights.at(-1)[0];
      const graded = candidates.filter(card => card.grade === grade);
      const index = Math.min(graded.length - 1, Math.floor(Math.max(0, this.random()) * graded.length));
      offer.push(structuredClone(graded[index]));
    }
    return offer;
  }
  open(account, pool, pickNumber) {
    if (account.setupComplete) fail('初始选人已经完成', 409);
    if (!account.draft) fail('请先建立球队并开始选人');
    if (!Object.hasOwn(DRAFT_POOLS, pool)) fail('请选择有效的位置池');
    this.transaction(account, () => {
      const draft = account.draft, changed = this.prepare(draft);
      if (pickNumber !== draft.roster.length + 1) fail('选人进度已变化，请刷新后重试', 409);
      if (draft.roster.length >= draftTargetSize(draft) && !missingDraftGoalkeepers(draft.roster)) { account.setupComplete = true; return true; }
      if (!availableDraftPools(draft).includes(pool)) fail('请先选齐 3 名门将', 409);
      if (draft.offer.length) {
        if (draft.offerPool !== pool) fail('请先选择当前卡包中的球员', 409);
        return changed; // Retries and other tabs see the same saved offer.
      }
      const offer = this.drawOffer(draft, pool);
      draft.offer = offer; draft.offerId = crypto.randomUUID(); draft.offerPool = pool;
      for (const card of offer) draft.roleOfferCounts[card.role] = (draft.roleOfferCounts[card.role] ?? 0) + 1;
      return true;
    });
  }
  choose(account, playerId, offerId) {
    if (!account.draft) fail('请先建立球队并开始选人');
    const draft = account.draft;
    if (draft.lastChoice && draft.lastChoice.offerId === offerId && draft.lastChoice.playerId === playerId) return;
    if (account.setupComplete) fail('初始选人已经完成', 409);
    if (!hasCurrentDraftOffer(draft) || !offerId || offerId !== draft.offerId) fail('候选已变化，请刷新后重试', 409);
    const selected = draft.offer.find(card => id(card) === playerId);
    if (!selected) fail('该球员不在本次候选中');
    if (draft.roster.some(card => id(card) === playerId)) fail('该球员已经完成选择', 409);
    this.transaction(account, () => {
      this.prepare(draft);
      const roster = [...draft.roster, structuredClone(selected)], totalPicks = draftTargetSize(draft);
      if (roster.length > totalPicks) fail('初始选人名额已经用完', 409);
      if (totalPicks - roster.length < missingDraftGoalkeepers(roster)) fail('初始阵容至少需要 3 名门将', 409);
      Object.assign(draft, { roster, offer: [], offerId: null, offerPool: null, lastChoice: { offerId, playerId } });
      account.setupComplete = roster.length === totalPicks;
      return true;
    });
  }
}
