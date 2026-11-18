export const INBOX_PAGE_SIZE = 25;
export const INBOX_RETENTION = Object.freeze({
  activity:{days:7,limit:40,label:'普通动态'},
  competition:{days:14,limit:160,label:'赛事与日报'},
  rewards:{days:60,limit:200,label:'奖励与收益'},
  trades:{days:60,limit:200,label:'交易记录'},
  announcements:{days:30,limit:120,label:'一般通知'},
  admin:{days:90,limit:80,label:'管理员公告'},
});
export function inboxRetentionBucket(message, category) {
  if (message.type === 'activity-digest') return 'activity';
  if (message.type === 'admin-update') return 'admin';
  if (message.type === 'matchweek' && message.payload?.rewards?.length) return 'rewards';
  return category;
}
