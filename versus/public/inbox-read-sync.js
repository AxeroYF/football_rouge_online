// Read state is monotonic. Keep per-message ownership of optimistic updates so
// one failed request cannot undo another request or a newer server snapshot.
export function createInboxReadSync({getScope,getView,request,onChange=()=>{},onError=()=>{},now=Date.now}) {
  let scope = null;
  const pending = new Map(), confirmed = new Map();
  function ensureScope() {
    const next = getScope();
    if (scope !== next) { scope = next; pending.clear(); confirmed.clear(); }
    return next;
  }
  function reconcile(view = getView(), {authoritative = false} = {}) {
    ensureScope();
    if (!view?.inbox || view.inboxMeta?.paged) return view;
    const present = new Set(view.inbox.map(message => message.id));
    for (const id of confirmed.keys()) if (!present.has(id)) confirmed.delete(id);
    for (const message of view.inbox) {
      const waiting = pending.get(message.id), done = confirmed.get(message.id);
      if (waiting && waiting.createdAt === message.createdAt) {
        if (message.readAt && (authoritative || message.readAt !== waiting.optimisticReadAt)) waiting.serverReadAt = message.readAt;
        message.readAt ||= waiting.optimisticReadAt;
      } else if (done && done.createdAt === message.createdAt) message.readAt = Math.max(Number(message.readAt ?? 0),done.readAt);
    }
    view.inboxUnreadCount = view.inbox.filter(message => !message.readAt).length;
    return view;
  }
  function notify() { reconcile(); onChange(); }
  async function read(messageIds, {category='all',single=false} = {}) {
    const startedScope = ensureScope(), ids = new Set(messageIds);
    const targets = (getView()?.inbox ?? []).filter(message => ids.has(message.id)
      && (!message.readAt || Number(message.updatedAt) > Number(message.readAt)) && !pending.has(message.id));
    const owned = new Map(targets.map(message => [message.id,{createdAt:message.createdAt,optimisticReadAt:now(),previousReadAt:message.readAt}]));
    for (const [id,item] of owned) pending.set(id,item);
    if (!owned.size) return;
    notify();
    const current = () => startedScope === getScope() && startedScope === scope;
    try {
      for (let offset=0; offset<targets.length; offset+=200) {
        if (!current()) return;
        const batch = targets.slice(offset,offset+200).map(message=>message.id);
        let receipt;
        for (let attempt=0; attempt<2; attempt++) {
          try {
            receipt = await request(single ? '/inbox/read' : '/inbox/read-batch',
              single ? {messageId:batch[0]} : {messageIds:batch,category});
            break;
          } catch (error) {
            if (!current()) return;
            if (attempt || (error.status >= 400 && error.status < 500)) throw error;
          }
        }
        if (!current()) return;
        const acknowledged = new Set(single ? [receipt.messageId] : receipt.messageIds ?? []);
        const missing = new Set(receipt.missingMessageIds ?? []);
        const view = getView();
        view.inbox = view.inbox.filter(message=>!missing.has(message.id));
        for (const id of batch) {
          const item = owned.get(id), message = view.inbox.find(entry=>entry.id===id);
          if (pending.get(id) !== item) continue;
          if (message?.createdAt === item.createdAt) {
            if (acknowledged.has(id)) {
              message.readAt = receipt.readAt;
              confirmed.set(id,{createdAt:item.createdAt,readAt:receipt.readAt});
            } else if (message.readAt === item.optimisticReadAt) message.readAt = item.serverReadAt ?? item.previousReadAt;
          }
          pending.delete(id);
        }
        // A read receipt does not contain unrelated league changes. Do not
        // advance the global snapshot version and accidentally skip polling.
        notify();
      }
    } catch (error) {
      if (current()) onError(error);
    } finally {
      if (current()) {
        for (const [id,item] of owned) {
          if (pending.get(id) !== item) continue;
          const message = getView()?.inbox?.find(entry=>entry.id===id);
          if (message?.createdAt === item.createdAt && message.readAt === item.optimisticReadAt) message.readAt = item.serverReadAt ?? item.previousReadAt;
          pending.delete(id);
        }
        notify();
      }
    }
  }
  return {read,reconcile};
}
