import {compareMovements} from './shape-movement.js';
import {shapeScenarios} from './shape-preview-player.js';

const meters=n=>n.toFixed(1)+' 米';
function direction(d){
  const parts=[];
  if(Math.abs(d.forward)>=.05)parts.push((d.forward>0?'前移':'后撤')+meters(Math.abs(d.forward)));
  if(Math.abs(d.right)>=.05)parts.push((d.right>0?'右移':'左移')+meters(Math.abs(d.right)));
  return parts.join('，');
}
function shift(d){
  const hint=direction(d);
  return meters(d.distance)+(hint?'（'+hint+'）':'');
}
const svgNS='http://www.w3.org/2000/svg';
export function mountShapeComparison(pitch,before,after,preferredId,onSingle,onClose,caption){
  const {players,duration}=compareMovements(before,after);
  const layer=document.createElement('div'),field=document.createElementNS(svgNS,'svg');
  layer.className='shape-v4-layer movement-overlay';
  field.setAttribute('viewBox','0 0 100 100');field.setAttribute('preserveAspectRatio','none');
  field.setAttribute('aria-hidden','true');layer.append(field);
  const panel=document.createElement('section');panel.className='shape-v4-panel movement-comparison';
  panel.setAttribute('aria-label','调整前后跑位对比');
  panel.innerHTML=`<div class="shape-v4-toolbar"><strong></strong><button type="button" data-single>看当前跑位</button><button type="button" data-close>退出预览</button></div>
    <div class="movement-legend"><span>调整前 · 虚线</span><span>调整后 · 实线</span><small>方块为起点，圆点为落位</small></div>
    <label>查看球员 <select aria-label="查看对比球员"></select></label>
    <div aria-live="polite" data-movement-detail></div>`;
  const plan={level:'默认预案',leading:'领先预案',trailing:'落后预案'}[after.scoreState];
  panel.querySelector('strong').textContent=`${plan} · ${shapeScenarios[after.scenario]} · 共同片段 0–${duration.toFixed(1)} 秒`;
  const note=document.createElement('small');
  note.textContent=caption;
  if(preferredId&&!players.some(p=>p.id===preferredId))note.append(' 关联球员未进入两套首发，可选择队友查看。');
  panel.append(note);
  panel.querySelector('[data-single]').onclick=onSingle;panel.querySelector('[data-close]').onclick=onClose;
  const select=panel.querySelector('select'),detail=panel.querySelector('[data-movement-detail]');
  const nodes=[];
  // Draw the wider old strokes underneath, so coincident paths keep both colours.
  for(const version of ['previous','next']){
    for(const player of players){
      const points=player[version];
      if(!points)continue;
      const trail=document.createElementNS(svgNS,'polyline');trail.setAttribute('points',points.map(p=>p.join(',')).join(' '));
      trail.dataset.version=version;
      trail.onclick=()=>choose(player.id);
      field.append(trail);
      const origin=document.createElement('i');
      origin.className='movement-origin';origin.setAttribute('aria-hidden','true');origin.dataset.version=version;
      origin.style.left=points[0][0]+'%';origin.style.top=points[0][1]+'%';layer.append(origin);
      const dot=document.createElement('button');
      dot.type='button';dot.className='movement-end';dot.dataset.version=version;
      dot.textContent=version==='next'||!player.next?player.role:'';
      dot.title=player.name+' · '+(version==='previous'?'调整前':'调整后');
      dot.setAttribute('aria-label',dot.title);dot.style.left=points.at(-1)[0]+'%';dot.style.top=points.at(-1)[1]+'%';
      dot.onclick=()=>choose(player.id);layer.append(dot);
      nodes.push({id:player.id,trail,origin,dot});
    }
  }
  for(const player of players)select.add(new Option(player.name+' · '+player.role,player.id));
  function choose(id){
    const player=players.find(p=>p.id===id);
    if(!player)return;
    select.value=id;
    for(const {id:other,trail,origin,dot} of nodes){
      const active=other===id;
      trail.dataset.selected=String(active);origin.hidden=!active;dot.setAttribute('aria-pressed',String(active));
    }
    detail.replaceChildren();
    if(!player.previous||!player.next){
      detail.textContent=player.name+(player.previous?'仅在调整前的首发中。':'仅在调整后的首发中。');
      return;
    }
    const delta=player.afterLength-player.beforeLength;
    const lengthDelta=Math.abs(delta)<.05?'相同':(delta>0?'多跑 ':'少跑 ')+meters(Math.abs(delta));
    const stats=[['起点位移',shift(player.start)],['跑动路程',`${meters(player.beforeLength)} → ${meters(player.afterLength)}（${lengthDelta}）`],
      ['落位位移',shift(player.end)],['途中最大位置差',meters(player.peakGap)]];
    const list=document.createElement('dl');
    for(const [label,value] of stats){
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);
    }
    detail.append(list);
    if(duration===0)detail.append('双方仅起始时点仍在同一阶段。');
  }
  // The host form treats bubbling input and change events as edits to the tactic.
  select.oninput=event=>event.stopPropagation();
  select.onchange=event=>{
    event.stopPropagation();
    choose(select.value);
  };
  pitch.classList.add('shape-v4-active');pitch.append(layer);pitch.after(panel);
  choose(players.find(p=>p.id===preferredId)?.id??players.find(p=>p.next&&p.previous&&p.role!=='GK')?.id??players[0]?.id);
  return ()=>{layer.remove();panel.remove();pitch.classList.remove('shape-v4-active');};
}
