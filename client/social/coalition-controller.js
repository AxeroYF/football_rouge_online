import {attackCurfewState} from '../../shared/config/conquest.mjs';
import {oilMovementChoiceMarkup} from '../resources/oil-movement.js';
import {registerWideWindow,activateWideWindow,deactivateWideWindow} from '../ui/wide-window.js';
import {startCampaignBroadcastBackground,showCampaignBroadcast} from '../../campaign-broadcast.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createCoalitionController({documentRef=document,getState,getRequest,campaignStore,mapElement,metadata,showToast,beforeOpen=()=>{},displayPointToSource,onOpenTactics=()=>{}}){
 const root=documentRef.createElement('section');root.className='coalition-window';root.hidden=true;root.setAttribute('aria-label','联军管理');documentRef.body.append(root);
 const trigger=documentRef.createElement('button');trigger.className='nav-item';trigger.id='topbar-coalition';trigger.textContent='联军';trigger.hidden=!getState()?.setupComplete;documentRef.querySelector('.topbar .nav')?.append(trigger);
 if(!trigger.isConnected)documentRef.querySelector('#topbar-research')?.after(trigger);
 let view=null,pending=false,tab='roster',mode=null,quote=null,selected=null,seaRoute=null,live=null,ownerId=null,loadEpoch=0,quoteEpoch=0,compact=false;
 const army=()=>view?.army;
 const territory=id=>{const t=metadata.get(id);return t?[t.country,t.name].filter(Boolean).join(' · '):id??'待部署';};
 const member=id=>view?.members?.find(m=>m.id===id)?.name??id;
 const command=()=>army()?.canCommand&&!army()?.busy;
 const button=(action,label,disabled=false,extra='')=>`<button type="button" data-coalition-action="${action}" ${disabled?'disabled':''} ${extra}>${label}</button>`;
 const elapsed=until=>Math.max(0,Math.ceil((until-(view?.serverNow??Date.now()))/60000));
 async function load(){const epoch=++loadEpoch,id=getState()?.playerId;try{const r=await getRequest()('/api/campaign/coalition');if(epoch!==loadEpoch||id!==getState()?.playerId)return;view=r.view;ownerId=id;render();}catch(e){showToast(e.message);}}
 async function mutate(action,extra={}){
  if(pending)return;pending=true;const id=getState()?.playerId;
  try{const result=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action,requestId:crypto.randomUUID(),armyId:army()?.id,revision:army()?.revision,...extra}});if(id!==getState()?.playerId)return;view=result.view;campaignStore.setState(result.state,{source:'coalition'});quote=null;render();return result;}
  catch(e){showToast(e.message);throw e;}finally{pending=false;}
 }
 function rosterMarkup(){const a=army(),starters=new Set(a.tactics?.starters??[]);
  return `<div class="coalition-columns"><section><h3>联军阵容 · ${a.roster.length}/18</h3>${a.tactics?`<p>阵型 ${esc(a.tactics.formation)} · 指挥官管理战术<br>全队研究采用指挥官方案；生物研究按球员原所属玩家结算。</p>`:''}<table><thead><tr><th>球员</th><th>位置 / 能力</th><th>提供方</th><th>体能</th><th></th></tr></thead><tbody>${a.roster.map(p=>{const loan=a.loans.find(l=>JSON.stringify([l.ownerId,l.playerId])===p.id);return `<tr><td>${esc(p.name)}<small>${starters.has(p.id)?'首发':'替补 / 待编排'}</small></td><td>${esc(p.role)} · ${esc(p.effectiveOverall??p.overall)}</td><td>${esc(p.ownerName)}</td><td>${Math.round(p.state?.fitness??100)}${p.state?.injury?.matchesRemaining?' · 伤病':''}${p.state?.suspension?.matchesRemaining?' · 停赛':''}</td><td>${loan?.ownerId===getState()?.playerId?button('withdraw',loan.withdrawRequested?'待归队':a.busy?'申请归队':'归队',loan.withdrawRequested,`data-player-id="${esc(loan.playerId)}"`):''}</td></tr>`;}).join('')||'<tr><td colspan="5">盟友共同派出球员后组建。</td></tr>'}</tbody></table><div class="coalition-buttons">${button('tactics','前往战术板')}</div><p>至少两位盟友共同出人，首发与替补自由安排。工资由原玩家承担。</p></section><section><h3>我的球员</h3><p>借调球员保留个人编队，标注“联军借调”；期间由替补出场。</p><div class="coalition-card-list">${view.myCards.map(p=>`<div><span>${esc(p.name)} <small>${esc(p.role)} · ${esc(p.overall)}</small></span>${button('lend',p.loan?'已借调':'借调',a.busy||Boolean(p.blocked),`data-player-id="${esc(p.id)}" title="${esc(p.blocked??'')}"`)}</div>`).join('')}</div></section></div>`;
 }
 function quoteMarkup(){if(!quote)return '';return `<section class="coalition-quote"><h3>${quote.kind==='attack'?'确认出征':'确认移动'} · ${esc(territory(quote.toTerritoryId))}</h3><strong>预计 ${Math.ceil(quote.durationMs/60000)} 分钟 · 石油 ${quote.oilSpent}</strong>${oilMovementChoiceMarkup(quote,'data-coalition-use-oil',pending)}<p>${quote.useOil===false?'不耗石油 · 行军时间 ×4。':quote.oilShortage?'部分盟友库存不足：全体不扣油，行军时间 ×4。':'全体盟友均摊，余数轮流承担。出发扣除，不退还。'}</p><div class="coalition-shares">${quote.shares.map(s=>`<span>${esc(s.name)}：${quote.oilSpent>0?s.amount:0} / 库存 ${s.balance}</span>`).join('')}</div>${button('confirm-order','确认行动',!command()||pending||(quote.kind==='attack'&&Boolean(army().attackBlocked)))}${button('cancel-quote','返回')}</section>`;}
 function actionsMarkup(){const a=army(),p=a.proposal;return `<section><div class="coalition-buttons">${button('select-move','移动',!command()||Boolean(a.blocked))}${button('select-target','进攻',!command()||Boolean(a.blocked)||Boolean(a.attackBlocked))}${button('select-coast','从驻地海岸出征',!command()||Boolean(a.blocked)||Boolean(a.attackBlocked))}${button('deploy','重新部署',!command()||Boolean(a.territoryId))}${a.activeChallengeId||a.lastChallengeId?button('watch',a.activeChallengeId?'观看联军比赛':'上一场战报'):''}</div>${a.waitingForCurfewUntil?'<p>已抵达，宵禁结束后于 08:00 尝试进攻。</p>':a.attackBlocked?`<p>${esc(a.attackBlocked)}</p>`:''}<p>用油行军由全体盟友均摊，也可选择不耗油慢速行军。中立地块消耗受益人的征服次数，盟友借地授权仍有效。</p>${a.order?`<p>出征目标：${esc(territory(a.order.territoryId))} · 占领归属 ${esc(member(a.order.beneficiaryId))}</p>`:''}${selected?`<div class="coalition-quote"><h3>目标：${esc(territory(selected))}</h3><label>占领归属 <select data-beneficiary>${a.contributors.map(id=>`<option value="${esc(id)}">${esc(member(id))}</option>`).join('')}</select></label>${button('propose','提交目标',!command())}</div>`:''}${p?`<div class="coalition-quote"><h3>${esc(territory(p.territoryId))}</h3><p>占领归属：${esc(member(p.beneficiaryId))} · ${p.confirmed?'已确认':'等待受益人确认'}</p>${p.beneficiaryId===getState()?.playerId&&!p.confirmed?button('confirm-target','同意本次占领'):''}${button('estimate-attack','预览出征消耗',!command()||!p.confirmed||Boolean(a.attackBlocked))}</div>`:''}${quoteMarkup()}${a.lastActionError?`<p role="alert">上次出征未能开战：${esc(a.lastActionError)}</p>`:''}</section>`;}
 function managementMarkup(){const a=army();return `<section><h3>指挥权与解散</h3><p>出人者过半数同意后生效，两位出人者需双方同意。行动期间不能变更。</p><label>指挥官候选 <select data-commander>${a.contributors.map(id=>`<option value="${esc(id)}">${esc(member(id))}</option>`).join('')}</select></label><div class="coalition-buttons">${button('vote-commander','支持移交指挥权',a.busy)}${button('vote-disband','支持解散联军',a.busy)}</div>${a.votes?`<p>当前表决：${a.votes.kind==='disband'?'解散联军':'移交给 '+esc(member(a.votes.targetId))} · ${a.votes.yes.length}/${a.votes.voters.length} 同意</p>`:''}<h3>石油分摊记录</h3><table><thead><tr><th>时间</th><th>行动</th><th>消耗</th><th>分摊</th></tr></thead><tbody>${[...(a.ledger??[])].reverse().map(l=>`<tr><td>${esc(new Date(l.at).toLocaleString('zh-CN'))}</td><td>${l.kind==='attack'?'出征':'移动'} · ${esc(territory(l.target))}</td><td>${l.total}${l.useOil===false?'（慢速）':l.shortage?'（缺油）':''}</td><td>${l.shares.map(s=>`${esc(s.name??member(s.ownerId))} ${s.amount}`).join('、')}</td></tr>`).join('')||'<tr><td colspan="4">暂无消耗</td></tr>'}</tbody></table></section>`;}
 function render(){if(root.hidden)return;const a=army();root.classList.toggle('coalition-action-window',compact);if(compact&&a){root.innerHTML=`<header><h2>${esc(a.name)}</h2>${button('close','关闭')}</header><div class="coalition-status"><span>驻地 ${esc(territory(a.territoryId))}</span><span>${a.waitingForCurfewUntil?'宵禁待命 · 08:00':a.movement?'行军中 · '+elapsed(a.movement.arrivesAt)+' 分钟':a.activeChallengeId?'比赛中':esc(a.blocked??'可以行动')}</span></div><main>${actionsMarkup()}</main><footer class="coalition-buttons">${button('manage','联军管理')}${button('tactics','战术板')}</footer>`;return;}root.innerHTML=`<header><div><small>同盟协作</small><h2>${esc(a?.name??'联军')}</h2></div>${button('close','关闭')}</header>${!view?'<p>加载中…</p>':!a?`<section><h3>共同出人，联合出征</h3><p>每个同盟可组建一支联军，至少两位成员共同提供球员。</p><label>联军名称 <input data-army-name maxlength="20" value="联军"></label>${button('create','发起组建',view.members.length<2)}${view.members.length<2?'<p>请先与其他玩家建立同盟。</p>':''}</section>`:`<div class="coalition-status"><span>指挥官 <b>${esc(a.commanderName)}</b></span><span>驻地 <b>${esc(territory(a.territoryId))}</b></span><span>${a.activeChallengeId?'比赛中':a.waitingForCurfewUntil?'宵禁待命 · 08:00':a.movement?`行军至 ${esc(territory(a.movement.toTerritoryId))} · ${elapsed(a.movement.arrivesAt)} 分钟`:a.blocked?esc(a.blocked):'可以行动'}</span></div><nav>${['roster','actions','management'].map((id,i)=>button('tab',['阵容与借调','地图行动','指挥与消耗'][i],false,`data-tab="${id}" aria-pressed="${tab===id}"`)).join('')}</nav><main>${tab==='roster'?rosterMarkup():tab==='actions'?actionsMarkup():managementMarkup()}</main>`}`;}
 async function estimate(args){
  if(pending)return;
  const epoch=++quoteEpoch,id=getState()?.playerId,armyId=army().id;
  pending=true;render();
  try{const r=await getRequest()('/api/campaign/coalition',{method:'POST',body:{action:'estimate',armyId,...args}});if(epoch===quoteEpoch&&id===getState()?.playerId&&armyId===army()?.id)quote=r.estimate;}
  finally{pending=false;render();}
 }
 root.addEventListener('change',async e=>{
  if(!e.target.matches?.('[data-coalition-use-oil]')||pending||!quote)return;
  try{await estimate({territoryId:quote.toTerritoryId,kind:quote.kind,beneficiaryId:quote.beneficiaryId,maritimeRoute:quote.maritimeRoute,useOil:e.target.value!=='slow'});}catch(error){showToast(error.message);}
 });
 async function watch(){const id=army().activeChallengeId??army().lastChallengeId,fetchSnapshot=()=>getRequest()('/api/campaign/territory/challenge?id='+encodeURIComponent(id));try{const snapshot=await fetchSnapshot();close();live?.stop?.();live=snapshot.completed?{snapshot}:startCampaignBroadcastBackground(snapshot,{fetchSnapshot,onFinish:load});showCampaignBroadcast(live,{onClose:open});}catch(e){showToast(e.message);}}
 function select(next){mode=next;root.hidden=true;deactivateWideWindow(root);beforeOpen();showToast(next==='coast'?'请点击联军驻地的海岸位置':next==='target'?'请选择要进攻的地块':'请选择同盟领土；按 Esc 取消');}
 root.addEventListener('click',async e=>{const b=e.target.closest('[data-coalition-action]');if(!b||b.disabled||pending)return;const action=b.dataset.coalitionAction;try{
  if(action==='close')return close();if(action==='manage')return open();if(action==='tab'){tab=b.dataset.tab;return render();}
  if(action==='create')return await mutate('create',{name:root.querySelector('[data-army-name]').value});
  if(action==='lend'||action==='withdraw')return await mutate(action,{playerId:b.dataset.playerId});
  if(action==='tactics'){close();onOpenTactics();return;}
  if(action==='select-move')return select('move');if(action==='select-target'){seaRoute=null;return select('target');}if(action==='select-coast')return select('coast');if(action==='deploy')return select('deploy');
  if(action==='propose'){await mutate('propose-target',{territoryId:selected,beneficiaryId:root.querySelector('[data-beneficiary]').value,maritimeRoute:seaRoute});selected=null;render();return;}
  if(action==='confirm-target')return await mutate(action,{proposalId:army().proposal.id});
  if(action==='estimate-attack')return await estimate({...army().proposal,kind:'attack'});
  if(action==='confirm-order')return await mutate(quote.kind==='attack'?'attack':'move',{territoryId:quote.toTerritoryId,quoteId:quote.quoteId,useOil:quote.useOil!==false});
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
 function close(){quoteEpoch++;root.hidden=true;deactivateWideWindow(root);mode=null;quote=null;}
 registerWideWindow(root,{onRequestClose:close});
 trigger.addEventListener('click',open);
 documentRef.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode){mode=null;root.hidden=false;activateWideWindow(root);render();}});
 campaignStore.subscribe(()=>{trigger.hidden=!getState()?.setupComplete;if(ownerId&&ownerId!==getState()?.playerId){close();view=null;ownerId=null;loadEpoch++;return;}const now=getState()?.expeditionFitness?.serverNow??Date.now(),deadline=(army()?.cooldownUntil??0);if(!pending&&!root.hidden&&(getState()?.coalition?.army?.revision!==army()?.revision||Boolean(army()?.attackBlocked)!==attackCurfewState(now).active||(deadline>0&&view?.serverNow<deadline&&now>=deadline)))load();});
 return {open,openActions:()=>open({actions:true}),close,handleTerritoryClick,root};
}
