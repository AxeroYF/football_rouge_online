import {randomUUID} from 'node:crypto';
import {INBOX_CATEGORIES,inboxCategory,inboxMatchesCategory} from './public/inbox-rules.js';
import {INBOX_PAGE_SIZE,INBOX_RETENTION,inboxRetentionBucket} from './public/inbox-policy.js';
import {trackedRawReference,trackedSubtreeVersion} from './league-shard-store.js';
const copy = value => JSON.parse(JSON.stringify(value));
const compare = (a,b) => Number(b.createdAt)-Number(a.createdAt) || String(b.id).localeCompare(String(a.id));
const failure = (message,statusCode=400,code='INBOX_INVALID') => Object.assign(new Error(message),{statusCode,code});
function queryOptions(options) {
  const category=options.category ?? 'all';
  if (!INBOX_CATEGORIES.some(item=>item.id===category)) throw failure('邮件分类无效');
  return {category,unreadOnly:options.unreadOnly===true};
}
function cursor(value) {
  if (value==null) return null;
  if (!Number.isFinite(value.createdAt) || typeof value.id!=='string' || value.id.length>500) throw failure('邮件分页位置无效');
  return {createdAt:value.createdAt,id:value.id};
}
export const inboxPageMethods = {
  inboxTeam(account) {
    const team=this.accountTeam(account.id);
    if (!team) throw failure('你还没有加入联赛',404);
    return team;
  },
  inboxActionContext() {
    // Read-only indexes: avoid wrapping every business object in a storage proxy
    // on every list/head request. All mutations still go through this.state.
    this.inboxActionIndexes ??= new Map();
    const index = key => {
      const value=this.state[key], raw=trackedRawReference(value), version=trackedSubtreeVersion(value), cached=this.inboxActionIndexes.get(key);
      // Untracked test/offline state has no reliable mutation counter: rebuild.
      if(version!==null && cached?.raw===raw && cached.version===version) return cached.index;
      const result=new Map((raw ?? []).map(item=>[item.id,item]));
      this.inboxActionIndexes.set(key,{raw,version,index:result});
      return result;
    };
    return {trades:index('cardTradeOffers'),invitations:index('friendlyInvitations')};
  },
  pruneInbox(team) {
    const inbox=trackedRawReference(this.state.inbox[team.id] ?? []), keep=new Set(), buckets=new Map(), context=this.inboxActionContext(), now=this.now();
    for (const message of inbox) {
      if (this.inboxActionState(message,context).status==='pending') { keep.add(message.id);continue; }
      const bucket=inboxRetentionBucket(message,inboxCategory(message)), policy=INBOX_RETENTION[bucket] ?? INBOX_RETENTION.announcements;
      if (now-Number(message.updatedAt ?? message.createdAt) > policy.days*86400000) continue;
      if (!buckets.has(bucket)) buckets.set(bucket,[]);
      buckets.get(bucket).push(message);
    }
    for (const [bucket,messages] of buckets) {
      // Unread or updated important messages survive capacity pressure before read mail.
      const unseen=m=>!m.readAt || Number(m.updatedAt)>Number(m.readAt);
      messages.sort((a,b)=>Number(unseen(b))-Number(unseen(a)) || compare(a,b));
      messages.slice(0,(INBOX_RETENTION[bucket] ?? INBOX_RETENTION.announcements).limit).forEach(m=>keep.add(m.id));
    }
    if (keep.size===inbox.length) return 0;
    this.state.inbox[team.id]=inbox.filter(m=>keep.has(m.id));
    return inbox.length-keep.size;
  },
  maintainInboxRetention() {
    if (this.now()<Number(this.nextInboxMaintenanceAt ?? 0)) return;
    this.nextInboxMaintenanceAt=this.now()+3600000;
    const removed=this.state.teams.filter(t=>t.ownerId).reduce((sum,t)=>sum+this.pruneInbox(t),0);
    if (removed) { this.state.updatedAt=Math.max(this.now(),Number(this.state.updatedAt)+1);this.scheduleInboxReadPersist(); }
  },
  inboxRows(team) {
    const context=this.inboxActionContext();
    return trackedRawReference(this.state.inbox[team.id] ?? []).map(message=>({message,action:this.inboxActionState(message,context)}));
  },
  inboxMeta(team,rows=team ? this.inboxRows(team) : []) {
    const counts=Object.fromEntries(INBOX_CATEGORIES.map(c=>[c.id,0])),unread={...counts};
    for (const {message,action} of rows) {
      const categories=['all',inboxCategory(message),...(action.status==='pending'?['action']:[])];
      for (const category of categories) { counts[category]++; if (!message.readAt) unread[category]++; }
    }
    return {paged:true,revision:this.state.updatedAt,counts,unread,total:rows.length,unreadCount:unread.all,pageSize:INBOX_PAGE_SIZE};
  },
  inboxProjection(team) {
    return this.pagedInbox ? {inboxMeta:this.inboxMeta(team)} : {inbox:team ? this.inbox(team) : []};
  },
  inboxList(account,options={}) {
    const team=this.inboxTeam(account), {category,unreadOnly}=queryOptions(options);
    if (this.pruneInbox(team)) { this.state.updatedAt=Math.max(this.now(),Number(this.state.updatedAt)+1);this.scheduleInboxReadPersist(); }
    const rows=this.inboxRows(team), before=cursor(options.cursor), upper=cursor(options.anchor);
    const filtered=rows.filter(({message,action})=>inboxMatchesCategory(message,category,action) && (!unreadOnly||!message.readAt)
      && (!upper || compare(message,upper)>=0)).sort((a,b)=>compare(a.message,b.message));
    const candidates=filtered.filter(({message})=>!before || compare(message,before)>0);
    const page=candidates.slice(0,INBOX_PAGE_SIZE);
    const key=message=>message ? {createdAt:Number(message.createdAt),id:message.id} : null;
    const messages=page.map(({message:m,action})=>({id:m.id,type:m.type,title:m.title,summary:String(m.summary ?? '').slice(0,240),createdAt:m.createdAt,updatedAt:m.updatedAt,
      readAt:m.readAt,seasonId:m.seasonId,seasonName:m.seasonName,seasonDate:m.seasonDate,round:m.round,matchId:m.matchId,
      competitionLabel:m.payload?.competitionLabel ?? null,action}));
    return {messages,meta:this.inboxMeta(team,rows),total:filtered.length,hasNext:candidates.length>page.length,
      nextCursor:key(page.at(-1)?.message),anchor:upper ?? key(filtered[0]?.message),serverTime:this.now()};
  },
  inboxDetail(account,messageId) {
    const team=this.inboxTeam(account), message=trackedRawReference(this.state.inbox[team.id] ?? []).find(m=>m.id===String(messageId));
    if (!message) throw failure('邮件已删除或超过保留期限',404,'INBOX_MESSAGE_MISSING');
    const context=this.inboxActionContext();
    const result={...copy(message),action:this.inboxActionState(message,context),...(message.matchId ? {matchLink:this.inboxMatchLink(message.matchId)} : {})};
    // Load only the business object needed by this mail, rechecking recipient ownership.
    const trade=context.trades.get(message.payload?.tradeOfferId), invitation=context.invitations.get(message.payload?.friendlyInvitationId);
    if (trade && [trade.fromOwnerId,trade.toOwnerId].includes(account.id)) result.tradeOffer=this.cardTradeOfferView(trade);
    if (invitation && [invitation.fromOwnerId,invitation.toOwnerId].includes(account.id)) result.friendlyInvitation=this.friendlyInvitationView(invitation);
    return {message:result,meta:this.inboxMeta(team),serverTime:this.now()};
  },
  inboxSelection(account,options={}) {
    const team=this.inboxTeam(account), filter=queryOptions(options), operation=options.operation;
    if (!['read','delete','delete-read'].includes(operation)) throw failure('邮件操作无效');
    const ids=this.inboxRows(team).filter(({message:m,action})=>inboxMatchesCategory(m,filter.category,action) && (!filter.unreadOnly || !m.readAt)
      && (operation==='read' ? !m.readAt : action.status!=='pending' && (operation!=='delete-read' || m.readAt))).map(({message})=>message.id);
    this.inboxSelections ??= new Map();
    for (const [id,item] of this.inboxSelections) if (item.expiresAt<=this.now()) this.inboxSelections.delete(id);
    const own=[...this.inboxSelections].filter(([,item])=>item.teamId===team.id);
    for (const [id] of own.slice(0,Math.max(0,own.length-3))) this.inboxSelections.delete(id);
    const token=randomUUID(),expiresAt=this.now()+120000;
    this.inboxSelections.set(token,{teamId:team.id,filter,operation,ids,expiresAt});
    return {token,count:ids.length,expiresAt};
  },
  applyInboxSelection(account,token) {
    const team=this.inboxTeam(account), selection=this.inboxSelections?.get(String(token));
    if (!selection || selection.teamId!==team.id || selection.expiresAt<=this.now()) throw failure('操作范围已失效，请重新选择',409,'INBOX_SELECTION_EXPIRED');
    if (selection.receipt) return {...selection.receipt,meta:this.inboxMeta(team)};
    const selected=new Set(selection.ids), removed=new Set(), context=this.inboxActionContext();let changed=0;
    for (const message of this.state.inbox[team.id] ?? []) {
      if (!selected.has(message.id)) continue;
      const action=this.inboxActionState(message,context);
      if (!inboxMatchesCategory(message,selection.filter.category,action) || (selection.filter.unreadOnly && message.readAt)) continue;
      if (selection.operation==='read') { if (!message.readAt) {message.readAt=this.now();changed++;} }
      else if (action.status!=='pending' && (selection.operation!=='delete-read' || message.readAt)) removed.add(message.id);
    }
    if (removed.size) {
      const previousInbox=this.state.inbox[team.id],previousDeleted=this.state.inboxDeleted[team.id] ?? [];
      this.state.inbox[team.id]=this.state.inbox[team.id].filter(m=>!removed.has(m.id));
      this.state.inboxDeleted[team.id]=[...new Set([...(this.state.inboxDeleted[team.id] ?? []),...removed])].slice(-500);
      try { this.save({skipDailyBackup:true}); }
      catch(error) {this.state.inbox[team.id]=previousInbox;this.state.inboxDeleted[team.id]=previousDeleted;throw error;}
    } else if (changed) {this.state.updatedAt=Math.max(this.now(),Number(this.state.updatedAt)+1);this.scheduleInboxReadPersist();}
    selection.receipt={changed,deletedCount:removed.size,serverTime:this.now()};
    return {...selection.receipt,meta:this.inboxMeta(team)};
  },
};
