import {ELITE_FAN_TIERS} from '../../shared/config/elite-clubs.mjs';
import {registerStandardWindow,activateStandardWindow,deactivateStandardWindow} from '../ui/standard-window.js';
import {playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js?v=20260905-shield-v1';
import {goldAmountMarkup} from '../ui/currency.js';
import {shopRequestId} from '../shop/shop-controller.js?v=20260909-transparent-v2';
import {startCampaignBroadcastBackground,showCampaignBroadcast} from '../../campaign-broadcast.js?v=20260909-v21-integration-v1';
const tierNames=['Ⅰ 档','Ⅱ 档','Ⅲ 档','Ⅳ 档','Ⅴ 档'];
const tierRanges=['首发平均 ≥99','首发平均 97–98.9','首发平均 95–96.9','首发平均 92–94.9','首发平均 <92'];
const badge=(club,className='')=>`<img class="elite-badge ${className}" src="./assets/club-badges/${esc(club.id)}.webp" alt="${esc(club.name)}队徽" decoding="sync" />`;
function catalogMarkup(view){
 if(!view)return '<p class="elite-loading" role="status">正在加载豪门列表…</p>';
 const groups=ELITE_FAN_TIERS.map((tier,index)=>({...tier,index,clubs:view.clubs.filter(c=>c.available&&c.fans===tier.fans).sort((a,b)=>b.average-a.average)}));
 const unavailable=view.clubs.filter(c=>!c.available);
 const tile=club=>`<button type="button" class="elite-club-tile" data-elite-club="${esc(club.id)}" aria-label="查看${esc(club.name)}阵容">${badge(club)}<b>${esc(club.name)}</b><span>首发平均 ${club.average??'—'}</span></button>`;
 return `<div class="elite-catalog-heading"><h3>选择挑战对手</h3><span>${view.clubs.length} 家豪门 · 全员 +5</span></div>${groups.filter(g=>g.clubs.length).map(g=>`<section class="elite-tier" data-elite-tier="${g.index+1}" aria-label="${tierNames[g.index]}"><header><h4>${tierNames[g.index]}</h4><span>${tierRanges[g.index]}</span><strong>胜利 +${g.fans.toLocaleString('zh-CN')} 球迷</strong></header><div class="elite-tier-clubs">${g.clubs.map(tile).join('')}</div></section>`).join('')}${unavailable.length?`<section class="elite-tier"><header><h4>暂不可挑战</h4></header><div class="elite-tier-clubs">${unavailable.map(tile).join('')}</div></section>`:''}`;
}
function statusMarkup(view,pending){
 const active=view?.active,result=view?.lastBattle,reward=view?.reward,cooldown=Math.max(0,Math.ceil(((view?.cooldownUntil??0)-(view?.serverNow??Date.now()))/60000));
 return `${active?`<section class="elite-status"><strong>比赛进行中 · ${Math.ceil(active.minute??0)}′ · ${active.score.join(' : ')}</strong><span>本场胜利奖励 ${active.fanReward} 球迷</span><button class="ui-button ui-button--primary" data-elite-watch="${esc(active.id)}">观看直播</button></section>`:''}
 ${!active&&result?`<section class="elite-status"><strong>${result.outcome==='win'?'挑战成功':'挑战失利'} · ${result.score.join(' : ')}${result.penalties?'（点球 '+result.penalties.join(' : ')+'）':''}</strong><span>${result.outcome==='win'?'已获得 '+(result.rewards?.fans??1000)+' 球迷':cooldown?'远征队休整剩余 '+cooldown+' 分钟':'休整已结束'}</span><button class="ui-button" data-elite-watch="${esc(result.id)}">查看战报</button></section>`:''}
 ${reward?`<section class="elite-reward-entry"><div><strong>胜利奖励待领取</strong><span>本队基础球员 · 三选一</span></div><button class="ui-button ui-button--primary" data-elite-reward ${pending?'disabled':''}>开启球员奖励</button></section>`:''}`;
}
function detailMarkup(view,pending){
 const club=view?.selected;
 if(!club)return '<p class="elite-loading" role="status">正在加载豪门阵容…</p>';
 return `<div class="elite-heading">${badge(club)}<div><h3>${esc(club.name)}</h3><p>${esc(club.formation)} · ${esc(club.styleLabel)} · 全员 +5</p></div><span>首发平均 <b>${club.average??'—'}</b></span></div>
 <div class="elite-preview"><div class="elite-pitch" aria-label="${esc(club.name)}首发阵容"><div class="elite-pitch-lines"></div>${(club.players??[]).map(({player,role,position})=>`<div class="elite-player" style="left:${position.x}%;top:${position.y}%" title="${esc(player.name)} · ${role}"><b>${role}</b>${playerCardMarkup(player,{variant:'mini',animated:false})}</div>`).join('')}</div><aside class="elite-rules"><h4>挑战规则</h4><p>单场决胜 · 平局加时与点球</p><p>远征队以 100 体力开局</p><p>胜利：${club.fans??view.rules.fans} 球迷<br>本队基础球员卡 3 选 1</p><p>失利：远征队休整 20 分钟</p><p>无需接壤 · 豪门地块不可占领</p><button class="ui-button ui-button--primary" data-elite-begin="${club.id}" ${pending||view.blocked||!club.available||view.gold<view.rules.fee?'disabled':''}>${pending?'处理中…':'挑战 '+goldAmountMarkup(view.rules.fee)}</button><small>${esc(view.blocked??(!club.available?club.reason:view.gold<view.rules.fee?'金币不足':''))}</small></aside></div>`;
}
export function eliteWindowMarkup(view,{pending=false,error='',page='catalog'}={}){
 const detail=page==='detail';
 return `<div class="standard-window__surface elite-surface" data-elite-page="${detail?'detail':'catalog'}"><header class="elite-header">${detail?`<button class="ui-button elite-back" data-elite-back ${pending?'disabled':''} aria-label="返回豪门列表">← <span>豪门列表</span></button>`:''}<h2>豪门挑战</h2><span class="elite-wallet">${goldAmountMarkup(view?.gold??0)}</span><button class="ui-button elite-close" data-stage-window-close aria-label="关闭豪门挑战">×</button></header><div class="elite-scroll ${detail?'elite-detail':'elite-catalog'}" data-elite-scroll="${detail?'detail':'catalog'}">
 ${error?`<p class="elite-error" role="alert">${esc(error)}</p>`:''}${statusMarkup(view,pending)}${detail?detailMarkup(view,pending):catalogMarkup(view)}</div></div>`;
}
export function createEliteController({root,trigger,getState,getRequest,campaignStore,showToast=()=>{},openPlayerReward=()=>false,onOpen=()=>{},onClose=()=>{}}){
 let page='catalog';const scrolls={catalog:0,detail:0};
 let view=null,selectedId=null,pending=false,error='',timer=null,sequence=0,live=null,livePromise=null,retry=null,autoReward=false;
 function render(){
  if(root.hidden)return;
  const prior=root.querySelector('.elite-scroll');if(prior)scrolls[prior.dataset.eliteScroll]=prior.scrollTop;
  const focused=root.ownerDocument?.activeElement;
  const focusKey=root.contains(focused)?['eliteClub','eliteBack','eliteBegin','eliteClaim','eliteWatch'].find(k=>Object.hasOwn(focused.dataset??{},k)):null;
  const focusValue=focusKey?focused.dataset[focusKey]:null;
  root.innerHTML=eliteWindowMarkup(view,{pending,error,page});root.querySelector('.elite-scroll').scrollTop=scrolls[page];
  if(focusKey)[...root.querySelectorAll('button')].find(b=>b.dataset[focusKey]===focusValue)?.focus({preventScroll:true});
 }
 function navigate(next,clubId){
  if(pending)return;
  if(next==='detail'&&clubId!==selectedId){selectedId=clubId;scrolls.detail=0;if(view)view={...view,selected:null};}
  page=next;error='';render();if(next==='detail')refresh();
  const focus=next==='detail'?root.querySelector('[data-elite-back]'):[...root.querySelectorAll('[data-elite-club]')].find(b=>b.dataset.eliteClub===selectedId);
  focus?.focus({preventScroll:true});
 }
 async function refresh(){if(pending)return;const seq=++sequence;try{const value=await getRequest()('/api/campaign/elite'+(selectedId?'?clubId='+encodeURIComponent(selectedId):''));if(seq!==sequence)return;view=value.elite;selectedId=view.selected?.id;error='';render();if(autoReward&&!root.hidden&&view.reward){autoReward=false;showReward();}}catch(e){if(seq===sequence){error=e.message;render();}}}
 async function syncState(){const value=await getRequest()('/api/campaign/state');campaignStore.setState(value.state,{source:'elite'});}
 function close(){if(root.hidden)return;clearInterval(timer);timer=null;root.hidden=true;deactivateStandardWindow(root);onClose();}
 function open(clubId,{skipReward=false}={}){autoReward=!skipReward;if(!getState()?.setupComplete)return;page=typeof clubId==='string'?'detail':'catalog';if(typeof clubId==='string'&&selectedId!==clubId){selectedId=clubId;scrolls.detail=0;if(view)view={...view,selected:null};}activateStandardWindow(root);onOpen();render();refresh();clearInterval(timer);timer=setInterval(refresh,3000);}
 async function ensureLive(id){
  if(live?.snapshot?.challenge?.id===id||live?.snapshot?.battle?.id===id)return live;
  if(livePromise)return livePromise;
  livePromise=(async()=>{const fetchSnapshot=()=>getRequest()('/api/campaign/elite/match?id='+encodeURIComponent(id)),snapshot=await fetchSnapshot();if(snapshot.completed){live={snapshot};return live;}
   live?.stop?.();live=startCampaignBroadcastBackground(snapshot,{fetchSnapshot,onOpen:state=>showCampaignBroadcast(state,{onClose:()=>open(page==='detail'?selectedId:undefined)}),onFinish:async()=>{try{await syncState();await refresh();showToast('豪门挑战已结束，可返回查看结果与奖励');}catch(e){showToast(e.message);}}});return live;
  })();try{return await livePromise;}finally{livePromise=null;}
 }
 async function watch(id){try{const state=await ensureLive(id);if(state)showCampaignBroadcast(state,{onClose:()=>open(page==='detail'?selectedId:undefined)});}catch(e){showToast(e.message);}}
 async function begin(clubId){if(pending)return;pending=true;++sequence;error='';if(retry?.clubId!==clubId)retry={clubId,requestId:shopRequestId()};render();try{const value=await getRequest()('/api/campaign/elite/begin',{method:'POST',body:retry});retry=null;view=value.elite;campaignStore.setState(value.state,{source:'elite-begin'});await watch(value.challengeId);}catch(e){error=e.message;showToast(error);}finally{pending=false;render();}}
 function showReward(){
  if(pending||!view?.reward)return;
  const reward=view.reward,account=getState()?.playerId,clubId=selectedId,backPage=page;
  openPlayerReward({id:reward.id,cards:reward.cards,onClose:()=>{if(account===getState()?.playerId)open(backPage==='detail'?clubId:undefined,{skipReward:true});},claim:async playerId=>{
   const value=await getRequest()('/api/campaign/elite/claim',{method:'POST',body:{rewardId:reward.id,playerId,clubId}});
   if(account===getState()?.playerId)view=value.elite;
   // The claim keeps its existing idempotency and ownership checks on the server.
   const player=value.state?.draft?.roster?.find(p=>(p.playerId??p.id)===value.playerId)??reward.cards.find(p=>p.playerId===playerId);
   return {state:value.state,player};
  }});
 }
 root.addEventListener('click',e=>{const b=e.target.closest?.('button');if(!b||b.disabled)return;if(Object.hasOwn(b.dataset,'eliteBack'))navigate('catalog');if(b.dataset.eliteClub)navigate('detail',b.dataset.eliteClub);if(b.dataset.eliteBegin)begin(b.dataset.eliteBegin);if(Object.hasOwn(b.dataset,'eliteReward'))showReward();if(b.dataset.eliteWatch)watch(b.dataset.eliteWatch);});
 trigger.addEventListener('click',()=>open());registerStandardWindow(root,{onRequestClose:close});
 function update(state){trigger.hidden=!state?.setupComplete;trigger.classList.toggle('has-reward',Boolean(state?.eliteChallenge?.pendingReward));if(!state?.setupComplete){close();live?.stop?.();live=null;return;}if(state.eliteChallenge?.activeId)ensureLive(state.eliteChallenge.activeId).catch(()=>{});}
 campaignStore.subscribe(({state})=>update(state));update(getState());return {open,close,refresh};
}
