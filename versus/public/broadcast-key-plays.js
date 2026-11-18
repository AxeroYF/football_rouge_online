const GOALS = new Set(['goal','ownGoal']);
const LABELS = {pass:'传球',direct:'向前传递',switch:'转移',recycle:'回传',carry:'带球',create:'创造机会',shoot:'射门',longShot:'远射'};
const RESULTS = {goal:'进球',ownGoal:'乌龙球',shot:'射门',save:'扑救',miss:'射偏',block:'封堵',red:'红牌'};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fieldPoint = p => p.teamIndex === 1 ? {x:100-p.x,y:100-p.y} : {x:p.x,y:p.y};
const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const find = (players,side,id) => players.find(p=>p.teamIndex===side && p.id===id);
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

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
      ball:mix(a.ball,b.ball,t),from:a.ball,to:b.ball,label:'关键事件回放',progress};
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

export function keyPlayEntries(match) {
  const clips=new Map((match.keyPlays??[]).map(c=>[c.eventId,c]));
  return (match.events??[]).filter(e=>GOALS.has(e.type)&&match.engineProfile!=='v4-spatial'||clips.has(e.id)).map(event=>{
    const clip=clips.get(event.id);
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
      // Retain goals in chronological order; ordinary chances cannot build a backlog.
      const goals=pending.filter(x=>GOALS.has(x.event.type));
      pending=goals.length?goals.slice(-4):pending.slice(-1);
      wasLive=Boolean(broadcast.live);
    },
    next(){return pending.shift()??null;}, clear(){pending=[];},
    reset(){code=null;seen=new Set();pending=[];wasLive=false;},
  };
}

