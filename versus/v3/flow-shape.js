import {clamp,rounded,zonePoint,flipFlowZone} from './flow-state.js';

// Interpolate actual positions towards desired positions. No state mutation here;
// the possession loop commits the returned positions only after time is consumed.
export function continuousShape(snapshot,teams,flow,seconds,rules) {
  return {...snapshot,modelVersion:'dynamic-shape-v3.2-continuous.1',teams:snapshot.teams.map((shape,index)=>{
    const roster=new Map(teams[index].players.map(p=>[p.id,p]));
    const transition=flow.transition,defendingLoss=transition?.lostTeam===index&&transition.expiresAt>flow.elapsedSeconds;
    const point=zonePoint(index===flow.owner?flow.zone:flipFlowZone(flow.zone));
    const nearest=shape.players.filter(p=>p.genericRole!=='GK').sort((a,b)=>{
      const distance=p=>{const old=flow.shapes[index][p.id]??p.basePosition;return Math.hypot(old.x-point.x,old.y-point.y);};
      return distance(a)-distance(b)||String(a.id).localeCompare(String(b.id));
    }).slice(0,2).map(p=>p.id);
    const players=shape.players.map(player=>{
      const data=roster.get(player.id),previous=flow.shapes[index][player.id]??player.basePosition;
      let desired={...player.targetPosition};
      const assignment=flow.defenseAssignments?.[index]?.find(entry=>entry.playerId===player.id);
      if(assignment)desired={...assignment.target};
      if(flow.carryTarget?.teamIndex===index&&flow.carryTarget.playerId===player.id)desired={...flow.carryTarget.point};
      const settled={...desired};
      if(defendingLoss&&transition.lossStrategy==='counterPress'&&nearest.includes(player.id))desired={...point};
      if(defendingLoss&&transition.lossStrategy==='regroup'&&player.genericRole!=='GK')desired.y=Math.max(desired.y,player.basePosition.y);
      const fitness=Number(data?.state?.fitness??100)/100;
      const speed=(.65+Number(data?.attributes?.pace??data?.attributes?.acceleration??70)/180)*(.7+fitness*.3);
      const move=(from,to,duration,multiplier=1)=>{
        const distance=Math.hypot(to.x-from.x,to.y-from.y);
        const fraction=distance>0?Math.min(1,duration*rules.movementUnitsPerSecond*speed*multiplier/distance):0;
        return {x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction};
      };
      const windowSeconds=defendingLoss?Math.min(seconds,Math.max(0,transition.expiresAt-flow.elapsedSeconds)):0;
      const interim=move(previous,desired,windowSeconds,transition?.lossStrategy==='regroup'?1.12:1);
      const target=move(interim,settled,seconds-windowSeconds);
      return {...player,previousPosition:{...previous},desiredPosition:desired,
        distanceMoved:rounded(Math.hypot(interim.x-previous.x,interim.y-previous.y)+Math.hypot(target.x-interim.x,target.y-interim.y)),
        targetPosition:{x:rounded(clamp(target.x,1,99)),y:rounded(clamp(target.y,1,99))}};
    });
    return {...shape,players,metrics:{...shape.metrics,restDefenseCount:players.filter(p=>p.restDefenseProtected).length}};
  })};
}
