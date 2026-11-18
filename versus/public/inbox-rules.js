export const INBOX_CATEGORIES = Object.freeze([
  {id:'all',label:'全部'}, {id:'action',label:'待处理'}, {id:'competition',label:'赛事'},
  {id:'rewards',label:'奖励与收益'}, {id:'trades',label:'交易'}, {id:'announcements',label:'公告'},
]);
export const INBOX_TYPE_META = Object.freeze({
  'daily-report':{label:'球队日报',category:'competition'}, matchweek:{label:'比赛周',category:'competition'},
  medical:{label:'队医报告',category:'competition'}, lineup:{label:'阵容轮换',category:'competition'},
  friendly:{label:'友谊赛',category:'competition'}, 'friendly-invite':{label:'友谊赛邀请',category:'competition'},
  reward:{label:'阶段奖励',category:'rewards'}, prediction:{label:'比赛预测',category:'rewards'},
  'prediction-share':{label:'系统收益均分',category:'rewards'}, 'mirror-settlement':{label:'镜像收益',category:'rewards'},
  'mirror-batch-report':{label:'镜像模拟',category:'competition'}, 'trait-compensation':{label:'特性补偿',category:'rewards'},
  transfer:{label:'转会消息',category:'trades'}, 'trade-offer':{label:'交易报价',category:'trades'},
  'trade-result':{label:'交易结果',category:'trades'}, 'trade-public':{label:'重要转会',category:'trades'},
  notice:{label:'联赛通知',category:'announcements'}, announcement:{label:'全服公告',category:'announcements'},
  'admin-update':{label:'管理员公告',category:'announcements'},
  'activity-digest':{label:'全服动态',category:'announcements'},
});
export const INBOX_ACTION_LABELS = Object.freeze({
  pending:'待处理', accepted:'已接受', rejected:'已拒绝', withdrawn:'已撤回', failed:'交易失败',
  completed:'已完成', cancelled:'已取消', expired:'已超时', unavailable:'已失效', none:'无需处理',
});
export function inboxCategory(message) { return INBOX_TYPE_META[message.type]?.category ?? 'announcements'; }
export function inboxActionAt(action, now = Date.now()) {
  const state = action ?? {status:'none'};
  return state.status === 'pending' && state.expiresAt && now >= Number(state.expiresAt)
    ? {...state,status:'expired',reason:'邀请已超过两小时有效期'} : state;
}
export function inboxMatchesCategory(message, category, action) {
  return category === 'all' || (category === 'action' ? action?.status === 'pending' : inboxCategory(message) === category);
}

// Resolve from the business object, never from an old mail snapshot alone.
export function resolveInboxAction(message, {trade, invitation, offer, card, traitEligible = false, now = Date.now()} = {}) {
  if (message.type === 'trade-offer') return {status:trade?.status ?? 'unavailable'};
  if (message.type === 'friendly-invite') {
    if (!invitation) return {status:'unavailable',reason:'邀请记录已归档或清理'};
    return inboxActionAt({status:invitation.status,expiresAt:invitation.expiresAt},now);
  }
  if (message.type === 'trait-compensation') {
    if (offer?.status === 'chosen' || message.payload?.resolvedAt) return {status:'completed',chosenTraitId:offer?.chosenTraitId ?? message.payload?.chosenTraitId};
    if (offer?.status === 'cancelled') return {status:'cancelled',reason:'对应球员卡或特性机会已不可用'};
    if (!offer || offer.status !== 'pending' || !card || card.status !== 'active' || card.ownerId !== offer.ownerId || !traitEligible) {
      return {status:'unavailable',reason:'对应球员卡或特性机会已不可用'};
    }
    return {status:'pending'};
  }
  return {status:'none'};
}