export function createBroadcastKeyPlays({renderCard,loadClip,env=globalThis}) {
  const doc=env.document,queue=createKeyPlayQueue();
  let root=null,controls=null,controlHost=null,broadcast=null,code=null,view='lineup',active=null,frame=0,auto=true,serial=0,loading=false;
  try{auto=env.localStorage.getItem('yffm1-key-play-auto')!=='off';}catch{}
  const reduced=()=>doc.documentElement.dataset.uiMotion==='off'||env.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cancel=()=>{serial++;loading=false;env.cancelAnimationFrame(frame);frame=0;active=null;};
  function archive(){return broadcast?keyPlayEntries(broadcast.match):[];}
  function draw() {
    if(!root)return;
    const selected=active?'plays':view;
    root.className='broadcast-key-plays';
    root.innerHTML=`<div class="key-play-toolbar"><div role="tablist" aria-label="直播画面"><button role="tab" data-kp-view="lineup" aria-selected="${selected==='lineup'}" tabindex="${selected==='lineup'?0:-1}">阵容</button><button role="tab" data-kp-view="plays" aria-selected="${selected==='plays'}" tabindex="${selected==='plays'?0:-1}">关键回合</button></div><label><input type="checkbox" data-kp-auto ${auto?'checked':''}>自动播放</label></div><div class="key-play-stage" role="tabpanel" aria-label="关键回合" ${selected==='plays'?'':'hidden'}>${active?`<div class="key-play-caption"><span>${esc(active.entry.event.minute)}′ · 精彩回合</span><b data-kp-action></b><button data-kp-stop>跳过</button></div><svg class="key-play-field" viewBox="0 0 100 130" role="img" aria-label="${esc(active.entry.event.minute)}分钟关键回合"><defs><pattern id="kp-grass" width="100" height="20" patternUnits="userSpaceOnUse"><rect width="100" height="10" fill="#ffffff" opacity=".025"/></pattern></defs><rect width="100" height="130" fill="#103d32"/><rect width="100" height="130" fill="url(#kp-grass)"/><g class="key-play-lines" fill="none"><rect x="2" y="2" width="96" height="126"/><path d="M2 65H98M27 2V22H73V2M27 128V108H73V128M39 2V10H61V2M39 128V120H61V128"/><circle cx="50" cy="65" r="10"/></g><path data-kp-trail fill="none"/><g data-kp-players></g><circle data-kp-ball r=".9" fill="white" stroke="#0d1f25" stroke-width=".3"/></svg><div class="key-play-celebration" data-kp-celebration hidden></div><div class="key-play-progress"><i data-kp-progress></i></div>`:`<div class="key-play-idle"><span>精彩回合</span><strong>${archive().length?'选择一个回合回看':'等待关键机会'}</strong></div>`}</div><div class="key-play-archive" ${selected==='plays'?'':'hidden'}>${archive().slice().reverse().map(({event,clip})=>`<button data-kp-replay="${esc(event.id)}" aria-label="回看${esc(event.minute)}分钟${RESULTS[event.type]??'机会'}">${esc(event.minute)}′ <b>${RESULTS[event.type]??'机会'}</b>${clip?'':' · 球员卡'}</button>`).join('')}</div>`;
    root.closest('.broadcast-v2-field-column')?.classList.toggle('is-key-play-view',selected==='plays');
    root.querySelectorAll('[data-kp-view]').forEach((button,index,buttons)=>{
      const select=()=>{cancel();queue.clear();view=button.dataset.kpView;draw();controls.querySelector(`[data-kp-view="${view}"]`)?.focus({preventScroll:true});};
      button.onclick=select;
      button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?1:1-index].click();}};
    });
    root.querySelector('[data-kp-auto]').onchange=e=>{auto=e.target.checked;try{env.localStorage.setItem('yffm1-key-play-auto',auto?'on':'off');}catch{}if(!auto){cancel();queue.clear();draw();}};
    root.querySelector('[data-kp-stop]')?.addEventListener('click',finish);
    root.querySelectorAll('[data-kp-replay]').forEach(button=>button.onclick=()=>{queue.clear();view='plays';start(archive().find(x=>x.event.id===button.dataset.kpReplay));});
    if(active)preparePlayers();
    controls=root.querySelector('.key-play-toolbar');
    if(controlHost)controlHost.replaceChildren(controls);
  }
  function preparePlayers(){
    const players=active.entry.clip?.frames?.[0]?.players??active.entry.clip?.actions?.[0]?.before??[];
    root.querySelector('[data-kp-players]').innerHTML=players.map(p=>`<g data-kp-player="${esc(p.teamIndex+':'+p.id)}" class="key-play-player side-${p.teamIndex}"><circle r="1.25"/><text text-anchor="middle">${esc(p.name||broadcast.match.teams[p.teamIndex].players.find(x=>x.id===p.id)?.name||'球员')}</text></g>`).join('');
    active.nodes=[...root.querySelectorAll('[data-kp-player]')];
  }
  function paint(progress){
    const clip=active.entry.clip;if(!clip)return;
    const sample=sampleKeyPlay(clip,progress),labels=[];
    for(const node of active.nodes){
      const p=sample.players.find(p=>p.teamIndex+':'+p.id===node.dataset.kpPlayer);if(!p)continue;
      const involved=p.teamIndex===sample.teamIndex&&[sample.actorId,sample.fromPlayerId].includes(p.id);
      node.classList.toggle('involved',involved);node.setAttribute('transform',`translate(${p.x} ${p.y*1.3})`);
      let x=Math.min(85,Math.max(15,p.x)),y=Math.min(126,p.y*1.3+3.6);
      for(let tries=0;tries<8&&labels.some(q=>Math.abs(q.x-x)<20&&Math.abs(q.y-y)<2.8);tries++)y=y<120?y+3:y-24;
      labels.push({x,y});const name=node.querySelector('text');name.setAttribute('x',x-p.x);name.setAttribute('y',y-p.y*1.3);
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
    panel.innerHTML=`<div class="key-play-goal-word">${e.type==='ownGoal'?'乌龙球':'GOAL'}</div><div class="key-play-goal-score">${esc(e.minute)}′${Array.isArray(e.score)?' · '+e.score.join(' : '):''}</div><div class="key-play-goal-cards">${scorer?`<div class="key-play-scorer"><span>${e.type==='ownGoal'?'乌龙球':'进球'}</span>${renderCard(scorer)}<b>${esc(scorer.name)}</b></div>`:''}${assistant?`<div class="key-play-assister"><span>助攻</span>${renderCard(assistant)}<b>${esc(assistant.name)}</b></div>`:''}</div>`;
    root.querySelector('[data-kp-action]').textContent=RESULTS[e.type];
  }
  function finish(){cancel();draw();pump();}
  async function start(entry){
    if(!entry||doc.hidden)return;
    if(entry.clip?.replayTime!=null&&!entry.clip.frames){
      cancel();loading=true;const request=serial,matchCode=code;
      const caption=root?.querySelector('.key-play-idle strong');if(caption)caption.textContent='正在读取关键片段…';
      try{entry={...entry,clip:await loadClip(broadcast.match.v4Replay,entry.clip)};}
      catch(error){if(request===serial){loading=false;if(caption)caption.textContent=error.message;}return;}
      if(request!==serial||matchCode!==code||!root?.isConnected)return;
    }
    cancel();active={entry,start:null,celebrated:false};draw();
    const playMs=entry.clip?(reduced()?200:3600):0,goal=GOALS.has(entry.event.type),endMs=playMs+(goal?3500:650);
    const tick=now=>{
      if(!active||!root?.isConnected)return;
      if(doc.hidden){cancel();queue.clear();draw();return;}
      active.start??=now;const elapsed=now-active.start;
      if(entry.clip)paint(reduced()?1:Math.min(1,elapsed/playMs));
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
    play(id){queue.clear();view='plays';draw();start(archive().find(x=>x.event.id===id));},
    reset(){cancel();queue.reset();root?.remove();controls?.remove();root=null;controls=null;controlHost=null;broadcast=null;code=null;},
  };
}
