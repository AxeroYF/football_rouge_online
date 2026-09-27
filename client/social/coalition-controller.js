import {createRequestId} from '../core/request-id.js';
import {confirmPvpAttack} from '../challenge/pvp-confirmation.js';
import {cardWarehouseMarkup,bindWarehouseControls} from '../cards/social-card-warehouse.js';
import {patchMarkup} from '../ui/patch-markup.js';
import {attackCurfewState} from '../../shared/config/conquest.mjs';
import {oilMovementChoiceMarkup} from '../resources/oil-movement.js';
import {registerWideWindow,activateWideWindow,deactivateWideWindow} from '../ui/wide-window.js';
import {startCampaignBroadcastBackground,showCampaignBroadcast} from '../../campaign-broadcast.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCoalitionController({documentRef=document,getState,getRequest,campaignStore,mapElement,metadata,showToast,beforeOpen=()=>{},displayPointToSource,onOpenTactics=()=>{},onOpenAirport=()=>{}}){
 const root=documentRef.createElement('section');root.className='coalition-window';root.hidden=true;root.setAttribute('aria-label','联军管理');documentRef.body.append(root);
 const trigger=documentRef.createElement('button');trigger.className='nav-item';trigger.id='topbar-coalition';trigger.textContent='联军';trigger.hidden=!getState()?.setupComplete;documentRef.querySelector('.topbar .nav')?.append(trigger);
 if(!trigger.isConnected)documentRef.querySelector('#topbar-research')?.after(trigger);
 let confirming=false;
 let view=null,pending=false,tab='roster',rosterPane='mine',mode=null,quote=null,selected=null,seaRoute=null,live=null,ownerId=null,loadEpoch=0,quoteEpoch=0,compact=false,loading=false;
 const army=()=>view?.army;
 const territory=id=>{const t=metadata.get(id);return t?[t.country,t.name].filter(Boolean).join(' · '):id??'待部署';};
 const member=id=>view?.members?.find(m=>m.id===id)?.name??id;
 const command=()=>army()?.canCommand&&!army()?.busy;
 const button=(action,label,disabled=false,extra='')=>`<button type="button" data-coalition-action="${action}" ${disabled?'disabled':''} ${extra}>${label}</button>`;
 const elapsed=until=>Math.max(0,Math.ceil((until-(view?.serverNow??Date.now()))/60000));
 async function load(){
  if(loading||pending||root.hidden||documentRef.hidden)return;
  loading=true;const epoch=++loadEpoch,id=getState()?.playerId;
  try{const r=await getRequest()('/api/campaign/coalition?view=management');if(epoch!==loadEpoch||id!==getState()?.playerId||pending||root.hidden)return;view=r.view;ownerId=id;render();}
  catch(e){if(epoch===loadEpoch&&!root.hidden)showToast(e.message);}
  finally{loading=false;}
 }

 async function mutate(action,extra={}){
  if(pending)return;pending=true;loadEpoch++;root.setAttribute('aria-busy','true');root.querySelectorAll('button').forEach(b=>{b.disabled=true;});const id=getState()?.playerId;
  try{const result=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action,view:'management',requestId:createRequestId(),armyId:army()?.id,revision:army()?.revision,...extra}});if(id!==getState()?.playerId)return;view=result.view;const next=result.statePatch?{...getState(),...result.statePatch}:result.state;
   if(action==='cancel-move'&&result.statePatch&&next.world){const a=view?.army;next.world={...next.world,units:(next.world.units??[]).map(u=>u.coalitionId===a?.id?{...u,territoryId:a.territoryId,position:u.movement?.fromPosition??u.position,moving:false,movement:null}:u)};}
   campaignStore.setState(next,{source:action==='cancel-move'?'coalition-cancel':'coalition'});quote=null;return result;}
  catch(e){showToast(e.message);throw e;}finally{pending=false;root.removeAttribute('aria-busy');render();}
 }
 let allyCards=null,allyOwnerId=null,allyLoading=false,allyEpoch=0;
 const warehouses={};
 bindWarehouseControls(root,warehouses,render,()=>pending);
 async function loadAllyCards(ownerId){
  if(allyLoading&&allyOwnerId===ownerId)return;
  const epoch=++allyEpoch;allyOwnerId=ownerId;allyCards=null;allyLoading=true;render();
  try{const r=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action:'loan-cards',ownerId}});if(epoch===allyEpoch){allyCards=r.view;}}
  catch(e){showToast(e.message);}finally{if(epoch===allyEpoch){allyLoading=false;render();}}
 }
 function loanMarkup(){const a=army();
  const requests=(a.loanRequests??[]).filter(r=>r.status==='pending'&&(r.ownerId===getState()?.playerId||a.canCommand));
  return `<section class="coalition-loans"><h3>借调申请</h3>${requests.map(r=>`<article data-ui-key="loan-${esc(r.id)}"><span>${esc(member(r.ownerId))} · ${esc(r.playerName)}</span>${r.ownerId===getState()?.playerId?button('accept-loan','同意借调',pending||a.busy,`data-loan-request-id="${esc(r.id)}"`)+button('reject-loan','拒绝',pending,`data-loan-request-id="${esc(r.id)}"`):'<small>等待球员主人同意</small>'}</article>`).join('')||'<p>暂无待处理申请</p>'}${a.canCommand?`<h3>盟友球员仓库</h3><select data-loan-owner><option value="">选择盟友</option>${view.members.filter(m=>m.id!==getState()?.playerId).map(m=>`<option value="${esc(m.id)}" ${m.id===allyOwnerId?'selected':''}>${esc(m.name)}</option>`).join('')}</select>${allyLoading?'<p>加载球员…</p>':allyCards?cardWarehouseMarkup(allyCards.cards,{key:'coalition-ally-'+allyOwnerId,states:warehouses,pending,canOperate:p=>!p.blocked&&!p.loan&&!requests.some(r=>r.ownerId===allyOwnerId&&r.playerId===p.id),action:p=>button('request-loan',requests.some(r=>r.ownerId===allyOwnerId&&r.playerId===p.id)?'等待同意':'申请借调',pending||Boolean(p.blocked)||Boolean(p.loan)||requests.some(r=>r.ownerId===allyOwnerId&&r.playerId===p.id),`data-player-id="${esc(p.id)}" data-owner-id="${esc(allyOwnerId)}"`)}):''}`:''}</section>`;
 }
 root.addEventListener('change',e=>{if(e.target.matches('[data-loan-owner]')){if(e.target.value)loadAllyCards(e.target.value);else{allyEpoch++;allyCards=null;allyOwnerId=null;render();}}});
 function rosterMarkup(){const a=army(),starters=new Set(a.tactics?.starters??[]);
  return `<div class="coalition-roster-workspace" data-roster-pane="${rosterPane}"><div class="coalition-roster-tabs">${[['mine','我的球员'],['lineup','联军阵容'],['allies','盟友借调']].map(([id,label])=>button('roster-pane',label,false,`data-pane="${id}" aria-pressed="${rosterPane===id}"`)).join('')}</div>${loanMarkup()}<div class="coalition-columns"><section class="coalition-lineup"><h3>联军阵容 · ${a.roster.length}/18</h3>${cardWarehouseMarkup(a.roster.map(p=>({...p,ownerName:(p.ownerName??'')+(starters.has(p.id)?' · 首发':' · 替补')})),{key:'coalition-roster',states:warehouses,pending,canOperate:p=>a.loans.some(l=>JSON.stringify([l.ownerId,l.playerId])===p.id&&(l.ownerId===getState()?.playerId||a.canCommand)&&!l.withdrawRequested),action:p=>{const loan=a.loans.find(l=>JSON.stringify([l.ownerId,l.playerId])===p.id);return loan&&(loan.ownerId===getState()?.playerId||a.canCommand)?button(loan.ownerId===getState()?.playerId?'withdraw':'kick',loan.withdrawRequested?'待归队':loan.ownerId!==getState()?.playerId?(a.busy?'踢出后待归队':'踢出球员'):a.busy?'申请归队':'归队',pending||loan.withdrawRequested,`data-player-id="${esc(loan.playerId)}" data-owner-id="${esc(loan.ownerId)}"`):'';}})}<div class="coalition-buttons">${button('tactics','前往战术板')}</div></section><section class="coalition-mine"><h3>我的球员</h3><p>借调保留个人编队，期间由替补出场。</p>${cardWarehouseMarkup(view.myCards,{key:'coalition-mine',states:warehouses,pending,canOperate:p=>!a.busy&&!p.blocked&&!p.loan,action:p=>button('lend',p.loan?'已借调':'借调',pending||a.busy||Boolean(p.blocked)||Boolean(p.loan),`data-player-id="${esc(p.id)}" title="${esc(p.blocked??'')}"`)})}</section></div></div>`;
 }
 function quoteMarkup(){if(!quote)return '';return `<section class="coalition-quote"><h3>${quote.kind==='attack'?'确认出征':'确认移动'} · ${esc(territory(quote.toTerritoryId))}</h3>${quote.attackBond?`<p>进攻保证金：30000 金币 · 全体盟友均摊，下一步确认各自份额</p>`:''}<strong>预计 ${Math.ceil(quote.durationMs/60000)} 分钟 · 石油 ${quote.oilSpent}</strong>${quote.oilExempt?'':oilMovementChoiceMarkup(quote,'data-coalition-use-oil',pending)}<p>${quote.oilExempt?'进攻中立地块不消耗石油，按正常行军速度出发。':quote.useOil===false?'不耗石油 · 行军时间 ×4。':quote.oilShortage?'部分盟友库存不足：全体不扣油，行军时间 ×4。':'全体盟友均摊，余数轮流承担。出发扣除，不退还。'}</p><div class="coalition-shares">${quote.shares.map(s=>`<span>${esc(s.name)}：${quote.oilSpent>0?s.amount:0} / 库存 ${s.balance}</span>`).join('')}</div>${button('confirm-order','确认行动',!command()||pending||(quote.kind==='attack'&&Boolean(army().attackBlocked)))}${button('cancel-quote','返回')}</section>`;}
 function actionsMarkup(){const a=army(),p=a.proposal;return `<section><div class="coalition-buttons">${button('select-move','移动',!command()||!a.territoryId)}${button('airport','机场移动',!command()||!a.territoryId)}${a.movement&&a.movement.transport!=='airport'?button('cancel-move','取消行军',!a.canCommand):''}${button('select-target','进攻',!command()||Boolean(a.blocked)||Boolean(a.attackBlocked))}${button('select-coast','从驻地海岸出征',!command()||Boolean(a.blocked)||Boolean(a.attackBlocked))}${button('deploy','重新部署',!command()||Boolean(a.territoryId))}${a.activeChallengeId||a.lastChallengeId?button('watch',a.activeChallengeId?'观看联军比赛':'上一场战报'):''}</div>${a.waitingForCurfewUntil?'<p>已抵达，宵禁结束后于 08:00 尝试进攻。</p>':a.attackBlocked?`<p>${esc(a.attackBlocked)}</p>`:''}<p>进攻中立地块不消耗石油。其他用油行军由全体盟友均摊，也可选择不耗油慢速行军。占领地块消耗受益人的征服次数；每日基础总计8块，加上受益人的奇观额外次数，其中玩家地块最多4块，盟友借地授权仍有效。</p>${a.order?`<p>出征目标：${esc(territory(a.order.territoryId))} · 占领归属 ${esc(member(a.order.beneficiaryId))}</p>`:''}${selected?`<div class="coalition-quote"><h3>目标：${esc(territory(selected))}</h3><label>占领归属 <select data-beneficiary>${a.contributors.map(id=>`<option value="${esc(id)}">${esc(member(id))}</option>`).join('')}</select></label>${button('propose','提交目标',!command())}</div>`:''}${p?`<div class="coalition-quote"><h3>${esc(territory(p.territoryId))}</h3><p>占领归属：${esc(member(p.beneficiaryId))} · ${p.confirmed?'已确认':'等待受益人确认'}</p>${p.beneficiaryId===getState()?.playerId&&!p.confirmed?button('confirm-target','同意本次占领'):''}${button('estimate-attack','预览出征',!command()||!p.confirmed||Boolean(a.attackBlocked))}</div>`:''}${quoteMarkup()}${a.lastActionError?`<p role="alert">上次出征未能开战：${esc(a.lastActionError)}</p>`:''}</section>`;}
 function defenceMarkup(){return `<section class="coalition-defence-setting"><h3>我的领土防守</h3><label>防守阵容 <select data-coalition-defence ${pending?'disabled':''}><option value="coalition" ${view?.defencePreference!=='garrison'?'selected':''}>优先使用联军</option><option value="garrison" ${view?.defencePreference==='garrison'?'selected':''}>使用自己的留守队</option></select></label><p>联军无法出战时自动使用留守队。修改仅影响之后开始的防守比赛。</p></section>`;}
 root.addEventListener('change',async e=>{if(e.target.matches('[data-coalition-defence]')&&!pending){try{await mutate('defence-preference',{preference:e.target.value});}catch{}}});
 function managementMarkup(){const a=army();return `${defenceMarkup()}<section><h3>指挥权管理</h3><p>现任指挥官可直接移交；盟友也可申请接任，由现任指挥官确认。行军或比赛结束后才能移交。</p>${a.canCommand?`<label>移交给 <select data-transfer-commander>${view.members.filter(m=>m.id!==a.commanderId).map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>${button('transfer-command','直接移交指挥权',a.busy||pending||view.members.length<2)}`:button('request-command',(a.commandRequests??[]).some(r=>r.requesterId===getState()?.playerId&&r.commanderId===a.commanderId&&r.status==='pending'&&view.serverNow-r.createdAt<86400000)?'已申请，等待确认':'申请接任指挥官',pending||(a.commandRequests??[]).some(r=>r.requesterId===getState()?.playerId&&r.commanderId===a.commanderId&&r.status==='pending'&&view.serverNow-r.createdAt<86400000))}${a.canCommand?(a.commandRequests??[]).filter(r=>r.status==='pending'&&r.commanderId===a.commanderId&&view.members.some(m=>m.id===r.requesterId)&&view.serverNow-r.createdAt<86400000).map(r=>`<article data-ui-key="command-${esc(r.id)}"><strong>${esc(member(r.requesterId))}申请接任</strong>${button('accept-command','同意并移交',pending||a.busy,`data-command-request-id="${esc(r.id)}"`)}${button('reject-command','拒绝',pending,`data-command-request-id="${esc(r.id)}"`)}</article>`).join(''):''}<h3>成员表决与解散</h3><p>出人者过半数同意后生效，两位出人者需双方同意。行动期间不能变更。</p><label>指挥官候选 <select data-commander>${a.contributors.map(id=>`<option value="${esc(id)}">${esc(member(id))}</option>`).join('')}</select></label><div class="coalition-buttons">${button('vote-commander','支持移交指挥权',a.busy)}${button('vote-disband','支持解散联军',a.busy)}</div>${a.votes?`<p>当前表决：${a.votes.kind==='disband'?'解散联军':'移交给 '+esc(member(a.votes.targetId))} · ${a.votes.yes.length}/${a.votes.voters.length} 同意</p>`:''}<h3>石油分摊记录</h3><table><thead><tr><th>时间</th><th>行动</th><th>消耗</th><th>分摊</th></tr></thead><tbody>${[...(a.ledger??[])].reverse().map(l=>`<tr><td>${esc(new Date(l.at).toLocaleString('zh-CN'))}</td><td>${l.kind==='attack'?'出征':'移动'} · ${esc(territory(l.target))}</td><td>${l.total}${l.oilExempt?'（中立进攻免油）':l.useOil===false?'（慢速）':l.shortage?'（缺油）':''}</td><td>${l.shares.map(s=>`${esc(s.name??member(s.ownerId))} ${s.amount}`).join('、')}</td></tr>`).join('')||'<tr><td colspan="4">暂无消耗</td></tr>'}</tbody></table></section>`;}
 function render(){if(root.hidden)return;renderContent();root.querySelectorAll('[data-coalition-action="lend"],[data-coalition-action="withdraw"]').forEach(b=>{if(pending)b.disabled=true;});}
 function renderContent(){if(root.hidden)return;const a=army();root.classList.toggle('coalition-action-window',compact);if(compact&&a){patchMarkup(root,`<header><h2>${esc(a.name)}</h2>${button('close','关闭')}</header><div class="coalition-status"><span>驻地 ${esc(territory(a.territoryId))}</span><span>${a.waitingForCurfewUntil?'宵禁待命 · 08:00':a.movement?'行军中 · '+elapsed(a.movement.arrivesAt)+' 分钟':a.activeChallengeId?'比赛中':esc(a.blocked??'可以行动')}</span></div><main>${actionsMarkup()}</main><footer class="coalition-buttons">${button('manage','联军管理')}${button('tactics','战术板')}</footer>`);return;}patchMarkup(root,`<header><div><small>同盟协作</small><h2>${esc(a?.name??'联军')}</h2></div>${button('close','关闭')}</header>${!view?'<p>加载中…</p>':!a?`${defenceMarkup()}<section><h3>共同出人，联合出征</h3><p>每个同盟可组建一支联军，至少两位成员共同提供球员。</p><label>联军名称 <input data-army-name maxlength="20" value="联军"></label>${button('create','发起组建',view.members.length<2)}${view.members.length<2?'<p>请先与其他玩家建立同盟。</p>':''}</section>`:`<div class="coalition-status"><span>指挥官 <b>${esc(a.commanderName)}</b></span><span>驻地 <b>${esc(territory(a.territoryId))}</b></span><span>${a.activeChallengeId?'比赛中':a.waitingForCurfewUntil?'宵禁待命 · 08:00':a.movement?`行军至 ${esc(territory(a.movement.toTerritoryId))} · ${elapsed(a.movement.arrivesAt)} 分钟`:a.blocked?esc(a.blocked):'可以行动'}</span></div><nav>${['roster','actions','management'].map((id,i)=>button('tab',['阵容与借调','地图行动','指挥与消耗'][i],false,`data-tab="${id}" aria-pressed="${tab===id}"`)).join('')}</nav><main>${tab==='roster'?rosterMarkup():tab==='actions'?actionsMarkup():managementMarkup()}</main>`}`);}
 async function estimate(args){
  if(pending)return;
  const epoch=++quoteEpoch,id=getState()?.playerId,armyId=army().id;
  pending=true;render();
  try{const r=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action:'estimate',armyId,...args}});if(epoch===quoteEpoch&&id===getState()?.playerId&&armyId===army()?.id)quote=r.estimate;}
  finally{pending=false;root.removeAttribute('aria-busy');render();}
 }
 root.addEventListener('change',async e=>{
  if(!e.target.matches?.('[data-coalition-use-oil]')||pending||!quote)return;
  try{await estimate({territoryId:quote.toTerritoryId,kind:quote.kind,beneficiaryId:quote.beneficiaryId,maritimeRoute:quote.maritimeRoute,useOil:e.target.value!=='slow'});}catch(error){showToast(error.message);}
 });
 async function watch(){const id=army().activeChallengeId??army().lastChallengeId,fetchSnapshot=()=>getRequest()('/api/campaign/territory/challenge?id='+encodeURIComponent(id));try{const snapshot=await fetchSnapshot();close();live?.stop?.();live=snapshot.completed?{snapshot}:startCampaignBroadcastBackground(snapshot,{fetchSnapshot,onFinish:load});showCampaignBroadcast(live,{onClose:open});}catch(e){showToast(e.message);}}
 function select(next){mode=next;root.hidden=true;deactivateWideWindow(root);beforeOpen();showToast(next==='coast'?'请点击联军驻地的海岸位置':next==='target'?'请选择要进攻的地块':'请选择同盟领土；按 Esc 取消');}
 root.addEventListener('click',async e=>{const b=e.target.closest('[data-coalition-action]');if(!b||b.disabled||pending)return;const action=b.dataset.coalitionAction;try{
  if(action==='roster-pane'){rosterPane=b.dataset.pane;return render();}if(action==='close')return close();if(action==='manage')return open();if(action==='tab'){tab=b.dataset.tab;return render();}
  if(action==='create')return await mutate('create',{name:root.querySelector('[data-army-name]').value});
  if(action==='transfer-command')return await mutate(action,{targetId:root.querySelector('[data-transfer-commander]').value});
  if(action==='request-command')return await mutate(action);
  if(action==='accept-command'||action==='reject-command')return await mutate(action,{commandRequestId:b.dataset.commandRequestId});
  if(action==='request-loan')return await mutate(action,{ownerId:b.dataset.ownerId,playerId:b.dataset.playerId});
  if(action==='accept-loan'||action==='reject-loan')return await mutate(action,{loanRequestId:b.dataset.loanRequestId});
  if(action==='lend'||action==='withdraw'||action==='kick')return await mutate(action,{playerId:b.dataset.playerId,...(action==='kick'?{ownerId:b.dataset.ownerId}:{})});
  if(action==='tactics'){close();onOpenTactics();return;}
  if(action==='select-move')return select('move');if(action==='select-target'){seaRoute=null;return select('target');}if(action==='select-coast')return select('coast');if(action==='deploy')return select('deploy');
  if(action==='propose'){await mutate('propose-target',{territoryId:selected,beneficiaryId:root.querySelector('[data-beneficiary]').value,maritimeRoute:seaRoute});selected=null;render();return;}
  if(action==='confirm-target')return await mutate(action,{proposalId:army().proposal.id});
  if(action==='estimate-attack')return await estimate({...army().proposal,kind:'attack'});
  if(action==='confirm-order'){
   const chosen=quote,playerId=getState()?.playerId;if(!chosen||confirming)return;
   if(chosen.attackBond){confirming=true;let accepted;try{accepted=await confirmPvpAttack({documentRef,...chosen.attackBond});}finally{confirming=false;}if(!accepted)return;}
   if(getState()?.playerId!==playerId||quote!==chosen)return;
   return await mutate(chosen.kind==='attack'?'attack':'move',{territoryId:chosen.toTerritoryId,quoteId:chosen.quoteId,useOil:chosen.useOil!==false,pvpConfirmed:Boolean(chosen.attackBond)});
  }
  if(action==='airport'){const a=army();close();return onOpenAirport({territoryId:a.territoryId,kind:'coalition',unitId:a.id});}
  if(action==='cancel-move')return await mutate('cancel-move');
  if(action==='cancel-quote'){quote=null;return render();}
  if(action==='vote-commander')return await mutate('vote',{kind:'commander',targetId:root.querySelector('[data-commander]').value});
  if(action==='vote-disband')return await mutate('vote',{kind:'disband'});
  if(action==='watch')return watch();
 }catch{} });
 function handleTerritoryClick(id,event){if(!mode)return false;const next=mode;mode=null;tab='actions';root.hidden=false;activateWideWindow(root);render();(async()=>{try{
  if(next==='coast'){
   if(id!==army().territoryId)throw Error('请从联军当前驻地的海岸出发');
   const sourcePoint=displayPointToSource(id,event.latlng),beneficiaryId=army().contributors[0];
   const routes=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action:'routes',armyId:army().id,beneficiaryId,sourcePoint}});
   if(routes.state)campaignStore.setState(routes.state,{source:'coalition-survey'});
   if(!routes.routes.length)throw Error('港口航程内没有可进攻的海岸地块');
   seaRoute={sourceTerritoryId:id,sourcePoint};mode='sea-target';root.hidden=true;deactivateWideWindow(root);showToast('请选择海上进攻目标（航程 '+routes.maxRangeKm+' 公里）');return;
  }
  if(next==='target'||next==='sea-target'){selected=id;return render();}
  if(next==='deploy')return await mutate('deploy',{territoryId:id});
  await estimate({territoryId:id,kind:'move'});
 }catch(e){showToast(e.message);}})();return true;}
 async function open({actions=false}={}){mode=null;compact=actions;tab=actions?'actions':'roster';beforeOpen();root.hidden=false;activateWideWindow(root);render();await load();}
 function close(){loadEpoch++;quoteEpoch++;root.hidden=true;deactivateWideWindow(root);mode=null;quote=null;}
 registerWideWindow(root,{onRequestClose:close});
 const loanNotice=documentRef.createElement('button');loanNotice.id='coalition-request-notice';loanNotice.type='button';loanNotice.className='campaign-live-card';loanNotice.hidden=true;
 documentRef.querySelector('#campaign-notification-list')?.append(loanNotice);
 if(!loanNotice.isConnected)documentRef.querySelector('#campaign-defence-notices')?.after(loanNotice);
 loanNotice.onclick=()=>open();
 const renderLoanNotice=()=>{const requests=getState()?.coalitionLoanRequests??[],commands=getState()?.coalitionCommandRequests??[];loanNotice.hidden=!requests.length&&!commands.length;const text=[requests.length?`借调申请 ${requests.length} 名球员`:'',commands.length?`接任申请 ${commands.length} 条`:''].filter(Boolean).join(' · ');if(loanNotice.textContent!==text)loanNotice.textContent=text;loanNotice.onclick=async()=>{await open();if(commands.length){tab='management';render();}};};
 campaignStore.subscribe(renderLoanNotice);renderLoanNotice();
 const targetNotices=documentRef.createElement('div');targetNotices.id='coalition-target-notices';
 documentRef.querySelector('#campaign-notification-list')?.append(targetNotices);
 let confirmingTarget=false;
 const renderTargets=()=>{const notices=getState()?.coalitionTargetRequests??[];targetNotices.hidden=!notices.length;patchMarkup(targetNotices,notices.map(n=>`<article class="campaign-live-card" data-ui-key="target-${esc(n.id)}"><span class="campaign-live-kicker">联军占领归属待确认</span><strong>${esc(n.armyName)} · ${esc(territory(n.territoryId))}</strong><small>胜利后地块归你所有，并消耗你的征服次数。</small><button type="button" data-confirm-coalition-target="${esc(n.id)}" ${confirmingTarget?'disabled':''}>同意本次占领</button></article>`).join(''));};
 targetNotices.addEventListener('click',async e=>{const b=e.target.closest('[data-confirm-coalition-target]');if(!b||confirmingTarget)return;const n=getState()?.coalitionTargetRequests?.find(n=>n.id===b.dataset.confirmCoalitionTarget);if(!n)return;const owner=getState()?.playerId;confirmingTarget=true;renderTargets();try{const result=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action:'confirm-target',requestId:createRequestId(),armyId:n.armyId,revision:n.revision,proposalId:n.id}});if(owner===getState()?.playerId){campaignStore.setState(result.state,{source:'coalition-target'});showToast('已确认本次占领归属');}}catch(error){if(owner===getState()?.playerId)showToast(error.message);}finally{confirmingTarget=false;renderTargets();}});
 campaignStore.subscribe(renderTargets);renderTargets();
 trigger.addEventListener('click',open);
 documentRef.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode){mode=null;root.hidden=false;activateWideWindow(root);render();}});
 campaignStore.subscribe(()=>{trigger.hidden=!getState()?.setupComplete;if(ownerId&&ownerId!==getState()?.playerId){close();for(const key of Object.keys(warehouses))delete warehouses[key];view=null;ownerId=null;allyCards=null;allyOwnerId=null;allyEpoch++;loadEpoch++;return;}const now=getState()?.expeditionFitness?.serverNow??Date.now(),deadline=(army()?.cooldownUntil??0);if(!pending&&!root.hidden&&(getState()?.coalition?.army?.revision!==army()?.revision||Boolean(view)&&attackCurfewState(view.serverNow??now).active!==attackCurfewState(now).active||(deadline>0&&view?.serverNow<deadline&&now>=deadline)))load();});
 return {open,openActions:()=>open({actions:true}),close,handleTerritoryClick,root};
}
