import {mergeDynamicSnapshot} from './dynamic-broadcast.js';
import {registerStandardWindow,activateStandardWindow,deactivateStandardWindow} from '../ui/standard-window.js';
import {patchMarkup} from '../ui/patch-markup.js';
import {showCampaignBroadcast} from '../../campaign-broadcast.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const teamLabel=team=>`${esc(team?.kind==='elite'?team.name.replace(/〔豪门〕$/,''):team?.name)}${team?.kind==='elite'?' <span class="league-ai-badge" aria-label="AI 球队">AI</span>':''}`;
const time=at=>new Date(at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
const audienceMarkup=people=>`<span class="league-audience"><b>${people?.length??0} 人观看</b><small>${people?.length?people.map(p=>esc(p.name)).join('、'):'暂无观众'}</small></span>`;
export const dynamicBadge=f=>f.engine==='v2.2'||f.dynamic?'<span class="league-dynamic-badge" title="V2.2 动态引擎比赛">◉ 动态直播</span>':'';
const num=n=>Number(n??0).toLocaleString('zh-CN');
export function leaguePanelMarkup(view,tab='standings',tv=false){
 const tabs=tv?[['live','直播'],['mine','我的日程'],['history','历史战绩']]:[['standings','积分榜'],['schedule','赛程'],['goals','射手榜'],['assists','助攻榜'],['rewards','奖励']];
 let content='<p class="league-empty">正在读取联赛…</p>';
 if(view&&!view.day)content=`<p class="league-empty">每日 09:50 生成赛程，10:00 开赛。${view.waitingForTeams?'等待参赛球队就绪。':''}</p>`;
 if(view){
  const teams=new Map(view.standings.map(t=>[t.id,t]));
  if(tab==='standings')content=`<p class="league-table-hint">左右滑动查看完整数据</p><table class="league-table league-standings"><thead><tr><th>名次</th><th>球队</th><th>赛</th><th>胜/平/负</th><th>进/失</th><th>净胜</th><th>积分</th></tr></thead><tbody>${view.standings.map(t=>`<tr class="${t.id===view.ownId?'is-own':''}"><td>${t.rank}</td><td><b>${teamLabel(t)}</b></td><td>${t.played}</td><td>${t.won}/${t.drawn}/${t.lost}</td><td>${t.goalsFor}/${t.goalsAgainst}</td><td>${t.goalDifference}</td><td><strong>${t.points}</strong></td></tr>`).join('')}</tbody></table>`;
  else if(['goals','assists'].includes(tab)){const rows=tab==='goals'?view.scorers:view.assists;content=rows.length?`<table class="league-table"><thead><tr><th>排名</th><th>球员 / 球队</th><th>出场</th><th>${tab==='goals'?'进球':'助攻'}</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.name)}</b><small>${teamLabel(teams.get(r.teamId)??{name:r.teamName})}</small></td><td>${r.appearances}</td><td><strong>${r[tab==='goals'?'goals':'assists']}</strong></td></tr>`).join('')}</tbody></table>`:'<p class="league-empty">比赛完成后更新榜单。</p>';}
  else if(tab==='rewards')content=`<p class="league-note">按总榜名次自动发放；AI 球队不领取，奖励不顺延。</p><table class="league-table"><thead><tr><th>名次</th><th>金币</th><th>传奇礼包</th></tr></thead><tbody>${view.rewards.map(r=>`<tr><td>${r.rank}</td><td>${num(r.gold)}</td><td>${r.packs}</td></tr>`).join('')}</tbody></table><p class="league-note">主场观众为球迷总数的 50%，受球场容量限制；每位观众收入 0.1 金币，另计已生效的奇观加成。</p>`;
  else {const fixtures=view.fixtures.filter(f=>tab==='live'?f.status==='live':tab==='mine'?[f.homeId,f.awayId].includes(view.ownId):tab==='history'?f.status==='completed'&&[f.homeId,f.awayId].includes(view.ownId):true);
   content=fixtures.map(f=>`<article class="league-fixture ${f.status}${f.engine==='v2.2'?' is-dynamic':''}" data-fixture="${esc(f.id)}"><time>第 ${f.round} 轮<br><span class="league-fixture-clock">${time(f.startsAt)}${dynamicBadge(f)}</span></time><div><span>${teamLabel(teams.get(f.homeId))}</span><strong>${f.score?f.score.join(' : '):'VS'}</strong><span>${teamLabel(teams.get(f.awayId))}</span></div><aside>${tv&&f.status==='live'?audienceMarkup(f.spectators):''}${f.status==='live'?`<small>直播 · ${Math.ceil(f.minute??0)}′</small>`:f.forfeit?'<small>未正常开赛</small>':f.status==='completed'?'<small>已结束</small>':'<small>未开始</small>'}${f.status==='live'||f.hasReport?`<button type="button" data-league-watch="${esc(f.id)}">${f.status==='live'?'观看直播':'查看战报'}</button>`:''}</aside></article>`).join('')||(view.day?'<p class="league-empty">暂无比赛。</p>':'<p class="league-empty">赛程待生成 · 每日 09:50</p>');
  }
 }
 return `<div class="league-surface standard-window__surface"><header class="league-heading"><div><h2>${tv?'电视台':'每日联赛'}${tv&&view?.fixtures?.some(f=>f.status==='live')?' <span class="league-live-badge">LIVE</span>':''}</h2><p>${esc(view?.day??'赛程待生成')} · ${view?.rewarded?'已结算':'18 轮'} · 每日 09:50 重置</p></div><button type="button" data-league-close aria-label="关闭">×</button></header><nav class="league-tabs">${tabs.map(([id,label])=>`<button type="button" data-league-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</nav><div class="league-content">${content}</div><p class="league-error" role="status"></p></div>`;
}
export function createDailyLeagueController({root,trigger,tvTrigger,notices,getState,getRequest,campaignStore,showToast=()=>{}}){
 let view=null,tab='standings',tv=false,opened=false,epoch=0,pending=false,timer=null,viewer=null,watchTimer=null,watchEpoch=0,watchPending=false,watchSession=null,owner=null,noticeDay=null;
 const sidebar=trigger.closest('#daily-league-sidebar')??trigger;
 const dismissed=new Set();
 const updateLive=(count,dynamic=0)=>{patchMarkup(tvTrigger,`电视台${count>0?' <span class="league-live-badge">LIVE</span>':''}${dynamic>0?dynamicBadge({dynamic:true}):''}`);tvTrigger.setAttribute('aria-label',count>0?`电视台，${count} 场直播`:'电视台');};
 const release=session=>{if(session)Promise.resolve(session.pending).catch(()=>{}).then(()=>session.request('/api/campaign/league/leave',{method:'POST',body:{id:session.id,session:session.token}})).catch(()=>{});};
 const stopWatch=()=>{const session=watchSession;watchSession=null;release(session);watchEpoch++;clearTimeout(watchTimer);if(viewer){viewer.onSuperseded=null;viewer.dynamicRenderer?.destroy();viewer.dynamicRenderer=null;viewer.renderOverlay=null;if(viewer.opened){const overlay=document.querySelector('#campaign-broadcast');if(overlay){overlay.hidden=true;deactivateStandardWindow(overlay);overlay.replaceChildren();}}viewer.opened=false;}viewer=null;};
 const render=()=>patchMarkup(root,leaguePanelMarkup(view,tab,tv));
 const close=(stop=true)=>{if(stop)stopWatch();opened=false;epoch++;clearTimeout(timer);root.hidden=true;deactivateStandardWindow(root);trigger.setAttribute('aria-expanded','false');trigger.textContent='展开';sidebar.classList.remove('is-expanded');};
 const refresh=async()=>{clearTimeout(timer);if(!opened||document.hidden||pending)return;const token=epoch;pending=true;try{const data=await getRequest()('/api/campaign/league');if(token!==epoch||!opened)return;view=data.league;updateLive(view.fixtures.filter(f=>f.status==='live').length,view.fixtures.filter(f=>f.status==='live'&&f.engine==='v2.2').length);render();}catch(e){if(token===epoch&&opened){const error=root.querySelector('.league-error');if(error)error.textContent=e.message;}}finally{pending=false;if(opened&&!document.hidden)timer=setTimeout(refresh,10000);}};
 const open=(television=false)=>{if(!getState()?.setupComplete)return;stopWatch();tv=television;tab=tv?'live':'standings';opened=true;epoch++;root.classList.toggle('is-league-drawer',!tv);root.hidden=false;render();activateStandardWindow(root);trigger.setAttribute('aria-expanded',String(!tv));trigger.textContent=tv?'展开':'收起';sidebar.classList.toggle('is-expanded',!tv);refresh();};
 const watch=async id=>{
  stopWatch();const token=watchEpoch,session={id,token:globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),request:getRequest(),pending:null};watchSession=session;
  const fetchSnapshot=()=>session.pending=session.request('/api/campaign/league/watch',{method:'POST',body:{id,session:session.token,afterTick:viewer?.snapshot?.live?.broadcast?.dynamic?.frames.at(-1)?.tick}});
  try{const snapshot=await fetchSnapshot();if(token!==watchEpoch)return;close(false);viewer={snapshot,opened:true,onSuperseded:stopWatch};showCampaignBroadcast(viewer,{onClose:()=>{stopWatch();open(true);}});
   const poll=async()=>{if(token!==watchEpoch)return;if(!viewer?.opened){stopWatch();return;}if(document.hidden){watchTimer=setTimeout(poll,2000);return;}if(watchPending){watchTimer=setTimeout(poll,2000);return;}watchPending=true;
    try{const next=await fetchSnapshot();if(token!==watchEpoch||!viewer)return;viewer.snapshot=mergeDynamicSnapshot(viewer.snapshot,next);viewer.renderOverlay?.();if(next.completed){release(watchSession);watchSession=null;return;}}catch(e){if(token===watchEpoch&&e.status===404){showToast(e.message);stopWatch();return;}}finally{watchPending=false;}
    if(token===watchEpoch&&viewer?.opened)watchTimer=setTimeout(poll,2000);
   };if(!snapshot.completed)watchTimer=setTimeout(poll,2000);else {release(watchSession);watchSession=null;}
  }catch(e){if(token===watchEpoch){stopWatch();showToast(e.message);}}
 };
 registerStandardWindow(root,{onRequestClose:close});
 trigger.onclick=()=>opened&&!tv?close():open(false);tvTrigger.onclick=()=>open(true);
 root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-league-close'))close();if(button.dataset.leagueTab){tab=button.dataset.leagueTab;render();}if(button.dataset.leagueWatch)watch(button.dataset.leagueWatch);});
 const sync=()=>{const state=getState(),id=state?.world?.viewerId??state?.accountId??state?.profile?.id??state?.draft?.teamName??null;if(owner!==id){owner=id;view=null;dismissed.clear();close();stopWatch();}
  if(noticeDay!==state?.dailyLeague?.day){noticeDay=state?.dailyLeague?.day;dismissed.clear();}
  updateLive(state?.dailyLeague?.liveCount??0,state?.dailyLeague?.dynamicLiveCount??0);
  sidebar.hidden=tvTrigger.hidden=!state?.setupComplete;const list=(state?.dailyLeague?.unread??[]).filter(n=>!dismissed.has(n.id));notices.hidden=!list.length;
  patchMarkup(notices,list.map(n=>`<article class="league-notice" data-league-notice="${esc(n.id)}"><button type="button" data-league-read="${esc(n.id)}" aria-label="关闭通知">×</button>${dynamicBadge(n)}<strong>${esc(n.title?.replaceAll('〔豪门〕','[AI]'))}</strong><p>${esc(n.text)}</p>${n.matchId?`<button class="league-notice-watch" type="button" data-league-watch="${esc(n.matchId)}">${n.kind==='live'?'进入电视台':'查看战报'}</button>`:''}</article>`).join(''));
 };
 notices.addEventListener('click',async event=>{const matchId=event.target.closest('[data-league-watch]')?.dataset.leagueWatch;if(matchId){watch(matchId);return;}const id=event.target.closest('[data-league-read]')?.dataset.leagueRead;if(!id)return;dismissed.add(id);sync();try{await getRequest()('/api/campaign/league/read',{method:'POST',body:{id}});}catch(e){dismissed.delete(id);sync();showToast(e.message);}});
 const visible=()=>{if(!document.hidden&&opened)refresh();};document.addEventListener('visibilitychange',visible);const unsubscribe=campaignStore.subscribe(sync);sync();
 return {open,close,destroy(){close();stopWatch();unsubscribe?.();document.removeEventListener('visibilitychange',visible);}};
}
