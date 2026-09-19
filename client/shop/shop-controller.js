import {registerStandardWindow,activateStandardWindow,deactivateStandardWindow} from '../ui/standard-window.js';
import {playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js?v=20260905-shield-v1';
import {goldAmountMarkup} from '../ui/currency.js';
import {SHOP_PACK_ART} from '../../shared/config/shop.mjs';
export function shopRequestId(cryptoImpl=globalThis.crypto){
 if(cryptoImpl.randomUUID)return cryptoImpl.randomUUID();
 const bytes=cryptoImpl.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function shopWindowMarkup(view,{pending=false,error=''}={}){
 const gold=Number(view?.gold??0),oil=Number(view?.oil??0),offers=view?.offers??[];
 return `<div class="standard-window__surface shop-surface"><header class="shop-header"><div><h2>商店</h2><span data-shop-wallet>${goldAmountMarkup(gold)} · ${oil.toLocaleString('zh-CN')} 石油</span></div><button class="ui-button" type="button" data-stage-window-close aria-label="关闭商店">×</button></header><div class="shop-content" aria-busy="${pending}">
 <section><div class="shop-section-heading"><div><h3>限量传奇</h3><p>金币或石油支付 · 共用限量库存</p></div><span class="shop-countdown" data-shop-countdown>正在同步…</span></div>
 ${error?`<p class="shop-error" role="alert">${esc(error)}</p>`:''}
 <div class="shop-legend-grid">${offers.map(o=>`<article class="shop-legend ${o.sold?'is-sold':''}" data-shop-offer="${esc(o.id)}"><div class="shop-card-art">${playerCardMarkup(o.player,{variant:'standard',animated:!o.sold})}${o.sold?'<span class="shop-sold-stamp">已售出</span>':''}</div><div class="shop-legend-caption"><strong>${esc(o.player.name)}</strong></div><button class="ui-button ui-button--primary" data-shop-buy="player" data-shop-item="${esc(o.id)}" ${pending||o.sold||gold<o.price?'disabled':''}>${o.sold?'已售出 · 等待刷新':gold<o.price?'金币不足 · ':''}${o.sold?'':goldAmountMarkup(o.price)}</button>${!o.sold&&o.oilPrice!=null?`<button class="ui-button shop-oil-buy" data-shop-buy="player" data-shop-currency="oil" data-shop-item="${esc(o.id)}" ${pending||oil<o.oilPrice?'disabled':''}>${oil<o.oilPrice?'石油不足 · ':''}${Number(o.oilPrice).toLocaleString('zh-CN')} 石油</button>`:''}</article>`).join('')}</div>
 ${offers.length&&offers.every(o=>o.sold)?'<p class="shop-empty">本轮传奇球员已售罄，等待下一轮刷新。</p>':!view?'<p class="shop-empty">正在加载商店…</p>':!offers.length?'<p class="shop-empty">暂无传奇球员可供出售</p>':''}</section>
 <section class="shop-pack-section"><div class="shop-section-heading"><div><h3>球员卡包</h3></div></div><div class="shop-pack-grid">${(view?.packs??[]).map(p=>`<article class="shop-pack"><img src="${SHOP_PACK_ART[p.type]}" alt="${esc(p.name)}" draggable="false"><h4>${esc(p.name)}</h4><button class="ui-button" data-shop-buy="pack" data-shop-item="${esc(p.type)}" ${pending||gold<p.price?'disabled':''}>${gold<p.price?'金币不足 · ':''}${goldAmountMarkup(p.price)}</button></article>`).join('')}</div></section></div></div>`;
}
export function createShopController({root,trigger,getState,getRequest,campaignStore,onOpen=()=>{},onClose=()=>{},showToast=()=>{}}){
 let view=null,pending=false,error='',timer=null,offset=0,fetching=false,generation=0,retry=null;
 function countdown(){const node=root.querySelector('[data-shop-countdown]');if(!node||!view)return;const sec=Math.max(0,Math.ceil((view.refreshAt-Date.now()-offset)/1000));node.textContent=sec?`下次刷新 ${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`:'正在刷新…';}
 function render(){if(root.hidden)return;const scroll=root.querySelector('.shop-content')?.scrollTop??0;root.innerHTML=shopWindowMarkup(view,{pending,error});root.querySelector('.shop-content').scrollTop=scroll;countdown();}
 function accept(next){view=next;offset=next.serverNow-Date.now();}
 async function refresh(){if(root.hidden||fetching||pending)return;fetching=true;const token=generation;try{const value=await getRequest()('/api/campaign/shop');if(token!==generation)return;const changed=JSON.stringify({...view,serverNow:0})!==JSON.stringify({...value.shop,serverNow:0});accept(value.shop);if(changed||error){error='';render();}}catch(e){if(token===generation){error=e.message||'商店同步失败';render();}}finally{fetching=false;}}
 function close(){if(root.hidden)return;generation++;clearInterval(timer);timer=null;root.hidden=true;deactivateStandardWindow(root);onClose();}
 function open(){if(!getState()?.setupComplete)return;generation++;activateStandardWindow(root);onOpen();render();refresh();clearInterval(timer);let ticks=0;timer=setInterval(()=>{countdown();if(++ticks%5===0||view&&Date.now()+offset>=view.refreshAt)refresh();},1000);}
 async function buy(kind,itemId,currency='gold'){
  if(pending||!view)return;pending=true;error='';generation++;
  const signature=JSON.stringify([kind,itemId,kind==='player'?view.rotationId:null,currency]);
  if(retry?.signature!==signature)retry={signature,body:{requestId:shopRequestId(),kind,itemId,currency,...(kind==='player'?{rotationId:view.rotationId}:{})}};
  render();try{const value=await getRequest()('/api/campaign/shop/buy',{method:'POST',body:retry.body});campaignStore.setState(value.state,{source:'shop-buy'});accept(value.shop);retry=null;showToast(kind==='pack'?`${value.purchase.name}已放入背包`:`${value.purchase.name} +3 已加入球队`);}
  catch(e){error=e.message||'购买未完成，请重试';showToast(error);}
  finally{pending=false;render();refresh();}
 }
 root.addEventListener('click',e=>{const b=e.target.closest?.('[data-shop-buy]');if(b&&!b.disabled)buy(b.dataset.shopBuy,b.dataset.shopItem,b.dataset.shopCurrency);});
 trigger.addEventListener('click',open);registerStandardWindow(root,{onRequestClose:close});
 campaignStore.subscribe(({state})=>{trigger.hidden=!state?.setupComplete;if(!state?.setupComplete)close();});trigger.hidden=!getState()?.setupComplete;
 return {open,close,refresh};
}
