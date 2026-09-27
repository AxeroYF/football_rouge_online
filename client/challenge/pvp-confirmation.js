import {bindSmallWindow} from '../ui/small-window.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function confirmPvpAttack({documentRef=document,total=30000,shares=null,conquest=null}){
 return new Promise(resolve=>{
  const overlay=documentRef.createElement('dialog');overlay.className='small-window pvp-attack-confirmation';overlay.style.position='fixed';overlay.style.zIndex='2100';
  overlay.innerHTML=`<section class="small-window__dialog" data-small-window-dialog tabindex="-1" aria-label="确认进攻玩家领土" style="max-width:560px;height:auto;padding:24px"><h2>确认进攻玩家领土</h2><div class="pvp-confirmation-copy"><p>本次需要支付 <strong>${total.toLocaleString()} 金币</strong>保证金。</p>${shares?'<p>全体盟友均摊：</p><ul>'+shares.map(s=>`<li>${esc(s.name)}：${s.amount.toLocaleString()} 金币</li>`).join('')+'</ul>':''}<p>进攻获胜：原额返还。挑战失败：保证金转给防守方，并休整20分钟；不会扣除其他金币。</p><p>每天最多成功征服 ${esc(conquest?.limit??8)} 块${conquest?'':'（奇观可增加总次数）'}，其中玩家领土最多 ${esc(conquest?.playerLimit??4)} 块。失败不扣次数；未能开战或取消出征将退还保证金。</p></div><footer><button type="button" data-small-window-close>取消</button><button type="button" data-pvp-confirm>确认进攻并支付</button></footer></section>`;
  documentRef.body.append(overlay);const previous=documentRef.activeElement;
  let settled=false;
  const close=accepted=>{if(settled)return;settled=true;cleanup();if(overlay.open)overlay.close();overlay.remove();previous?.focus?.({preventScroll:true});resolve(accepted);};
  const cleanup=bindSmallWindow(overlay,{onRequestClose:()=>close(false)});
  overlay.querySelector('[data-pvp-confirm]').onclick=()=>close(true);
  overlay.addEventListener('cancel',event=>{event.preventDefault();close(false);});
  overlay.showModal();
 });
}
