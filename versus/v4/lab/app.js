import {PRESETS} from '../fixtures.js';
import {TASK_LABELS} from '../tasks.js';
import {sampleReplay,eventsAt,playbackRate} from '../replay.js';
import {SCENARIOS} from '../scenarios.js';
import {RESTART_NAMES} from '../rules.js';
import {formatMatchClock} from '../period-clock.js';
import {explainEvent} from '../explanation.js';

const $=id=>document.getElementById(id),canvas=$('pitch'),ctx=canvas.getContext('2d');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const actionNames={pass:'传球',carry:'带球',shot:'射门'};
const coordinationEvents=new Set(['overlapCoordination','coverReleased','pressCoordination','pressBeaten','tacticalPlanChanged','transition','transitionEnd']);
const controlEvents=new Set(['receive','interception','miscontrol','parry','deflection','secondBall','save','block','woodwork']);
const ruleEvents=new Set(['offside','foul','yellowCard','redCard','emergencyKeeper','injury','substitution','replacementUnavailable','doubleTouch','stoppage','restart','abandoned','addedTime','halfTime','endsChanged','penaltyExtension','fulltime','shootoutStart','shootoutReady','shootoutShot','shootoutResult','shootoutGoal','shootoutMiss','keeperCommitment']);
let recording=null,worker=null,playing=false,cursor=0,selected='0:p2',selectedEvent=null,lastStamp=null,lastPanel='',generation=0;
for(const side of ['home','away'])$(side).innerHTML=Object.entries(PRESETS).map(([key,value])=>`<option value="${key}">${value.name}</option>`).join('');
$('home').value='left';$('away').value='press';
$('scenario').innerHTML=Object.entries(SCENARIOS).map(([key,value])=>`<option value="${key}">${value.name}</option>`).join('');

