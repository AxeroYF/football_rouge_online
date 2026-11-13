export const uiMotionEnabled = (preference, reduced = false) => preference === 'on' || (preference !== 'off' && !reduced);

// Compare authoritative snapshots. Joining, reconnecting and repeated polls never replay history.
export function createMatchFeedback() {
  let previous = null;
  return {
    reset() { previous = null; },
    update(value) {
      const match = value.match;
      const next = {code:value.code,live:value.live,score:[...match.score],ids:new Set((match.events ?? []).map(e=>e.id))};
      const result = {scores:[],events:[]};
      if (previous?.code === next.code && (value.live || previous.live)) {
        result.scores = next.score.flatMap((score,i)=>score > previous.score[i] ? [i] : []);
        result.events = (match.events ?? []).filter(e=>!previous.ids.has(e.id));
      }
      previous = next;
      return result;
    },
  };
}

export function createUiMotion(env = globalThis) {
  const doc = env.document, media = env.matchMedia?.('(prefers-reduced-motion: reduce)');
  const active = new Map(), feedback = createMatchFeedback();
  let preference = 'system', pageKey = null;
  const enabled = () => uiMotionEnabled(preference, media?.matches) && !doc?.hidden;
  const cancel = () => { for (const animation of active.values()) animation.cancel(); active.clear(); };
  function apply() {
    if (doc) doc.documentElement.dataset.uiMotion = uiMotionEnabled(preference,media?.matches) ? 'on' : 'off';
    if (!enabled()) cancel();
  }
  function visibility() { cancel(); feedback.reset(); }
  media?.addEventListener?.('change',apply);
  doc?.addEventListener?.('visibilitychange',visibility);
  function play(element,kind='enter',color='#4cbfa6') {
    if (!enabled() || !element?.animate) return;
    active.get(element)?.cancel();
    const frames = kind === 'float'
      ? [{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)',offset:.15},{opacity:1,offset:.65},{opacity:0,transform:'translateY(-18px)'}]
      : kind === 'score'
      ? [{transform:'scale(1)'},{transform:'scale(1.18)',color,offset:.35},{transform:'scale(1)'}]
      : kind === 'pulse'
        ? [{boxShadow:'0 0 0 0 transparent'},{boxShadow:`0 0 0 3px ${color}, 0 0 20px ${color}55`,offset:.3},{boxShadow:'0 0 0 0 transparent'}]
        : kind === 'dialog'
          ? [{opacity:0,transform:'translateY(10px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}]
          : [{opacity:.35},{opacity:1}];
    const animation = element.animate(frames,{duration:kind==='float'?1100:kind==='score'?650:kind==='pulse'?600:kind==='dialog'?220:180,easing:'cubic-bezier(.2,.7,.25,1)'});
    active.set(element,animation);
    const release = () => { if(active.get(element)===animation) active.delete(element); };
    animation.onfinish = release; animation.oncancel = release;
    return animation;
  }

  function polygon(element, previous) {
    const final = element?.getAttribute('points');
    const parse = value => String(value ?? '').trim().split(/[\s,]+/).map(Number);
    const from = parse(previous), to = parse(final);
    if (!enabled() || !element || !previous || previous === final || from.length !== to.length || !from.every(Number.isFinite) || !to.every(Number.isFinite)) return;
    active.get(element)?.cancel();
    let frame, start;
    const finish = () => {
      env.cancelAnimationFrame(frame);
      element.setAttribute('points',final);
      if (active.get(element) === animation) active.delete(element);
    };
    const animation = {cancel:finish};
    active.set(element,animation);
    const tick = now => {
      if (element.isConnected === false || !enabled()) { finish(); return; }
      start ??= now;
      const progress = Math.min(1,(now-start)/260), eased = 1-(1-progress)**3;
      element.setAttribute('points',to.map((value,i)=>from[i]+(value-from[i])*eased).join(' '));
      if (progress < 1) frame=env.requestAnimationFrame(tick);
      else finish();
    };
    frame=env.requestAnimationFrame(tick);
  }
  apply();
  return {
    get enabled() { return enabled(); },
    setPreference(value) { preference=value; apply(); },
    play,
    polygon,
    prune() { for (const [element,animation] of active) if (element.isConnected === false) animation.cancel(); },
    page(key,element) { if(key!==pageKey){pageKey=key;play(element);} },
    resetBroadcast() { feedback.reset(); },
    broadcast(root,value) {
      if(doc?.hidden){feedback.reset();return;}
      const changes=feedback.update(value);
      changes.scores.forEach(i=>play(root.querySelector(`[data-motion-score="${i}"]`),'score','#e7ad3d'));
      // Bound bursts after a slow poll; the full event feed still retains every event.
      const colors={goal:'#e7ad3d',ownGoal:'#e7ad3d',superWorldie:'#e7ad3d',penalty:'#e7ad3d',red:'#ed6472',yellow:'#e7ad3d',injury:'#ed6472',substitution:'#4cbfa6'};
      for(const event of changes.events.filter(e=>colors[e.type]).slice(-4)) {
        const ids=[event.actorId,event.incomingPlayerId,event.outgoingPlayerId].filter(Boolean);
        for(const player of root.querySelectorAll('[data-motion-player]')) {
          if(ids.includes(player.dataset.motionPlayer)) play(player,'pulse',colors[event.type]);
        }
      }
    },
    destroy() { cancel();media?.removeEventListener?.('change',apply);doc?.removeEventListener?.('visibilitychange',visibility); },
  };
}
