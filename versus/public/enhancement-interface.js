// Both layouts use the same authoritative cards, controls and request handlers.
export function modernEnhancementMarkup(classicMarkup, {result, pendingTrait, hint, skipped = false}, doc = document) {
  const template = doc.createElement('template');
  template.innerHTML = classicMarkup;
  const source = template.content.querySelector('.league-enhancement');
  source.querySelector('[data-enhancement-submit]').textContent = source.classList.contains('phase-scanning') ? '合成中' : '开始合成';
  const action = source.querySelector('.enhancement-action');
  if (action.querySelector('strong')?.textContent.trim() === '—') action.querySelector('strong').remove();
  if (action.querySelector('small')?.textContent.includes('选择主卡')) action.querySelector('small').remove();
  action.querySelector('label.disabled')?.remove();
  for (const slot of source.querySelectorAll('[data-enhancement-drop]')) {
    const label = slot.dataset.enhancementDrop === 'main' ? '选择待强化球员卡' : '选择合成材料卡';
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', label);
    slot.querySelector(':scope > b')?.remove();
    if (slot.classList.contains('empty')) slot.innerHTML = `<button type="button" class="fusion-empty-pick" data-fusion-open-warehouse aria-label="${label}"><span aria-hidden="true">＋</span></button>`;
  }
  const html = selector => source.querySelector(selector).outerHTML;
  const hasResult = Boolean(result || pendingTrait);
  const outcome = result ? result.success ? 'success' : 'failure' : 'pending';
  const status = pendingTrait ? '选择强化特性' : hasResult ? '' : /不足|上限|不能高于|失败可能降级/.test(hint) ? hint : '';
  return `<section class="${source.className} fusion-workspace ${hasResult ? 'has-result' : ''} ${skipped ? 'fusion-motion-skipped' : ''}" data-fusion-outcome="${outcome}" data-fusion-tier="${Number(result?.afterLevel ?? 0) >= 4 ? 'high' : 'normal'}">
    <div class="fusion-atmosphere" aria-hidden="true"><i></i><i></i><i></i></div>
    <section class="fusion-stage" aria-label="合卡舞台">
      <header class="fusion-heading"><h2>球员合成</h2><div class="fusion-heading-actions"><button type="button" data-enhancement-history-open>合成记录</button><button type="button" data-fusion-settings>界面设置</button></div></header>
      <div class="fusion-duel">
        ${html('[data-enhancement-drop="main"]')}
        ${html('.enhancement-action')}
        ${html('[data-enhancement-drop="material"]')}
        <div class="fusion-impact" aria-hidden="true"></div>
        <div class="fusion-reveal" role="status" aria-live="polite">${html('.enhancement-result-frame')}${result && !pendingTrait ? `<button type="button" class="fusion-collect" data-fusion-collect="${result.card.id}">放回仓库 · 继续合成</button>` : ''}</div>
      </div>
      <footer class="fusion-stage-footer"><span>${status}</span><button type="button" data-fusion-skip>跳过动画</button><span class="fusion-processing" role="status">正在合成…</span></footer>
    </section>
    <aside class="fusion-drawer" data-fusion-drawer>
      <button type="button" class="fusion-drawer-handle" data-fusion-drawer-toggle aria-expanded="false" aria-controls="fusion-warehouse-content"><i aria-hidden="true">⌃</i><b>球员卡仓库</b></button>
      <div class="fusion-drawer-content" id="fusion-warehouse-content" inert>${html('.enhancement-warehouse')}</div>
    </aside>
  </section>`;
}

