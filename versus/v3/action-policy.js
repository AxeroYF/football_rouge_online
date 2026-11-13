import {clamp,zonePoint} from './flow-state.js';
import {isV33} from './model-config.js';
import {buildUpPreference} from './tactical-execution.js';

export function chooseBounded(entries,score,rng,{judgment=75,pressure=0,tolerance=.12,trace=null,kind='decision'}={}) {
  if(!entries.length)return null;
  const ranked=entries.map(entry=>({entry,value:Number(score(entry))||0})).sort((a,b)=>b.value-a.value||String(a.entry.id??a.entry.target??a.entry.type).localeCompare(String(b.entry.id??b.entry.target??b.entry.type)));
  const scale=Math.max(.001,Math.abs(ranked[0].value));
  const range=(.015+tolerance*(1-clamp(judgment,1,100)/100)+pressure*.04)*scale;
  const eligible=ranked.filter(item=>item.value>=ranked[0].value-range);
  const roll=rng(),selected=eligible[Math.min(eligible.length-1,Math.floor(roll*eligible.length))];
  if(trace)trace({kind,selected:selected.entry.id??selected.entry.target??selected.entry.type,roll,tolerance:range,
    candidates:ranked.map(item=>({id:item.entry.id??item.entry.target??item.entry.type,utility:item.value,eligible:eligible.includes(item)}))});
  return selected.entry;
}
const bandOrder={defensiveThird:0,buildUp:1,finalThird:2,box:3};
export function chooseFlowAction(team,opponent,zone,phase,flow,rng,parameters,trace=null,recycles=0) {
  const dimensions=team.tacticalDimensions,mentality=Number(dimensions.mentality??50)/100;
  const carrier=team.players.find(player=>player.id===flow.carrierId);
  const pressure=1-Number(team.zones[zone]?.controlShare??.5);
  const judgment=Number(carrier?.attributes?.decisions??75);
  const currentBand=bandOrder[zone.split(':')[0]]??0;
  const candidates=[];
  if(phase==='shot')return {type:'shoot',target:zone,routeType:'structured',quality:1,seconds:2};
  if(phase==='chance') {
    candidates.push({type:'create',target:zone,routeType:'structured',quality:.7,score:.66+mentality*.12,seconds:5});
  }
  if(phase==='finalThird'&&team.inPossessionDetails?.longShots!=='reduce') {
    const skill=Number(carrier?.attributes?.longShots??65)/100;
    candidates.push({type:'longShot',target:zone,routeType:'structured',quality:clamp(.03+(skill-.65)*.1,.02,.1),
      score:.08+skill*.10+Number(team.zones[zone]?.exploitableSpace??.4)*.08+(team.inPossessionDetails?.longShots==='increase'?.10:0),seconds:3});
  }
  for(const connection of team.connections) {
    const target=connection.from===zone?connection.to:connection.to===zone?connection.from:null;
    if(!target)continue;
    const z=team.zones[target],delta=(bandOrder[target.split(':')[0]]??0)-currentBand;
    if(delta>2||delta< -1||!z||Number(z.own.occupancy)<.1)continue;
    const type=delta>1?'direct':delta>0?'pass':delta===0?'switch':'recycle';
    const escape=isV33(parameters)&&pressure>.55&&['defensiveThird','buildUp'].includes(zone.split(':')[0])?team.pressureEscape:null;
    if((type==='direct'&&Number(dimensions.directness)<55&&escape!=='direct')||(type==='recycle'&&recycles>=parameters.v32.maxRecycles))continue;
    let quality=clamp(connection.quality-(type==='direct'?.12:0),.08,.95);
    const direction=team.inPossessionDetails?.attackDirection??'balanced',lane=target.split(':')[1];
    const preferred=direction==='balanced'?0:direction==='left'&&['farLeft','leftHalfSpace'].includes(lane)||direction==='right'&&['farRight','rightHalfSpace'].includes(lane)||direction==='center'&&lane==='center'||direction==='leftHalf'&&lane==='leftHalfSpace'||direction==='rightHalf'&&lane==='rightHalfSpace'?.1:0;
    const transitionBonus=flow.transition&&team.transitionStyle==='counterAttack'&&delta>0?.14:0;
    const preference=isV33(parameters)?buildUpPreference(team,target,zone,pressure):{bonus:0};
    // A weak-side escape must cross the centre and offer less pressure.
    const escapeChosen=escape==='switch'?type==='switch'&&(zonePoint(zone).x-50)*(zonePoint(target).x-50)<0&&z.controlShare>Number(team.zones[zone]?.controlShare??.5):escape==='direct'?type==='direct':false;
    const score=.34*quality+.18*z.controlShare+.12*z.exploitableSpace+Math.max(0,delta)*(.12+mentality*.08)+preference.bonus+(escapeChosen?.14:0)
      -(1-quality)*(.22-mentality*.1)+preferred+transitionBonus-(delta<=0?.12+recycles*.12:0)
      +(type==='direct'?(Number(dimensions.directness)-50)/400:0);
    candidates.push({...connection,target,type,routeType:type==='direct'?'direct':flow.transition&&team.transitionStyle==='counterAttack'?'counter':'structured',quality,score,
      ...(isV33(parameters)?{receiverId:preference.receiverId,reasons:[...preference.reasons,...(escapeChosen?['escape']:[])]}:{}),
      seconds:(type==='direct'?5:delta<0?7:delta===0?6:7)+(escapeChosen&&escape==='switch'?2:0)});
    const point=zonePoint(target),carrierDistance=carrier?Math.hypot(carrier.localPosition.x-point.x,carrier.localPosition.y-point.y):Infinity;
    if(delta===1&&carrier&&carrierDistance<=20) {
      const dribbling=Number(carrier.attributes?.dribbling??carrier.metrics?.progression??60)/100;
      candidates.push({...connection,target,type:'carry',routeType:'structured',quality:clamp(dribbling*.55+z.exploitableSpace*.3,.1,.9),
        score:score-.07+(dribbling-.7)*.22+z.exploitableSpace*.08,seconds:Math.max(8,carrierDistance),carrierDistance});
    }
  }
  const bestByType=Object.values(candidates.reduce((out,candidate)=>{
    if(!out[candidate.type]||out[candidate.type].score<candidate.score)out[candidate.type]=candidate;return out;
  },{})).sort((a,b)=>b.score-a.score).slice(0,5);
  if(!bestByType.length)return {type:'clearance',target:`${['buildUp','finalThird','box','box'][currentBand]}:center`,routeType:'direct',quality:.08,score:.1,seconds:6};
  const action=chooseBounded(bestByType,value=>value.score,rng,{judgment,pressure,tolerance:parameters.v32.decisionTolerance,trace,kind:'action'});
  const tempo=clamp(1+(50-Number(dimensions.tempo??50))*.008,.65,1.4);
  const clock=({slow:1.55,normal:1,quick:.76})[team.clockManagement]??1;
  const wasting=1+Number(dimensions.timeWasting??15)/180;
  return {...action,seconds:clamp(Math.max(action.type==='carry'?action.carrierDistance:0,action.seconds*tempo*clock*wasting),parameters.v32.minimumActionSeconds,22)};
}
export function nearestFlowPlayer(team,zone,{excludeGoalkeeper=true}={}) {
  const point=zonePoint(zone);
  return [...team.players].filter(p=>!excludeGoalkeeper||p.assignedRole!=='GK').sort((a,b)=>{
    const distance=p=>Math.hypot((p.localPosition?.x??50)-point.x,(p.localPosition?.y??50)-point.y)/(1+Number(p.metrics?.movement??60)/100);
    return distance(a)-distance(b)||String(a.id).localeCompare(String(b.id));
  })[0];
}
