// Presentation-only statistics. No random draws or changes to simulation.
// Uses public event fields so live archives and settled reports share one model.
export const METRIC_DEFINITIONS = {
  possession:'双方有效控球时间占比；包括本方传球飞行，排除死球、自由球、中场和点球大战。',
  xg:'几何估算：按射门距离、球门张角和头球计算；点球为 0.76。不影响比赛结果，尚未做实赛校准。',
  model:'v4-geometric-xg-1', unavailable:[],
};
const fresh=()=>({possession:0,xg:0,shots:0,shotsOnTarget:0,passes:0,completed:0,saves:0,
  corners:0,fouls:0,yellowCards:0,redCards:0,tackles:0,interceptions:0,blocks:0,clearances:0,substitutions:0});
const controls=new Set(['kickoff','restart','carry','receive','tackle','interception','secondBall','save','pass','shot']);
const stops=new Set(['goal','stoppage','halfTime','fulltime','abandoned','matchEnd','shootoutStart','loose','miscontrol','parry','keeperSpill','block','deflection','offside']);
const visible=new Set(['spiritPossession','shot','goal','save','parry','yellowCard','redCard','injury','substitution','offside','weather','lightning','weatherInjury','matchInjury','keeperSpill','blackWhistle','brawl','abandoned']);
export function estimateShotXg(event){
  if(event.restartType==='penalty')return .76;
  const p=event.position;
  if(!p||![p.x,p.y].every(Number.isFinite))return null;
  const direction=event.clock?.attackDirections?.[event.side]??(event.side===0?1:-1);
  const depth=Math.max(.1,direction===1?105-p.x:p.x),width=p.y-34;
  const distance=Math.hypot(depth,width);
  const angle=Math.abs(Math.atan2(7.32*depth,depth*depth+(width-3.66)*(width+3.66)));
  const header=event.bodyPart==='head'||event.text?.includes('头球');
  return Math.round(Math.max(.005,Math.min(.95,1/(1+Math.exp(1.2+.075*distance-1.6*angle))*(header?.65:1)))*10000)/10000;
}
export function createMatchMetrics(saved){
  const state=saved?structuredClone(saved):{version:1,cursor:0,time:0,side:null,shootout:false,stats:[fresh(),fresh()],events:[],pending:[null,null]};
  function advance(time){
    if(Number.isFinite(time)&&time>=state.time){
      if(state.side!==null&&!state.shootout)state.stats[state.side].possession+=time-state.time;
      state.time=time;
    }
  }
  return {
    consume(events){for(const e of events){
      if(e.id<=state.cursor)continue;
      advance(e.time);state.cursor=e.id;
      if(e.type==='shootoutStart'){state.shootout=true;state.side=null;}
      if(state.shootout){
        if(e.type==='shootoutResult')state.events.push({id:'v4-'+e.id,type:'penaltyShootoutKick',shootoutGoal:e.goal===true,time:e.time,replayTime:e.time,minute:Number((((e.clock?.baseSeconds??0)+(e.clock?.elapsed??e.time))/60).toFixed(2)),teamIndex:e.side,actorId:e.actor?.slice(2)??null,text:e.text,detail:e.shootoutScore?'点球比分 '+e.shootoutScore.join(' : '):undefined,importance:'major'});
        continue;
      }
      const side=e.side,s=[0,1].includes(side)?state.stats[side]:null;
      if(controls.has(e.type)&&s)state.side=side;
      if(stops.has(e.type))state.side=null;
      const counter={pass:'passes',receive:'completed',shot:'shots',save:'saves',parry:'saves',
        foul:'fouls',yellowCard:'yellowCards',redCard:'redCards',tackle:'tackles',interception:'interceptions',
        block:'blocks',deflection:'blocks',substitution:'substitutions'}[e.type];
      if(s&&counter)s[counter]++;
      if(s&&e.type==='stoppage'&&e.restartType==='corner')s.corners++;
      if(s&&e.text?.includes('解围')&&['pass','clearance'].includes(e.type))s.clearances++;
      let row=null;
      if(visible.has(e.type)||e.traitOpening){
        row={id:`v4-${e.id}`,type:({yellowCard:'yellow',redCard:'red',parry:'save'})[e.type]??e.type,
          time:e.time,replayTime:e.time,minute:Number((((e.clock?.baseSeconds??0)+(e.clock?.elapsed??e.time??0))/60).toFixed(2)),
          teamIndex:e.type==='goal'?e.scoringSide:side,actorId:e.actor?.slice(2)??null,text:e.text,
          score:e.score,...(e.traitOpening?{level:e.level}:{}),importance:e.type==='shot'?'normal':'major',ownGoal:Boolean(e.ownGoal),...(e.special?{special:e.special}:{})};
        if(e.type==='goal' && Object.hasOwn(e,'assistId'))row.assistId=e.assistId;
        state.events.push(row);
      }
      if(e.type==='shot'&&s){
        row.xg=estimateShotXg(e);row.attackingTeamIndex=side;
        if(row.xg!==null)s.xg+=row.xg;
        state.pending[side]={id:row.id,time:e.time,onTarget:false};
      }
      if(['goal','save','parry'].includes(e.type)&&!e.ownGoal){
        const attacking=e.type==='goal'?e.scoringSide:1-side,shot=state.pending[attacking];
        if(shot&&e.time-shot.time<=15){
          if(!shot.onTarget){state.stats[attacking].shotsOnTarget++;shot.onTarget=true;}
          if(e.type==='goal'){const record=state.events.find(row=>row.id===shot.id);if(record)record.goal=true;}
        }
      }
      if(['restart','halfTime'].includes(e.type))state.pending=[null,null];
    }},
    view(time=state.time){
      const stats=structuredClone(state.stats);
      if(state.side!==null&&!state.shootout)stats[state.side].possession+=Math.max(0,time-state.time);
      return {stats:stats.map(s=>({...s,xg:Number(s.xg.toFixed(4))})),events:structuredClone(state.events),metricDefinitions:METRIC_DEFINITIONS};
    },
    checkpoint(){return structuredClone(state);},
  };
}