// Keep hover/keyboard/drag state outside patched HTML so selecting or filtering
// a card does not collapse the drawer. The hidden content is not keyboard-focusable.
export function createFusionWarehouseController(env = globalThis) {
  let root = null, drawer = null, open = false, hovering = false, dragging = false, timer = null;
  let openedByHover = false;
  const doc = env.document;
  function clear() { if (timer !== null) env.clearTimeout(timer); timer = null; }
  function sync() {
    if (!root) return;
    root.classList.toggle('fusion-warehouse-open', open);
    const button = root.querySelector('[data-fusion-drawer-toggle]');
    button?.setAttribute('aria-expanded', String(open));
    const content = root.querySelector('.fusion-drawer-content');
    if (content) content.inert = !open;
  }
  function setOpen(value) { clear(); open = value; openedByHover = false; sync(); }
  function close() { setOpen(false); }
  function focusNeedsDrawer() {
    const active = doc?.activeElement;
    return drawer?.contains(active) && !active.matches('[data-fusion-drawer-toggle]')
      && active.matches('input,select,textarea,:focus-visible');
  }
  function scheduleClose() {
    clear();
    timer = env.setTimeout(() => { timer = null; if (!hovering && !dragging && !focusNeedsDrawer()) close(); }, 180);
  }
  const canHover = () => env.matchMedia?.('(min-width: 1051px) and (hover: hover) and (pointer: fine)')?.matches ?? true;
  function enter(event) {
    if (event.pointerType === 'touch' || !canHover()) return;
    hovering = true;
    if (!open) {
      setOpen(true);
      openedByHover = true;
    }
  }
  function leave(event) { if (event.pointerType === 'touch' || !canHover()) return; hovering = false; scheduleClose(); }
  function focusIn(event) { if (!event.target.matches('[data-fusion-drawer-toggle]')) setOpen(true); }
  function focusOut(event) {
    // Selecting a card removes its warehouse node. That focus loss is not an
    // intentional exit, especially on touch devices without a hovering pointer.
    if (event.relatedTarget && !drawer.contains(event.relatedTarget) && !hovering && !dragging) scheduleClose();
  }
  function click(event) {
    if (event.target.closest('[data-fusion-drawer-toggle]')) {
      // A mouse click can arrive immediately after the same pointer opened the drawer.
      setOpen(!open || (event.detail > 0 && openedByHover));
    }
    else if (event.target.closest('[data-fusion-open-warehouse]')) {
      setOpen(true);
      root.querySelector('.enhancement-tools input')?.focus({preventScroll:true});
    }
  }
  function keydown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); close(); root.querySelector('[data-fusion-drawer-toggle]')?.focus({preventScroll:true});
    } else if (event.key === 'ArrowUp' && event.target.matches('[data-fusion-drawer-toggle]')) {
      event.preventDefault(); setOpen(true); root.querySelector('.enhancement-tools input')?.focus({preventScroll:true});
    }
  }
  function dragStart() { dragging = true; setOpen(true); }
  function dragEnd() { dragging = false; if (!hovering) scheduleClose(); }
  function resize() {
    if (!root?.isConnected) return;
    const top = root.getBoundingClientRect().top + (env.scrollY ?? 0);
    root.style.setProperty('--fusion-height', `${Math.max(420, env.innerHeight - top - 8)}px`);
  }
  function detach() {
    clear();
    drawer?.removeEventListener('pointerenter', enter); drawer?.removeEventListener('pointerleave', leave);
    drawer?.removeEventListener('focusin', focusIn); drawer?.removeEventListener('focusout', focusOut);
    root?.removeEventListener('click', click); root?.removeEventListener('keydown', keydown);
    root?.removeEventListener('dragstart', dragStart); root?.removeEventListener('dragend', dragEnd);
    env.removeEventListener?.('resize', resize);
  }
  return {
    mount(element) {
      const nextDrawer = element?.querySelector('[data-fusion-drawer]') ?? null;
      if (root !== element || drawer !== nextDrawer) {
        detach(); root = element; drawer = nextDrawer; open = hovering = dragging = false;
        drawer?.addEventListener('pointerenter', enter); drawer?.addEventListener('pointerleave', leave);
        drawer?.addEventListener('focusin', focusIn); drawer?.addEventListener('focusout', focusOut);
        root?.addEventListener('click', click); root?.addEventListener('keydown', keydown);
        root?.addEventListener('dragstart', dragStart); root?.addEventListener('dragend', dragEnd);
        if (root) env.addEventListener?.('resize', resize);
      }
      if (root?.classList.contains('phase-scanning')) open = false;
      sync(); resize();
    },
    close,
    destroy() { detach(); root = drawer = null; },
  };
}

// Cancelling presentation never cancels or repeats the server mutation.
export function createEnhancementPresentation(env = globalThis, enabled = () => true) {
  let skipped = false, finish = null;
  function skip() { skipped = true; finish?.(); }
  const visibility = () => { if (env.document?.hidden) skip(); };
  const media = env.matchMedia?.('(prefers-reduced-motion: reduce)');
  const preferenceChanged = () => { if (!enabled()) skip(); };
  env.document?.addEventListener('visibilitychange', visibility);
  media?.addEventListener?.('change', preferenceChanged);
  return {
    get skipped() { return skipped; },
    start() { finish?.(); skipped = !enabled() || Boolean(env.document?.hidden); },
    skip,
    wait(ms) {
      if (skipped || !enabled() || env.document?.hidden || ms <= 0) return Promise.resolve();
      return new Promise(resolve => {
        const timer = env.setTimeout(() => done(), ms);
        function done() { env.clearTimeout(timer); if (finish === done) finish = null; resolve(); }
        finish = done;
      });
    },
    destroy() { skip(); env.document?.removeEventListener('visibilitychange', visibility); media?.removeEventListener?.('change', preferenceChanged); },
  };
}
