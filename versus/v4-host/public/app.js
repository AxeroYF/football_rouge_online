import {createAccountPlayback} from './v4-host/account-playback.js';
import {formatMatchClock} from './v4/period-clock.js';
import {competitionPresentation} from './v4-host/competition-presentation.js';

const $=id=>document.getElementById(id),canvas=$('pitch'),ctx=canvas.getContext('2d');
const accountKey='football_test1_versus_account_v1';
const params=new URL(location.href).searchParams,reportId=params.get('report');
let client=null,selected='',stamp=performance.now(),lastEvents='',pendingSeek=null,seekSerial=0;
function field(frame){
  ctx.fillStyle='#183c35';ctx.fillRect(0,0,1260,816);ctx.save();ctx.scale(12,12);
  for(let x=0;x<105;x+=10.5){ctx.fillStyle=x%21===0?'#ffffff04':'#00000004';ctx.fillRect(x,0,10.5,68);}
  ctx.strokeStyle='#c4dacf70';ctx.lineWidth=.18;ctx.strokeRect(.3,.3,104.4,67.4);ctx.beginPath();ctx.moveTo(52.5,0);ctx.lineTo(52.5,68);ctx.stroke();ctx.beginPath();ctx.arc(52.5,34,9.15,0,Math.PI*2);ctx.stroke();
  ctx.strokeRect(0,13.84,16.5,40.32);ctx.strokeRect(88.5,13.84,16.5,40.32);ctx.strokeRect(0,24.84,5.5,18.32);ctx.strokeRect(99.5,24.84,5.5,18.32);
  if(frame){
    const focus=frame.players.find(p=>p.key===selected);
    if(focus?.task&&focus.active){ctx.strokeStyle='#d0e9a5';ctx.setLineDash([.5,.5]);ctx.beginPath();ctx.moveTo(focus.x,focus.y);ctx.lineTo(focus.task.target.x,focus.task.target.y);ctx.stroke();ctx.setLineDash([]);}
    for(const p of frame.players.filter(p=>p.active)){ctx.fillStyle=p.side===0?'#63b5ee':'#eb907b';ctx.beginPath();ctx.arc(p.x,p.y,p.key===selected?1.35:1.05,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0f252c';ctx.font='bold 1.15px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.number),p.x,p.y);}
    ctx.fillStyle='#fff8cd';ctx.beginPath();ctx.arc(frame.ball.x,frame.ball.y-(frame.ball.z??0)*.3,.45,0,Math.PI*2);ctx.fill();
  }ctx.restore();
}
function stop(message){
  client?.close();client=null;seekSerial++;pendingSeek=null;selected='';lastEvents='';
  $('controls').disabled=true;$('player').replaceChildren(new Option('选择球员',''));$('events').replaceChildren();$('task').textContent='当前没有可播放的比赛画面。';
  $('connection').textContent=message;$('score').textContent='— : —';$('clock').textContent='00:00';$('perspective').textContent='';
  $('play').textContent='播放';$('timeline').max=0;$('timeline').value=0;$('elapsed').textContent='0.0秒';$('buffer').textContent='暂无播放画面';
  for(const id of ['match-stage','aggregate','shootout','decision'])$(id).textContent='';
  delete document.body.dataset.ready;delete document.body.dataset.owner;field(null);
}
function render(){
  if(!client)return;const frame=client.frame,state=client.state;field(frame);
  $('connection').textContent=!state.connected?'连接中断，正在重连；已缓存画面仍可回看':state.buffering?'等待下一段直播画面':state.complete&&state.time>=state.bufferedThrough?'本场比赛已结束':state.playing?'正在播放':'已暂停，可回看已发布片段';
  $('play').textContent=state.playing?'暂停':'播放';$('timeline').max=Math.max(0,state.publishedThrough);$('timeline').value=pendingSeek??state.time;$('elapsed').textContent=`${state.time.toFixed(1)}秒`;$('buffer').textContent=`已发布 ${Math.max(0,Math.floor(state.publishedThrough))}秒 · 缓存至 ${Math.max(0,Math.floor(state.bufferedThrough))}秒`;
  document.body.dataset.time=String(state.time);document.body.dataset.owner=String(state.ownerSide);
  $('perspective').textContent=state.ownerSide===null?'· 公开视角':'· 本方视角';
  if(state.teams.length===2){$('home-name').textContent=state.teams[0].name;$('away-name').textContent=state.teams[1].name;}
  const competition=competitionPresentation(frame,state.competition,state.teams);
  $('match-stage').textContent=competition.label;for(const id of ['aggregate','shootout','decision'])$(id).textContent=competition[id];
  if(!frame)return;$('score').textContent=frame.score.join(' : ');$('clock').textContent=formatMatchClock(frame.clock);
  if($('player').options.length===1)for(const p of frame.players)$('player').add(new Option(`${state.teams[p.side]?.name??(p.side===0?'主队':'客队')} · ${p.name}`,p.key));
  const p=frame.players.find(p=>p.key===selected);if(p){$('player').value=selected;$('task').textContent=p.task?`${p.name}：${p.task.reason}。体能 ${p.fitness.toFixed(1)}`:`${p.name}：${p.active?'正在场上比赛':'已离场'}。此视角只展示公开位置。`;}
  const events=client.events.filter(e=>!['carry','receive','restart'].includes(e.type)).slice(-30),signature=events.map(e=>e.id).join(',');
  if(signature!==lastEvents){lastEvents=signature;$('events').replaceChildren(...events.slice().reverse().map(e=>{const button=document.createElement('button');button.textContent=`${Math.floor(e.time)}秒 · ${e.text}`;button.onclick=()=>client?.seek(e.time).then(render).catch(showError);return button;}));}
}
function showError(error){if(error.code==='V4_REPLAY_EXPIRED'){stop('本场录像已过保留期限，比赛结果仍可在游戏中查看。');return;}if(client&&error.name!=='AbortError')$('connection').textContent=error.message;}
$('play').onclick=()=>{client?.play(!client.state.playing);render();};$('speed').onchange=()=>client?.setRate(Number($('speed').value));$('slow').onchange=()=>client?.slowMotion($('slow').checked);
$('timeline').oninput=()=>{if(!client)return;client.play(false);const serial=++seekSerial;pendingSeek=Number($('timeline').value);client.seek(pendingSeek).then(()=>{if(serial===seekSerial)pendingSeek=null;render();}).catch(error=>{if(serial===seekSerial)pendingSeek=null;showError(error);});};
$('live').onclick=()=>client?.catchUp().then(render).catch(showError);$('player').onchange=()=>{selected=$('player').value;render();};
canvas.onclick=event=>{const frame=client?.frame;if(!frame)return;const bounds=canvas.getBoundingClientRect(),x=(event.clientX-bounds.left)/bounds.width*105,y=(event.clientY-bounds.top)/bounds.height*68;
  const p=frame.players.filter(p=>p.active).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];if(p){selected=p.key;$('player').value=selected;render();}};
