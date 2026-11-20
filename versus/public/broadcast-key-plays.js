import {isGoalEvent} from './goal-event.js';
const goalLabel = event => event.type==='penaltyShootoutKick' ? '点球大战进球' : event.type==='ownGoal'||event.ownGoal ? '乌龙球' : '进球';
const LABELS = {pass:'传球',direct:'向前传递',switch:'转移',recycle:'回传',carry:'带球',create:'创造机会',shoot:'射门',longShot:'远射'};
const RESULTS = {goal:'进球',ownGoal:'乌龙球',shot:'射门',save:'扑救',miss:'射偏',block:'封堵',red:'红牌'};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fieldPoint = p => p.teamIndex === 1 ? {x:100-p.x,y:100-p.y} : {x:p.x,y:p.y};
const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const find = (players,side,id) => players.find(p=>p.teamIndex===side && p.id===id);
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

export function broadcastMinuteLabel(value) {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\.\d+)?(?:\+(\d+)(?:\.\d+)?)?(?::\d+)?[′']?$/);
  return match ? match[1] + (match[2] ? "+" + match[2] : "") : "—";
}

function sameReplayPositions(a, b) {
  if (a.ball.x !== b.ball.x || a.ball.y !== b.ball.y || a.players.length !== b.players.length) return false;
  return a.players.every((p, i) => {
    const q = b.players[i];
    return p.id === q.id && p.teamIndex === q.teamIndex && p.x === q.x && p.y === q.y;
  });
}

// Drop dead time at the ends and keep a short pause for a restart within the move.
// Use a separate playback clock so saved frames and the engine event time stay intact.
export function prepareGoalPlayback(clip) {
  const frames = clip?.frames;
  if (!frames || frames.length < 2) return clip;
  const goalIndex = Number.isFinite(clip.replayTime) ? frames.findIndex(f => f.time >= clip.replayTime) : -1;
  const last = goalIndex > 0 ? goalIndex : frames.length - 1;
  let first = 0;
  while (first < last && sameReplayPositions(frames[first], frames[first + 1])) first++;
  const playback = [{...frames[first], time:0}];
  for (let i = first + 1; i <= last; i++) {
    const previous = frames[i - 1];
    if (sameReplayPositions(previous, frames[i])) {
      const start = previous.time;
      while (i < last && sameReplayPositions(frames[i], frames[i + 1])) i++;
      if (i < last) playback.push({...frames[i], time:playback.at(-1).time + Math.min(.35, frames[i].time - start)});
      continue;
    }
    const elapsed = frames[i].time - previous.time;
    if (elapsed <= 0) playback[playback.length - 1] = {...frames[i], time:playback.at(-1).time};
    else playback.push({...frames[i], time:playback.at(-1).time + elapsed});
  }
  return {...clip, frames:playback};
}

// The engine models regions, not an exact striking foot position. Use the
// recorded shot zone/type for the final setup, retaining the preceding movement.
export function keyPlayShotOrigin(clip) {
  const last=clip.actions.at(-1),player=find(last.after,last.teamIndex,clip.actorId??last.toPlayerId);
  if(!player)return null;
  if(!clip.zone)return {x:player.x,y:player.y};
  const [band,lane]=clip.zone.split(':');
  const long=clip.attackType==='longShot'||last.type==='longShot'||band==='finalThird';
  const depth=long?[23,32]:clip.attackType==='cutback'?[13,20]:['cross','header'].includes(clip.attackType)?[9,16]:[10,19];
  const lanes={farLeft:[22,34],leftHalfSpace:[32,44],center:[43,57],rightHalfSpace:[56,68],farRight:[66,78]};
  const width=lanes[lane]??lanes.center;
  return {x:clamp(player.x,...width),y:clamp(player.y,...depth)};
}

