const stageNames={league:'联赛阶段',swiss:'瑞士轮',roundOf16:'十六强',quarterfinals:'四分之一决赛',semifinals:'半决赛',final:'决赛'};

// Only the displayed frame contributes live scores or a winner. Static head
// metadata contains the already-played first leg, never this match's result.
export function competitionPresentation(frame,competition,teams=[]){
  const cup=competition?.kind==='cup',stage=cup?competition.stage:null;
  const label=cup?`黄狗冠军杯 · ${stageNames[stage]}${!['league','swiss','final'].includes(stage)?` · 第${competition.leg}回合`:''}`:'';
  if(!frame)return {label,aggregate:'',shootout:'',decision:''};
  const aggregate=frame.score.map((score,index)=>score+(competition?.aggregate?.[index]??0));
  const shootout=frame.shootout?`点球 ${frame.shootout.score.join(' : ')}`:'';
  let decision='';
  if(cup&&frame.phase==='finished'&&(competition.leg===2||['final','swiss'].includes(stage))){
    const side=Number.isInteger(frame.shootout?.winner)?frame.shootout.winner:aggregate[0]===aggregate[1]?null:aggregate[0]>aggregate[1]?0:1;
    if(side!==null)decision=`${teams[side]?.name??(side===0?'主队':'客队')}${stage==='final'?'夺冠':stage==='swiss'?'获胜':'晋级'}`;
  }
  return {label,aggregate:cup&&competition.leg===2?`总比分 ${aggregate.join(' : ')}`:'',shootout,decision};
}
