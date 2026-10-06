import {S4_ENHANCEMENT} from '../../shared/config/enhancement.mjs';
import {filterYooglePlayers} from '../yoogle/yoogle-controller.js';
import {playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js';
import {createRequestId} from '../core/request-id.js';
import {patchMarkup} from '../ui/patch-markup.js';
import {s4EnhancementAbilityBonus} from '../../shared/config/enhancement.mjs';

const endpoint='/api/campaign/card-purchases';
const button=(action,text,extra='')=>'<button type="button" data-cpo-action="'+action+'" '+extra+'>'+text+'</button>';
const terms=payment=>[payment.gold?Number(payment.gold).toLocaleString('zh-CN')+' 金币':'',payment.oil?Number(payment.oil).toLocaleString('zh-CN')+' 石油':'',...(payment.territories??[]).map(t=>'地块：'+t.label)].filter(Boolean).map(esc).join(' ＋ ');
const statusText={active:'求购中',filled:'已成交',cancelled:'已撤销'};
export function createCardPurchaseController({request,onChanged=()=>{},showToast=()=>{}}){
  let root=null,mode='board',mine=false,page=0,board=null,options=null,directory=null,query='',requirements=[],payment={gold:0,oil:0,territoryIds:[]},detail=null,detailId='',selection=[],preview=null,error='',loading=false,pending=null,epoch=0,readId=0,timer=null,cancelConfirm=false;
  const retries=new Map();
  const identity=p=>String(p.cardDefinitionId??p.id);
  const card=p=>playerCardMarkup(p,{variant:'standard',animated:false,deferred:false});
  const requestedCard=r=>{const p=r.card??directory?.find(p=>identity(p)===r.definitionId);return p?card({...p,upgradeLevel:r.upgradeLevel,effectiveOverall:Number(p.baseOverall??p.overall)+s4EnhancementAbilityBonus(r.upgradeLevel)}):'';};
  const requirementsMarkup=rows=>'<div class="cpo-card-grid">'+rows.map(r=>'<div class="cpo-requested-card">'+requestedCard(r)+'</div>').join('')+'</div>';
  function close(){epoch++;readId++;clearTimeout(timer);root=null;loading=false;}
  function reset(){close();directory=null;options=null;pending=null;retries.clear();requirements=[];payment={gold:0,oil:0,territoryIds:[]};}
  function mount(node){root=node;if(!node)return;if(!node.dataset.bound){node.dataset.bound='1';node.addEventListener('click',click);node.addEventListener('input',input);node.addEventListener('change',change);}render();}
  function open(){epoch++;mode='board';mine=false;page=0;detail=null;preview=null;error='';loadBoard();}
  async function read(work,apply){const current=++readId,opened=epoch;loading=true;error='';render();try{const value=await work();if(opened!==epoch||current!==readId||!root)return;apply(value);}catch(e){if(opened===epoch&&current===readId)error=e.message;}finally{if(opened===epoch&&current===readId){loading=false;render();}}}
  const loadBoard=()=>read(()=>request(endpoint+'?mine='+(mine?'1':'0')+'&page='+page),v=>{board=v;page=v.page;});
  const loadDetail=id=>{detailId=id;return read(()=>request(endpoint+'/detail?id='+encodeURIComponent(id)),v=>{detail=v;selection=Array(v.order.requirements.length).fill('');preview=null;cancelConfirm=false;});};
  async function create(){mode='create';query='';await read(()=>Promise.all([request(endpoint+'/options'),directory?Promise.resolve(directory):request('/api/campaign/player-directory').then(v=>v.playerDirectory.players)]),([o,d])=>{options=o;directory=d;});}
  function selectedIds(){return selection.filter(Boolean);}
  async function mutate(body){
    if(pending)return;const key=JSON.stringify(body);const requestId=retries.get(key)??createRequestId();retries.set(key,requestId);
    const operation={epoch};pending=operation;error='';render();
    try{const value=await request(endpoint,{method:'POST',body:{...body,requestId}});retries.delete(key);if(operation.epoch!==epoch||!root)return;
      if(body.action==='publish'){requirements=[];payment={gold:0,oil:0,territoryIds:[]};}
      showToast(body.action==='publish'?'求购已发布':body.action==='cancel'?'求购已撤销':'交割完成');mode='board';mine=body.action!=='accept';page=0;preview=null;detail=null;
      await onChanged(value);await loadBoard();
    }catch(e){if(operation.epoch===epoch)error=e.message;}finally{if(pending===operation)pending=null;render();}
  }
  function boardMarkup(){return '<div class="cpo-toolbar">'+button('all','求购广场','aria-pressed="'+!mine+'"')+button('mine','我的求购','aria-pressed="'+mine+'"')+button('refresh','刷新')+button('create','＋ 发布求购','class="cm-primary"')+'</div><p class="cpo-note">整单交割 · 强化等级精确匹配 · 报价为整单总价</p>'+
    '<div class="cpo-orders">'+(board?.orders??[]).map(o=>'<article class="cpo-order"><header><strong>'+esc(o.buyerName)+'</strong><span>'+statusText[o.status]+'</span></header>'+requirementsMarkup(o.requirements)+'<strong class="cpo-price">'+terms(o.payment)+'</strong>'+button('detail',o.mine?'管理求购':'查看并交割','data-id="'+esc(o.id)+'"')+'</article>').join('')+'</div>'+(!loading&&!board?.orders?.length?'<div class="cpo-empty"><strong>'+(mine?'还没有发布求购':'暂无公开求购')+'</strong><p>搜索心仪的球员，发布你的第一条求购。</p>'+button('create','＋ 发布求购','class="cm-primary"')+'</div>':'')+(board?.total?'<div class="cpo-pagination">'+button('prev','上一页',page===0?'disabled':'')+'<span>第 '+(page+1)+' 页 · '+(board?.total??0)+' 条</span>'+button('next','下一页',!board||((page+1)*board.rules.pageSize>=board.total)?'disabled':'')+'</div>':'');}
  function createMarkup(){
    const results=directory&&query.trim()?filterYooglePlayers(directory,query).slice(0,12):[];
    return '<div class="cpo-toolbar">'+button('back','‹ 求购广场')+'<strong>发布求购</strong></div><div class="cpo-compose"><section><label class="cpo-search"><b>YOOGLE</b><input type="search" data-cpo-field="search" placeholder="球员姓名、俱乐部、国家或位置" aria-label="YOOGLE 搜索球员" value="'+esc(query)+'"></label><div class="cpo-search-results cpo-card-grid">'+results.map(p=>button('add',card(p)+'<span>＋ 加入求购</span>','class="cpo-card-button" aria-label="求购 '+esc(p.name)+'" data-id="'+esc(identity(p))+'"')).join('')+'</div>'+(!loading&&query.trim()&&!results.length?'<p>没有匹配的球员</p>':'')+'<div class="cpo-selected">'+requirements.map((r,i)=>{const p=directory?.find(p=>identity(p)===r.definitionId);return '<article>'+ requestedCard(r)+'<label>求购强化 <select data-cpo-level="'+i+'" aria-label="'+esc(p?.name)+'求购强化等级">'+Array.from({length:S4_ENHANCEMENT.maxLevel+1},(_,n)=>'<option value="'+n+'"'+(n===r.upgradeLevel?' selected':'')+'>＋'+n+'</option>').join('')+'</select></label>'+button('remove','移除','data-index="'+i+'"')+'</article>';}).join('')+'</div>'+(!requirements.length?'<p class="cm-empty">搜索后添加球员，可添加多名或同名多张</p>':'')+'</section><aside class="cpo-payment"><h3>整单报价</h3><label>金币<input type="number" min="0" max="'+(options?.rules.maxGold??1000000000)+'" step="1" data-cpo-field="gold" value="'+esc(payment.gold)+'"></label><label>石油<input type="number" min="0" max="'+(options?.rules.maxOil??1000000)+'" step="1" data-cpo-field="oil" value="'+esc(payment.oil)+'"></label><fieldset><legend>支付地块（最多 3 块）</legend>'+ (options?.territories??[]).map(t=>'<label class="cpo-land"><input type="checkbox" data-cpo-land="'+esc(t.id)+'"'+(payment.territoryIds.includes(t.id)?' checked':'')+'>'+esc(t.label)+'</label>').join('')+(!options?.territories?.length?'<small>暂无可交易地块</small>':'')+'</fieldset><p class="cpo-note">可用：'+Number(options?.gold??0).toLocaleString('zh-CN')+' 金币 / '+Number(options?.oil??0).toLocaleString('zh-CN')+' 石油</p><p class="cpo-note">资产不冻结，成交时重新校验。所选球员须由一名玩家整单交付，每条最多 10 人，同时最多 20 条求购。</p>'+button('publish-review','核对求购','class="cm-primary" '+(!requirements.length||!options?'disabled':''))+'</aside></div>';
  }
  function detailMarkup(){
    if(!detail)return button('back','‹ 求购广场');const o=detail.order;
    const header='<div class="cpo-toolbar">'+button('back','‹ 求购广场')+'<strong>'+esc(o.buyerName)+'的求购 · '+statusText[o.status]+'</strong></div><p class="cpo-price">整单报酬：'+terms(o.payment)+'</p>';
    if(o.mine||o.status!=='active')return header+requirementsMarkup(o.requirements)+(o.mine&&o.status==='active'?button(cancelConfirm?'cancel':'cancel-review',cancelConfirm?'确认撤销求购':'撤销求购'):'');
    return header+'<p class="cpo-note">为每个名额选择一张球员卡，整单交付后获得报酬。</p><div class="cpo-delivery">'+o.requirements.map((r,i)=>{
      const matches=detail.candidates.filter(p=>identity(p)===r.definitionId&&Number(p.upgradeLevel??0)===r.upgradeLevel);
      return '<section><div class="cpo-delivery-target"><div class="cpo-requested-card">'+requestedCard(r)+'</div><strong>求购名额 '+(i+1)+'</strong></div><div class="cpo-card-grid cpo-match-cards">'+matches.map(p=>button('choose',card(p)+'<span>'+(p.blocked?esc(p.blocked):selection[i]===p.id?'✓ 已选交付':'选择交付')+'</span>','class="cpo-card-button" data-slot="'+i+'" data-id="'+esc(p.id)+'" aria-label="交付 '+esc(p.name)+'" aria-pressed="'+(selection[i]===p.id)+'"'+(p.blocked||selection.some((id,j)=>j!==i&&id===p.id)?' disabled':''))).join('')+'</div>'+(!matches.length?'<p class="cpo-note">暂无符合条件的球员卡</p>':'')+'</section>';
    }).join('')+'</div>'+button('preview','预览交割','class="cm-primary" '+(selectedIds().length!==o.requirements.length?'disabled':''));
  }
  function render(){
    if(!root)return;const focus=root.ownerDocument.activeElement,field=focus?.dataset?.cpoField,caret=focus?.selectionStart,scroll=root.closest('[data-cm-content]')?.scrollTop;
    let html=mode==='board'?boardMarkup():mode==='create'?createMarkup():mode==='publish-review'?'<h3>确认发布求购</h3>'+requirementsMarkup(requirements)+'<p class="cpo-price">整单支付：'+terms({...payment,territories:options.territories.filter(t=>payment.territoryIds.includes(t.id))})+'</p><p>发布后所有玩家可查看，资产不冻结。</p>'+button('edit','返回修改')+button('publish','确认发布','class="cm-primary"'):detailMarkup();
    if(preview&&mode==='detail')html='<h3>确认整单交割</h3><div class="cpo-selected">'+preview.cards.map(p=>'<article>'+card(p)+'</article>').join('')+'</div><p class="cpo-price">你将获得：'+terms(preview.order.payment)+'</p><p>所选 '+preview.cards.length+' 张球员卡将转给 '+esc(preview.order.buyerName)+'。</p>'+button('select-again','返回选择')+button('accept','确认交割','class="cm-primary"');
    const surface=root.closest('.cm-surface');if(surface)surface.dataset.purchaseMode=preview?'confirm':mode;
    patchMarkup(root,'<div class="cpo-body">'+html+(loading?'<p role="status">正在加载…</p>':'')+(error?'<div class="cpo-error" role="alert">'+esc(error)+' '+button('retry','重试加载')+'</div>':'')+'</div>');
    if(pending||loading)root.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);
    if(field){const node=root.querySelector('[data-cpo-field="'+field+'"]');node?.focus();if(field==='search'&&caret!=null)node?.setSelectionRange(caret,caret);}
    if(scroll!=null)root.closest('[data-cm-content]').scrollTop=scroll;
  }
  function click(event){const target=event.target.closest('[data-cpo-action]');if(!target||pending||loading||target.disabled)return;const action=target.dataset.cpoAction;error='';
    if(action==='all'||action==='mine'){mine=action==='mine';page=0;return loadBoard();}
    if(action==='prev'||action==='next'){page+=action==='prev'?-1:1;return loadBoard();}
    if(action==='refresh')return loadBoard();if(action==='create')return create();
    if(action==='back'){mode='board';preview=null;return loadBoard();}
    if(action==='detail'){mode='detail';detail=null;return loadDetail(target.dataset.id);}
    if(action==='retry'){if(mode==='board')return loadBoard();if(mode==='create')return create();if(mode==='detail'&&detailId)return loadDetail(detailId);}
    if(action==='add'){if(requirements.length>=10){error='每条求购最多 10 名球员';}else requirements.push({definitionId:target.dataset.id,upgradeLevel:0});}
    if(action==='choose'){const slot=Number(target.dataset.slot);selection[slot]=selection[slot]===target.dataset.id?'':target.dataset.id;}
    if(action==='remove')requirements.splice(Number(target.dataset.index),1);
    if(action==='publish-review'){
      if(!Number.isSafeInteger(payment.gold)||payment.gold<0||payment.gold>options.rules.maxGold||!Number.isSafeInteger(payment.oil)||payment.oil<0||payment.oil>options.rules.maxOil||(!payment.gold&&!payment.oil&&!payment.territoryIds.length)||payment.territoryIds.length>3)error='请填写有效的整数报价，或选择最多 3 块地块';
      else if(payment.gold>options.gold||payment.oil>options.oil)error='金币或石油不足';else mode='publish-review';
    }
    if(action==='edit')mode='create';if(action==='publish')return mutate({action:'publish',requirements,payment});
    if(action==='cancel-review')cancelConfirm=true;if(action==='cancel')return mutate({action:'cancel',orderId:detail.order.id});
    if(action==='preview')return read(()=>request(endpoint+'/preview',{method:'POST',body:{orderId:detail.order.id,cardIds:selectedIds()}}),v=>preview=v);
    if(action==='select-again')preview=null;
    if(action==='accept')return mutate({action:'accept',orderId:detail.order.id,cardIds:preview.cards.map(p=>p.id),quote:preview.quote});
    render();
  }
  function input(event){if(pending||loading)return;const key=event.target.dataset.cpoField;if(key==='search'){query=event.target.value;clearTimeout(timer);timer=setTimeout(render,160);}else if(key==='gold'||key==='oil')payment[key]=Number(event.target.value);}
  function change(event){if(pending||loading)return;const node=event.target;if(node.dataset.cpoLevel!==undefined){requirements[Number(node.dataset.cpoLevel)].upgradeLevel=Number(node.value);render();}
    if(node.dataset.cpoLand!==undefined){payment.territoryIds=payment.territoryIds.filter(id=>id!==node.dataset.cpoLand);if(node.checked)payment.territoryIds.push(node.dataset.cpoLand);}
  }
  return {mount,open,close,reset};
}
