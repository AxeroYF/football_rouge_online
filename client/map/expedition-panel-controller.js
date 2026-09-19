import { buildAccountMatchSeat, defaultStartingEleven } from '../../shared/football/account-match-seat.mjs';
import { autoCompletePlayerSquads } from '../../shared/config/player-squads.mjs';
import { representativePlayers } from '../../shared/config/representative-players.mjs';
import { analyzeElevenBoardFormation } from '../../formation-rules.js';
import { TACTIC_LABELS, PLAY_STYLE_LABELS, ROLE_LABELS, LINE_LABELS } from '../../shared/football/labels.js';
import { expeditionArtIcon } from '../../shared/config/expedition-art.mjs';

const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const label=(labels,key)=>labels[key]??key??'未设置';
function currentFitness(player){
 const value=Number(player.state?.fitness??player.fitness??100);
 return Number.isFinite(value)?Math.round(Math.max(0,Math.min(100,value))):null;
}
export function expeditionPanelView(state,{territoryLabel=id=>id}={}){
 const piece=state?.expeditionPiece;
 if(!state?.playerId||!state.setupComplete||!piece?.territoryId)return null;
 // Inspect the expedition using server fitness by card instance, independent of the open tactics tab.
 const liveFitness=state.expeditionFitness?.players??{};
 const roster=(state.draft?.roster??[]).map(player=>{
  const value=liveFitness[player.id]?.fitness;
  return typeof value==='number'&&Number.isFinite(value)?{...player,state:{...player.state,fitness:value},fitness:value}:player;
 });
 const tactics=state.tactics??{};
 const expeditionTactics=tactics.squads??{expedition:tactics.activeSquadId==='garrison'?{}:tactics};
 const inspection={...state,draft:{...state.draft,roster},tactics:{...tactics,squads:expeditionTactics}};
 let seat=null,error='',players=[],roles={},formation='待设置';
 try{
  seat=buildAccountMatchSeat({...inspection,id:state.playerId},'expedition',Date.now(),{fitness:true,allowShortHanded:true});
  const analysis=analyzeElevenBoardFormation(seat.players.filter(p=>p.active!==false),seat.positions,seat.formationLines);
  players=seat.players.filter(p=>p.active!==false);roles=analysis.roles;formation=analysis.name;
 }catch(reason){
  error=reason.message||'首发阵容暂不可用';
  const saved=inspection.tactics.squads.expedition,ids=saved?.planSnapshots?.__s4V2?.starters??saved?.starters;
  const completed=autoCompletePlayerSquads(state.playerSquads,roster,{allowTransfers:false});
  const eligible=representativePlayers(roster).filter(p=>completed.playerSquads.assignments[p.id]==='expedition');
  players=Array.isArray(ids)?[...new Set(ids)].map(id=>eligible.find(p=>p.id===id)).filter(Boolean).slice(0,11):defaultStartingEleven(eligible);
  formation=saved?.formation??'待设置';
 }
 if(error){try{seat=buildAccountMatchSeat({...inspection,id:state.playerId},'expedition');roles=analyzeElevenBoardFormation(players,seat.positions,seat.formationLines).roles;}catch{}}
 const saved=inspection.tactics.squads.expedition,opening=saved?.planSnapshots?.__s4V2?.tacticalPlans?.opening??saved?.planSnapshots?.opening;
 const tactic=seat?.tactic??opening?.tactic??saved?.attackStyle??'balanced',style=seat?.style??opening?.style??saved?.defenseStyle??'possession';
 const moving=Boolean(piece.moving),disabled=moving||Boolean(state.activeChallengeId),reason=moving?'远征队正在行军，抵达后可再次移动。':state.activeChallengeId?'地块挑战进行中，暂时无法移动。':'';
 return {
  name:state.draft?.teamName??state.nickname??'我的俱乐部',icon:expeditionArtIcon(piece.tokenId),
  location:moving?`${territoryLabel(piece.movement?.fromTerritoryId??piece.territoryId)} → ${territoryLabel(piece.movement?.toTerritoryId)}`:territoryLabel(piece.territoryId),
  rotations:seat?.rotations??[],redline:seat?.fitnessThreshold??65,recovery:state.expeditionFitness?.players?.[players[0]?.id]?.recoveryPerMinute??0.5,
  availabilityWarning:!error&&players.length<7?'可出场球员不足 7 人，本回合将判负。':!error&&players.length<11?'伤停球员已排除，本回合将以现有人数出场。':'',
  status:moving?'行军中':'驻扎中',formation,tactic:label(TACTIC_LABELS,tactic),style:label(PLAY_STYLE_LABELS,style),error,
  players:players.map(p=>({id:p.id,name:p.name??p.id,role:roles[p.id]??p.role??p.pool,roleLabel:ROLE_LABELS[roles[p.id]??p.role]??LINE_LABELS[p.pool]??p.role??'球员',overall:Number.isFinite(Number(p.effectiveOverall??p.overall))?Math.round(Number(p.effectiveOverall??p.overall)):null,fitness:currentFitness(p),captain:p.id===seat?.captainId})),
  actions:[{id:'move',label:'移动',disabled,reason}],
 };
}
export function expeditionPanelMarkup(view){
 if(!view)return '';
 return `<header class="expedition-panel-header"><div><span>远征编队</span><h2 id="expedition-panel-title">远征队</h2></div><button type="button" data-expedition-panel-close aria-label="关闭远征队界面">×</button></header>
 <div class="expedition-panel-identity"><img src="${esc(view.icon)}" alt=""><div><strong>${esc(view.name)}</strong><span class="expedition-panel-status">${esc(view.status)}</span><p title="${esc(view.location)}">${esc(view.location)}</p></div></div>
 <section class="expedition-panel-tactics" aria-label="开场阵型与打法"><div><span>阵型</span><strong data-expedition-formation>${esc(view.formation)}</strong></div><div><span>心态</span><strong data-expedition-tactic>${esc(view.tactic)}</strong></div><div><span>打法</span><strong data-expedition-style>${esc(view.style)}</strong></div></section>
 <div class="expedition-panel-roster-heading"><h3>出征首发预览</h3><span>${view.players.length} / 11 人</span></div>
 ${view.availabilityWarning?`<p class="expedition-panel-notice" role="status">${esc(view.availabilityWarning)}</p>`:''}<p class="expedition-panel-notice" data-fitness-summary>红线 ${esc(view.redline)} · ${view.recovery>0?`恢复 +${esc(view.recovery)}/分`:'比赛中暂停恢复'}</p>${view.rotations.length?`<p class="expedition-panel-notice" data-fitness-rotations>${view.rotations.map(r=>(r.inId?esc(r.inName)+' 替换 '+esc(r.outName):esc(r.outName)+' 缺阵')+'（'+esc(r.reason)+'）').join('；')}</p>`:''}<div class="expedition-panel-roster" tabindex="0" aria-label="远征首发名单，可滚动"><div class="expedition-panel-roster-columns" aria-hidden="true"><span>球员</span><span>总评</span><span>体力</span></div>${view.error?`<p class="expedition-panel-notice" role="status">${esc(view.error)}</p>`:''}<ol>${view.players.map(p=>`<li data-expedition-player-id="${esc(p.id)}"><span class="expedition-player-role" title="${esc(p.roleLabel)}">${esc(p.role)}</span><strong title="${esc(p.name)}">${esc(p.name)}</strong>${p.captain?'<span class="expedition-player-captain" title="队长" aria-label="队长">C</span>':''}<span class="expedition-player-rating" aria-label="总评 ${esc(p.overall??'未知')}">${esc(p.overall??'—')}</span><span class="expedition-player-fitness" data-expedition-fitness aria-label="体力 ${esc(p.fitness??'未知')}" title="当前体力 ${esc(p.fitness??'未知')}">${esc(p.fitness??'—')}</span></li>`).join('')}${Array.from({length:Math.max(0,11-view.players.length)},()=>'<li class="expedition-player-vacant"><span>—</span><strong>首发空缺</strong></li>').join('')}</ol></div>
 <footer class="expedition-panel-footer"><div class="expedition-panel-actions" aria-label="远征队操作">${view.actions.map(a=>`<button type="button" data-expedition-action="${esc(a.id)}" ${a.disabled?'disabled':''}>${esc(a.label)}</button>`).join('')}</div>${view.actions.some(a=>a.reason)?`<p>${esc(view.actions.find(a=>a.reason).reason)}</p>`:''}</footer>`;
}
export function createExpeditionPanelController({root,mapElement,getState,campaignStore,onOpen=()=>{},onMove=()=>false,territoryLabel=id=>id}={}){
 let opened=false,previousMarkup='',ownerId=null;
 const documentRef=root.ownerDocument;
 function render(){
  if(!opened)return;
  const view=expeditionPanelView(getState(),{territoryLabel});
  if(!view){close();return;}
  const markup=expeditionPanelMarkup(view);if(markup===previousMarkup)return;
  const scroll=root.querySelector('.expedition-panel-roster')?.scrollTop??0;
  const focus=documentRef.activeElement,action=root.contains(focus)?focus.dataset?.expeditionAction:null,wasClose=root.contains(focus)&&focus.hasAttribute?.('data-expedition-panel-close');
  root.innerHTML=markup;previousMarkup=markup;
  const roster=root.querySelector('.expedition-panel-roster');if(roster)roster.scrollTop=scroll;
  if(action)root.querySelector(`[data-expedition-action="${action}"]`)?.focus();else if(wasClose)root.querySelector('[data-expedition-panel-close]')?.focus();
 }
 function open(){
  if(!expeditionPanelView(getState(),{territoryLabel}))return false;
  onOpen();ownerId=getState().playerId;opened=true;root.hidden=false;root.setAttribute('aria-hidden','false');render();root.querySelector('[data-expedition-panel-close]')?.focus({preventScroll:true});return true;
 }
 function close({restoreFocus=false}={}){
  if(!opened)return false;
  opened=false;ownerId=null;root.hidden=true;root.setAttribute('aria-hidden','true');
  if(restoreFocus)documentRef.querySelector('.expedition-piece-token')?.focus({preventScroll:true});return true;
 }
 const onClick=event=>{
  if(event.target.closest?.('[data-expedition-panel-close]')){close({restoreFocus:true});return;}
  const button=event.target.closest?.('[data-expedition-action]');if(!button||button.disabled)return;
  if(button.dataset.expeditionAction==='move'){
   const action=expeditionPanelView(getState(),{territoryLabel})?.actions.find(a=>a.id==='move');
   if(!action||action.disabled){render();return;}
   if(onMove())close();
  }
 };
 const onKey=event=>{if(!opened||event.defaultPrevented||event.key!=='Escape'||mapElement?.closest('.map-stage')?.classList.contains('has-stage-window'))return;close({restoreFocus:true});event.preventDefault();};
 root.addEventListener('click',onClick);documentRef.addEventListener('keydown',onKey);
 const unsubscribe=campaignStore.subscribe(({state})=>{if(!opened)return;if(state?.playerId!==ownerId||!state?.expeditionPiece?.territoryId||!state.setupComplete){close();return;}render();});
 return Object.freeze({open,close,render,isOpen:()=>opened,destroy(){close();unsubscribe();root.removeEventListener('click',onClick);documentRef.removeEventListener('keydown',onKey);}});
}
