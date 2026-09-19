import {INTERACTION_LABELS} from '../../shared/config/diplomacy.mjs';
import {registerStandardWindow,activateStandardWindow,deactivateStandardWindow} from '../ui/standard-window.js';
import {escapePlayerCardHtml as esc,playerCardMarkup} from '../player-card/player-card.js';
import {goldAmountMarkup} from '../ui/currency.js';
import {createRequestId} from '../core/request-id.js';
import {startCampaignBroadcastBackground,showCampaignBroadcast} from '../../campaign-broadcast.js';
const states={self:'我',neutral:'中立',friendship:'友谊',alliance:'同盟',war:'战争'};
const requestStates={pending:'待处理',accepted:'已接受',rejected:'已拒绝',cancelled:'已撤销',expired:'已过期'};
const color=value=>/^#[0-9a-f]{6}$/i.test(value??'')?value:'#75988b';
const iconPaths={
 friendship:'M9 12l2 2 4-4M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z',
 condemn:'M12 8v5m0 3v.01M10 3h4l8 17H2z',
 trade:'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
 friendly:'M16 3H8v5a4 4 0 0 0 8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 0v7m-4 2h8',
 location:'M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Zm0-15a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
 war:'m4 3 15 15m-4 1 4-4m-2 6 4-4M20 3 5 18m4 1-4-4m2 6-4-4',
 inbox:'M4 4h16v16H4zM4 13h5l1 3h4l1-3h5',
};
const icon=key=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[key]??iconPaths.friendship}"/></svg>`;
const styleNames={possession:'控球组织',counterAttack:'快速反击',highPress:'高位压迫',direct:'直接进攻',lowBlock:'低位防守',balanced:'均衡打法'};
function squadMarkup(squad){
 if(!squad?.players?.length)return `<div class="interaction-pitch is-empty"><div class="interaction-pitch-lines"></div><p>远征首发尚未就绪<span>完成编队后在此展示阵容</span></p></div>`;
 return `<div class="interaction-pitch" aria-label="远征首发阵容"><div class="interaction-pitch-lines"><i></i><i></i></div>${squad.players.map(({player,position})=>`<div class="interaction-player" style="left:${Math.max(10,Math.min(90,Number(position?.x)||50))}%;top:${Math.max(11,Math.min(88,Number(position?.y)||50))}%" title="${esc(player.name)} · ${esc(player.role)} · ${player.overall}"><b>${esc(player.role)}</b>${playerCardMarkup(player,{variant:'mini',animated:false})}<span>${esc(player.name)}</span></div>`).join('')}</div>`;
}
export function serverPlayersMarkup(state,{collapsed=false}={}) {
 const players=state?.interactions?.players??[];
 return `<header><strong>服务器玩家 <span>${players.length}</span></strong><button data-players-toggle aria-expanded="${!collapsed}">${collapsed?'展开':'收起'}</button></header><div class="server-player-list" ${collapsed?'hidden':''}>${players.map(p=>`<button class="server-player" data-interaction-player="${esc(p.id)}" ${p.self||!p.ready?'disabled':''}><span><b>${esc(p.teamName)}</b><small>${esc(p.nickname)}</small></span><em class="relation-${p.state}">${p.ready?states[p.state]:'未建队'}${p.pending+p.unread?` · ${p.pending+p.unread}`:''}</em></button>`).join('')||'<p>暂无玩家</p>'}</div>`;
}
function offerSide(cards=[],gold=0,oil=0){return `${goldAmountMarkup(gold)}${oil?` · ${Number(oil).toLocaleString("zh-CN")} 石油`:""}${cards.length?`<div class="interaction-offer-cards">${cards.map(p=>`<div>${playerCardMarkup(p,{variant:'mini',animated:false})}<span>${esc(p.name)} · ${p.overall}</span></div>`).join('')}</div>`:''}`;}
export function interactionWindowMarkup(view,{pending=false,error='',tradeOpen=false,trade={},confirmWar=false}={}) {
 const button=(action,label,disabled=false,cls='')=>`<button type="button" class="ui-button ${cls}" data-interaction-action="${action}" ${pending||disabled?'disabled':''}>${label}</button>`;
 if(!view)return `<div class="standard-window__surface interaction-surface"><header><h2>玩家互动</h2><button class="ui-button" data-stage-window-close>×</button></header><p role="status">${esc(error||'正在读取俱乐部…')}</p></div>`;
 const war=view.relationship==='war',allied=view.relationship==='alliance',me=view.selfId,other=view.player.id;
 const has=type=>view.requests.some(r=>r.type===type&&r.status==='pending');
 const requestMarkup=r=>`<article class="interaction-request ${r.status==='pending'?'is-pending':''}"><header><strong>${r.from===me?'已发出':'收到'} · ${r.payload?.kind==='gift'?'赠送':INTERACTION_LABELS[r.type]}</strong><small>${requestStates[r.status]}</small></header>${r.type==='trade'?`<div class="interaction-offer"><section><h4>${r.from===me?'你':'对方'}付出</h4>${offerSide(r.payload.giveCards,r.payload.giveGold,r.payload.giveOil)}</section><section><h4>${r.from===me?'对方':'你'}付出</h4>${offerSide(r.payload.takeCards,r.payload.takeGold,r.payload.takeOil)}</section></div>`:''}${r.type==='alliance'?`<p>同盟成员：${esc((r.payload?.memberNames??[]).join('、'))}。共同应战，开放盟友领地调动、发掘和范围恢复。</p>`:''}${r.type==='friendly'?'<p>远征阵容快照 · 100 体力 · 无奖励 · 不影响正式体力及伤停</p>':''}${r.status==='pending'?`<footer>${r.to===me?`<button class="ui-button ui-button--primary" data-interaction-response="accept" data-proposal="${esc(r.id)}" ${pending?'disabled':''}>${r.type==='trade'?(r.payload?.kind==='gift'?'接受赠送':'接受并完成交易'):r.type==='peace'?'接受求和':'接受'}</button><button class="ui-button" data-interaction-response="reject" data-proposal="${esc(r.id)}" ${pending?'disabled':''}>拒绝</button>`:`<button class="ui-button" data-interaction-response="cancel" data-proposal="${esc(r.id)}" ${pending?'disabled':''}>撤销申请</button>`}<small>有效至 ${esc(new Date(r.expiresAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</small></footer>`:''}</article>`;
 const choose=(cards,side,title)=>`<section><h4>${title}</h4><label>金币<input type="number" min="0" max="${view.rules.maxTradeGold}" step="1" data-trade-gold="${side}" value="${Number(trade[side+'Gold']??0)}" ${pending?'disabled':''}></label><label>石油<input type="number" min="0" max="${view.rules.maxTradeOil??1000000}" step="1" data-trade-oil="${side}" value="${Number(trade[side+'Oil']??0)}" ${pending?'disabled':''}></label><div class="interaction-trade-cards">${cards.map(p=>`<label class="interaction-trade-card"><input type="checkbox" data-trade-card="${side}" value="${esc(p.playerId)}" ${(trade[side+'CardIds']??[]).includes(p.playerId)?'checked':''} ${pending||p.blocked?'disabled':''}><span>${esc(p.name)} <small>${esc(p.role)} · 总评 ${p.overall}${p.upgradeLevel?` · +${p.upgradeLevel}`:''}</small>${p.blocked?`<small>${esc(p.blocked)}</small>`:''}</span></label>`).join('')}</div></section>`;
 const requests=[...view.requests].sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')||b.createdAt-a.createdAt);
 const eventLabel=e=>{const [action,type]=e.type.split(':');return type?`${{accept:'接受',reject:'拒绝',cancel:'撤销'}[action]??action}${INTERACTION_LABELS[type]??type}`:({ 'revoke-location':'撤回位置共享','withdraw-condemnation':'撤回谴责','friendly-finished':'友谊赛结束','alliance-formed':'同盟已建立','alliance-war':'同盟连带进入战争','leave-alliance':'退出同盟'}[action]??INTERACTION_LABELS[action]??action);};
 const activeRequests=requests.filter(r=>r.status==='pending'),pastRequests=requests.filter(r=>r.status!=='pending');
 const squad=view.squad,starters=new Set(squad?.players?.map(p=>p.player.playerId)??[]);
 const roster=[...view.theirCards].sort((a,b)=>Number(starters.has(b.playerId))-Number(starters.has(a.playerId))||(b.overall??0)-(a.overall??0));
 const actionTile=(action,label,detail,key,disabled=false)=>button(action,`${icon(key)}<span><b>${label}</b><small>${detail}</small></span><i>↗</i>`,disabled,`interaction-action action-${key}`).replace('data-interaction-action=',`aria-label="${esc(label)}" data-interaction-action=`);
 return `<div class="standard-window__surface interaction-surface" role="dialog" aria-modal="true" aria-labelledby="interaction-club-name" style="--club-color:${color(view.player.color)}">
 <header class="interaction-hero"><div class="interaction-crest" aria-hidden="true"><span>${esc(view.player.teamName.slice(0,1))}</span></div><div class="interaction-identity"><small>俱乐部主页</small><h2 id="interaction-club-name">${esc(view.player.teamName)}</h2><p>${esc(view.player.nickname)}<b class="interaction-relation relation-${view.relationship}"><i></i>${states[view.relationship]}</b></p></div><dl class="interaction-stats"><div><dt>远征阵型</dt><dd>${esc(squad?.formation??'待编队')}</dd></div><div><dt>首发平均</dt><dd>${squad?.average??'—'}</dd></div><div><dt>球员卡</dt><dd>${view.theirCards.length}<small> 张</small></dd></div></dl><button class="ui-button interaction-close" data-stage-window-close aria-label="关闭玩家互动">×</button></header>
 <div class="interaction-scroll">
 ${error?`<p class="interaction-error" role="alert">${esc(error)}</p>`:''}
 ${confirmWar?`<section class="interaction-confirm"><strong>${confirmWar==='leave'?'确认退出整个同盟？':'确认向 '+esc(view.player.teamName)+' 宣战？'}</strong><p>${confirmWar==='leave'?'退出后与原盟友保留友谊，已有战争继续。盟友地块上的单位返回己方领地，已付费发掘可继续领奖。':'宣战立即使双方整个同盟进入战争，撤回交战双方的位置共享与待处理申请。对方同盟：'+esc((view.targetAllianceMembers??[]).map(p=>p.teamName).join('、'))}</p>${button(confirmWar==='leave'?'leave-alliance':'war',confirmWar==='leave'?'确认退出同盟':'确认宣战',false,'interaction-danger')}${button('war-cancel','返回')}</section>`:''}
 ${tradeOpen?`<form data-interaction-trade class="interaction-trade"><header><h3>${trade.mode==='gift'?'赠送资源与球员':'资源交易'}</h3><span>可用：${goldAmountMarkup(view.gold)} · ${Number(view.oil??0).toLocaleString('zh-CN')} 石油</span></header><nav class="interaction-trade-mode" aria-label="交易方式">${button('trade-exchange','交易',trade.mode!=='gift')}${button('trade-gift','赠送',trade.mode==='gift')}</nav><p>${trade.mode==='gift'?'对方接受后到账，无需回赠':'金币、石油、球员可混合报价，对方接受后交换'} · 最多 10 张球员卡</p><div>${choose(view.myCards,'give',trade.mode==='gift'?'你赠送':'你付出')}${trade.mode==='gift'?'<section class="interaction-gift-recipient"><h4>对方付出</h4><p>无需付出</p></section>':choose(view.theirCards,'take','对方付出')}</div><footer>${button('trade-close','返回主页')}<button class="ui-button ui-button--primary" type="submit" ${pending?'disabled':''}>${trade.mode==='gift'?'发送赠送申请':'发送报价'}</button></footer></form>`:`<div class="interaction-profile-grid"><section class="interaction-lineup"><header class="interaction-section-heading"><h3>远征首发</h3><span>${esc(styleNames[squad?.style]??'阵容预览')}</span></header>${squadMarkup(squad)}</section>
 <aside class="interaction-sidebar"><section><header class="interaction-section-heading"><h3>俱乐部互动</h3><span>与 ${esc(view.player.nickname)}</span></header><div class="interaction-actions">
 ${actionTile('friendly','邀请友谊赛','满体力切磋','friendly',war||has('friendly'))}${actionTile('trade-form','发起交易','金币 · 石油 · 球员','trade',war||has('trade'))}${actionTile('gift-form','赠送资源','金币 · 石油 · 球员','trade',war||has('trade'))}${actionTile('friendship',['friendship','alliance'].includes(view.relationship)?'已建立友谊':'宣布友谊',has('friendship')?'等待对方回应':'建立友好关系','friendship',war||['friendship','alliance'].includes(view.relationship)||has('friendship'))}${actionTile(view.condemnedByMe?'withdraw-condemnation':'condemn',view.condemnedByMe?'撤回谴责':'谴责',view.condemnedByMe?'撤回公开立场':'表达外交立场','condemn',allied)}
 ${actionTile('alliance',allied?'已建立同盟':'建立同盟',allied?'共同应战与领地合作':view.relationship==='friendship'?'结盟后自动加入盟友战争':'需先宣布友谊','friendship',allied||view.relationship!=='friendship'||has('alliance'))}
 ${allied?`${actionTile('conquest-access',view.canUseTheirConquestLand?'已获借地授权':'申请借地征服',view.canUseTheirConquestLand?'可从对方领土征服中立地块':has('conquest-access')?'等待盟友批准':'持续授权，盟友可撤销','friendship',view.canUseTheirConquestLand||has('conquest-access'))}${view.allowTheirConquest?actionTile('revoke-conquest-access','撤销借地授权','停止对方从你的领土发起新征服','condemn'):''}`:''}
 </div></section>
 <section class="interaction-location"><div>${icon('location')}<span><b>俱乐部总部</b><small>${view.location?esc(view.location.label):'总部位置尚未向你开放'}</small></span></div><footer>${view.location?`<button class="ui-button" data-interaction-locate="${esc(view.location.territoryId)}">定位总部 ↗</button>`:button('location',has('location')?'位置申请已发出':'申请开放位置',war||has('location'))}${view.sharingLocation?button('revoke-location','撤回我的位置共享'):''}</footer></section>
 <section class="interaction-roster"><header class="interaction-section-heading"><h3>球员名单 <small>${roster.length}</small></h3><span>首发优先</span></header><div class="interaction-roster-list">${roster.map(p=>`<div class="interaction-roster-row"><i class="roster-grade grade-${esc(p.grade)}">${esc(p.grade)}</i><span><b>${esc(p.name)}</b><small>${esc(p.role)}${p.upgradeLevel?` · +${p.upgradeLevel}`:''}${starters.has(p.playerId)?' · 首发':''}</small></span><strong>${p.overall??'—'}</strong></div>`).join('')||'<p class="interaction-hint">暂无球员卡</p>'}</div></section></aside></div>`}
 <section class="interaction-diplomacy ${war?'is-war':''}"><div>${icon(war?'war':'friendship')}<span><b>${war?'战争状态':allied?'同盟关系':view.relationship==='friendship'?'友好关系':'和平往来'}</b><small>${war?'双方可进攻领土；领土比赛结束后可接受求和':'双方未处于战争状态，不能互相进攻领土。'}${view.condemnedMe?' 对方已谴责你。':''}</small></span></div>${allied?button('leave-alliance-confirm','退出同盟'):war?button('peace',has('peace')?'求和申请已发出':'提出求和',has('peace')):button('war-confirm','宣战',false,'interaction-danger')}</section>
 ${allied?`<p class="interaction-alliance-summary">同盟成员：${esc((view.allianceMembers??[]).map(p=>p.teamName).join('、'))}。一方被宣战，全盟共同应战；可在盟友地块调动、发掘，使用盟友范围恢复，并共享迷雾视野。借地征服中立地块需要额外申请授权。</p>`:''}
 <section class="interaction-requests"><header class="interaction-section-heading"><h3>互动申请 <small>${activeRequests.length}</small></h3><span>${activeRequests.some(r=>r.to===me)?'有申请等待你的回应':'等待双方确认'}</span></header>${activeRequests.map(requestMarkup).join('')||`<div class="interaction-empty">${icon('inbox')}<span>暂无待处理申请</span></div>`}</section>
 ${view.matches.length?`<section class="interaction-matches"><header class="interaction-section-heading"><h3>最近友谊赛</h3><span>与该俱乐部的交锋</span></header>${view.matches.map(m=>`<div><span>${m.from===me?'你主场':'对方主场'}</span><strong>${m.score.join(' : ')}</strong><small>${m.completed?'已结束':Math.floor(m.minute)+'′'}</small><button class="ui-button" data-friendly-watch="${esc(m.id)}">${m.completed?'查看战报':'观看直播'}</button></div>`).join('')}</section>`:''}
 <details class="interaction-history" data-interaction-details="history"><summary>往来记录 <span>${pastRequests.length+view.events.length}</span></summary>${pastRequests.map(requestMarkup).join('')}${view.events.map(e=>`<p>${e.from===me?'你':'对方'} · ${esc(eventLabel(e))} <small>${esc(new Date(e.createdAt).toLocaleString('zh-CN'))}</small></p>`).join('')||'<p>暂无往来记录</p>'}</details>
 </div></div>`;
}

export function interactionNoticesMarkup(state,{pending=false}={}){
 const data=state?.interactions??{},players=new Map((data.players??[]).map(p=>[p.id,p]));
 const partner=id=>esc(players.get(id)?.teamName??'其他俱乐部');
 const button=(action,label,id,extra='')=>`<button type="button" class="ui-button ${action==='accept'?'ui-button--primary':''}" data-notice-action="${action}" data-partner="${esc(id)}" ${extra} ${pending?'disabled':''}>${label}</button>`;
 const amounts=(gold,cards,oil=0)=>`${Number(gold??0).toLocaleString('zh-CN')} 金币${oil?' · '+Number(oil).toLocaleString('zh-CN')+' 石油':''}${cards?.length?' · '+cards.length+' 张球员卡':''}`;
 const names=cards=>(cards??[]).map(p=>`${esc(p.name)}${p.upgradeLevel?' +'+Number(p.upgradeLevel):''}（${esc(p.grade)} · ${Number(p.overall??0)}）`).join('、');
 const requests=(data.requests??[]).map(r=>{
  const text={'conquest-access':'申请从你的领土持续发起中立地块征服；同意后可随时撤销',location:'申请查看你的总部位置',friendship:'希望与你建立友谊',alliance:'邀请建立同盟，自动加入盟友现有战争并开放领地合作',friendly:'邀请你进行友谊赛',peace:'向你提出求和',trade:'向你发起交易'}[r.type]??INTERACTION_LABELS[r.type];
  const terms=r.payload??{};
  const trade=r.type==='trade'?`<div class="notice-trade"><p>你获得：${amounts(terms.giveGold,terms.giveCards,terms.giveOil)}</p><p>你付出：${amounts(terms.takeGold,terms.takeCards,terms.takeOil)}</p>${terms.giveCards?.length||terms.takeCards?.length?`<details><summary>查看交易球员</summary>${terms.giveCards?.length?`<p>获得：${names(terms.giveCards)}</p>`:''}${terms.takeCards?.length?`<p>付出：${names(terms.takeCards)}</p>`:''}</details>`:''}</div>`:'';
  return `<article class="interaction-notice" data-notice-proposal="${esc(r.id)}"><header><strong>${partner(r.from)}</strong><small>${INTERACTION_LABELS[r.type]}</small></header><p>${r.type==='trade'&&r.payload?.kind==='gift'?'向你赠送资源或球员':text}</p>${r.type==='alliance'?`<small>成员：${esc((r.payload?.memberNames??[]).join('、'))}</small>`:''}${r.type==='friendly'?'<small>远征队满体力 · 不影响正式体力和伤停</small>':''}${trade}<footer>${button('accept',r.type==='trade'?(r.payload?.kind==='gift'?'接受赠送':'接受交易'):'接受',r.from,`data-proposal="${esc(r.id)}"`)}${button('reject','拒绝',r.from,`data-proposal="${esc(r.id)}"`)}</footer></article>`;
 });
 const events=(data.events??[]).map(e=>{
  const [action,type]=e.type.split(':');const text=type?`${{accept:'接受了',reject:'拒绝了',cancel:'撤销了'}[action]??action}${INTERACTION_LABELS[type]??type}申请`:({'war':'已向你宣战','alliance-formed':'与你建立同盟','alliance-war':'因同盟关系，双方已进入战争','revoke-conquest-access':'撤销了你的借地征服授权','leave-alliance':'退出了同盟','condemn':'公开谴责了你','withdraw-condemnation':'撤回了对你的谴责','revoke-location':'撤回了总部位置共享','friendly-finished':'与你的友谊赛已结束'}[e.type]??INTERACTION_LABELS[e.type]??'互动状态已更新');
  return `<article class="interaction-notice is-event" data-notice-event="${esc(e.id)}"><strong>${partner(e.from)}</strong><p>${esc(text)}</p><footer>${button('read','知道了',e.from,`data-event-id="${esc(e.id)}"`)}</footer></article>`;
 });
 const news=(data.news??[]).map(e=>`<article class="interaction-notice world-news" data-world-news="${esc(e.id)}"><header><strong>世界动态</strong><small>${esc(new Date(e.createdAt).toLocaleString('zh-CN'))}</small></header><p>${esc(e.text)}</p><footer>${button('read-news','知道了',state.playerId,`data-event-id="${esc(e.id)}"`)}</footer></article>`);
 return [...requests,...events,...news].join('');
}

// Keep stable article nodes so native scroll anchoring survives incoming/removed messages.
const noticeMarkupCache=new WeakMap();
function patchNoticeList(root,markup){
 const template=root.ownerDocument.createElement('template');template.innerHTML=markup;
 const key=node=>['noticeProposal','noticeEvent','worldNews'].map(k=>node.dataset[k]!=null?k+':'+node.dataset[k]:'').find(Boolean);
 const nodes=[...template.content.children],wanted=new Set(nodes.map(key));
 const existing=new Map([...root.children].map(node=>[key(node),node]));
 // Remove expired messages before reconciling order; do not move every surviving article.
 for(const [id,node]of existing)if(!wanted.has(id)){node.remove();existing.delete(id);}
 let cursor=root.firstElementChild;
 for(const next of nodes){
  const previous=existing.get(key(next)),node=previous??next,html=next.innerHTML;
  if(previous&&(noticeMarkupCache.get(previous)??previous.innerHTML)!==html){
   const expanded=[...previous.querySelectorAll('details')].map(d=>d.open);
   previous.replaceChildren(...next.childNodes);
   previous.querySelectorAll('details').forEach((d,i)=>{d.open=expanded[i]??false;});
  }
  noticeMarkupCache.set(node,html);
  if(node!==cursor)root.insertBefore(node,cursor);
  cursor=node.nextElementSibling;
 }
 while(cursor){const next=cursor.nextElementSibling;cursor.remove();cursor=next;}
}

export function createInteractionController({root,listRoot,notices,getState,getRequest,campaignStore,showToast=()=>{},onLocate=()=>{},onOpen=()=>{}}) {
 let target=null,view=null,pending=false,error='',timer=null,seq=0,tradeOpen=false,trade={},confirmWar=false,collapsed=globalThis.innerWidth<1100,retry=null,live=null,lastWindowMarkup=null;
 const acknowledgements=new Map();
 let lastNoticesMarkup=null;
 function renderNotices(){
  const state=getState(),data=state?.interactions??{};
  const hidden=(action,id)=>acknowledgements.get(action+':'+id)?.hidden;
  const filtered={...state,interactions:{...data,news:(data.news??[]).filter(e=>!hidden('read-news',e.id)),events:(data.events??[]).filter(e=>!hidden('read',e.id))}};
  const markup=interactionNoticesMarkup(filtered,{pending});
  notices.hidden=!markup;if(lastNoticesMarkup!==markup){patchNoticeList(notices,markup);lastNoticesMarkup=markup;}
 }
 async function acknowledge(action,extra,chosen){
  const account=getState()?.playerId,key=action+':'+(extra.eventId??chosen);
  let entry=acknowledgements.get(key);
  if(entry?.hidden)return;
  if(!entry){entry={body:{targetId:chosen,action,...extra,requestId:createRequestId()}};acknowledgements.set(key,entry);}
  entry.hidden=true;renderNotices();
  try{
   await getRequest()('/api/campaign/interactions',{method:'POST',body:entry.body});
   if(account!==getState()?.playerId||acknowledgements.get(key)!==entry)return;
   if(!extra.eventId)acknowledgements.delete(key);
   // Bound local tombstones while keeping slow, older state polls from reviving dismissed notices.
   if(acknowledgements.size>2000)acknowledgements.delete(acknowledgements.keys().next().value);
  }catch(e){if(account===getState()?.playerId&&acknowledgements.get(key)===entry){entry.hidden=false;renderNotices();showToast(e.message);}}
 }
 function render(force=false){
  const state=getState(),markup=serverPlayersMarkup(state,{collapsed});listRoot.hidden=!state?.setupComplete;
  if(listRoot.innerHTML!==markup){const scroll=listRoot.querySelector('.server-player-list')?.scrollTop??0;listRoot.innerHTML=markup;if(listRoot.querySelector('.server-player-list'))listRoot.querySelector('.server-player-list').scrollTop=scroll;}
  renderNotices();
  if(root.hidden)return;
  if(!force&&root.contains(root.ownerDocument.activeElement)&&root.ownerDocument.activeElement.matches('input'))return;
  const nextMarkup=interactionWindowMarkup(view,{pending,error,tradeOpen,trade,confirmWar});
  if(!force&&nextMarkup===lastWindowMarkup)return;
  const scroll=root.querySelector('.interaction-scroll')?.scrollTop??0;
  const openDetails=[...root.querySelectorAll('details[open][data-interaction-details]')].map(el=>el.dataset.interactionDetails);
  const innerScrolls=[...root.querySelectorAll('.interaction-roster-list,.interaction-trade-cards')].map(el=>el.scrollTop);
  lastWindowMarkup=nextMarkup;root.innerHTML=nextMarkup;if(root.querySelector('.interaction-scroll'))root.querySelector('.interaction-scroll').scrollTop=scroll;
  root.querySelectorAll('details[data-interaction-details]').forEach(el=>{el.open=openDetails.includes(el.dataset.interactionDetails);});
  root.querySelectorAll('.interaction-roster-list,.interaction-trade-cards').forEach((el,i)=>{el.scrollTop=innerScrolls[i]??0;});
 }
 async function refresh(){if(!target||pending)return;const version=++seq,account=getState()?.playerId;try{const result=await getRequest()('/api/campaign/interactions?playerId='+encodeURIComponent(target));if(version!==seq||account!==getState()?.playerId)return;view=result.view;error='';render();if(getState()?.interactions?.players.find(p=>p.id===target)?.unread>0)mutate('read');}catch(e){if(version===seq){error=e.message;render();}}}
 function close(){++seq;target=null;root.hidden=true;clearInterval(timer);timer=null;deactivateStandardWindow(root);}
 function open(id){if(!getState()?.setupComplete)return;const changed=target!==id;target=id;if(changed){view=null;tradeOpen=false;trade={};confirmWar=false;error='';retry=null;}activateStandardWindow(root);onOpen();render(true);refresh();clearInterval(timer);timer=setInterval(refresh,3000);}
 async function mutate(action,extra={},chosen=target){
  if(['read-news','read'].includes(action))return acknowledge(action,extra,chosen);
  if(pending||!chosen)return;const account=getState()?.playerId,signature=JSON.stringify([chosen,action,extra]);
  if(retry?.signature!==signature)retry={signature,body:{targetId:chosen,action,...extra,requestId:createRequestId()}};
  const body=retry.body;pending=true;++seq;error='';render(true);
  try{const result=await getRequest()('/api/campaign/interactions',{method:'POST',body});if(account!==getState()?.playerId)return;retry=null;campaignStore.setState(result.state,{source:'interaction'});if(target===chosen){view=result.view;tradeOpen=false;confirmWar=false;}if(action!=='read')showToast(action==='war'?'双方已进入战争状态':action==='accept'?'已接受申请':action==='trade'?'交易报价已发出':'互动状态已更新');if(result.matchId)await watch(result.matchId,chosen);}
  catch(e){if(account===getState()?.playerId){error=e.message;showToast(error);}}finally{pending=false;render(true);}
 }
 async function watch(id,partner=target){const account=getState()?.playerId,back=()=>{if(partner&&getState()?.playerId===account)open(partner);};try{const fetchSnapshot=()=>getRequest()('/api/campaign/interactions/match?id='+encodeURIComponent(id));const snapshot=await fetchSnapshot();if(account!==getState()?.playerId)return;live?.stop?.();live=snapshot.completed?{snapshot}:startCampaignBroadcastBackground(snapshot,{fetchSnapshot,onFinish:refresh,onOpen:state=>showCampaignBroadcast(state,{onClose:back})});showCampaignBroadcast(live,{onClose:back});}catch(e){if(account===getState()?.playerId)showToast(e.message);}}
 const openFrom=e=>{const b=e.target.closest('[data-interaction-player]');if(b&&!b.disabled)open(b.dataset.interactionPlayer);};
 listRoot.addEventListener('click',e=>{if(e.target.closest('[data-players-toggle]')){collapsed=!collapsed;render();}else openFrom(e);});notices.addEventListener('click',e=>{const b=e.target.closest('[data-notice-action]');if(!b||b.disabled)return;mutate(b.dataset.noticeAction,b.dataset.proposal?{proposalId:b.dataset.proposal}:{eventId:b.dataset.eventId},b.dataset.partner);});
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.interactionLocate){const id=b.dataset.interactionLocate;close();onLocate(id);return;}
  if(b.dataset.friendlyWatch)return watch(b.dataset.friendlyWatch);
  if(b.dataset.interactionResponse)return mutate(b.dataset.interactionResponse,{proposalId:b.dataset.proposal});
  const action=b.dataset.interactionAction;if(!action)return;
  if(action==='leave-alliance-confirm'){confirmWar='leave';render(true);root.querySelector('.interaction-scroll').scrollTop=0;return;}
  if(action==='war-confirm'){confirmWar=true;render(true);root.querySelector('.interaction-scroll').scrollTop=0;return;}if(action==='war-cancel'){confirmWar=false;return render(true);}
  if(['trade-exchange','trade-gift'].includes(action)){trade={...trade,mode:action==='trade-gift'?'gift':'trade',...(action==='trade-gift'?{takeGold:0,takeOil:0,takeCardIds:[]}:{} )};render(true);return;}
  if(action==='gift-form'){trade={mode:'gift',takeGold:0,takeOil:0,takeCardIds:[]};tradeOpen=true;render(true);root.querySelector('.interaction-scroll').scrollTop=0;return;}
  if(action==='trade-form'){trade={...trade,mode:'trade'};tradeOpen=true;render(true);root.querySelector('.interaction-scroll').scrollTop=0;return;}if(action==='trade-close'){tradeOpen=false;return render(true);}mutate(action);
 });
 root.addEventListener('input',e=>{const input=e.target;if(input.dataset.tradeGold)trade[input.dataset.tradeGold+'Gold']=Number(input.value);if(input.dataset.tradeOil)trade[input.dataset.tradeOil+'Oil']=Number(input.value);if(input.dataset.tradeCard){const key=input.dataset.tradeCard+'CardIds',ids=new Set(trade[key]??[]);input.checked?ids.add(input.value):ids.delete(input.value);trade[key]=[...ids].sort();}});
 root.addEventListener('submit',e=>{if(!e.target.matches('[data-interaction-trade]'))return;e.preventDefault();mutate('trade',{trade:{giveGold:0,takeGold:0,giveOil:0,takeOil:0,giveCardIds:[],takeCardIds:[],...trade}});});
 registerStandardWindow(root,{onRequestClose:close});
 campaignStore.subscribe(({state,previousState})=>{if(state?.playerId!==previousState?.playerId||!state?.setupComplete){acknowledgements.clear();close();live?.stop?.();live=null;view=null;retry=null;}render();});render();return {open,close,refresh};
}
