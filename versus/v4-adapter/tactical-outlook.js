// Distances use the 68 x 105 m pitch. Board y increases towards our own goal.
const length=(a,b)=>Math.hypot((a.x-b.x)*.68,(a.y-b.y)*1.05);
function laneDistance(p,a,b){
  const dx=(b.x-a.x)*.68,dy=(b.y-a.y)*1.05;
  const x=(p.x-a.x)*.68,y=(p.y-a.y)*1.05;
  const t=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(x-dx*t,y-dy*t);
}
const name=(ctx,p)=>ctx.roster.get(p.key).name;
const observation=(p,risk,detail,advice='',issue=null)=>({playerKey:p.key,risk,detail,advice,issue});

function passing(ctx){
  const {holder,own,opponents}=ctx;
  if(!holder||!own.includes(holder))return;
  const outlets=own.filter(p=>p!==holder&&ctx.roster.get(p.key).role!=='GK'&&length(p,holder)<=22
    && opponents.every(q=>laneDistance(q,holder,p)>1.6));
  const bearings=outlets.map(p=>Math.atan2((p.y-holder.y)*1.05,(p.x-holder.x)*.68));
  const spread=bearings.some((a,i)=>bearings.slice(i+1).some(b=>Math.cos(a-b)<Math.cos(Math.PI/6)));
  const risk=spread?0:outlets.length?1:2;
  const detail=`${name(ctx,holder)}持球，22 米内有 ${outlets.length} 个短传点的线路与对手相距超过 1.6 米。`
    +(spread?'至少两个接应方向错开了 30°。':outlets.length>1?'接应人都挤在同一方向。':'');
  return observation(holder,risk,detail,risk?'让一名中场在持球侧斜后方回接，再让另一人拉开传球角度。':'',risk===2?'noOutlet':risk?'fewAngles':null);
}

function pressing(ctx){
  const {holder,opponents,own,task}=ctx;
  if(!holder||!opponents.includes(holder))return;
  const presser=own.find(p=>['press','counterPress'].includes(task(p)));
  if(!presser)return;
  const screen=own.find(p=>task(p)==='screen'&&p.partners.includes(presser.key));
  if(!screen)return observation(presser,2,`${name(ctx,presser)}上抢，场上没有队友为他执行封线任务。`,'在上抢球员身后留一名中场封线，或降低上抢范围。','noScreen');
  const outlet=opponents.find(p=>p.key===screen.opponent);
  if(!outlet)return;
  const gap=laneDistance(screen,holder,outlet);
  return observation(screen,gap>4?1:0,`${name(ctx,presser)}上抢，${name(ctx,screen)}距持球者通往${name(ctx,outlet)}的传球线 ${gap.toFixed(1)} 米。`,
    gap>4?'让封线球员靠近内侧接应人，缩短他横移到传球线的距离。':'',gap>4?'lateScreen':null);
}

function overlap(ctx){
  const {own,task}=ctx;
  const runner=own.find(p=>task(p)==='overlap'||task(p)==='recoverOverlap');
  if(!runner)return;
  const cover=own.find(p=>task(p)==='coverOverlap'&&p.partners.includes(runner.key));
  if(!cover)return observation(runner,2,`${name(ctx,runner)}执行套上或回追，身后没有队友执行配对补位。`,'保留同侧后腰或中场承担补位。','noCover');
  const gap=length(cover,cover.target);
  return observation(cover,gap>8?1:0,`${name(ctx,runner)}${task(runner)==='overlap'?'套上':'回追'}，${name(ctx,cover)}负责补位，距自己的保护目标 ${gap.toFixed(1)} 米。`,
    gap>8?'把补位中场的起点移近该侧，或让另一侧边卫留守。':'',gap>8?'lateCover':null);
}

function turnover(ctx){
  const {frame,own,task}=ctx;
  if(frame.owner!==1||!ctx.lossWindow||!frame.lossResponse)return;
  const outfield=own.filter(p=>ctx.roster.get(p.key).role!=='GK');
  const closest=outfield.reduce((a,b)=>length(a,frame.ball)<=length(b,frame.ball)?a:b);
  const nearby=outfield.filter(p=>length(p,frame.ball)<16).length;
  if(ctx.lossStart&&ctx.lossReaction==='counterPress'&&frame.transition==='regroup'&&nearby<2){
    return observation(closest,2,`预案要求反抢，V4 启动回收。丢球后的首个可评估时点，球周围 16 米内只有 ${nearby} 名本队外场球员。`,'让持球侧多保留一名近距离接应人，或将丢球反应设为回收。','forcedRegroup');
  }
  if(frame.lossResponse==='counterPress'){
    const presser=outfield.find(p=>task(p)==='counterPress');
    const risk=!presser||nearby<2;
    return observation(presser??closest,risk?1:0,`反抢窗口内，球周围 16 米有 ${nearby} 人；${presser?name(ctx,presser)+'负责上抢':'无人执行上抢'}。`,
      risk?'缩短持球侧前后两线的距离，给第一名反抢球员提供支援。':'',risk?'isolatedPress':null);
  }
  const behind=outfield.filter(p=>p.y>=frame.ball.y);
  return observation(closest,behind.length<3?1:0,`丢球后全队回收，${name(ctx,closest)}距球最近，球与本方底线之间有 ${behind.length} 名本队外场球员。`,
    behind.length<3?'减少同时前插的人数，为回收阶段多留一名球后保护者。':'',behind.length<3?'fewBehind':null);
}

