import {ART_GRADES,DEFAULT_ART_POSITION,normalizedArtPosition,normalizeArtBatch,initialArtPosition,playerArtPreviewContent,artPositionStyle,escapeArtHtml} from './player-art-preview.js';

const $=selector=>document.querySelector(selector);
const card=$('#position-card'),status=$('#status'),type=$('#profile-type');
const modes={legendary:'S',a:'A',b:'B',c:'C'};
let mode='legendary',profiles=[],index=-1,drag=null,showGrid=false,batch=false;
const storeKey=()=>`yffm1-shield-art-v2-${batch?'batch':mode}`;
const current=()=>profiles[index]??null;
const keyOf=file=>file.replace(/\.[^.]+$/,'');
const safeUrl=url=>/^(?:\/(?!\/)|https?:\/\/|blob:|data:image\/(?:png|webp);base64,)/i.test(url);
function stored(){try{return JSON.parse(localStorage.getItem(storeKey())??'{}');}catch{return {};}}
function livePosition(){return normalizedArtPosition({xPercent:$('#x-range').value,yPercent:$('#y-range').value,widthPercent:$('#width-range').value});}
function applyPosition(value){
  const p=normalizedArtPosition(value);card.style.cssText=artPositionStyle(p);
  for(const [short,key] of [['x','xPercent'],['y','yPercent'],['width','widthPercent']]){
    $(`#${short}-range`).value=p[key];$(`#${short}-value`).textContent=p[key].toFixed(1)+'%';
    if($(`#${short}-number`))$(`#${short}-number`).value=p[key];
  }
}
function renderCard(){
  const entry=current(),player=entry?.player??{grade:modes[mode],name:'球员卡预览',overall:modes[mode]==='S'?95:modes[mode]==='A'?86:modes[mode]==='B'?83:79,role:'ST'};
  type.value=batch?Object.keys(modes).find(k=>modes[k]===player.grade):mode;
  $('#image-input').disabled=batch;
  $('#image-input-label').textContent=batch?'批次图片已载入':`导入 ${modes[mode]} 级图片`;
  card.className=`position-card s4-player-card ydl-player-card player-card-shield player-card-static grade-${player.grade.toLowerCase()} band-base${showGrid?' show-grid':''}`;
  card.innerHTML=playerArtPreviewContent(player,entry?.url,entry?.position??DEFAULT_ART_POSITION,{imageId:'position-image'})+'<span class="card-grid"></span>';
  card.setAttribute('aria-label',`${player.name} ${player.grade} 盾形卡画定位`);
  // Use the same fallback behavior as the game when a badge cannot be loaded.
  card.querySelectorAll('[data-card-identity-image]').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.parentElement.classList.add('is-missing');}));
}
function renderList(){
  $('#queue-count').textContent=profiles.length+' 张';$('#saved-count').textContent=profiles.filter(p=>p.saved&&!p.dirty).length+' 已保存';
  $('#profile-list').innerHTML=profiles.length?profiles.map((p,i)=>`<button type="button" class="profile-item ${i===index?'active':''} ${p.saved&&!p.dirty?'saved':''}" data-profile-index="${i}"><i>${p.saved&&!p.dirty?'✓':i+1}</i><span title="${escapeArtHtml(p.playerKey)}">${escapeArtHtml(p.player?.name??p.playerKey)}</span><small>${p.dirty?'未保存':p.saved?'已保存':'待定位'}</small></button>`).join(''):'<div class="profile-empty">导入 PNG/WebP，或载入球员批次 JSON。</div>';
  filterList();
}
function filterList(){const q=($('#profile-search')?.value??'').trim().toLocaleLowerCase();document.querySelectorAll('[data-profile-index]').forEach(row=>{const p=profiles[Number(row.dataset.profileIndex)];row.hidden=!!q&&!`${p.player?.name??''} ${p.player?.sourceName??''} ${p.playerKey}`.toLocaleLowerCase().includes(q);});}
$('#profile-search')?.addEventListener('input',filterList);
const exportPlayer=p=>({...p.player,imageUrl:p.player.exportImageUrl??p.url,position:p.position,fileName:p.fileName});
function exportPayload(){
  return {schemaVersion:2,frame:'shield-v1',profileType:batch?'mixed':mode,grade:batch?null:modes[mode],coordinateSystem:'card-percent',card:{width:520,height:700},
    profiles:Object.fromEntries(profiles.map(p=>[p.playerKey,{fileName:p.fileName,playerId:p.player?.id,grade:p.player?.grade,...p.position}])),
    ...(batch?{players:profiles.map(exportPlayer)}:{})};
}
function updateJson(){const p=current();$('#json-preview').textContent=JSON.stringify(profiles.length>50?{note:'当前球员预览；下载 JSON 包含整个批次。',total:profiles.length,players:p?[exportPlayer(p)]:[]}:exportPayload(),null,2);}
function selectProfile(next){index=profiles.length?(next+profiles.length)%profiles.length:-1;const p=current();$('#player-key').value=p?.playerKey??'';$('#player-key').readOnly=!!p?.player?.id;applyPosition(p?.position??DEFAULT_ART_POSITION);renderCard();renderList();updateJson();status.textContent=p?`正在定位：${p.player?.name??p.playerKey} · ${p.player?.grade??modes[mode]}`:'等待导入球员素材。';}
function update(){const p=current();if(!p)return;p.position=livePosition();if(!p.player?.id)p.playerKey=$('#player-key').value.trim()||keyOf(p.fileName);p.dirty=true;const row=document.querySelector(`[data-profile-index="${index}"]`);if(row){row.classList.remove('saved');row.querySelector('small').textContent='未保存';row.querySelector('span').textContent=p.player?.name??p.playerKey;}updateJson();}
function release(){profiles.filter(p=>p.url?.startsWith('blob:')).forEach(p=>URL.revokeObjectURL(p.url));}
function save(){const p=current();if(!p)return;update();p.saved=true;p.dirty=false;try{const data=stored();data[p.playerKey]={fileName:p.fileName,assetSha256:p.player?.sha256??null,...p.position};localStorage.setItem(storeKey(),JSON.stringify(data));status.textContent='当前定位已保存到浏览器；导出 JSON 可用于批量接入。';}catch{status.textContent='浏览器存储不可用，请下载 JSON 保存。';}renderList();updateJson();}
function loadBatch(payload){
  const players=normalizeArtBatch(payload);release();batch=true;profiles=players.map(p=>({player:p,playerKey:p.id,fileName:p.fileName??p.imageUrl.split('/').pop().split('?')[0],url:p.imageUrl,position:p.position,saved:false,dirty:false}));
  const saved=stored();for(const p of profiles)if(saved[p.playerKey]&&(!p.player.sha256||saved[p.playerKey].assetSha256===p.player.sha256)){p.position=normalizedArtPosition(saved[p.playerKey]);p.saved=true;}
  type.disabled=true;selectProfile(0);updateJson();status.textContent=`已载入 ${profiles.length} 名球员，逐张定位后下载批次 JSON。`;
}
async function loadJson(file){try{
  const payload=JSON.parse(await file.text());
  if(payload.players){loadBatch(payload);return;}
  if(payload.grade&&!ART_GRADES.includes(payload.grade))throw Error('仅支持 S/A/B/C');
  if(payload.grade&&payload.grade!==modes[mode])throw Error('请先选择对应卡片等级');
  const entries=payload.profiles??payload;
  const positions=Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,{...v,...normalizedArtPosition(v)}]));
  localStorage.setItem(storeKey(),JSON.stringify({...stored(),...positions}));
  for(const p of profiles){const v=positions[p.playerKey]??positions[p.fileName]??Object.values(positions).find(v=>v.fileName===p.fileName);if(v){p.position=normalizedArtPosition(v);p.saved=true;p.dirty=false;}}
  selectProfile(index);updateJson();status.textContent=payload.frame==='shield-v1'?'定位已载入。':'旧卡面定位已载入，请在盾形卡面重新检查。';
}catch(e){status.textContent='载入失败：'+e.message;}finally{$('#json-input').value='';}}
$('#image-input').addEventListener('change',()=>{
  if(batch){status.textContent='当前为球员批次。请先清空队列再导入独立图片。';$('#image-input').value='';return;}
  const saved=stored();for(const file of $('#image-input').files){if(!/^image\/(png|webp)$/.test(file.type))continue;const key=keyOf(file.name),old=profiles.find(p=>p.fileName===file.name);if(old){URL.revokeObjectURL(old.url);old.url=URL.createObjectURL(file);old.dirty=true;continue;}
    const value=saved[key]??Object.values(saved).find(p=>p.fileName===file.name);
    profiles.push({player:{name:key,grade:modes[mode]},playerKey:key,fileName:file.name,url:URL.createObjectURL(file),position:normalizedArtPosition(value),saved:!!value,dirty:false});}
  selectProfile(index<0?0:index);updateJson();$('#image-input').value='';
});
type.addEventListener('change',()=>{if(profiles.length&&!confirm('切换等级会清空当前图片队列，请先导出定位。')){type.value=mode;return;}release();profiles=[];index=-1;mode=type.value;$('#image-input-label').textContent=`导入 ${modes[mode]} 级图片`;selectProfile(-1);updateJson();});
$('#json-input').addEventListener('change',()=>$('#json-input').files[0]&&loadJson($('#json-input').files[0]));
$('#profile-list').addEventListener('click',e=>{const row=e.target.closest('[data-profile-index]');if(row)selectProfile(Number(row.dataset.profileIndex));});
$('#previous-profile').addEventListener('click',()=>selectProfile(index-1));$('#next-profile').addEventListener('click',()=>selectProfile(index+1));
$('#toggle-grid').addEventListener('click',e=>{showGrid=!showGrid;card.classList.toggle('show-grid',showGrid);e.currentTarget.textContent=showGrid?'隐藏中心线':'显示中心线';});
for(const short of ['x','y','width'])$(`#${short}-range`).addEventListener('input',()=>{applyPosition(livePosition());update();});
for(const short of ['x','y'])$(`#${short}-number`).addEventListener('input',()=>{applyPosition({...livePosition(),[short+'Percent']:$(`#${short}-number`).value});update();});
$('#player-key').addEventListener('input',update);
function nudge(x,y){if(!current())return;const p=livePosition();applyPosition({...p,xPercent:p.xPercent+x,yPercent:p.yPercent+y});update();}
document.querySelectorAll('[data-nudge-x],[data-nudge-y]').forEach(b=>b.addEventListener('click',()=>nudge(Number(b.dataset.nudgeX??0),Number(b.dataset.nudgeY??0))));
$('#reset-current').addEventListener('click',()=>{applyPosition(DEFAULT_ART_POSITION);update();});$('#save-current').addEventListener('click',save);
$('#copy-json').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(exportPayload(),null,2));status.textContent='定位 JSON 已复制。';}catch{status.textContent='复制不可用，请下载 JSON。';}});
$('#download-json').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(exportPayload(),null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=batch?'player-art-batch-shield.json':`${mode}-player-profile-shield.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('#clear-all').addEventListener('click',()=>{if(!confirm('清空当前队列和本队列的浏览器定位记录？'))return;localStorage.removeItem(storeKey());release();profiles=[];batch=false;type.disabled=false;selectProfile(-1);updateJson();});
card.addEventListener('pointerdown',e=>{if(!current()||e.button!==0)return;e.preventDefault();card.focus();drag={id:e.pointerId,x:e.clientX,y:e.clientY,position:livePosition(),rect:card.getBoundingClientRect()};card.setPointerCapture(e.pointerId);card.classList.add('dragging');});
card.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;applyPosition({...drag.position,xPercent:drag.position.xPercent+(e.clientX-drag.x)/drag.rect.width*100,yPercent:drag.position.yPercent+(e.clientY-drag.y)/drag.rect.height*100});update();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])card.addEventListener(event,()=>{drag=null;card.classList.remove('dragging');});
card.addEventListener('wheel',e=>{if(!current())return;e.preventDefault();const p=livePosition();applyPosition({...p,widthPercent:p.widthPercent+(e.deltaY<0?4:-4)});update();},{passive:false});
document.addEventListener('keydown',e=>{if(!current()||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;const n=e.shiftKey?5:1,d={ArrowLeft:[-n,0],ArrowRight:[n,0],ArrowUp:[0,-n],ArrowDown:[0,n]}[e.key];if(d){e.preventDefault();nudge(...d);}});
$('#auto-position').addEventListener('click',async()=>{const entry=current();if(!entry)return;try{
  const image=$('#position-image');await image.decode();if(current()!==entry)return;
  const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
  let left=canvas.width,top=canvas.height,right=0,bottom=0,clear=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){if(data[(y*canvas.width+x)*4+3]>24){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}else clear++;}
  if(clear<canvas.width*canvas.height*.01)throw Error('图片没有透明背景，请先换用透明人物素材');
  applyPosition(initialArtPosition({width:canvas.width,height:canvas.height,left,top,right,bottom}));update();status.textContent='已自动初定位，请检查脸部大小和头顶裁切。';
}catch(e){status.textContent='自动定位失败：'+e.message;}});
selectProfile(-1);updateJson();
const batchUrl=new URLSearchParams(location.search).get('batch');
if(batchUrl){try{const url=new URL(batchUrl,location.href);if(url.origin!==location.origin||!safeUrl(url.href))throw Error('批次必须来自本站');const response=await fetch(url);if(!response.ok)throw Error('批次读取失败');loadBatch(await response.json());}catch(e){status.textContent=e.message;}}
