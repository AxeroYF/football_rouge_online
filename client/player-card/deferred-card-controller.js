// Keep lightweight, correctly sized card nodes in the grid; only nearby card bodies exist.
const SELECTOR = '[data-card-render]';
const SCROLL_ROOTS = '.enhancement-card-grid,.enhancement-history-scroll,[data-cmu-scroll],[data-cmu-pool-scroll],[data-cmm-scroll],[data-cm-content],.cm-dialog-body,.training-card-list,.backpack-card-grid';

export function createDeferredCardController({ document:doc, window:win=doc.defaultView, renderContent, chunkSize=6 } = {}) {
  const nodes=new Map(), groups=new Map(), queue=new Set();
  let frame=null, destroyed=false, dragged=null;
  const find=node=>node?.querySelectorAll ? [...(node.matches?.(SELECTOR)?[node]:[]),...node.querySelectorAll(SELECTOR)] : [];
  const schedule=()=>{if(!destroyed&&!doc.hidden&&queue.size&&frame===null)frame=win.requestAnimationFrame(flush);};
  function release(node) {
    if(!node.mounted || node.card===dragged)return;
    const surface=node.card.querySelector('.shield-card-surface');
    if(surface)surface.innerHTML='';
    node.card.removeAttribute('data-card-rendered');node.mounted=false;
  }
  function paint(node) {
    if(node.mounted||!node.card.isConnected)return;
    const surface=node.card.querySelector('.shield-card-surface');if(!surface)return;
    surface.innerHTML=renderContent(JSON.parse(node.card.dataset.cardRender));
    node.card.setAttribute('data-card-rendered','');node.mounted=true;
  }
  function flush() {
    frame=null;let painted=0;
    for(const node of queue){
      queue.delete(node);
      if(node.visible&&!doc.hidden&&node.card.isConnected){paint(node);if(++painted>=chunkSize)break;}
    }
    schedule();
  }
  function groupFor(root) {
    if(groups.has(root))return groups.get(root);
    const group={root,targets:new Set(),observer:null};
    if(win.IntersectionObserver)group.observer=new win.IntersectionObserver(entries=>{
      for(const entry of entries){const node=nodes.get(entry.target);if(!node)continue;
        node.visible=entry.isIntersecting;
        if(node.visible)queue.add(node);else{queue.delete(node);release(node);}
      }schedule();
    },{root,rootMargin:'320px 0px',threshold:0});
    groups.set(root,group);return group;
  }
  function add(card) {
    if(nodes.has(card)||!card.isConnected)return;
    const group=groupFor(card.closest(SCROLL_ROOTS));
    const node={card,group,visible:!group.observer,mounted:card.hasAttribute('data-card-rendered')};
    nodes.set(card,node);group.targets.add(card);
    if(group.observer)group.observer.observe(card);else queue.add(node);
  }
  function remove(card) {
    const node=nodes.get(card);if(!node||card.isConnected)return;
    queue.delete(node);if(dragged===card)dragged=null;release(node);
    node.group.observer?.unobserve(card);node.group.targets.delete(card);nodes.delete(card);
    if(!node.group.targets.size){node.group.observer?.disconnect();groups.delete(node.group.root);}
  }
  const observer=new win.MutationObserver(records=>{
    for(const record of records){
      // Hydrating a card never needs another subtree scan.
      if(record.target?.closest?.(SELECTOR))continue;
      for(const node of record.removedNodes)for(const card of find(node))remove(card);
      for(const node of record.addedNodes)for(const card of find(node))add(card);
    }schedule();
  });
  function targetCard(event){return event.target?.closest?.(SELECTOR) ?? event.target?.querySelector?.(SELECTOR);}
  function activate(event){const node=nodes.get(targetCard(event));if(node)paint(node);}
  function dragStart(event){dragged=targetCard(event)??null;activate(event);}
  function dragEnd(){const node=nodes.get(dragged);dragged=null;if(node&&!node.visible)release(node);}
  function visibility(){
    if(doc.hidden){if(frame!==null)win.cancelAnimationFrame(frame);frame=null;for(const node of nodes.values())release(node);}
    else{for(const node of nodes.values())if(node.visible)queue.add(node);schedule();}
  }
  for(const card of find(doc))add(card);schedule();
  observer.observe(doc.body??doc.documentElement,{childList:true,subtree:true});
  doc.addEventListener('pointerdown',activate,true);doc.addEventListener('focusin',activate,true);
  doc.addEventListener('dragstart',dragStart,true);doc.addEventListener('dragend',dragEnd,true);doc.addEventListener('visibilitychange',visibility);
  return {
    inspect:()=>({tracked:nodes.size,mounted:[...nodes.values()].filter(n=>n.mounted).length,queued:queue.size,observers:groups.size}),
    destroy(){destroyed=true;if(frame!==null)win.cancelAnimationFrame(frame);observer.disconnect();for(const g of groups.values())g.observer?.disconnect();
      doc.removeEventListener('pointerdown',activate,true);doc.removeEventListener('focusin',activate,true);doc.removeEventListener('dragstart',dragStart,true);doc.removeEventListener('dragend',dragEnd,true);doc.removeEventListener('visibilitychange',visibility);
      nodes.clear();groups.clear();queue.clear();},
  };
}

export function installDeferredCardController(renderContent,doc=globalThis.document) {
  const win=doc?.defaultView;if(!win?.MutationObserver||!win.requestAnimationFrame)return null;
  const key=Symbol.for('yellowdogs.deferred-card-controller');if(doc[key])return doc[key];
  if(!doc.body){doc.addEventListener('DOMContentLoaded',()=>installDeferredCardController(renderContent,doc),{once:true});return null;}
  return doc[key]=createDeferredCardController({document:doc,window:win,renderContent});
}
