// Local-only pointer drag: one lightweight ghost, at most one hit test per animation frame.
const suppress=new WeakMap(),installed=new WeakSet();
export function bindCardTransferDrag(panel,{cardSelector,columnSelector,canDrag,onDrop}){
 let active=null,frame=0,last=null;
 if(!installed.has(panel)){installed.add(panel);panel.addEventListener('click',e=>{if(Date.now()<(suppress.get(panel)??0)){e.preventDefault();e.stopImmediatePropagation();}},true);}
 function clear(){cancelAnimationFrame(frame);frame=0;active?.ghost?.remove();active?.card?.classList.remove('is-transfer-dragging');document.documentElement.classList.remove('team-card-drag-active');panel.querySelectorAll('.is-drop-target').forEach(e=>e.classList.remove('is-drop-target'));active=null;last=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);}
 function paint(){frame=0;if(!active||!last)return;if(!panel.isConnected||panel.hidden){clear();return;}
  const {x,y}=last;if(!active.ghost&&Math.hypot(x-active.x,y-active.y)<7)return;
  if(!active.ghost){
   const ghost=document.createElement('div');ghost.className='team-transfer-ghost';ghost.setAttribute('aria-hidden','true');ghost.inert=true;
   const source=active.card.querySelector('.s4-player-card');
   if(source){const art=source.cloneNode(true);art.classList.add('player-card-static');art.removeAttribute('id');art.removeAttribute('tabindex');art.querySelectorAll('canvas,.shield-card-motion,.shield-card-sheen').forEach(n=>n.remove());ghost.append(art);}
   else{const label=document.createElement('strong');label.textContent=active.card.querySelector('strong')?.textContent??'球员';ghost.append(label);}
   ghost.style.width=active.width+'px';ghost.style.height=active.height+'px';document.body.append(ghost);active.ghost=ghost;active.card.classList.add('is-transfer-dragging');document.documentElement.classList.add('team-card-drag-active');
  }
  // Keep the exact viewport-space grab point, including a handle above the card.
  // Clamping or shrinking the ghost changes that anchor near screen edges.
  active.ghost.style.transform=`translate3d(${x-active.offsetX}px,${y-active.offsetY}px,0)`;
  const target=document.elementFromPoint(x,y)?.closest(columnSelector);active.target=target&&panel.contains(target)?target:null;
  panel.querySelectorAll(columnSelector).forEach(e=>e.classList.toggle('is-drop-target',e===active.target));
  const list=active.target?.querySelector('.team-batch-list');if(list){const r=list.getBoundingClientRect();if(y<r.top+36)list.scrollTop-=12;else if(y>r.bottom-36)list.scrollTop+=12;}
 }
 function move(e){if(!active||e.pointerId!==active.pointerId)return;e.preventDefault();last={x:e.clientX,y:e.clientY};if(!frame)frame=requestAnimationFrame(paint);}
 function up(e){if(!active||e.pointerId!==active.pointerId)return;last={x:e.clientX,y:e.clientY};paint();const value=active;if(value?.ghost){e.preventDefault();suppress.set(panel,Date.now()+400);}clear();if(value?.ghost&&value.target)onDrop(value.card,value.target);}
 function cancel(e){if(e?.pointerId!=null&&active?.pointerId!==e.pointerId)return;clear();}
 function down(e){if(active||e.button!==0||e.isPrimary===false)return;const card=e.target.closest(cardSelector);if(!card||!canDrag(card))return;
  const handle=e.target.closest('[data-card-drag]');if(!handle&&(e.pointerType==='touch'||e.target.closest('button,input,select,a')))return;
  const source=card.querySelector('.s4-player-card')??card,rect=source.getBoundingClientRect();
  e.preventDefault();active={card,pointerId:e.pointerId,x:e.clientX,y:e.clientY,width:rect.width,height:rect.height,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top};window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
 }
 function nativeDrag(e){if(e.target.closest(cardSelector))e.preventDefault();}
 panel.addEventListener('pointerdown',down);panel.addEventListener('dragstart',nativeDrag);return ()=>{clear();panel.removeEventListener('pointerdown',down);panel.removeEventListener('dragstart',nativeDrag);};
}
