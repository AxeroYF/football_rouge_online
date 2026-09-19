// Shared browser/WebView presentation. No game state or server mutations.
const media=matchMedia('(max-width:1100px) and (max-height:600px) and (orientation:landscape)');
const root=document.documentElement,nav=document.querySelector('.primary-nav'),menu=document.querySelector('#mobile-menu-toggle'),tools=document.querySelector('.campaign-minimap-panel'),toolsButton=tools?.querySelector('.mobile-map-tools');
const players=document.querySelector('#server-players'),notices=document.querySelector('#campaign-notifications');
let entered=false,scheduled=false,tacticsTab="lineup",pitchExpanded=false,observedBoard=null;
function fitPitch(){if(!media.matches||!observedBoard?.isConnected||!observedBoard.clientHeight)return;const scale=Math.min(.8,(observedBoard.clientHeight-14)/600,(observedBoard.clientWidth-14)/480);root.style.setProperty('--mobile-pitch-zoom',String(Math.max(.15,scale)));}
const pitchResize=new ResizeObserver(fitPitch);
function closeMenu(){root.classList.remove('mobile-menu-open');menu?.setAttribute('aria-expanded','false');}
function collapsePlayers(){const b=players?.querySelector('[data-players-toggle][aria-expanded="true"]');b?.click();}
function collapseNotices(){const b=notices?.querySelector('[data-notification-toggle][aria-expanded="true"]');b?.click();}
function closeTools(){tools?.classList.remove('mobile-tools-open');toolsButton?.setAttribute('aria-expanded','false');}
function fit(){
 root.classList.toggle('is-compact-landscape',media.matches);
 if(media.matches){
  // Pinch zoom changes visualViewport.height too; do not relayout on page zoom.
  const viewport=window.visualViewport;
  const height=viewport&&Math.abs(viewport.scale-1)<.05?viewport.height:innerHeight;
  root.style.setProperty('--mobile-viewport-height',Math.round(height)+'px');
  root.style.setProperty('--mobile-pitch-zoom',String(Math.max(.22,Math.min(.8,(height-98)/600))));
  if(!entered){collapsePlayers();collapseNotices();closeTools();window.scrollTo(0,0);entered=true;}
 }else{root.style.removeProperty('--mobile-viewport-height');closeMenu();closeTools();entered=false;}
}
menu?.addEventListener('click',()=>{const open=!root.classList.contains('mobile-menu-open');closeMenu();if(open){collapsePlayers();collapseNotices();closeTools();root.classList.add('mobile-menu-open');menu.setAttribute('aria-expanded','true');}});
nav?.addEventListener('click',e=>{if(e.target.closest('.nav-item'))closeMenu();});
toolsButton?.addEventListener('click',()=>{const open=!tools.classList.contains('mobile-tools-open');closeTools();if(open){tools.classList.add('mobile-tools-open');toolsButton.setAttribute('aria-expanded','true');collapsePlayers();collapseNotices();closeMenu();}});
document.addEventListener('click',e=>{
 if(!media.matches)return;
 if(e.isTrusted&&!e.target.closest('.primary-nav,#mobile-menu-toggle'))closeMenu();
 if(e.target.closest('[data-players-toggle]')?.getAttribute('aria-expanded')==='true'){collapseNotices();closeTools();}
 if(e.target.closest('[data-notification-toggle]')?.getAttribute('aria-expanded')==='true'){collapsePlayers();closeTools();}
 const tab=e.target.closest('[data-mobile-tactics-tab]');
 if(tab){tacticsTab=tab.dataset.mobileTacticsTab;decorate();}
 if(e.target.closest('[data-mobile-pitch-zoom]')){pitchExpanded=!pitchExpanded;decorate();}
 if(e.target.closest('[data-mobile-tactics-close]'))document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 const toggle=e.target.closest('[data-mobile-filter-toggle]');
 if(toggle){const shell=toggle.closest('.team-management-shell');const open=shell.classList.toggle('mobile-filters-open');toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'收起筛选':'筛选';}
},false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(media.matches&&(root.classList.contains('mobile-menu-open')||tools?.classList.contains('mobile-tools-open')))e.preventDefault();closeMenu();closeTools();}});
function decorate(){
 scheduled=false;
 const shell=document.querySelector('.team-management-shell'),heading=shell?.querySelector('header');
 if(heading&&!heading.querySelector('[data-mobile-filter-toggle]')){const b=document.createElement('button');b.type='button';b.className='mobile-only mobile-filter-toggle';b.dataset.mobileFilterToggle='';b.setAttribute('aria-expanded','false');b.textContent='筛选';heading.insertBefore(b,heading.lastElementChild);}
 const tactics=document.querySelector('#campaign-tactics .league-squad-page');
 if(tactics){
  const board=tactics.querySelector('.league-board-panel');if(board!==observedBoard){pitchResize.disconnect();observedBoard=board;if(board)pitchResize.observe(board);}
  tactics.dataset.mobileView=tacticsTab;tactics.classList.toggle('mobile-pitch-expanded',pitchExpanded);
  if(!tactics.querySelector('.mobile-tactics-nav')){
   const bar=document.createElement('nav');bar.className='mobile-only mobile-tactics-nav';bar.setAttribute('aria-label','战术工作区');
   bar.innerHTML='<button type="button" data-mobile-tactics-tab="lineup">阵容</button><button type="button" data-mobile-tactics-tab="controls">站位与羁绊</button><button type="button" data-mobile-tactics-tab="tactics">比赛战术</button><button type="button" data-mobile-pitch-zoom>放大编辑</button><button type="button" data-mobile-tactics-close aria-label="关闭战术板">返回地图</button>';
   tactics.prepend(bar);
  }
  tactics.querySelectorAll('[data-mobile-tactics-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mobileTacticsTab===tacticsTab)));
  const zoom=tactics.querySelector('[data-mobile-pitch-zoom]');const label=pitchExpanded?'全场预览':'放大编辑';if(zoom.textContent!==label)zoom.textContent=label;if(zoom.hidden!==(tacticsTab!=='lineup'))zoom.hidden=tacticsTab!=='lineup';fitPitch();
 }
 // Controllers render asynchronously; compact first-open HUD without fighting later user toggles.
 for(const [node,collapse]of [[players,collapsePlayers],[notices,collapseNotices]])if(media.matches&&node&&!node.hidden&&!node.dataset.mobileInitialized){node.dataset.mobileInitialized='true';collapse();}
}
const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(decorate);}});
observer.observe(document.querySelector('.map-stage'),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
media.addEventListener('change',fit);window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);fit();decorate();