// Buildup endpoints are recorded positions; the final shooting setup and ball
// flight are region-based illustrations. Never feed presentation into simulation.
export function sampleKeyPlay(clip, progress) {
  if(clip.frames?.length){
    const frames=clip.frames,time=frames[0].time+(frames.at(-1).time-frames[0].time)*progress;
    const index=frames.findIndex(f=>f.time>=time),b=frames[index<0?frames.length-1:index],a=frames[Math.max(0,index-1)];
    const t=b.time>a.time?clamp((time-a.time)/(b.time-a.time),0,1):1;
    return {players:b.players.map(p=>({...p,...mix(find(a.players,p.teamIndex,p.id)??p,p,t)})),
      ball:mix(a.ball,b.ball,t),from:a.ball,to:b.ball,label:'进球回放',progress};
  }
  const actions=clip.actions, span=1/(actions.length+1), index=Math.min(actions.length,Math.floor(progress/span));
  const a=actions[Math.min(index,actions.length-1)], terminal=index===actions.length;
  const t=Math.min(1,Math.max(0,(progress-index*span)/span));
  const last=actions.at(-1),shooterId=clip.actorId??last.toPlayerId;
  const shooter=find(last.after,last.teamIndex,shooterId),origin=keyPlayShotOrigin(clip);
  const setupStart=Math.max(0,actions.length-2);
  const setupWeight=boundary=>clamp((boundary-setupStart)/(actions.length-setupStart),0,1);
  const positioned=(p,boundary)=>fieldPoint(p.id===shooterId&&p.teamIndex===last.teamIndex&&origin&&shooter
    ? {...p,x:clamp(p.x+(origin.x-shooter.x)*setupWeight(boundary),2,98),y:clamp(p.y+(origin.y-shooter.y)*setupWeight(boundary),2,98)}:p);
  const players=a.after.map(p=>({...p,...mix(positioned(find(a.before,p.teamIndex,p.id)??p,index),positioned(p,index+1),terminal?1:t)}));
  const start=find(a.before,a.teamIndex,a.fromPlayerId), end=find(a.after,a.teamIndex,a.toPlayerId);
  let from=positioned(start??end,index),to=positioned(end??start,index+1);
  if (terminal) {
    from=positioned(end,actions.length);
    const defender=find(a.after,1-a.teamIndex,clip.defenderId);
    const goal={x:clip.type==='miss'?62:from.x<50?53.5:46.5,y:a.teamIndex===0?.8:99.2};
    to=['save','block'].includes(clip.type)?mix(from,goal,clip.type==='save'?.86:.42):goal;
    if(defender){const marker=find(players,defender.teamIndex,defender.id);if(marker&&['save','block'].includes(clip.type))Object.assign(marker,mix(fieldPoint(defender),to,t));}
  }
  const ball=mix(from,to,t);
  return {players,ball,from,to,actorId:terminal?clip.actorId:a.toPlayerId,fromPlayerId:a.fromPlayerId,
    teamIndex:a.teamIndex,label:terminal?RESULTS[clip.type]:LABELS[a.type]??'推进',terminal,progress};
}

export function keyPlayDurationMs(clip) {
  if (!clip) return 0;
  if (clip.frames?.length >= 2) {
    const seconds = clip.frames.at(-1).time - clip.frames[0].time;
    if (Number.isFinite(seconds) && seconds > 0) return Math.max(6000, seconds * 1000);
  }
  // Action-only recordings have no clock; give each action and the shot time to read.
  return Math.max(6000, ((clip.actions?.length ?? 0) + 1) * 1500);
}

export function keyPlayEntries(match) {
  const clips=new Map();
  for(const clip of match.keyPlays??[]){
    if(clip.frames?.length>=2 || clip.actions?.length)clips.set(String(clip.eventId),clip);
    else if(match.v4Replay && Number.isFinite(clip.replayTime))clips.set(String(clip.eventId),{...clip,frames:null});
  }
  return (match.events??[]).filter(e=>isGoalEvent(e)&&(match.engineProfile!=='v4-spatial'||clips.has(String(e.id)))).map(event=>{
    const clip=clips.get(String(event.id));
    return {event,clip:clip?{...clip,zone:clip.zone??event.zone,attackType:clip.attackType??event.attackType}:null};
  });
}

