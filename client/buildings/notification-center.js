export function createNotificationCenter(root){
 const list=root.querySelector('#campaign-notification-list'),countNode=root.querySelector('[data-notification-count]'),toggle=root.querySelector('[data-notification-toggle]');
 const mapControls=root.ownerDocument.querySelector('.campaign-minimap-panel'),stage=root.closest('.map-stage');
 let collapsedScrollTop=0,restoreScrollTop=null,frame=null;
 const fitAvailableHeight=()=>{
  if(root.hidden)return;
  const bounds=root.getBoundingClientRect(),controls=mapControls?.getBoundingClientRect(),stageBounds=stage?.getBoundingClientRect();
  let bottom=Math.min(window.innerHeight,stageBounds?.bottom??window.innerHeight);
  if(controls?.height&&controls.right>bounds.left&&controls.left<bounds.right)bottom=Math.min(bottom,controls.top);
  const height=Math.max(44,Math.floor(bottom-bounds.top-12))+'px';
  if(root.style.getPropertyValue('--notification-available-height')!==height)root.style.setProperty('--notification-available-height',height);
 };
 const update=()=>{
  const count=[...list.children].reduce((n,group)=>n+(group.hidden?0:group.tagName==='SECTION'?group.children.length:1),0);
  root.hidden=count===0;if(countNode.textContent!==String(count))countNode.textContent=String(count);
  if(frame!==null)return;
  frame=requestAnimationFrame(()=>{frame=null;fitAvailableHeight();if(restoreScrollTop!==null&&!root.classList.contains("is-collapsed")){list.scrollTop=Math.min(restoreScrollTop,Math.max(0,list.scrollHeight-list.clientHeight));restoreScrollTop=null;}root.classList.toggle('is-scrollable',list.scrollHeight>list.clientHeight+1);});
 };
 // Only an explicit expand restores a saved offset; live updates never fight scrolling.
 const onToggle=()=>{if(!root.classList.contains('is-collapsed'))collapsedScrollTop=list.scrollTop;const collapsed=root.classList.toggle('is-collapsed');restoreScrollTop=collapsed?null:collapsedScrollTop;toggle.textContent=collapsed?'展开':'收起';toggle.setAttribute('aria-expanded',String(!collapsed));list.inert=collapsed;update();};toggle.addEventListener('click',onToggle);
 const observer=new MutationObserver(update);observer.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
 const resize=new ResizeObserver(update);resize.observe(list);if(mapControls)resize.observe(mapControls);if(stage)resize.observe(stage);window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);update();
 return {destroy(){observer.disconnect();resize.disconnect();window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);if(frame!==null)cancelAnimationFrame(frame);toggle.removeEventListener('click',onToggle);}};
}
