import {createStreamPlayback} from '/v4-stream/playback.js';
import {formatMatchClock} from '/v4/period-clock.js';
const $=id=>document.getElementById(id),canvas=$('pitch'),ctx=canvas.getContext('2d');
const sessions=await (await fetch('/lab-sessions')).json();let client=null,selected='',stamp=performance.now(),generation=0,lastEvents='';
let pendingSeek=null,seekSerial=0;
const info=await (await fetch('/lab-info')).json();document.querySelector('.badge').textContent=info.scope;
if(info.realSnapshot)document.querySelector('footer').textContent='真实球队只读影子演练 · 使用演练身份，结果不结算至正式存档。';
async function connect(){const current=++generation;pendingSeek=null;seekSerial++;client?.close();client=createStreamPlayback({matchId:'demo',token:sessions[$('view').value]});client.setRate(Number($('speed').value));client.slowMotion($('slow').checked);selected='';lastEvents='';$('player').replaceChildren(new Option('选择球员',''));$('events').replaceChildren();$('task').textContent='点击小圆点查看球员。本方教练可查看任务解释。';try{await client.pump();if(current!==generation)return;document.body.dataset.ready='true';render();}catch(error){if(current===generation)showError(error);}}
function field(frame){
  ctx.fillStyle='#183c35';ctx.fillRect(0,0,1260,816);ctx.save();ctx.scale(12,12);
  for(let x=0;x<105;x+=10.5){ctx.fillStyle=x%21===0?'#ffffff04':'#00000004';ctx.fillRect(x,0,10.5,68);}
  ctx.strokeStyle='#c4dacf70';ctx.lineWidth=.18;ctx.strokeRect(.3,.3,104.4,67.4);ctx.beginPath();ctx.moveTo(52.5,0);ctx.lineTo(52.5,68);ctx.stroke();ctx.beginPath();ctx.arc(52.5,34,9.15,0,Math.PI*2);ctx.stroke();
  ctx.strokeRect(0,13.84,16.5,40.32);ctx.strokeRect(88.5,13.84,16.5,40.32);ctx.strokeRect(0,24.84,5.5,18.32);ctx.strokeRect(99.5,24.84,5.5,18.32);
  if(frame){
    const focus=frame.players.find(p=>p.key===selected);if(focus?.task&&focus.active){ctx.strokeStyle='#d0e9a5';ctx.setLineDash([.5,.5]);ctx.beginPath();ctx.moveTo(focus.x,focus.y);ctx.lineTo(focus.task.target.x,focus.task.target.y);ctx.stroke();ctx.setLineDash([]);}
    for(const p of frame.players.filter(p=>p.active)){ctx.fillStyle=p.side===0?'#63b5ee':'#eb907b';ctx.beginPath();ctx.arc(p.x,p.y,p.key===selected?1.35:1.05,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0f252c';ctx.font='bold 1.15px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.number),p.x,p.y);}
    ctx.fillStyle='#fff8cd';ctx.beginPath();ctx.arc(frame.ball.x,frame.ball.y-(frame.ball.z??0)*.3,.45,0,Math.PI*2);ctx.fill();
  }ctx.restore();
}
function render(){
  if(!client)return;const frame=client.frame,state=client.state;field(frame);
  $('connection').textContent=!state.connected?'连接中断，正在重连；已缓存画面仍可回看':state.buffering?'等待下一段直播画面':state.complete&&state.time>=state.bufferedThrough?'本场比赛已结束':state.playing?'正在播放':'已暂停，可回看已发布片段';
  $('play').textContent=state.playing?'暂停':'播放';$('timeline').max=state.publishedThrough;$('timeline').value=pendingSeek??state.time;$('elapsed').textContent=`${state.time.toFixed(1)}秒`;$('buffer').textContent=`已发布 ${Math.floor(state.publishedThrough)}秒 · 缓存至 ${Math.floor(state.bufferedThrough)}秒`;
  document.body.dataset.time=String(state.time);document.body.dataset.owner=String(state.ownerSide);
  if(state.teams.length===2){$('home-name').textContent=state.teams[0].name;$('away-name').textContent=state.teams[1].name;}
  if(!frame)return;$('score').textContent=frame.score.join(' : ');$('clock').textContent=formatMatchClock(frame.clock);
  if($('player').options.length===1)for(const p of frame.players)$('player').add(new Option(`${p.side===0?'蓝队':'珊瑚队'} · ${p.name}`,p.key));
  const p=frame.players.find(p=>p.key===selected);if(p)$('task').textContent=p.task?`${p.name}：${p.task.reason}。体能 ${p.fitness.toFixed(1)}`:`${p.name}：${p.active?'正在场上比赛':'已离场'}。此视角只展示公开位置。`;
  const events=client.events.filter(e=>!['carry','receive','restart'].includes(e.type)).slice(-30),signature=events.map(e=>e.id).join(',');
  if(signature!==lastEvents){lastEvents=signature;$('events').replaceChildren(...events.slice().reverse().map(e=>{const button=document.createElement('button');button.textContent=`${Math.floor(e.time)}秒 · ${e.text}`;button.onclick=()=>client.seek(e.time).then(render).catch(showError);return button;}));}
}
function showError(error){if(error.name!=='AbortError')$('connection').textContent=error.message;}
$('view').onchange=connect;$('play').onclick=()=>{client.play(!client.state.playing);render();};$('speed').onchange=()=>client.setRate(Number($('speed').value));$('slow').onchange=()=>client.slowMotion($('slow').checked);
$('timeline').oninput=()=>{client.play(false);const serial=++seekSerial;pendingSeek=Number($('timeline').value);client.seek(pendingSeek).then(()=>{if(serial===seekSerial)pendingSeek=null;render();}).catch(error=>{if(serial===seekSerial)pendingSeek=null;showError(error);});};$('live').onclick=()=>client.catchUp().then(render).catch(showError);
$('player').onchange=()=>{selected=$('player').value;render();};canvas.onclick=event=>{const frame=client.frame;if(!frame)return;const bounds=canvas.getBoundingClientRect(),x=(event.clientX-bounds.left)/bounds.width*105,y=(event.clientY-bounds.top)/bounds.height*68;const p=frame.players.filter(p=>p.active).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];selected=p.key;$('player').value=selected;render();};
setInterval(()=>client?.pump().then(render).catch(showError),1000);
function animate(now){if(client){client.tick(Math.min(.1,(now-stamp)/1000));render();}stamp=now;requestAnimationFrame(animate);}requestAnimationFrame(animate);await connect();