window.addEventListener('storage',event=>{if(event.key===accountKey||event.key===null)stop('登录状态已变更，请刷新页面重新连接。');});
window.addEventListener('pagehide',()=>client?.close());
setInterval(()=>{
  if(!client||!document.body.dataset.ready)return;
  if(reportId&&(!client.state.playing||client.state.bufferedThrough===client.state.publishedThrough))return;
  client.pump().then(render).catch(showError);
},500);
function animate(now){if(client){client.tick(Math.max(0,Math.min(.1,(now-stamp)/1000)));render();}stamp=now;requestAnimationFrame(animate);}requestAnimationFrame(animate);
field(null);
try{
  const matchId=params.get('match');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(matchId??''))throw new Error('请从指定比赛链接打开预览。');
  const account=JSON.parse(localStorage.getItem(accountKey)??'null');if(!account?.profile?.id||!account?.accountToken)throw new Error('请先返回游戏登录，再打开比赛链接。');
  client=createAccountPlayback({matchId,settled:Boolean(reportId),playerId:account.profile.id,accountToken:account.accountToken,fetcher:async(url,init)=>{
    let response;
    if(reportId){
      const last=url.split('/').at(-1),segment=last==='head'?last:Number(last);
      response=await fetch('/api/versus/league/match/tactical-replay',{method:'POST',signal:init.signal,cache:'no-store',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId:reportId,segment,playerId:account.profile.id,accountToken:account.accountToken})});
    }else response=await fetch(url,init);
    if(response.status===403)stop('当前账号无权观看此比赛，请返回游戏确认登录状态。');return response;
  }});
  if(reportId){
    document.title='战术复盘 · YFFM1';
    document.querySelector('header .badge').textContent='赛后回放';
    document.querySelector('.intro h1').textContent='战术复盘';
    document.querySelector('.intro h1 + p').textContent='已定位到所选时点，可播放查看后续跑位。';
    $('live').hidden=true;
    selected=params.get('player')??'';
    await client.seek(Number(params.get('t')??0));
  }else await client.pump();
  if(client){
    if(reportId&&params.has('issue')&&params.has('plan')){
      const link=document.createElement('a'),back=new URL('/versus/',location.origin);
      if(params.has('save'))back.searchParams.set('save',params.get('save'));
      back.hash='review-board?'+params.toString();link.href=back.href;
      link.textContent='在战术板调整这条证据';document.querySelector('.intro').append(link);
    }
    $('controls').disabled=false;document.body.dataset.ready='true';render();
  }
}catch(error){if(error.code==='V4_REPLAY_EXPIRED')stop('本场录像已过保留期限，比赛结果仍可在游戏中查看。');else if(client)stop(error.message);else if(!$('connection').textContent.includes('无权'))stop(error.message);}
