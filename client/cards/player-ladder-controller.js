import {playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js';
import {playerDetailBodyMarkup} from '../player-card/player-detail-window.js';
import {registerStandardWindow,activateStandardWindow,deactivateStandardWindow} from '../ui/standard-window.js';
export function createPlayerLadderController({root,getState,getRequest,campaignStore,onOpen=()=>{},onClose=()=>{},showToast=()=>{}}){
 let data=null,page=0,busy=false,error='',detail=null,epoch=0,owner=null,expiresAt=0,timer=null;
 const fresh=()=>data&&Date.now()<expiresAt;
 function draw(){
  const rows=data?.entries??[],pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages-1);
  root.innerHTML=`<section class="standard-window__surface player-ladder-surface"><header class="ladder-hero"><div><small>YELLOWDOGS / TOP 100</small><h2>球员天梯</h2><p>全服球员卡 · 强化后的真实总评</p></div><div class="ladder-summary"><strong>${rows.length}</strong><span>上榜球员卡</span></div><button data-ladder-close aria-label="关闭球员天梯">×</button></header><div class="ladder-toolbar"><span>${data?'更新于 '+esc(new Date(data.generatedAt).toLocaleTimeString('zh-CN'))+' · 每分钟更新快照':'全服排行'}<small>同分按强化等级、归属及卡片编号稳定排序</small></span><button data-ladder-refresh ${busy?'disabled':''}>${busy?'读取中…':'刷新'}</button></div>${error?`<p class="ladder-error" role="alert">${esc(error)}</p>`:''}<div class="ladder-scroll"><div class="ladder-grid">${rows.slice(page*20,(page+1)*20).map((entry,i)=>`<button class="ladder-entry ${entry.rank<=3?'is-podium':''}" data-ladder-entry="${page*20+i}" aria-label="第${entry.rank}名 ${esc(entry.card.name)}，总评${entry.score}，${esc(entry.owner.teamName)}"><div class="ladder-rank"><b>#${String(entry.rank).padStart(2,'0')}</b><span>总评 <strong>${entry.score}</strong></span></div>${playerCardMarkup(entry.card,{variant:'standard',animated:false,deferred:true})}<h3>${esc(entry.card.name)}</h3><p>${esc(entry.card.role)} · ${esc(entry.card.club)}</p><div class="ladder-owner"><small>卡片归属</small><b>${esc(entry.owner.teamName)}</b><span>${esc(entry.owner.nickname)}</span></div></button>`).join('')||`<p class="ladder-empty">${busy?'正在读取球员天梯…':error?'读取失败，请重试':'暂无可上榜的球员卡'}</p>`}</div></div><footer><span>点击球员卡查看详情</span><nav aria-label="天梯翻页"><button data-ladder-prev ${!page?'disabled':''}>上一页</button><b>${page+1} / ${pages}</b><button data-ladder-next ${page+1>=pages?'disabled':''}>下一页</button></nav></footer></section>`;
  root.querySelector('[data-ladder-close]').onclick=close;root.querySelector('[data-ladder-refresh]').onclick=()=>{if(fresh())return showToast('当前已是最新快照，每分钟更新一次');void load();};
  root.querySelector('[data-ladder-prev]').onclick=()=>{page--;draw();};root.querySelector('[data-ladder-next]').onclick=()=>{page++;draw();};
  root.querySelectorAll('[data-ladder-entry]').forEach(el=>el.onclick=()=>showDetail(rows[Number(el.dataset.ladderEntry)]));
 }
 function showDetail(entry){
  detail?.remove();detail=document.createElement('dialog');detail.className='ladder-detail';detail.setAttribute('aria-label',entry.card.name+'球员详情');
  detail.innerHTML=`<header><div><small>全服第 ${entry.rank} 名 · 真实总评 ${entry.score} · 强化 +${entry.card.upgradeLevel}</small><h2>${esc(entry.card.name)}</h2><p>归属：${esc(entry.owner.teamName)} · ${esc(entry.owner.nickname)}</p></div><button aria-label="关闭球员详情">×</button></header>${playerDetailBodyMarkup(entry.card,{showCardStatus:false,compact:true})}`;
  document.body.append(detail);detail.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});detail.querySelector('button').onclick=()=>{detail.close();detail.remove();detail=null;};detail.addEventListener('cancel',()=>{detail.remove();detail=null;});detail.showModal();
 }
 function schedule(){clearTimeout(timer);if(root.hidden)return;const delay=fresh()?Math.max(1000,expiresAt-Date.now()):60000;timer=setTimeout(()=>{if(!document.hidden&&!root.hidden)void load();else schedule();},delay);}
 async function load(){if(busy||root.hidden)return;const token=++epoch,account=getState()?.playerId;busy=true;error='';if(!data)draw();else root.querySelector('[data-ladder-refresh]').disabled=true;
  try{const value=await getRequest()('/api/campaign/player-ladder');if(token!==epoch||account!==getState()?.playerId||root.hidden)return;data=value.ladder;expiresAt=Date.now()+Math.max(0,data.refreshAt-(value.serverNow??data.generatedAt));draw();}
  catch(e){if(token===epoch){error=e.message;draw();}}
  finally{if(token===epoch){busy=false;const button=root.querySelector('[data-ladder-refresh]');if(button){button.disabled=false;button.textContent='刷新';}schedule();}}
 }
 function close({silent=false}={}){++epoch;busy=false;clearTimeout(timer);detail?.remove();detail=null;deactivateStandardWindow(root);root.hidden=true;if(!silent)onClose();}
 function open(){const id=getState()?.playerId;if(!id||!getState()?.setupComplete)return showToast('请先完成建队');if(owner!==id){owner=id;data=null;page=0;}activateStandardWindow(root);onOpen();draw();if(!fresh())void load();else schedule();}
 registerStandardWindow(root,{onRequestClose:close});
 campaignStore.subscribe(({state,previousState})=>{if(state?.playerId!==previousState?.playerId){close();data=null;owner=null;}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!root.hidden&&!fresh())void load();});
 return {open,close};
}
