// Read-only analysis. Never feeds accumulated match totals back into football decisions.
export function shotDiagnostics(events){
  const shots=events.filter(e=>e.type==='shot'),outcomes=new Map();
  for(const e of events)if(e.decisionId!=null&&(['goal','out','save','parry','block','deflection','receive','offside','woodwork'].includes(e.type)||e.bodyPart==='head')&&!outcomes.has(e.decisionId))outcomes.set(e.decisionId,e);
  const bucket=()=>({shots:0,onTarget:0,goals:0,blocked:0,woodwork:0,aimInsideMouth:0,distanceTotal:0,pressureTotal:0});
  const total=bucket(),groups={distance:{},pressure:{},angle:{},restart:{},period:{},role:{},bodyPart:{}};
  for(const e of shots){
    const d=Math.hypot(e.target.x-e.position.x,34-e.position.y),pressure=e.execution?.pressureDistance??0;
    const dx=Math.abs(e.target.x-e.position.x),dy=34-e.position.y;
    const angle=Math.abs(Math.atan2(7.32*dx,dx*dx+(dy-3.66)*(dy+3.66)))*180/Math.PI;
    const result=outcomes.get(e.id),aimInsideMouth=Math.abs(e.target.y-34)<=3.66&&(e.target.z??0)<=2.44;
    const onTarget=result?.type==='goal'||aimInsideMouth&&['save','parry'].includes(result?.type),blocked=['block','deflection'].includes(result?.type);
    const categories={distance:d<12?'under12':d<20?'12to20':d<27?'20to27':'27plus',pressure:pressure<2?'under2':pressure<5?'2to5':'5plus',
      angle:angle<15?'under15':angle<30?'15to30':'30plus',restart:e.restartType??'openPlay',period:String(e.clock?.period??1),role:e.actorRole??'legacyUnknown',bodyPart:e.bodyPart??'foot'};
    const targets=[total,...Object.entries(categories).map(([key,value])=>groups[key][value]??=(bucket()))];
    for(const b of targets){b.shots++;b.onTarget+=Number(onTarget);b.goals+=Number(result?.type==='goal');b.blocked+=Number(blocked);b.woodwork+=Number(result?.type==='woodwork');b.aimInsideMouth+=Number(aimInsideMouth);b.distanceTotal+=d;b.pressureTotal+=pressure;}
  }
  return {total,groups};
}
export function mergeShotDiagnostics(items){
  const out={total:{},groups:{}};
  const add=(to,from)=>{for(const [key,value] of Object.entries(from))to[key]=(to[key]??0)+value;};
  for(const item of items){add(out.total,item.total);for(const [kind,groups] of Object.entries(item.groups)){out.groups[kind]??={};for(const [key,b] of Object.entries(groups))add(out.groups[kind][key]??={},b);}}
  return out;
}