function field() {
  ctx.clearRect(0,0,1260,816);ctx.save();ctx.scale(12,12);
  ctx.fillStyle='#1b483a';ctx.fillRect(0,0,105,68);
  for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#1b483a':'#204d3f';ctx.fillRect(i*10.5,0,10.5,68);}
  ctx.strokeStyle='#b6d1bd88';ctx.lineWidth=.15;
  ctx.strokeRect(1,1,103,66);ctx.beginPath();ctx.moveTo(52.5,1);ctx.lineTo(52.5,67);ctx.stroke();
  ctx.beginPath();ctx.arc(52.5,34,9.15,0,Math.PI*2);ctx.stroke();
  for(const side of [0,1]){ctx.save();if(side){ctx.translate(105,68);ctx.rotate(Math.PI);}ctx.strokeRect(0,13.84,16.5,40.32);ctx.strokeRect(0,24.84,5.5,18.32);ctx.strokeRect(0,30.34,1,7.32);ctx.beginPath();ctx.arc(11,34,.25,0,Math.PI*2);ctx.fillStyle='#b6d1bd';ctx.fill();ctx.restore();}
  ctx.restore();
}
function draw(frame) {
  field();if(!frame)return;ctx.save();ctx.scale(12,12);
  const offside=selectedEvent?.time<=cursor&&selectedEvent.offside?selectedEvent.offside:frame.rules?.offside;
  if(offside&&$('tasks').checked){
    const x=offside.attackDirection===1?offside.line:105-offside.line;
    ctx.strokeStyle='#f3d77b';ctx.lineWidth=.22;ctx.setLineDash([.6,.6]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,68);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#f3d77b';ctx.font='1.1px sans-serif';ctx.textAlign='left';ctx.fillText('出球时越位线',Math.min(x+1,94),3);
  }
  if(frame.restart){ctx.strokeStyle='#f3d77b';ctx.lineWidth=.25;ctx.beginPath();ctx.arc(frame.restart.spot.x,frame.restart.spot.y,1.5,0,Math.PI*2);ctx.stroke();}
  const player=frame.players.find(p=>p.key===selected);
  if(player?.task&&$('tasks').checked) {
    for(const key of player.task.partners??[]) {
      const partner=frame.players.find(p=>p.key===key);if(!partner)continue;
      ctx.strokeStyle='#c8e79566';ctx.lineWidth=.14;ctx.setLineDash([.3,.7]);ctx.beginPath();ctx.moveTo(player.x,player.y);ctx.lineTo(partner.x,partner.y);ctx.stroke();ctx.setLineDash([]);
      ctx.strokeStyle='#c8e795aa';ctx.beginPath();ctx.arc(partner.x,partner.y,1.5,0,Math.PI*2);ctx.stroke();
    }
    const outlet=frame.players.find(p=>p.key===player.task.targetPlayer);
    if(player.task.type==='screen'&&outlet){ctx.strokeStyle='#ffac8288';ctx.lineWidth=.4;ctx.beginPath();ctx.moveTo(frame.ball.x,frame.ball.y);ctx.lineTo(outlet.x,outlet.y);ctx.stroke();}
  }
  if(player?.task&&$('tasks').checked){ctx.strokeStyle='#d7ed9c';ctx.lineWidth=.22;ctx.setLineDash([.6,.6]);ctx.beginPath();ctx.moveTo(player.x,player.y);ctx.lineTo(player.task.target.x,player.task.target.y);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(player.task.target.x,player.task.target.y,.6,0,Math.PI*2);ctx.stroke();}
  if(frame.ball.mode==='flight'&&frame.ball.flight){ctx.strokeStyle='#eef5d95c';ctx.lineWidth=.15;ctx.beginPath();ctx.moveTo(frame.ball.flight.start.x,frame.ball.flight.start.y);ctx.lineTo(frame.ball.x,frame.ball.y);ctx.stroke();}
  for(const p of frame.players) {
    if(p.active===false)continue;
    const active=p.key===selected;
    if(active){ctx.strokeStyle='#d8eda0';ctx.lineWidth=.18;ctx.beginPath();ctx.arc(p.x,p.y,1.65,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle=p.side===0?'#72beff':'#ff9d83';ctx.strokeStyle=p.side===0?'#273e55':'#5b392f';ctx.lineWidth=.18;
    ctx.beginPath();ctx.arc(p.x,p.y,1.15,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle='#13222a88';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+Math.cos(p.facing)*1.1,p.y+Math.sin(p.facing)*1.1);ctx.stroke();
    if($('labels').checked){ctx.fillStyle='#102331';ctx.font='bold 1.05px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.number,p.x,p.y+.05);}
  }
  const height=frame.ball.z??0;
  if(height>.3){ctx.fillStyle='#0008';ctx.beginPath();ctx.ellipse(frame.ball.x,frame.ball.y,.65,.3,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fffbe5';ctx.font='1.1px sans-serif';ctx.textAlign='left';ctx.fillText(`${height.toFixed(1)} m`,frame.ball.x+1,frame.ball.y-height*.55);}
  ctx.shadowColor='#0009';ctx.shadowBlur=4;ctx.fillStyle='#fffbe5';ctx.beginPath();ctx.arc(frame.ball.x,frame.ball.y-height*.55,.45,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.restore();
}
function panels(frame,force=false) {
  const visible=eventsAt(recording.events,cursor),latest=visible.at(-1),player=frame.players.find(p=>p.key===selected);
  const key=[frame.eventCursor,selected,selectedEvent?.id,Math.floor(cursor*2)].join(':');
  if(!force&&lastPanel===key)return;lastPanel=key;
  $('score').innerHTML=`${frame.score[0]} <span>:</span> ${frame.score[1]}`;
  $('clock').textContent=formatMatchClock(frame.clock);$('elapsed').textContent=clock(cursor);$('timeline').value=cursor;
  $('direction').textContent=frame.clock.attackDirections?.[0]===-1?'← 蓝队进攻':'蓝队进攻 →';
  $('period-status').textContent=frame.shootout?'点球大战':frame.clock.mode==='full'?`${['上半场','下半场','加时上半场','加时下半场'][frame.clock.period-1]}${frame.clock.announcedSeconds!==null?' · 至少补时 '+frame.clock.announcedSeconds/60+' 分钟':''}`:'演示片段';
  $('shootout-score').hidden=!frame.shootout;$('shootout-score').textContent=frame.shootout?`点球大战 ${frame.shootout.score[0]} : ${frame.shootout.score[1]} · 已罚 ${frame.shootout.taken[0]} / ${frame.shootout.taken[1]} 轮${frame.shootout.winner!==null?' · '+(frame.shootout.winner===0?'蓝队':'珊瑚队')+'获胜':''}`:'';
  $('next-half').hidden=frame.clock.mode!=='full'||!recording.events.some(e=>e.type==='endsChanged'&&e.time>cursor+.001);
  $('next-half').textContent=frame.clock.period===1?'下半场':frame.clock.period===2?'进入加时':'加时下半场';
  $('caption').textContent=latest?`${latest.clock?formatMatchClock(latest.clock):clock(latest.time)} · ${latest.text}`:'选择球员查看任务';
  const tr=frame.transition;
  $('phase-summary').textContent=frame.clock.extendingPenalty&&frame.phase!=='halftime'&&frame.phase!=='finished'?'本半场延长 · 只完成点球，不再进行普通进攻':frame.phase==='halftime'?`中场休息 · 还剩 ${clock(frame.clock.intervalRemaining)} · 可跳到下半场`:frame.phase==='finished'?'比赛结束':frame.phase==='restart'?`死球 · ${frame.restart?.side===0?'蓝队':'珊瑚队'}准备${RESTART_NAMES[frame.restart?.type]??'重启'}`:frame.ball.mode==='loose'?'自由球 · 双方争夺二点，球权尚未确定':frame.rules?.restartTouch?`${RESTART_NAMES[frame.rules.restartTouch.type]}已开出 · 等待下一次触球`:tr&&cursor<tr.until?
    `${tr.from===0?'蓝队':'珊瑚队'}${tr.lossMode==='counterPress'&&cursor<tr.at+3?'短时反抢':'回撤恢复'} · ${tr.to===0?'蓝队':'珊瑚队'}寻找转换出口`:'常规组织 / 防守';
  if(player) {
    if(frame.shootout)$('phase-summary').textContent=frame.phase==='finished'?'点球大战结束':frame.shootout.current?'点球大战 · 本轮罚球中，不可补射':'点球大战 · 准备下一轮';
    $('player-info').innerHTML=`<h2>${escape(player.name)} <span class="muted">${escape(player.role)}</span></h2><span class="task-tag">${TASK_LABELS[player.task?.type]??'准备'}</span><p>${escape(player.task?.reason??'等待比赛开始')}</p><p>战术来源：${escape(PRESETS[player.task?.source]?.name??'基础规则')}</p><div class="metrics"><div><small>跑动速度</small><b>${Math.hypot(player.vx,player.vy).toFixed(1)} m/s</b></div><div><small>当前体能</small><b>${player.fitness.toFixed(1)}</b></div><div><small>坐标 / 米</small><b>${player.x.toFixed(0)}, ${player.y.toFixed(0)}</b></div></div>`;
    const partners=(player.task?.partners??[]).map(key=>frame.players.find(p=>p.key===key)?.name).filter(Boolean);
    if(frame.phase==='finished')$('player-info').querySelector('.task-tag').textContent='比赛结束';
    if(player.task?.plan)$('player-info').insertAdjacentHTML('beforeend',`<p>赛前预案：${player.task.plan==='leading'?'领先':player.task.plan==='trailing'?'落后':'默认'}</p>`);
    if(partners.length)$('player-info').insertAdjacentHTML('beforeend',`<p class="partners">协同：${partners.map(escape).join('、')}</p>`);
    if(player.yellowCards||player.active===false)$('player-info').insertAdjacentHTML('beforeend',`<p class="discipline">黄牌 ${player.yellowCards??0} · ${player.active===false?({bench:'替补待命',injured:'受伤离场',substituted:'已被替换',sentOff:'已被罚下'}[player.status]??'不在场'):'在场'}</p>`);
    $('player-select').value=selected;
  }
  const event=selectedEvent&&selectedEvent.time<=cursor?selectedEvent:visible.findLast(e=>e.decision||controlEvents.has(e.type)||coordinationEvents.has(e.type)||ruleEvents.has(e.type))||latest;
  if(event) {
    $('decision').innerHTML=`<div class="decision-title">${escape(event.text)}</div><p>${escape(event.reason)}</p>${event.source?`<p>指令来源：${escape(PRESETS[event.source]?.name)}</p>`:''}${event.decision?`<p class="muted">候选价值（内部比较分，非成功率）</p>${event.decision.candidates.map(c=>`<div class="candidate"><span>${actionNames[c.type]??c.type}${c.to?' → '+escape(recording.frames[0].players.find(p=>p.key===c.to)?.name):''}</span><b>${c.utility.toFixed(2)}</b></div>`).join('')}`:''}${event.contact?'<p>触球依据：球路与球员触球范围相交。</p>':''}`;
    if(event.control)$('decision').insertAdjacentHTML('beforeend',`<div class="control-factors"><span>来球 ${event.control.speed.toFixed(1)} m/s</span><span>压力距离 ${event.control.pressureDistance.toFixed(1)} m</span><span>模型控制概率 ${(event.control.probability*100).toFixed(0)}%</span></div>`);
    if(event.aerial)$('decision').insertAdjacentHTML('beforeend',`<p>争顶高度 ${event.aerial.height.toFixed(2)} m · 可达高度 ${event.aerial.reach.toFixed(2)} m · 头球能力 ${event.aerial.heading}</p>`);
    if(event.type==='woodwork')$('decision').insertAdjacentHTML('beforeend',`<p>撞击高度 ${(event.position.z??0).toFixed(2)} m · 门框反弹后继续争夺</p>`);
    const opportunity=event.opportunity??event.decision?.candidates.find(c=>c.type==='shot')?.opportunity;
    if(opportunity)$('decision').insertAdjacentHTML('beforeend',`<div class="opportunity-factors"><p>${event.type==='shot'?'此次射门条件':'比较中的射门条件'}</p><div class="control-factors"><span>距离 ${opportunity.distance.toFixed(1)} m</span><span>球门张角 ${opportunity.angleDegrees.toFixed(0)}°</span><span>对手距离 ${opportunity.pressureDistance.toFixed(1)} m</span><span>封堵球员 ${opportunity.blockers.length} 人</span></div><p>门将覆盖估计：${opportunity.keeperCoverage>.66?'高':opportunity.keeperCoverage>.33?'中':'低'}。这是决策依据，不是进球概率。</p></div>`);
    if(event.decision?.comparison)$('decision').insertAdjacentHTML('beforeend',`<p class="decision-comparison">${event.restartType?'按定位球规则，仅比较本次可执行的传球或射门。':escape(event.decision.comparison)}</p>`);
    const chain=explainEvent(recording.events,event.id,cursor);
    if(chain.context.length||chain.decision&&chain.decision.id!==event.id)$('decision').insertAdjacentHTML('beforeend',`<details class="evidence-chain"><summary>查看此前过程</summary>${chain.context.map(e=>`<p>背景 · ${clock(e.time)} · ${escape(e.text)}</p>`).join('')}${chain.decision?`<p>出球选择 · ${escape(chain.decision.comparison)}</p>`:''}<p class="muted">同一控球阶段的协同是背景记录；触球结果按实际球路关联。</p></details>`);
    if(event.contest)$('decision').insertAdjacentHTML('beforeend',`<p>二点球 #${event.contest.id} · ${event.outcome==='controlled'?'已实际控制':'仍可争夺'}</p>`);
    if(event.offside)$('decision').insertAdjacentHTML('beforeend',`<p>出球时刻 ${clock(event.offside.at)} · 越位线 ${event.offside.line.toFixed(1)} m（进攻方向坐标）</p><p>球 ${event.offside.ballX.toFixed(1)} m · 倒数第二名对手 ${event.offside.secondLastX.toFixed(1)} m</p>`);
    if(event.restartType)$('decision').insertAdjacentHTML('beforeend',`<p>重启类型：${RESTART_NAMES[event.restartType]}</p>`);
    if(event.foul)$('decision').insertAdjacentHTML('beforeend',`<p>相对速度 ${event.foul.speed.toFixed(1)} m/s · ${event.foul.penalty?'禁区内':'禁区外'} · ${event.foul.dogso?'明显进球机会':'普通争抢'}</p>`);
    if(event.allowance)$('decision').insertAdjacentHTML('beforeend',`<p>已记录损失 ${event.allowance.lostSeconds.toFixed(1)} 秒 · 公布至少 ${event.allowance.seconds/60} 分钟；公布后新增损失继续补回。</p>`);
    if(event.controlPlan)$('decision').insertAdjacentHTML('beforeend',`<p>接稳后观察 ${event.controlPlan.duration.toFixed(1)} 秒，近身受压可提前出球。</p>`);
    if(event.offsideResetByDeliberatePlay)$('decision').insertAdjacentHTML('beforeend','<p>对方有控制机会的主动处理球，清除前一次越位阶段。</p>');
  }
  const passes=new Map(visible.filter(e=>e.type==='pass').map(e=>[e.id,e]));
  const received=visible.filter(e=>e.type==='receive'&&passes.get(e.decisionId)?.side===e.side).length;
  const errors=visible.filter(e=>e.type==='miscontrol'&&passes.get(e.decisionId)?.side===e.side).length;
  $('match-metrics').textContent=`已播放统计 · 传球 ${received}/${passes.size}（${passes.size?Math.round(received/passes.size*100):0}%） · 接球失误 ${errors} · 射门 ${visible.filter(e=>e.type==='shot').length} · 犯规 ${visible.filter(e=>e.type==='foul').length} · 越位 ${visible.filter(e=>e.type==='offside').length}`;
  const category=$('event-filter').value;
  const notable=visible.filter(e=>category==='coordination'?coordinationEvents.has(e.type):category==='control'?controlEvents.has(e.type):category==='rules'?ruleEvents.has(e.type):!['carry','loose','stoppage'].includes(e.type)).slice(-30).reverse();
  $('event-count').textContent=String(notable.length);
  $('events').innerHTML=notable.map(e=>`<button class="event ${e.id===event?.id?'active':''}" data-event="${e.id}"><time>${e.clock?formatMatchClock(e.clock):clock(e.time)}</time><span>${escape(e.text)}</span></button>`).join('');
}
function render(force=false) {
  if(!recording){field();return;}
  const frame=sampleReplay(recording.frames,cursor);draw(frame);panels(frame,force);
  $('rate-status').textContent=playing?(playbackRate(recording.events,cursor,Number($('speed').value),$('slow').checked)<Number($('speed').value)?'关键片段慢放':'正在播放'):'已暂停';
  $('play').textContent=playing?'Ⅱ':'▶';$('play').setAttribute('aria-label',playing?'暂停':'播放');
}
function seek(time){cursor=Math.max(0,Math.min(recording?.duration??0,time));selectedEvent=null;render(true);}
function generate(event) {
  event?.preventDefault();generation++;const request=generation;
  worker?.terminate();playing=false;recording=null;selectedEvent=null;cursor=0;lastPanel='';
  $('generate').disabled=true;$('message').textContent='正在生成独立比赛片段…';$('score').innerHTML='0 <span>:</span> 0';$('clock').textContent='00:00';$('events').replaceChildren();$('decision').innerHTML='<p class="muted">正在准备新的片段…</p>';render();
  worker=new Worker('/lab/simulation-worker.js',{type:'module'});
  const fail=message=>{if(request!==generation)return;$('generate').disabled=false;$('message').textContent=`生成失败：${message}`;worker?.terminate();worker=null;};
  worker.onerror=e=>fail(e.message);
  worker.onmessage=({data})=>{
    if(request!==generation)return;
    if(data.type==='error'){fail(data.message);return;}
    if(data.type==='progress'){$('message').textContent=`正在生成片段 · ${Math.round(data.value*100)}%`;return;}
    if(data.type!=='complete')return;
    recording=data;worker.terminate();worker=null;$('generate').disabled=false;
    $('timeline').max=data.duration;$('length').textContent=clock(data.duration);
    $('home-preset').textContent=PRESETS[data.input.teams[0].preset].name;$('away-preset').textContent=PRESETS[data.input.teams[1].preset].name;
    const labels={width:'进攻宽度',press:'压迫强度',directness:'直接性',lineHeight:'防线高度',compactness:'紧凑程度'};
    const instructions=Object.entries(data.input.teams[0].instructions??{}).map(([key,value])=>`${labels[key]??key} ${Math.round(value*100)}`);
    $('locked-instructions').textContent=`本场蓝队配置：${instructions.length?instructions.join('、'):'沿用预设'} · ${Object.keys(data.input.teams[0].scorePlans??{}).length?'已锁定领先／落后预案':'默认预案'}`;
    $('player-select').innerHTML=data.frames[0].players.map(p=>`<option value="${p.key}">${escape(p.name)} · ${p.role}</option>`).join('');
    $('message').textContent=`片段已就绪 · ${data.frames.length}个状态帧 · ${Math.round(data.elapsedMs)} ms 本机生成 · 同编号与配置可重复`;
    document.body.dataset.ready='true';render(true);
  };
  delete document.body.dataset.ready;
  const override=$('override-field').value;
  worker.postMessage({scenario:$('scenario').value,seed:$('seed').value,home:$('home').value,away:$('away').value,duration:Number($('duration').value),resolution:$('resolution').value,
    homeInstructions:override?{[override]:Number($('override-value').value)/100}:undefined,
    homeScorePlans:$('score-plans').checked?{leading:{restDefense:'conservative',press:.3,clockManagement:'slow'},trailing:{directness:.8,restDefense:'adventurous',clockManagement:'quick'}}:undefined});
}
$('config').addEventListener('submit',generate);
$('override-field').onchange=()=>{const width=$('override-field').value==='width';$('override-value').min=width?45:0;$('override-value').max=width?120:100;$('override-value').value=width?90:50;};
$('scenario').onchange=()=>{
  if($('scenario').value==='parry')$('seed').value='v4-scene-1';
  if($('scenario').value==='foul')$('seed').value='v4-foul-10';
  if($('scenario').value==='firstTouch')$('seed').value='v4-scene-2';
  if(['penalty','offside'].includes($('scenario').value))$('seed').value='v4-scene-0';
  $('message').textContent=SCENARIOS[$('scenario').value].description+' · 点击生成应用新场景';
};
$('play').onclick=()=>{if(!recording)return;if(cursor>=recording.duration)seek(0);playing=!playing;selectedEvent=null;render(true);};
$('timeline').addEventListener('input',()=>{playing=false;seek(Number($('timeline').value));});
$('end').onclick=()=>{playing=false;seek(recording?.duration??0);};
$('next-half').onclick=()=>{const event=recording?.events.find(e=>e.type==='endsChanged'&&e.time>cursor+.001);if(event){playing=false;seek(event.time);}};
for(const id of ['speed','slow','tasks','labels','event-filter'])$(id).onchange=()=>render(true);
$('player-select').onchange=()=>{selected=$('player-select').value;render(true);};
$('events').onclick=e=>{const button=e.target.closest('[data-event]');if(!button)return;const event=recording.events.find(v=>v.id===Number(button.dataset.event));playing=false;seek(event.time);selectedEvent=event;if(event.actor)selected=event.actor;render(true);};
canvas.onclick=e=>{
  if(!recording)return;const box=canvas.getBoundingClientRect(),point={x:(e.clientX-box.left)/box.width*105,y:(e.clientY-box.top)/box.height*68};
  const frame=sampleReplay(recording.frames,cursor),nearest=frame.players.filter(p=>p.active!==false).sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
  if(Math.hypot(nearest.x-point.x,nearest.y-point.y)<5){selected=nearest.key;render(true);}
};
document.addEventListener('visibilitychange',()=>{lastStamp=null;if(document.hidden){playing=false;render(true);}});
function tick(now){const dt=lastStamp===null?0:Math.min(.1,(now-lastStamp)/1000);lastStamp=now;
  if(playing&&recording){cursor=Math.min(recording.duration,cursor+dt*playbackRate(recording.events,cursor,Number($('speed').value),$('slow').checked));if(cursor>=recording.duration)playing=false;render();}
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);generate();
