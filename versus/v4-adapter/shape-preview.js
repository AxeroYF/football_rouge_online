import {createHash} from 'node:crypto';
import {compileLiveSeat} from './live-match.js';
import {compileInput,demoInput} from '../v4/fixtures.js';
import {advanceMatch,createMatch} from '../v4/engine.js';
import {changePossession,planCoordination,possessionSide} from '../v4/coordination.js';
import {commitTasks,planTasks,TASK_LABELS} from '../v4/tasks.js';
import {refreshPlayerEffects} from '../v4/player-effects.js';
import {controlPlan} from '../v4/tempo.js';
import {STEP,VERSION,distance,worldPoint} from '../v4/world.js';

// Coordinates in metres, from the manager's attacking perspective.
const situations = {
  attack:{side:0,x:53,y:56}, left:{side:0,x:53,y:12},
  defense:{side:1,x:75,y:56}, loss:{side:1,x:53,y:56}, gain:{side:0,x:44,y:30},
};
const boardPoint = p => ({x:Math.round(p.y/68*1000)/10,y:Math.round((1-p.x/105)*1000)/10});

function referenceOpponent() {
  const team=compileInput(demoInput({away:'balanced'})).teams[1];
  team.name='标准陪练队';
  team.sourcePlans={normal:{},leading:{},trailing:{}};
  team.sourceBondCatalog=[];
  for(const p of team.players) Object.assign(p,{baseAttributes:{...p.attributes},baseHeightCm:p.heightCm,traitDefinitions:[]});
  return team;
}

function startSituation(match,scenario,minute,scoreState) {
  const s=match.state,spot=situations[scenario];
  s.score=scoreState==='leading'?[1,0]:scoreState==='trailing'?[0,1]:[0,0];
  s.clock.elapsed=minute*60;
  s.clock.played[0]=s.clock.elapsed;
  // Replace the opening kick and its first pass with a controlled training setup.
  s.coordination=[{},{}];
  s.rules={offside:null,restartTouch:null};
  for(const stats of s.stats) for(const key of Object.keys(stats)) stats[key]=0;
  for(const p of s.players) Object.assign(p,worldPoint(p.anchor,p.side),{vx:0,vy:0,task:null,control:null,nextTouch:0,nextTackle:0,nextDecision:0});
  const nearest=side=>s.players.filter(p=>p.side===side&&p.role!=='GK').sort((a,b)=>distance(a,spot)-distance(b,spot)||a.key.localeCompare(b.key))[0];
  const carrier=nearest(spot.side);
  if(scenario==='loss'){
    // Put the dispossessed teammate within challenging distance. Other players
    // keep their board positions, which determine whether a counterpress is viable.
    Object.assign(nearest(0),{x:spot.x-1.5,y:spot.y});
  }
  Object.assign(carrier,{x:spot.x,y:spot.y});
  s.ball={mode:'held',holder:carrier.key,x:carrier.x,y:carrier.y,z:0,vx:0,vy:0,flight:null};
  if(scenario==='loss'||scenario==='gain'){
    s.lastOwner=1-carrier.side;
    changePossession(s,carrier.side,0,'interception');
  }
  else s.lastOwner=carrier.side;
  refreshPlayerEffects(s);
  carrier.control=controlPlan(s,carrier,0);
  carrier.nextDecision=carrier.control.until;
  s.coordination=planCoordination(s);
  commitTasks(s,planTasks(s,s.coordination));
  match.events.length=0;
}

export function createShapePreviewRunner(seat,{minute=25,scoreState='level'}={}) {
  const teams=[compileLiveSeat(seat,0),referenceOpponent()];
  return (scenario='attack')=>simulatePreview(teams,scenario,minute,scoreState);
}

export function buildV4ShapePreview(seat,options={}) {
  return createShapePreviewRunner(seat,options)(options.scenario);
}

// The match worker receives the locked, rotated starting eleven. Pin one plan
// for the entire rehearsal, just as the editor does for its selected preset.
export function lockedPlanPreviewRunner(source,mode,engine){
  const instructions=mode==='normal'?source.instructions:source.scorePlans[mode];
  const plan=source.sourcePlans[mode];
  const team={...source,instructions,scorePlans:{leading:instructions,trailing:instructions},
    sourcePlans:{normal:plan,leading:plan,trailing:plan},bench:[],players:source.players.map(p=>{
      const anchor=p.anchorPlans?.[mode]??p.anchor,role=p.rolePlans?.[mode]??p.role;
      const sourceRole=p.sourceRolePlans?.[mode]??p.sourceRole??role,duty=p.dutyPlans?.[mode]??null;
      return {...p,anchor,role,sourceRole,anchorPlans:{normal:anchor},rolePlans:{normal:role},sourceRolePlans:{normal:sourceRole},
        dutyPlans:{normal:duty,leading:duty,trailing:duty}};
    })};
  const teams=[team,referenceOpponent()];
  return scenario=>simulatePreview(teams,scenario,mode==='normal'?25:70,mode==='normal'?'level':mode,engine);
}

function simulatePreview(teams,scenario,minute,scoreState,engine={createMatch,advanceMatch}) {
  if(!Object.hasOwn(situations,scenario)) throw new Error('未知的落位预览场景');
  const match=engine.createMatch({seed:'formation-preview-v4',format:'clip',duration:5400,teams,
    passiveSubstitutions:false,playerEffects:true},{recording:false});
  startSituation(match,scenario,minute,scoreState);
  const s=match.state;
  const roster=s.players.map(p=>({key:p.key,id:p.id,side:p.side,name:p.name,number:p.number,
    role:p.sourceRole??p.role,duty:p.dutyPlans?.normal??null}));
  const tasks=[],taskIndices=new Map();
  function taskIndex(task) {
    const key=JSON.stringify([task.type,task.reason]);
    if(!taskIndices.has(key)){
      taskIndices.set(key,tasks.length);
      tasks.push({type:task.type,label:TASK_LABELS[task.type]??task.type,reason:task.reason});
    }
    return taskIndices.get(key);
  }
  function frame() {
    return {time:s.time,owner:possessionSide(s),transition:s.transition?.lossMode??null,
      transitionId:s.transition?.id??null,lossResponse:s.transition?.from===0?s.coordination[0].transition:null,
      restart:s.restart?.reason??null,ball:{...boardPoint(s.ball),holder:s.ball.holder,mode:s.ball.mode},
      players:s.players.map(p=>({key:p.key,...boardPoint(p),active:p.active,...(p.side===0?{
        target:boardPoint(p.task.target),task:taskIndex(p.task),partners:p.task.partners??[],opponent:p.task.targetPlayer??null,
      }:{})}))};
  }
  const frames=[frame()];
  for(let tick=0;tick<12/STEP;tick+=2){
    engine.advanceMatch(match,2);
    frames.push(frame());
  }
  const result={engineVersion:VERSION,scenario,minute,scoreState,opponent:s.input.teams[1].name,
    lossReaction:s.input.teams[0].tactics.lossReaction,dimensions:teams[0].sourcePlans.normal.tacticalDimensions,roster,tasks,frames};
  result.clipId=createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return result;
}
