// Presentation only: snapshots never modify league state or decide a business outcome.
export function createValueChanges() {
  let scope, previous = null;
  return {
    update(key, values) {
      const changes = previous && scope === key
        ? Object.entries(values).filter(([name,value]) => Number.isFinite(value) && Number.isFinite(previous[name]) && value !== previous[name])
          .map(([name,value]) => ({name,delta:value-previous[name]})) : [];
      scope=key; previous={...values};
      return changes;
    },
    reset() { previous=null; },
  };
}

export function leagueActionNotice(path, body, before, after) {
  if (path === '/card-trades/respond' && after.cardTradeResult?.status === 'failed') return {kind:'error',title:`交易失败：${after.cardTradeResult.reason ?? '卡片状态已变化'}`};
  if (path === '/shop/buy-s4') {
    const oldIds = new Set((before.s4Packs?.inventory ?? []).map(pack=>pack.id));
    const added = (after.s4Packs?.inventory ?? []).filter(pack=>!oldIds.has(pack.id)).length;
    return {title:'购买成功',detail:added ? `${before.shop?.catalog?.find(pack=>pack.id===body.packType)?.name ?? '礼包'} × ${added}，已放入背包` : '礼包已放入背包'};
  }
  if (path === '/market/buy') return {title:'交易完成',detail:after.marketPurchase?.player?.name ? `已获得 ${after.marketPurchase.player.name}` : '资产已到账'};
  const titles = {'/market/cancel':'挂牌已撤回','/market/list-card':'球员卡已挂牌','/market/list-ownership':'球员所有权已挂牌','/card-trades/create':'交易报价已发送，附带金币已进入托管','/card-trades/withdraw':'交易报价已撤回'};
  if (titles[path]) return {title:titles[path]};
  if (path === '/card-trades/respond') return {title:body.action==='accept'?'交易已经达成':'交易报价已拒绝'};
  return null;
}

function triggerSelector(button) {
  if (!button) return null;
  // Only use stable action attributes; rendering may replace the original control.
  const attributes = [...button.attributes].filter(attr=>attr.name.startsWith('data-') && !attr.name.startsWith('data-request-'));
  if (attributes.length) return attributes.map(attr=>`[${attr.name}=${JSON.stringify(attr.value)}]`).join('');
  const form = button.closest('form');
  return form?.id ? `[id=${JSON.stringify(form.id)}] button[type="submit"]` : null;
}

