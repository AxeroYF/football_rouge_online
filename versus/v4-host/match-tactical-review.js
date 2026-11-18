import {lockedPlanPreviewRunner} from '../v4-adapter/shape-preview.js';
import {previewDiagnostics,tacticalChecks} from '../v4-adapter/tactical-outlook.js';

const modes=['normal','leading','trailing'];
const clockAt=c=>({period:c.period,seconds:c.baseSeconds+c.elapsed,
  ...(c.mode==='full'&&c.elapsed>=c.halfLength?{added:c.elapsed-c.halfLength}:{})});
const rounded=n=>Math.round(n*10)/10;

export function createMatchTacticalReview(input,engine){
  const teams=input.teams.map(team=>Object.fromEntries(modes.map(mode=>{
    const run=lockedPlanPreviewRunner(team,mode,engine);
    const clips=Object.fromEntries(['attack','left','defense','loss'].map(s=>[s,run(s)]));
    const checks=previewDiagnostics(clips).map(d=>({id:d.id,label:d.label,preview:{samples:d.samples,
      flagged:d.flagged,issues:d.issues??[],detail:d.detail},samples:0,flagged:0,occurrences:{},example:null}));
    return [mode,{intervals:[],checks}];
  })));
  const active=['normal','normal'],open=[null,null],observedLoss=[null,null];
  const opportunities=[new Map(),new Map()];
  let inPeriod=true,lastEvent=0,lastFrame=-1,possession=0;
  function begin(side,time,clock){
    opportunities[side].clear();
    open[side]={start:time,from:clockAt(clock),checks:{}};
  }
  function end(side,time,clock){
    const span=open[side];
    if(span&&time>span.start)teams[side][active[side]].intervals.push({...span,end:time,to:clockAt(clock)});
    open[side]=null;
  }
  for(const side of [0,1])begin(side,0,{period:1,baseSeconds:0,elapsed:0});
  function consumeEvent(e){
    if(e.id<=lastEvent)return;
    lastEvent=e.id;
    possession=e.sequence?.possession??possession;
    if(e.type==='tacticalPlanChanged'){
      end(e.side,e.time,e.clock);active[e.side]=e.plan;
      if(inPeriod)begin(e.side,e.time,e.clock);
    }else if(e.type==='endsChanged'){
      inPeriod=true;
      for(const side of [0,1])begin(side,e.time,e.clock);
    }else if(['halfTime','fulltime','shootoutStart','abandoned'].includes(e.type)){
      for(const side of [0,1])end(side,e.time,e.clock);
      inPeriod=false;
    }
  }
  function sample(f,side){
    const mode=f.activePlans[side],flip=f.clock.attackDirections[side]<0;
    const point=p=>({x:rounded((flip?68-p.y:p.y)/68*100),y:rounded((flip?p.x:105-p.x)/105*100)});
    const players=f.players.filter(p=>p.active).map(p=>({
      key:p.key,role:p.role,name:p.name,side:p.side,...point(p),task:p.task?.type,
      target:point(p.task?.target??p),partners:p.task?.partners??[],opponent:p.task?.targetPlayer,
    }));
    const own=players.filter(p=>p.side===side),opponents=players.filter(p=>p.side!==side);
    if(!own.some(p=>p.role!=='GK'))return;
    const roster=new Map(players.map(p=>[p.key,p]));
    const group=f.coordination[side],loss=f.transition?.from===side&&f.time>=f.transition.at&&f.time<f.transition.until;
    const holder=roster.get(f.ball.holder),owner=holder?.side??f.ball.flight?.side??f.transition?.to??group.owner;
    const frame={ball:point(f.ball),owner:owner===side?0:1,transition:f.transition?.lossMode,
      lossResponse:loss&&['counterPress','regroup'].includes(group.transition)?group.transition:null};
    const team=input.teams[side],instruction=mode==='normal'?team.instructions:team.scorePlans[mode];
    const firstLoss=loss&&owner!==side&&frame.lossResponse&&observedLoss[side]!==f.transition.id;
    const ctx={frame,roster,own,opponents,holder,task:p=>p.task,
      lossWindow:loss,lossStart:firstLoss&&open[side]?.start<=f.transition.at,lossReaction:instruction.lossReaction};
    if(firstLoss)observedLoss[side]=f.transition.id;
    for(const check of teams[side][mode].checks){
      const item=tacticalChecks[check.id](ctx);
      if(!item)continue;
      const span=open[side];
      if(!span||mode!==active[side])continue;
      const during=span.checks[check.id]??={samples:0,flagged:0,occurrences:{},example:null};
      const evidence=()=>({time:f.time,clock:clockAt(f.clock),playerKey:item.playerKey,playerName:roster.get(item.playerKey)?.name,detail:item.detail});
      // A single possession, overlap run or loss window can span many recorder frames.
      const opportunity=check.id==='loss'?f.transition.id:check.id==='overlap'&&group.overlap?
        `run:${group.overlap.runner}:${group.overlap.since}`:`${f.restartSerial}:${f.transition?.id??possession}`;
      const newEpisode=item.risk&&opportunities[side].get(item.issue)!==opportunity;
      if(newEpisode)opportunities[side].set(item.issue,opportunity);
      for(const counts of [check,during]){
        counts.samples++;
        if(item.risk){
          counts.flagged++;
          const occurrence=counts.occurrences[item.issue]??={count:0,episodes:0,evidence:evidence(),moreEvidence:[]};
          occurrence.count++;
          if(newEpisode){
            occurrence.episodes++;
            if(occurrence.episodes>1&&occurrence.moreEvidence.length<2)occurrence.moreEvidence.push(evidence());
          }
        }else if(!counts.example)counts.example=evidence();
      }
    }
  }
  return {
    consume(frames,events){
      let next=0;
      for(let i=0;i<frames.length;i++){
        const f=frames[i];
        // The replay samples the last frame at an equal timestamp in its segment.
        if(f.time<=lastFrame||frames[i+1]?.time===f.time)continue;
        while(next<events.length&&events[next].id<=f.eventCursor)consumeEvent(events[next++]);
        lastFrame=f.time;
        if(f.phase==='playing'&&!f.shootout)for(const side of [0,1])sample(f,side);
      }
      while(next<events.length)consumeEvent(events[next++]);
    },
    finish(){return teams;},
  };
}