export function createKeyPlayQueue() {
  let code=null,seen=new Set(),pending=[],wasLive=false;
  return {
    update(broadcast,enabled=true) {
      const entries=keyPlayEntries(broadcast.match);
      if(code!==broadcast.code) {code=broadcast.code;wasLive=Boolean(broadcast.live);seen=new Set(entries.map(x=>x.event.id));pending=[];return;}
      for(const entry of entries) if(!seen.has(entry.event.id)) {
        seen.add(entry.event.id);
        if(enabled&&(broadcast.live||wasLive))pending.push(entry);
      }
      wasLive=Boolean(broadcast.live || wasLive&&broadcast.replaysPending);
    },
    next(){return pending.shift()??null;}, clear(){pending=[];},
    reset(){code=null;seen=new Set();pending=[];wasLive=false;},
  };
}

export function createBroadcastKeyPlays({renderCard,loadClip,env=globalThis}) {
  const doc=env.document,queue=createKeyPlayQueue();
  let root=null,controls=null,controlHost=null,broadcast=null,code=null,view='lineup',active=null,frame=0,auto=true,serial=0,loading=false,loadMessage='';
  try{auto=env.localStorage.getItem('yffm1-key-play-auto')!=='off';}catch{}
  const reduced=()=>doc.documentElement.dataset.uiMotion==='off'||env.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cancel=()=>{serial++;loading=false;loadMessage='';env.cancelAnimationFrame(frame);frame=0;active=null;};
  function archive(){return broadcast?keyPlayEntries(broadcast.match):[];}
  function draw() {
    if(!root)return;
    const selected=active||loadMessage?'plays':view;
    root.className='broadcast-key-plays';
    root.innerHTML=`<div class="key-play-toolbar"><div role="tablist" aria-label="直播画面"><button role="tab" data-kp-view="lineup" aria-selected="${selected==='lineup'}" tabindex="${selected==='lineup'?0:-1}">阵容</button><button role="tab" data-kp-view="plays" aria-selected="${selected==='plays'}" tabindex="${selected==='plays'?0:-1}">进球回放</button></div><label><input type="checkbox" data-kp-auto ${auto?'checked':''}>自动播放</label></div><div class="key-play-stage" role="tabpanel" aria-label="进球回放" ${selected==='plays'?'':'hidden'}>${active?`<div class="key-play-caption"><span>${broadcastMinuteLabel(active.entry.event.minute)}′ · 进球回放</span><b data-kp-action></b><button data-kp-stop>跳过</button></div><svg class="key-play-field" viewBox="0 0 100 130" role="img" aria-label="${broadcastMinuteLabel(active.entry.event.minute)}分钟进球回放"><defs><pattern id="kp-grass" width="100" height="20" patternUnits="userSpaceOnUse"><rect width="100" height="10" fill="#ffffff" opacity=".025"/></pattern></defs><rect width="100" height="130" fill="#103d32"/><rect width="100" height="130" fill="url(#kp-grass)"/><g class="key-play-lines" fill="none"><rect x="2" y="2" width="96" height="126"/><path d="M2 65H98M27 2V22H73V2M27 128V108H73V128M39 2V10H61V2M39 128V120H61V128"/><circle cx="50" cy="65" r="10"/></g><path data-kp-trail fill="none"/><g data-kp-players></g><circle data-kp-ball r=".9" fill="white" stroke="#0d1f25" stroke-width=".3"/></svg><div class="key-play-celebration" data-kp-celebration hidden></div><div class="key-play-progress"><i data-kp-progress></i></div>`:`<div class="key-play-idle"><span>进球回放</span><strong>${archive().length?'选择进球回看':'等待进球'}</strong></div>`}</div><div class="key-play-archive" ${selected==='plays'?'':'hidden'}>${archive().slice().reverse().map(({event,clip})=>`<button data-kp-replay="${esc(event.id)}" aria-label="回看${broadcastMinuteLabel(event.minute)}分钟${goalLabel(event)}">${broadcastMinuteLabel(event.minute)}′ <b>${goalLabel(event)}</b>${clip?'':' · 球员卡'}</button>`).join('')}</div>`;
    if(loadMessage)root.querySelector('.key-play-idle strong').textContent=loadMessage;
    root.closest('.broadcast-v2-field-column')?.classList.toggle('is-key-play-view',selected==='plays');
    root.querySelectorAll('[data-kp-view]').forEach((button,index,buttons)=>{
      const select=()=>{cancel();queue.clear();view=button.dataset.kpView;draw();controls.querySelector(`[data-kp-view="${view}"]`)?.focus({preventScroll:true});};
      button.onclick=select;
      button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?1:1-index].click();}};
    });
    root.querySelector('[data-kp-auto]').onchange=e=>{auto=e.target.checked;try{env.localStorage.setItem('yffm1-key-play-auto',auto?'on':'off');}catch{}if(!auto){cancel();queue.clear();draw();}};
    root.querySelector('[data-kp-stop]')?.addEventListener('click',finish);
    root.querySelectorAll('[data-kp-replay]').forEach(button=>button.onclick=()=>{queue.clear();view='plays';start(archive().find(x=>String(x.event.id)===button.dataset.kpReplay),true);});
    if(active)preparePlayers();
    controls=root.querySelector('.key-play-toolbar');
    if(controlHost)controlHost.replaceChildren(controls);
  }
  function preparePlayers(){
    const clip = active.entry.clip;
    const players = clip ? sampleKeyPlay(clip, 0).players : [];
    root.querySelector('[data-kp-players]').innerHTML = players.map(p => {
      const name = p.name || broadcast.match.teams[p.teamIndex].players.find(row => row.id === p.id)?.name || '球员';
      // Keep the label in marker-local coordinates throughout this clip.
      const anchor = p.x < 15 ? 'start' : p.x > 85 ? 'end' : 'middle';
      const above = p.y > 95 || (p.teamIndex === 1 && p.y > 5);
      return `<g data-kp-player="${esc(p.teamIndex+':'+p.id)}" class="key-play-player side-${p.teamIndex}"><circle r="1.25"/><text text-anchor="${anchor}" y="${above ? -2.1 : 3.9}">${esc(name)}</text></g>`;
    }).join('');
    active.nodes=[...root.querySelectorAll('[data-kp-player]')];
  }
  function paint(progress){
    const clip=active.entry.clip;if(!clip)return;
    const sample=sampleKeyPlay(clip,progress);
    for(const node of active.nodes){
      const p=sample.players.find(p=>p.teamIndex+':'+p.id===node.dataset.kpPlayer);if(!p)continue;
      const involved=p.teamIndex===sample.teamIndex&&[sample.actorId,sample.fromPlayerId].includes(p.id);
      node.classList.toggle('involved',involved);node.setAttribute('transform',`translate(${p.x} ${p.y*1.3})`);
    }
    const ball=root.querySelector('[data-kp-ball]');ball.setAttribute('cx',sample.ball.x);ball.setAttribute('cy',sample.ball.y*1.3);
    root.querySelector('[data-kp-trail]').setAttribute('d',`M${sample.from.x} ${sample.from.y*1.3} L${sample.ball.x} ${sample.ball.y*1.3}`);
    root.querySelector('[data-kp-action]').textContent=sample.label;
    root.querySelector('[data-kp-progress]').style.width=`${progress*100}%`;
  }
  function celebrate(){
    const e=active.entry.event,side=e.attackingTeamIndex??e.teamIndex;
    const playerSide=e.type==='ownGoal'||e.ownGoal?1-side:side;
    const scorer=broadcast.match.teams[playerSide]?.players.find(p=>p.id===e.actorId);
    const assistant=e.type==='goal'&&!e.ownGoal&&e.assistId?broadcast.match.teams[side]?.players.find(p=>p.id===e.assistId):null;
    const panel=root.querySelector('[data-kp-celebration]');panel.hidden=false;
    panel.classList.add('is-visible');
    panel.innerHTML=`<div class="key-play-goal-word">${e.type==='ownGoal'||e.ownGoal?'乌龙球':'GOAL'}</div><div class="key-play-goal-score">${broadcastMinuteLabel(e.minute)}′${Array.isArray(e.score)?' · '+e.score.join(' : '):''}</div><div class="key-play-goal-cards">${scorer?`<div class="key-play-scorer"><span>${goalLabel(e)}</span>${renderCard(scorer)}<b>${esc(scorer.name)}</b></div>`:''}${assistant?`<div class="key-play-assister"><span>助攻</span>${renderCard(assistant)}<b>${esc(assistant.name)}</b></div>`:''}</div>`;
    root.querySelector('[data-kp-action]').textContent=goalLabel(e);
  }
  function finish(){cancel();draw();pump();}
  async function start(entry,manual=false){
    if(!entry||doc.hidden)return;
    if(entry.clip?.replayTime!=null&&!entry.clip.frames?.length&&!entry.clip.actions?.length){
      cancel();loading=true;const request=serial,matchCode=code;
      loadMessage='正在读取进球片段…';draw();
      try{entry={...entry,clip:await loadClip(broadcast.match.v4Replay,entry.clip)};}
      catch(error){if(request===serial){loading=false;loadMessage=error.message;draw();pump();}return;}
      if(request!==serial||matchCode!==code||!root?.isConnected)return;
    }
    entry = {...entry, clip:prepareGoalPlayback(entry.clip)};
    cancel();active={entry,start:null,celebrated:false};draw();
    const still = !manual && reduced();
    const playMs = entry.clip && still ? 200 : keyPlayDurationMs(entry.clip);
    const goal = isGoalEvent(entry.event), endMs = playMs + (goal ? 3500 : 650);
    if (entry.clip) paint(still ? 1 : 0);
    const tick=now=>{
      if(!active||!root?.isConnected)return;
      if(doc.hidden){cancel();queue.clear();draw();return;}
      active.start??=now;const elapsed=now-active.start;
      if(entry.clip)paint(still?1:Math.min(1,elapsed/playMs));
      if(goal&&elapsed>=playMs&&!active.celebrated){active.celebrated=true;celebrate();}
      if(goal&&elapsed>=endMs-400)root.querySelector('[data-kp-celebration]')?.classList.add('is-leaving');
      if(elapsed>=endMs){finish();return;}frame=env.requestAnimationFrame(tick);
    };frame=env.requestAnimationFrame(tick);
  }
  function pump(){if(!active&&!loading&&auto&&!doc.hidden){const next=queue.next();if(next)start(next);}}
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden){cancel();queue.clear();draw();}});
  return {
    mount(host,value,toolbarHost=null){
      broadcast=value;
      controlHost=toolbarHost;
      if(code!==value.code){cancel();queue.reset();code=value.code;view=value.history?'plays':'lineup';root?.remove();controls?.remove();root=null;controls=null;}
      if(!root)root=doc.createElement('div');
      if(root.parentNode!==host)host.append(root);
      if(controlHost&&controls&&controls.parentNode!==controlHost)controlHost.append(controls);
      queue.update(value,auto&&!doc.hidden);
      if(!active)draw();else root.closest('.broadcast-v2-field-column')?.classList.add('is-key-play-view');
      pump();
    },
    play(id){queue.clear();view='plays';draw();start(archive().find(x=>String(x.event.id)===String(id)),true);},
    reset(){cancel();queue.reset();root?.remove();controls?.remove();root=null;controls=null;controlHost=null;broadcast=null;code=null;},
  };
}