export const tacticalChecks={pass:passing,press:pressing,overlap,loss:turnover};

function assess(id,label,clips,inspect,criterion,empty){
  let samples=0,flagged=0,best;
  const issueCounts={},issueEvidence={};
  for(const clip of clips){
    const roster=new Map(clip.roster.map(p=>[p.key,p]));
    for(const frame of clip.frames){
      // Allow the initial positions to settle, except when inspecting the loss itself.
      if(frame.restart||(id!=='loss'&&frame.time<1.2))continue;
      const active=frame.players.filter(p=>p.active);
      const row=inspect({roster,frame,lossWindow:frame.transitionId===clip.frames[0].transitionId,lossStart:frame.time===0,lossReaction:clip.lossReaction,holder:active.find(p=>p.key===frame.ball.holder),
        own:active.filter(p=>roster.get(p.key).side===0),opponents:active.filter(p=>roster.get(p.key).side===1),
        task:p=>clip.tasks[p.task]?.type});
      if(!row)continue;
      samples++;
      if(row.risk){
        flagged++;
        issueCounts[row.issue]=(issueCounts[row.issue]??0)+1;
        issueEvidence[row.issue]??={scenario:clip.scenario,time:frame.time,clipId:clip.clipId,playerKey:row.playerKey,detail:row.detail};
      }
      if(!best||row.risk>best.risk)best={...row,scenario:clip.scenario,time:frame.time,clipId:clip.clipId};
    }
  }
  if(!best)return {id,label,criterion,status:'unobserved',samples,flagged,issueCounts,detail:empty};
  const {risk,detail,advice,...evidence}=best;
  return {id,label,criterion,status:flagged?'attention':'covered',samples,flagged,issues:Object.keys(issueCounts),issueCounts,issueEvidence,detail,advice,evidence};
}

const dimensions=[
  ['tempo','节奏','tempo','数值越高，处理球的节奏越快。'],
  ['direct','传球纵深','directness','数值越高，越倾向直接向前传递。'],
  ['width','进攻宽度','attackingWidth','数值越高，进攻时越倾向拉开场地宽度。'],
  ['press','压迫强度','pressing','数值越高，越倾向主动施压。'],
  ['line','防线高度','defensiveLine','数值越高，防线的目标位置越靠前。'],
  ['compact','紧凑程度','compactness','数值越高，防守时越强调收紧队形。'],
];

export function previewDiagnostics({attack,left,defense,loss}){
  return [
    assess('pass','传球接应',[attack,left],passing,'在 22 米内寻找两条夹角至少 30° 的短传路线，要求对手距线路超过 1.6 米。','两侧片段中没有可评估的本队持球样本。'),
    assess('press','压迫封线',[defense],pressing,'本队上抢时检查协同封线人；有明确出球对象时，封线人离传球线超过 4 米即提示。','陪练边路出球时，片段中未观察到可评估的上抢封线配合。'),
    assess('overlap','套上补位',[attack,left],overlap,'边卫套上或回追时，检查配对补位人是否进入保护目标周围 8 米。','两侧进攻片段中未触发套上或套上回追。采用留守边卫时，这可以是预案意图。'),
    assess('loss','丢球转换',[loss],turnover,'反抢时看有无上抢者、16 米内是否有两名本队外场球员；回收时看是否至少有三人留在球后。','片段中未观察到可评估的本队丢球窗口。'),
  ];
}

export function buildV4TacticalOutlook(clips,planState,unavailableCount){
  const {attack}=clips,diagnostics=previewDiagnostics(clips);
  return {valid:true,engineVersion:attack.engineVersion,planState,scoreState:attack.scoreState,
    assumptions:{minute:attack.minute,opponent:attack.opponent},diagnostics,
    warnings:unavailableCount?[`所选首发中有 ${unavailableCount} 名伤停球员，推演按战术板名单进行。`]:[],
    axes:dimensions.map(([id,label,key,evidence])=>({id,label,value:attack.dimensions[key],evidence}))};
}
