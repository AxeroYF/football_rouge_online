import { broadcastCardFace } from '../player-card/broadcast-card.js';

export function mergeDynamicSnapshot(previous, next) {
  const incoming=next?.live?.broadcast, old=previous?.live?.broadcast;
  if(!incoming?.playerPatch||!old?.dynamic||previous.live.key!==next.live.key)return next;
  incoming.teams=incoming.teams.map((team,i)=>({...team,players:team.players.map(p=>({...old.teams[i]?.players.find(q=>q.id===p.id),...p}))}));
  incoming.dynamic.frames=[...new Map([...old.dynamic.frames,...incoming.dynamic.frames].map(f=>[f.tick,f])).values()].sort((a,b)=>a.tick-b.tick).slice(-61);
  return next;
}

// Presentation only: accepts already released server frames, no match seed,
// simulation, future results or client-side settlement.
export function mountDynamicBroadcast(host) {
  host.innerHTML = '<div class="dynamic-pitch-wrap"><canvas aria-label="动态比赛球场，点选球员查看球员卡"></canvas><span class="dynamic-phase" role="status"></span></div><div class="dynamic-player-inspector"><div class="dynamic-selected-card"></div><div><label>查看球员 <select aria-label="选择场上球员"></select></label><p class="dynamic-player-state"></p><small>蓝方为主队 · 金方为客队</small></div></div>';
  const canvas=host.querySelector('canvas'), ctx=canvas.getContext('2d'), select=host.querySelector('select'), card=host.querySelector('.dynamic-selected-card');
  let frames=[],teams=[],selected='',frameId=0,disposed=false,anchor=0,anchorAt=0,lastPaint=0,drawn=null,signature='';
  const coordinates = () => { const width=canvas.clientWidth||800,height=canvas.clientHeight||500,pad=18;return {width,height,pad,sx:(width-pad*2)/105,sy:(height-pad*2)/68}; };
  function inspect() {
    const [side,...parts]=selected.split('|'), p=teams[Number(side)]?.players.find(p=>String(p.id)===parts.join('|'));
    if (!p) return;
    const key=selected+'|'+p.overall+'|'+p.upgradeLevel;
    if (signature!==key) {card.innerHTML=broadcastCardFace({...p,broadcastTeamIndex:Number(side)});signature=key;}
    host.querySelector('.dynamic-player-state').textContent=`${p.name} · ${p.assignedRole??p.role} · 体力 ${Math.round(p.fitness??100)} · 评分 ${Number(p.rating??6).toFixed(1)}${p.sentOff?' · 红牌':p.injury?' · 伤退':''}`;
  }
  select.onchange=()=>{selected=select.value;inspect();};
  canvas.onclick=e=>{
    if(!drawn)return;
    const r=canvas.getBoundingClientRect(),g=coordinates(),x=(e.clientX-r.left-g.pad)/g.sx,y=(e.clientY-r.top-g.pad)/g.sy;
    const nearest=[...drawn.players].sort((a,b)=>Math.hypot(a[3]-x,a[4]-y)-Math.hypot(b[3]-x,b[4]-y))[0];
    if(nearest&&Math.hypot(nearest[3]-x,nearest[4]-y)<6){selected=`${nearest[0]}|${nearest[1]}`;select.value=selected;inspect();}
  };
  function draw(now) {
    frameId=0;
    if(disposed||document.hidden)return;
    frameId=requestAnimationFrame(draw);
    if(now-lastPaint<32||!frames.length)return;
    lastPaint=now;
    const time=Math.min(frames.at(-1).time,anchor+(now-anchorAt)/1000);
    const a=frames.findLast(f=>f.time<=time)??frames[0],b=frames.find(f=>f.time>a.time)??a;
    const blend=a.cut||b.cut||a.phase!==b.phase?0:Math.min(1,Math.max(0,(time-a.time)/(b.time-a.time||1)));
    const next=new Map(b.players.map(p=>[`${p[0]}|${p[1]}`,p]));
    const players=a.players.map(p=>{const q=next.get(`${p[0]}|${p[1]}`)??p;return [...p.slice(0,3),p[3]+(q[3]-p[3])*blend,p[4]+(q[4]-p[4])*blend];});
    const ball=a.ball.map((v,i)=>v+(b.ball[i]-v)*blend);drawn={players};
    const g=coordinates(),dpr=Math.min(2,devicePixelRatio||1);
    if(canvas.width!==Math.round(g.width*dpr)||canvas.height!==Math.round(g.height*dpr)){canvas.width=Math.round(g.width*dpr);canvas.height=Math.round(g.height*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,g.width,g.height);
    ctx.fillStyle='#123b35';ctx.fillRect(0,0,g.width,g.height);
    for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#1b5146':'#184b40';ctx.fillRect(g.pad+i*10.5*g.sx,g.pad,10.5*g.sx,68*g.sy);}
    const x=v=>g.pad+v*g.sx,y=v=>g.pad+v*g.sy;
    ctx.strokeStyle='#c5e2d282';ctx.lineWidth=1;
    ctx.strokeRect(x(0),y(0),105*g.sx,68*g.sy);ctx.beginPath();ctx.moveTo(x(52.5),y(0));ctx.lineTo(x(52.5),y(68));ctx.stroke();
    ctx.beginPath();ctx.ellipse(x(52.5),y(34),9.15*g.sx,9.15*g.sy,0,0,Math.PI*2);ctx.stroke();
    for(const side of [0,1]){ctx.strokeRect(x(side?88.5:0),y(13.84),16.5*g.sx,40.32*g.sy);ctx.strokeRect(x(side?99.5:0),y(24.84),5.5*g.sx,18.32*g.sy);ctx.strokeRect(x(side?105:-1.7),y(30.34),1.7*g.sx,7.32*g.sy);}
    for(const p of players){const px=x(p[3]),py=y(p[4]),radius=Math.max(6,Math.min(12,g.width/70));
      ctx.fillStyle='#0005';ctx.beginPath();ctx.ellipse(px,py+radius*.65,radius*1.1,radius*.5,0,0,7);ctx.fill();
      ctx.fillStyle=p[0]===0?'#71c6ff':'#f4c66b';ctx.strokeStyle=selected===`${p[0]}|${p[1]}`?'#ffffff':'#14242d';ctx.lineWidth=selected===`${p[0]}|${p[1]}`?3:1.5;
      ctx.beginPath();ctx.arc(px,py,radius,0,7);ctx.fill();ctx.stroke();ctx.fillStyle='#10252b';ctx.font=`bold ${Math.max(9,radius)}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p[2],px,py);
    }
    ctx.fillStyle='#0005';ctx.beginPath();ctx.ellipse(x(ball[0]),y(ball[1])+3,5,2,0,0,7);ctx.fill();
    ctx.fillStyle='#fff';ctx.strokeStyle='#152b22';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x(ball[0]),y(ball[1])-ball[2]*3,4,0,7);ctx.fill();ctx.stroke();
    host.querySelector('.dynamic-phase').textContent=a.phase==='var'?'VAR 检查中':a.phase==='stoppage'?'死球 · 准备重新开球':a.phase==='finished'?'比赛结束':'动态直播';
    const overlay=host.closest('#campaign-broadcast');
    const scores=overlay?.querySelectorAll('.scoreboard>div>b');if(scores?.length===2)scores.forEach((node,i)=>{node.textContent=a.score[i];});
    const clock=overlay?.querySelector('.scoreboard>span>strong');if(clock)clock.textContent=`${Math.ceil(a.minute)}′`;
    overlay?.querySelectorAll('[data-dynamic-event-time]').forEach(node=>{node.hidden=Number(node.dataset.dynamicEventTime)>a.time;});
  }
  const visible=()=>{if(document.hidden){cancelAnimationFrame(frameId);frameId=0;}else if(!disposed&&!frameId){anchor=Math.max(frames[0]?.time??0,(frames.at(-1)?.time??0)-2.4);anchorAt=performance.now();frameId=requestAnimationFrame(draw);}};
  document.addEventListener('visibilitychange',visible);
  return {host,update(broadcast){
    const fresh=broadcast.dynamic.frames;teams=broadcast.teams;
    if(fresh?.length){const now=performance.now(),current=anchor+(now-anchorAt)/1000;frames=fresh;const latest=frames.at(-1).time;anchor=broadcast.finished?latest:Math.max(frames[0].time,Math.min(latest-2.4,Math.max(current,latest-3.2)));anchorAt=now;}
    const old=select.value, options=teams.flatMap((t,i)=>t.players.filter(p=>p.active||p.startedMatch||p.sentOff||p.injury).map(p=>({key:`${i}|${p.id}`,text:`${i===0?'主':'客'} · ${p.name}${p.active?'':'（已离场）'}`})));
    if(select.dataset.signature!==JSON.stringify(options)){select.replaceChildren(...options.map(p=>{const o=document.createElement('option');o.value=p.key;o.textContent=p.text;return o;}));select.dataset.signature=JSON.stringify(options);}
    selected=options.some(p=>p.key===old)?old:options[0]?.key??'';select.value=selected;inspect();
    if(!frameId&&!document.hidden)frameId=requestAnimationFrame(draw);
  },destroy(){disposed=true;cancelAnimationFrame(frameId);document.removeEventListener('visibilitychange',visible);canvas.onclick=null;select.onchange=null;}};
}