export function createInteractionFeedback({motion,env=globalThis}) {
  const doc=env.document, resources=createValueChanges();
  const requests=new Map(), chips=new Set();
  let uiScope, previous=null, notice=null, noticeTitle='', noticeKind='', noticeTimer;
  const visible = element => element?.isConnected && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;

  function showNotice({title,detail='',kind='success'}) {
    env.clearTimeout(noticeTimer); notice?.remove();
    notice=doc.createElement('aside'); notice.className=`interaction-notice is-${kind}`;
    notice.setAttribute('role',kind==='error'?'alert':'status');
    noticeTitle=title;noticeKind=kind;
    const icon=doc.createElement('span');icon.className='interaction-notice-icon';icon.textContent=kind==='error'?'!':'✓';icon.setAttribute('aria-hidden','true');
    const copy=doc.createElement('div'), heading=doc.createElement('strong');heading.textContent=title;copy.append(heading);
    if(detail){const text=doc.createElement('small');text.textContent=detail;copy.append(text);}
    const close=doc.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭操作提示');
    const dismiss=()=>{notice?.remove();notice=null;noticeTitle='';};
    close.addEventListener('click',dismiss);notice.append(icon,copy,close);doc.body.append(notice);motion.play(notice,'dialog');
    if(kind!=='error')noticeTimer=env.setTimeout(dismiss,3200);
  }

  function mark(record,button) {
    if (!button || !button.isConnected) return;
    if (button.dataset.requestState !== 'pending') {
      record.buttons.set(button,{disabled:button.disabled,busy:button.getAttribute('aria-busy')});
      button.style?.setProperty?.('--request-ink',env.getComputedStyle?.(button).color ?? '#224539');
    }
    button.disabled=true;button.dataset.requestState='pending';button.setAttribute('aria-busy','true');
  }
  function syncRequests() {
    for (const record of requests.values()) {
      if(record.selector)for(const button of doc.querySelectorAll(record.selector))mark(record,button);
    }
  }
  function request(button,task,{key=button}={}) {
    if(requests.has(key))return requests.get(key).promise;
    if(noticeKind==='error'){env.clearTimeout(noticeTimer);notice?.remove();notice=null;noticeTitle='';noticeKind='';}
    const record={selector:triggerSelector(button),buttons:new Map()};
    mark(record,button);
    // Start in a microtask so duplicate synchronous dispatches share the same promise.
    record.promise=Promise.resolve().then(task).then(value=>{
      const failed=value?.cardTradeResult?.status==='failed';
      for(const control of record.buttons.keys())if(control.isConnected)motion.play(control,'pulse',failed?'#ed6472':'#4cbfa6');
      return value;
    },error=>{
      showNotice({kind:'error',title:error.message ?? '操作失败，请重试'});
      throw error;
    }).finally(()=>{
      requests.delete(key);
      for(const [control,state] of record.buttons) {
        if(control.dataset.requestState!=='pending')continue;
        control.disabled=state.disabled;
        delete control.dataset.requestState;
        control.style?.removeProperty?.('--request-ink');
        if(state.busy===null)control.removeAttribute('aria-busy');else control.setAttribute('aria-busy',state.busy);
      }
    });
    requests.set(key,record);
    return record.promise;
  }

  function resourceChanges(key,values,anchors) {
    const changes=resources.update(key,values);
    if(!motion.enabled)return;
    for(const {name,delta} of changes) {
      const anchor=anchors[name];if(!visible(anchor))continue;
      motion.play(anchor,'pulse',delta>0?'#4cbfa6':'#d69543');
      // A small fixed overlay cannot affect layout, clicks or the authoritative number.
      const chip=doc.createElement('span'),rect=anchor.getBoundingClientRect();
      chip.className=`interaction-resource-delta ${delta>0?'is-gain':'is-cost'}`;
      chip.textContent=`${delta>0?'+':''}${delta.toLocaleString('zh-CN')}`;chip.setAttribute('aria-hidden','true');
      chip.style.left=`${Math.max(36,Math.min(env.innerWidth-46,rect.left+rect.width/2))}px`;
      chip.style.top=`${Math.max(8,Math.min(env.innerHeight-40,rect.bottom))}px`;
      doc.body.append(chip);chips.add(chip);
      const animation=motion.play(chip,'float');
      const remove=()=>{chip.remove();chips.delete(chip);};
      if(animation){const finish=animation.onfinish,cancel=animation.oncancel;animation.onfinish=()=>{finish?.();remove();};animation.oncancel=()=>{cancel?.();remove();};}
      else remove();
    }
  }

  function sync(root,scope) {
    syncRequests();motion.prune();
    const next=new Map();
    const add=(key,value,element,kind='pulse')=>next.set(key,{value,element,kind});
    for(const element of root.querySelectorAll('[data-league-magnet],[data-league-bench-magnet]')) {
      const field=element.hasAttribute('data-league-magnet');
      add(`player:${element.dataset.leagueMagnet ?? element.dataset.leagueBenchMagnet}`,
        field ? `field:${element.style.left}:${element.style.top}:${element.dataset.assignedRole}:${element.querySelector('[data-league-duty-label]')?.textContent}` : 'bench',element);
    }
    for(const slot of root.querySelectorAll('[data-enhancement-drop]'))add(`slot:${slot.dataset.enhancementDrop}`,slot.querySelector('[data-enhancement-card-id]')?.dataset.enhancementCardId ?? '',slot);
    for(const card of root.querySelectorAll('[data-card-trade-choice]'))add(`trade:${card.dataset.cardTradeSide}:${card.dataset.cardTradeChoice}`,card.closest('.card-trade-choice')?.classList.contains('selected')?'selected':'',card.closest('.card-trade-choice'));
    for(const offer of root.querySelectorAll('[data-motion-trade-offer]'))add(`offer:${offer.dataset.motionTradeOffer}`,offer.dataset.motionTradeState,offer);
    for(const button of root.querySelectorAll('[data-league-position-preset],[data-tactical-mentality]')) {
      if(button.getAttribute('aria-pressed')==='true')add(`active:${button.dataset.planState ?? 'position'}`,button.dataset.tacticalMentality ?? button.dataset.leaguePositionPreset,button);
    }
    for(const control of root.querySelectorAll('[data-league-principle]'))add(`principle:${control.dataset.planState}:${control.dataset.leaguePrinciple}`,control.value,control);
    if(previous && uiScope===scope)for(const [key,item] of next) {
      if(previous.get(key)?.value===item.value || !visible(item.element))continue;
      if(!previous.has(key) && !key.startsWith('player:') && !key.startsWith('offer:'))continue;
      // Deselection remains immediately visible through the permanent selected style.
      if(key.startsWith('trade:') && !item.value)continue;
      motion.play(item.element,item.kind);
    }
    previous=next;uiScope=scope;
  }
  const clearTransient=()=>{for(const chip of chips)chip.remove();chips.clear();resources.reset();previous=null;};
  doc.addEventListener('visibilitychange',clearTransient);
  return {
    request,sync,resourceChanges,showNotice,
    isShowing:title=>Boolean(notice?.isConnected && noticeTitle===title),
    reset(){resources.reset();previous=null;clearTransient();},
    destroy(){doc.removeEventListener('visibilitychange',clearTransient);env.clearTimeout(noticeTimer);notice?.remove();clearTransient();},
  };
}
