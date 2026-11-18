import {V2_PLAYER_DUTY_OPTIONS} from './v2-player-duty-options.js';
import {movementFrames} from './shape-movement.js';
export {movementFrames} from './shape-movement.js';

export const shapeScenarios={attack:'右路进攻',left:'左路进攻',defense:'阵地防守',gain:'夺回球权',loss:'丢球转换'};

const formationLine=role=>({
  LB:'back',LWB:'back',CB:'back',RB:'back',RWB:'back',
  DM:'mid',CM:'mid',AM:'mid',LM:'mid',RM:'mid',LW:'front',ST:'front',RW:'front',
})[role];

// The overlay uses the own team's measured positions. The editor retains its anchors.
export function mountShapePreview(pitch,preview,onClose,evidence=null,onCompare=null){
  if(!preview.frames?.length||!preview.roster?.length)throw new Error('没有可显示的 V4 跑位');
  const frames=movementFrames(preview,evidence?.time??0);
  const start=frames[0].time,end=frames.at(-1).time;
  const layer=document.createElement('div');
  layer.className='shape-v4-layer';
  const field=document.createElementNS('http://www.w3.org/2000/svg','svg');
  field.setAttribute('viewBox','0 0 100 100');field.setAttribute('preserveAspectRatio','none');field.setAttribute('aria-hidden','true');
  layer.append(field);
  const panel=document.createElement('section');
  panel.className='shape-v4-panel';panel.setAttribute('aria-label','V4 落位播放器');
  panel.innerHTML='<div class="shape-v4-toolbar"><strong></strong><button type="button" data-play>暂停</button><button type="button" data-close>退出预览</button></div><small>轨迹显示本阶段跑位，横向连线显示三线阵型。点选球员可查看职责。</small><p data-focus></p>';
  panel.querySelector('strong').textContent=shapeScenarios[preview.scenario];
  if(onCompare){
    const button=document.createElement('button');
    button.type='button';button.textContent=evidence?'对比阶段起始跑位':'叠加调整前';button.dataset.compareMovement='';
    button.onclick=()=>onCompare(preview.roster.find(p=>p.key===selected)?.id);
    panel.querySelector('[data-close]').before(button);
  }
  if(evidence){
    const note=document.createElement('p');note.className='shape-v4-evidence';
    note.textContent=`${evidence.label} · ${evidence.time.toFixed(1)} 秒｜${evidence.detail}`;
    panel.append(note);
  }
  function polyline(kind){
    const line=document.createElementNS(field.namespaceURI,'polyline');
    line.dataset.kind=kind;field.append(line);return line;
  }
  const lines=new Map(['back','mid','front'].map(kind=>[kind,polyline('formation')]));
  const roster=new Map(preview.roster.filter(p=>p.side===0).map(p=>[p.key,p]));
  const own=frames[0].players.flatMap((p,index)=>{
    const meta=roster.get(p.key);
    if(!meta||!p.active)return [];
    const trail=polyline('trail');
    trail.setAttribute('points',frames.map(f=>`${f.players[index].x},${f.players[index].y}`).join(' '));
    const dot=document.createElement('button');
    dot.type='button';dot.className='shape-v4-dot';dot.dataset.side='0';dot.textContent=meta.role;
    dot.title=meta.name+' · '+meta.role;dot.setAttribute('aria-label',dot.title);
    dot.onclick=()=>{selected=p.key;draw();};layer.append(dot);
    return [{index,meta,trail,dot,line:formationLine(meta.role)}];
  }).sort((a,b)=>frames[0].players[a.index].x-frames[0].players[b.index].x);
  let selected=evidence?.playerKey??own.find(e=>e.meta.role!=='GK')?.meta.key;
  let elapsed=evidence?.time??start,running=!evidence&&end>start,last=null,ticket=0;
  const play=panel.querySelector('[data-play]'),focus=panel.querySelector('[data-focus]');
  function draw(){
    const index=Math.max(0,frames.findLastIndex(f=>f.time<=elapsed+1e-7));
    const a=frames[index],b=frames[index+1]??a,t=a===b?0:(elapsed-a.time)/(b.time-a.time);
    const points={back:[],mid:[],front:[]};
    for(const player of own){
      const {meta,dot,trail}=player,from=a.players[player.index],to=b.players[player.index];
      const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t;
      dot.style.left=x+'%';dot.style.top=y+'%';dot.hidden=!from.active;
      const chosen=meta.key===selected;
      dot.setAttribute('aria-pressed',String(chosen));trail.dataset.selected=String(chosen);
      if(from.active&&player.line)points[player.line].push(x+','+y);
      if(chosen){
        const task=preview.tasks[from.task];
        const text=[meta.name,meta.role,V2_PLAYER_DUTY_OPTIONS[meta.duty]?.label,task?.label].filter(Boolean).join(' · ');
        if(focus.textContent!==text)focus.textContent=text;
      }
    }
    for(const [kind,line] of lines)line.setAttribute('points',points[kind].join(' '));
    play.textContent=running?'暂停':elapsed>=end?'重看跑位':'继续';play.disabled=end===start;
  }
  function animate(now){
    if(last!==null)elapsed=Math.min(end,elapsed+(now-last)/1000*1.5);
    last=now;running=elapsed<end;draw();
    if(running)ticket=requestAnimationFrame(animate);
  }
  function pause(){cancelAnimationFrame(ticket);last=null;running=false;}
  play.onclick=()=>{
    if(running)pause();
    else{if(elapsed>=end)elapsed=start;last=null;running=true;ticket=requestAnimationFrame(animate);}
    draw();
  };
  panel.querySelector('[data-close]').onclick=onClose;
  pitch.classList.add('shape-v4-active');pitch.append(layer);pitch.after(panel);
  draw();if(running)ticket=requestAnimationFrame(animate);
  return ()=>{pause();layer.remove();panel.remove();pitch.classList.remove('shape-v4-active');};
}
