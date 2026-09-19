import { FORMATION_LINE_KEYS, formationRoleZones } from '../../formation-rules.js';
import { ROLE_LABELS } from '../../shared/football/labels.js';
import { FORMATION_RESEARCH_DIRECTIONS as directions, FORMATION_RESEARCH_POINTS as points, normalizeFormationResearchSlots, analyzeResearchFormation, limitFormationPoint, moveResearchFormationLine, researchProgress, researchRemainingTime } from '../../shared/config/formation-research.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lineLabels={attack:'前场线',midfield:'中场线',defense:'后场线',goalkeeper:'门将线'};
const pitchLines=()=>`<svg class="formation-pitch-markings" viewBox="0 0 100 132" aria-hidden="true"><rect x="3" y="3" width="94" height="126" rx=".3"/><path d="M3 66H97 M23 3V23H77V3 M36 3V12H64V3 M23 129V109H77V129 M36 129V120H64V129"/><circle cx="50" cy="66" r="9.15"/><path d="M42.65 23 A9.15 9.15 0 0 0 57.35 23 M42.65 109 A9.15 9.15 0 0 1 57.35 109"/><circle class="pitch-spot" cx="50" cy="66" r=".55"/><circle class="pitch-spot" cx="50" cy="17.5" r=".55"/><circle class="pitch-spot" cx="50" cy="114.5" r=".55"/></svg>`;
function thumbnail(slot){return `<span class="formation-slot-pitch" aria-hidden="true"><i class="formation-mini-half"></i>${points.map(id=>`<i style="left:${slot.positions[id].x}%;top:${slot.positions[id].y}%"></i>`).join('')}</span>`;}
export function createFormationResearchController({root,storage,playerId,getState,campaignStore,getRequest}){
 const key=`yellowdogs-custom-formation-research-v1:${playerId}`;
 let slots;try{slots=normalizeFormationResearchSlots(JSON.parse(storage?.getItem(key)??'null'));}catch{slots=normalizeFormationResearchSlots();}
 let active=null,drag=null,busy=false,disposed=false,serverOffset=0;
 const events=new AbortController(),options={signal:events.signal};
 const $=s=>root.querySelector(s),slot=()=>slots[active];
 const server=()=>getState()?.formationResearch;
 function merge(){const value=server();serverOffset=(value?.serverNow??Date.now())-Date.now();for(let i=0;i<3;i++){const saved=value?.slots?.[i];if(saved?.confirmedAt!=null)slots[i]={...structuredClone(saved),direction:slots[i].direction,showZones:slots[i].showZones};}}
 merge();
 async function action(kind){
  if(busy)return;const selected=slot(),id=selected.id,account=playerId;busy=true;updateDirection();
  try{
   const value=await getRequest()('/api/campaign/research/'+kind,{method:'POST',body:{revision:server().revision,slotId:id,direction:selected.direction,formation:selected,name:$('[data-formation-name]')?.value,jobId:server().active?.id}});
   if(getState()?.playerId!==account)return;
   campaignStore.setState(value.state,{source:'formation-research'});merge();if(!disposed){render();status(kind==='rename'?'阵型名称已保存':kind==='confirm'?'阵型已确定，站位已锁定':kind==='start'?'研究已开始':'研究已中止');}
  }catch(error){if(!disposed)status(error.message||'操作失败，请重试');}finally{busy=false;if(!disposed)updateDirection();}
 }
 function persist(message='已保存到当前浏览器'){
  try{if(!storage)throw Error();storage.setItem(key,JSON.stringify(slots));status(message);}catch{status('保存失败，请检查浏览器存储空间');}
 }
 function status(text){const host=$('[data-formation-status]');if(host)host.textContent=text;}
 function render(){
  if(active===null){root.innerHTML=`<section class="formation-slots"><h2>自定义阵型</h2><div class="formation-slot-list">${slots.map((s,i)=>`<button type="button" data-formation-slot="${i}">${thumbnail(s)}<h3>${esc(s.name)}</h3><span>${s.configured?analyzeResearchFormation(s).name:'设定阵型'}</span></button>`).join('')}</div></section>`;return;}
  const s=slot();root.innerHTML=`<section class="formation-editor"><header class="formation-editor-header"><button type="button" data-formation-slots-back>← 槽位</button><input data-formation-name aria-label="阵型名称" maxlength="24" value="${esc(s.name)}" ><button type="button" data-formation-save ${s.confirmedAt!=null?'disabled':''}>${s.confirmedAt!=null?'阵型已锁定':'确定阵型'}</button>${s.confirmedAt!=null?'<button type="button" data-formation-rename>保存名称</button>':''}</header><div class="formation-editor-columns"><div class="formation-board-panel"><div class="formation-board-toolbar"><span>识别阵型 <strong data-formation-shape></strong></span><label><input type="checkbox" data-formation-zones ${s.showZones?'checked':''}>位置阴影</label></div><div class="research-formation-board ${s.confirmedAt!=null?'is-locked':''}" aria-label="自定义阵型战术板">${pitchLines()}<div data-formation-zone-layer></div>${FORMATION_LINE_KEYS.map(k=>`<button type="button" class="formation-reference-line line-${k}" data-research-line="${k}" aria-label="拖动${lineLabels[k]}" title="${lineLabels[k]} · 拖动或使用上下方向键"><i></i><span>${lineLabels[k]}</span></button>`).join('')}${points.map((id,i)=>`<button type="button" class="formation-point" data-formation-point="${id}" aria-label="移动 ${i+2} 号位置"><b>${i+2}</b><span></span></button>`).join('')}<span class="formation-point formation-keeper" aria-label="固定门将"><b>1</b><span>GK</span></span></div><p data-formation-status role="status">${s.confirmedAt!=null?'研究成果绑定此阵型':'确定阵型后锁定站位'}</p></div><aside class="formation-directions-panel"><header><h2>研究方向</h2><span data-formation-summary></span></header>${['组织','进攻','防守'].map(group=>`<section class="formation-direction-group"><h3>${group}</h3><div>${directions.filter(d=>d.group===group).map(d=>`<button type="button" data-formation-direction="${d.id}"><span>${d.label}</span><b data-direction-bonus="${d.id}"></b></button>`).join('')}</div></section>`).join('')}<section class="formation-research-detail" data-formation-detail></section></aside></div></section>`;
  updateBoard();updateDirection();
 }
 function updateBoard(){
  const s=slot(),analysis=analyzeResearchFormation(s);$('[data-formation-shape]').textContent=analysis.name;
  $('[data-formation-zone-layer]').innerHTML=s.showZones?`<div class="formation-role-zones" aria-label="位置自动识别区域">${formationRoleZones(s.lines).map(z=>`<span class="formation-role-zone role-${z.role.toLowerCase()}" style="left:${z.xMin}%;top:${z.yMin}%;width:${z.xMax-z.xMin}%;height:${z.yMax-z.yMin}%"><b>${z.role}</b><small>${ROLE_LABELS[z.role]??z.role}</small></span>`).join('')}</div>`:'';
  for(const id of points){const el=$(`[data-formation-point="${id}"]`),p=s.positions[id];el.style.left=p.x+'%';el.style.top=p.y+'%';el.querySelector('span').textContent=analysis.roles[id];el.setAttribute('aria-label',`移动 ${points.indexOf(id)+2} 号位置，${ROLE_LABELS[analysis.roles[id]]??analysis.roles[id]}`);}
  for(const k of FORMATION_LINE_KEYS)$(`[data-research-line="${k}"]`).style.top=s.lines[k]+'%';
 }
 function updateDirection(){
  if(active===null||!$('[data-formation-detail]'))return;
  const s=slot(),d=directions.find(d=>d.id===s.direction),level=s.levels?.[d.id]??0,confirmed=s.confirmedAt!=null,job=server()?.active;
  const mine=job?.slotId===s.id&&job?.direction===d.id,progress=mine?researchProgress(job,Date.now()+serverOffset):null;
  for(const el of root.querySelectorAll('[data-formation-direction]')){el.disabled=!confirmed||busy;el.setAttribute('aria-pressed',String(confirmed&&el.dataset.formationDirection===d.id));const bonus=s.levels?.[el.dataset.formationDirection]??0;el.querySelector('b').textContent=bonus?`+${bonus}%`:'';}
  $('[data-formation-summary]').textContent=confirmed?'已确定阵型':'待确定阵型';
  if(!confirmed){$('[data-formation-detail]').innerHTML='<div class="formation-research-locked">先确定左侧阵型</div>';return;}
  const detailKey=JSON.stringify([s.id,d.id,level,job?.id,busy,server()?.requirements]);
  const host=$('[data-formation-detail]');
  if(host.dataset.key!==detailKey){
   host.dataset.key=detailKey;
   host.innerHTML=`<div class="formation-detail-heading"><h3>${d.label}</h3></div><p>${d.effect}</p>
    <div class="formation-level-comparison"><div><span>当前等级</span><b>Lv.${level}</b><strong>+${level}%</strong></div>
     <svg class="formation-upgrade-arrow" viewBox="0 0 56 40" aria-label="升级至"><path d="M4 20H49 M34 5L49 20L34 35"/></svg>
     <div class="formation-next-level"><span>${level<5?'下一等级':'已满级'}</span><b>Lv.${Math.min(5,level+1)}</b><strong>+${Math.min(5,level+1)}%</strong></div></div>
    ${level<5?`<div class="formation-research-requirement"><span>科技需求</span><b>${mine?job.required:server()?.requirements?.[level]??'—'}</b></div>`:''}
    <div data-formation-job-progress>${mine?`<div class="formation-progress-labels"><span data-research-work></span><b data-research-percent></b></div><div class="formation-progress-track" role="progressbar" aria-label="研究进度" aria-valuemin="0" aria-valuemax="100"><i></i></div>`:''}</div>
    ${level<5?'<div class="formation-research-timing"><span data-research-speed></span><span data-research-time></span></div>':''}
    <div class="formation-research-actions"><button type="button" class="research-start" data-formation-start ${busy||level>=5||job?'disabled':''}>${level>=5?'已达最高等级':mine?'研究中':job?'其他方向研究中':'开始研究'}</button>${mine?`<button type="button" class="formation-cancel" data-formation-cancel ${busy?'disabled':''}>中止研究</button>`:''}</div>`;
  }
  if(level<5){
   const rate=mine?(job.sciencePerMinute??(job.sciencePerHour??0)/60):(server()?.sciencePerMinute??(server()?.sciencePerHour??0)/60);
   $('[data-research-speed]').textContent=`科技 ${Number(rate.toFixed(2))}/分钟`;
   const estimate=rate>0?(server()?.requirements?.[level]??0)/rate*60000:null;
   $('[data-research-time]').textContent=progress?researchRemainingTime(progress.remaining):job?'':researchRemainingTime(estimate).replace('剩余','预计');
  }
  if(progress){
   $('[data-research-work]').textContent=`${progress.completed.toFixed(1)} / ${job.required}`;
   $('[data-research-percent]').textContent=`${Math.floor(progress.percent)}%`;
   const bar=$('.formation-progress-track');bar.setAttribute('aria-valuenow',String(Math.floor(progress.percent)));bar.querySelector('i').style.width=progress.percent+'%';
  }
 }
 root.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;
  if(el.hasAttribute('data-formation-slot')){active=Number(el.dataset.formationSlot);render();}
  if(el.hasAttribute('data-formation-slots-back')){active=null;render();}
  if(el.hasAttribute('data-formation-save')&&slot().confirmedAt==null){action('confirm');}
  if(el.hasAttribute('data-formation-rename'))action('rename');
  if(el.hasAttribute('data-formation-start'))action('start');
  if(el.hasAttribute('data-formation-cancel')&&confirm('中止本级研究？本级进度将清零，已完成等级保留。'))action('cancel');
  if(el.dataset.formationDirection&&slot().confirmedAt!=null){slot().direction=el.dataset.formationDirection;updateDirection();persist();}
 },options);
 root.addEventListener('input',e=>{if(e.target.matches('[data-formation-name]')&&slot().confirmedAt==null){slot().name=e.target.value.trim().slice(0,24)||`自定义阵型 ${active+1}`;persist();}},options);
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-formation-name]')&&slot().confirmedAt==null){slot().name=e.target.value.trim().slice(0,24)||`自定义阵型 ${active+1}`;e.target.value=slot().name;persist();}
  if(e.target.matches('[data-formation-zones]')){slot().showZones=e.target.checked;updateBoard();persist();}
 },options);
 function move(el,x,y){
  if(slot().confirmedAt!=null)return;
  if(el.dataset.formationPoint)slot().positions[el.dataset.formationPoint]=limitFormationPoint({x,y},slot().lines);
  else moveResearchFormationLine(slot(),el.dataset.researchLine,y);
  slot().configured=true;updateBoard();
 }
 root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-formation-name]')&&slot().confirmedAt!=null){e.preventDefault();action('rename');return;}const el=e.target.closest('[data-formation-point],[data-research-line]');if(!el||slot().confirmedAt!=null||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const p=el.dataset.formationPoint?slot().positions[el.dataset.formationPoint]:{x:0,y:slot().lines[el.dataset.researchLine]},step=e.shiftKey?5:1;move(el,p.x+({ArrowLeft:-step,ArrowRight:step}[e.key]??0),p.y+({ArrowUp:-step,ArrowDown:step}[e.key]??0));persist();},options);
 root.addEventListener('pointerdown',e=>{
  const el=e.target.closest('[data-formation-point],[data-research-line]');if(!el||e.button!==0||drag||slot().confirmedAt!=null)return;e.preventDefault();
  const board=$('.research-formation-board').getBoundingClientRect(),p=el.dataset.formationPoint?slot().positions[el.dataset.formationPoint]:{x:0,y:slot().lines[el.dataset.researchLine]};
  drag={el,id:e.pointerId,board,offsetX:(e.clientX-board.left)/board.width*100-p.x,offsetY:(e.clientY-board.top)/board.height*100-p.y,before:structuredClone(slot())};el.setPointerCapture(e.pointerId);el.classList.add('is-dragging');
 },options);
 root.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;move(drag.el,(e.clientX-drag.board.left)/drag.board.width*100-drag.offsetX,(e.clientY-drag.board.top)/drag.board.height*100-drag.offsetY);},options);
 function endDrag(e){if(!drag||e.pointerId!==drag.id)return;const current=drag;drag=null;current.el.classList.remove('is-dragging');if(e.type==='pointercancel'){slots[active]=current.before;updateBoard();}else persist();if(current.el.hasPointerCapture(current.id))current.el.releasePointerCapture(current.id);}
 root.addEventListener('pointerup',endDrag,options);root.addEventListener('pointercancel',endDrag,options);root.addEventListener('lostpointercapture',endDrag,options);
 const unsubscribe=campaignStore.subscribe(()=>{if(getState()?.playerId!==playerId)return;const was=active===null?null:slot().confirmedAt;merge();if(active!==null&&slot().confirmedAt!==was){drag=null;render();}else updateDirection();});
 const timer=setInterval(updateDirection,1000);
 render();
 return {back(){if(active===null)return false;active=null;render();return true;},dispose(){disposed=true;unsubscribe();clearInterval(timer);if(drag){slots[active]=drag.before;drag=null;}events.abort();}};
}
