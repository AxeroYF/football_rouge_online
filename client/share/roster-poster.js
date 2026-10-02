import {clubSquad,squadNames} from '../social/club-presentation.js';
import {playerCardMarkup,escapePlayerCardHtml as esc} from '../player-card/player-card.js';
import {renderDomPng} from './dom-image.js';
let currentClose=null;
const PAGE_SIZE=20;
export function posterPlayers(state,squad,mode){const data=clubSquad(state,squad);return {data,players:mode==='lineup'?data.players.map(p=>p.player):data.roster};}
export function posterMarkup({teamName,title,squad,mode,data,players,page=0,date,theme='obsidian'}){
 const shown=mode==='lineup'?players:players.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
 // Arrange role groups rather than exposing exact tactical coordinates.
 const groups=['GK','DEF','MID','ATT'];
 const group=p=>p.role==='GK'?'GK':/^(CB|LB|RB|LWB|RWB)$/.test(p.role)?'DEF':/^(ST|CF|LW|RW)$/.test(p.role)?'ATT':'MID';
 const card=p=>`<div class="poster-card"><div class="poster-card-platform" aria-hidden="true"></div>${playerCardMarkup(p,{variant:'standard',animated:false,eager:true})}<span>${esc(p.name)}</span></div>`;
 const content=mode==='lineup'?groups.reverse().map(g=>{const list=shown.filter(p=>group(p)===g);return list.length?`<div class="poster-line">${list.map(card).join('')}</div>`:'';}).join(''):`<div class="poster-card-grid">${shown.map(card).join('')}</div>`;
 return `<article class="roster-poster-page poster-theme-${theme==='silver'?'silver':'obsidian'} ${mode==='lineup'?'is-lineup':'is-roster'}"><header><div class="poster-brand"><b>黄狗风云</b><span>CLUB COLLECTION / ${mode==='lineup'?'STARTING XI':'SQUAD EDITION'}</span></div><div class="poster-edition" aria-hidden="true">${mode==='lineup'?'XI':String(page+1).padStart(2,'0')}</div><div class="poster-heading"><small>THE PLAYERS. THE STORY.</small><h1>${esc(teamName)}</h1><p>${esc(title|| (mode==='lineup'?'我的首发阵容':'我的球员名单'))}</p></div><div class="poster-meta"><span>${squadNames[squad]} · ${mode==='lineup'?esc(data.formation):players.length+' 名球员'}</span><span>${mode==='lineup'?'首发 '+shown.length+' 人':'第 '+(page+1)+' / '+Math.max(1,Math.ceil(players.length/PAGE_SIZE))+' 张'}</span></div></header><main><div class="poster-stage-light" aria-hidden="true"></div>${content||'<p class="poster-empty">当前编队暂无可展示的球员</p>'}</main><footer><span>用自己的阵容，写自己的故事。</span><span>${esc(date)}</span></footer></article>`;
}
export function openRosterPoster(state){
 currentClose?.();
 const snapshot=structuredClone({playerId:state.playerId,nickname:state.nickname,draft:state.draft,tactics:state.tactics,playerSquads:state.playerSquads,leagueRegistration:state.leagueRegistration,formationResearch:state.formationResearch}),teamName=state.draft?.teamName??'我的俱乐部';
 const squads=new Map();const getPlayers=(squad,mode)=>{if(!squads.has(squad))squads.set(squad,clubSquad(snapshot,squad));const data=squads.get(squad);return {data,players:mode==='lineup'?data.players.map(p=>p.player):data.roster};};
 const dialog=document.createElement('dialog');dialog.className='roster-poster-dialog';dialog.setAttribute('aria-label','阵容海报');
 dialog.innerHTML=`<header><div><small>CLUB STUDIO</small><h2>分享我的球队</h2></div><button data-poster-close aria-label="关闭海报">×</button></header><div class="poster-controls"><label>编队<select name="squad">${Object.entries(squadNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>版式<select name="mode"><option value="lineup">首发阵容</option><option value="roster">球员名单</option></select></label><label>风格<select name="theme"><option value="obsidian">曜石金 · 聚光展台</option><option value="silver">月光银 · 收藏画册</option></select></label><label class="poster-title-input">海报标题<input name="title" maxlength="32" placeholder="给这支球队写一句话"></label></div><div class="poster-preview-scroll"><div class="poster-preview-stage"></div></div><div class="poster-page-nav"><button data-poster-prev>上一张</button><span></span><button data-poster-next>下一张</button></div><p class="poster-status" role="status">图片仅展示球员卡与编队信息，不包含资源、体力或精确战术站位。</p><footer><button data-poster-generate>生成分享图片</button><a data-poster-save hidden>保存 PNG</a><button data-poster-copy hidden>复制图片</button><button data-poster-share hidden>系统分享</button></footer>`;
 document.body.append(dialog);let page=0,url=null,blob=null,busy=false,controller=null,closed=false;
 const q=s=>dialog.querySelector(s),stage=q('.poster-preview-stage'),status=q('.poster-status');
 const cleanup=()=>{closed=true;controller?.abort();observer.disconnect();if(url)URL.revokeObjectURL(url);dialog.remove();if(currentClose===close)currentClose=null;};
 const close=()=>{dialog.close();cleanup();};currentClose=close;
 const scale=()=>{const element=stage.firstElementChild;if(!element)return;const ratio=Math.min(1,stage.parentElement.clientWidth/960);element.style.transform=`scale(${ratio})`;stage.style.height=element.offsetHeight*ratio+'px';stage.style.width=960*ratio+'px';};
 const observer=new ResizeObserver(scale);observer.observe(stage.parentElement);
 function clearImage(){if(url)URL.revokeObjectURL(url);url=null;blob=null;for(const key of ['save','copy','share'])q(`[data-poster-${key}]`).hidden=true;}
 function render(){clearImage();const squad=q('[name=squad]').value,mode=q('[name=mode]').value,{data,players}=getPlayers(squad,mode),pages=mode==='lineup'?1:Math.max(1,Math.ceil(players.length/PAGE_SIZE));page=Math.min(page,pages-1);
  stage.innerHTML=posterMarkup({teamName,title:q('[name=title]').value,squad,mode,data,players,page,date:new Date().toLocaleDateString('zh-CN'),theme:q('[name=theme]').value});
  q('.poster-page-nav span').textContent=`${page+1} / ${pages}`;q('[data-poster-prev]').disabled=page===0;q('[data-poster-next]').disabled=page+1>=pages;q('[data-poster-generate]').disabled=!players.length;scale();
 }
 q('[data-poster-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 for(const input of dialog.querySelectorAll('select,input'))input.addEventListener('input',()=>{if(!busy){page=0;render();status.textContent='预览已更新，点击生成分享图片。';}});
 q('[data-poster-prev]').onclick=()=>{page--;render();};q('[data-poster-next]').onclick=()=>{page++;render();};
 q('[data-poster-generate]').onclick=async()=>{
  if(busy)return;busy=true;clearImage();controller=new AbortController();for(const el of dialog.querySelectorAll('select,input,button:not([data-poster-close])'))el.disabled=true;status.textContent='正在本地生成图片…';
  try{const result=await renderDomPng(stage.firstElementChild,{signal:controller.signal});if(closed)return;blob=result.blob;url=URL.createObjectURL(blob);const save=q('[data-poster-save]');save.href=url;save.download=`${teamName.replace(/[\\/:*?"<>|]/g,'_')}-${q('[name=squad]').value}-${page+1}.png`;save.hidden=false;q('[data-poster-copy]').hidden=!navigator.clipboard?.write;q('[data-poster-share]').hidden=!navigator.canShare?.({files:[new File([blob],'阵容海报.png',{type:'image/png'})]});status.textContent=result.missing?`图片已生成，${result.missing} 个素材未加载，可稍后重新生成补齐。`:'图片已生成，可保存后发送到群聊。';}
  catch(e){if(!closed)status.textContent='生成失败：'+e.message;}
  finally{busy=false;if(!closed){for(const el of dialog.querySelectorAll('select,input,button'))el.disabled=false;const pages=q('[name=mode]').value==='lineup'?1:Math.ceil(getPlayers(q('[name=squad]').value,'roster').players.length/PAGE_SIZE);q('[data-poster-prev]').disabled=page===0;q('[data-poster-next]').disabled=page+1>=pages;}}
 };
 q('[data-poster-copy]').onclick=async()=>{try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);status.textContent='图片已复制，可粘贴到聊天中。';}catch{status.textContent='当前环境不支持复制，请选择保存 PNG。';}};
 q('[data-poster-share]').onclick=async()=>{try{await navigator.share({files:[new File([blob],'阵容海报.png',{type:'image/png'})]});}catch(e){if(e.name!=='AbortError')status.textContent='分享未成功，请选择保存 PNG。';}};
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});dialog.showModal();render();return close;
}
