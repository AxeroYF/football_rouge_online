import {buildV2TeamSnapshots} from '../v2/team-snapshot-v2.js';
import {buildV2SpatialMatchup,buildV2StageSpatialMatchup} from '../v2/spatial-model-v2.js';
import {chooseFlowAction,nearestFlowPlayer} from './action-policy.js';
import {initializeFlowState,periodRemaining,clamp,rounded,flipFlowZone,zonePoint,FLOW_PERIODS} from './flow-state.js';
import {isV33} from './model-config.js';
import {prepareDefensiveAssignments} from './tactical-execution.js';

const phaseForZone=zone=>({defensiveThird:'buildUp',buildUp:'progression',finalThird:'finalThird',box:'chance'})[zone.split(':')[0]]??'buildUp';
export function simulatePossessionFlow(teams,options,{attemptStage,compactReplayShape}) {
  const {parameters,rng}=options;
  const snapshot=options.snapshotTeams??buildV2TeamSnapshots(teams,{parameters,state:options.state,environment:options.environment});
  const initial={parameters,teams};if(!options.flowState)initializeFlowState(initial);
  const flow=structuredClone(options.flowState??initial.flowState);
  const available=Math.min(periodRemaining(flow),Number(options.availableSeconds??Infinity));
  let spent=0,previousOwnerSeconds=0;
  const stages=[],actions=[],decisions=options.recordDecisionTrace?[]:null;
  const opening=buildV2SpatialMatchup(snapshot,{parameters});
  if(flow.owner!==0&&flow.owner!==1) {
    const control=opening.teams.map(team=>Math.max(.01,Number(team.centralControl??.5)));
    const share=control[0]/(control[0]+control[1]);
    flow.owner=(options.outcomeRoll?.('possession')??rng())<share?0:1;
    if(flow.openingOwner===undefined)flow.openingOwner=flow.owner;
    flow.zone='defensiveThird:center';flow.phase='buildUp';
  }
  const transfer=flow.transition;
  if(transfer&&!transfer.attempted&&transfer.lossStrategy==='counterPress'&&transfer.expiresAt>flow.elapsedSeconds&&available>=parameters.v32.counterPressSeconds) {
    transfer.attempted=true;
    const lost=transfer.lostTeam,point=zonePoint(flipFlowZone(flow.zone));
    const nearby=snapshot[lost].players.filter(p=>p.active!==false&&p.assignedRole!=='GK').map(p=>({p,d:Math.hypot((flow.shapes[lost][p.id]?.x??50)-point.x,(flow.shapes[lost][p.id]?.y??70)-point.y)})).filter(x=>x.d<25).sort((a,b)=>a.d-b.d||String(a.p.id).localeCompare(String(b.p.id))).slice(0,3);
    if(nearby.length) {
      const pressing=nearby.reduce((sum,x)=>sum+Number(x.p.attributes?.aggression??70)+Number(x.p.attributes?.tackling??70),0)/(nearby.length*2);
      const carrier=snapshot[flow.owner].players.find(p=>p.id===flow.carrierId);
      const resistance=Number(carrier?.attributes?.composure??75);
      const probability=clamp(.12+(pressing-resistance)/300+nearby.length*.09,.08,parameters.v32.counterPressMaximum);
      const roll=options.outcomeRoll?.(`counterPress:${lost}`)??rng(),success=roll<probability;
      spent+=parameters.v32.counterPressSeconds;flow.counterPressAttempts[lost]++;
      stages.push({stage:'counterPress',teamIndex:lost,zone:flipFlowZone(flow.zone),probability,success,
        actor:{id:nearby[0].p.id,name:nearby[0].p.name},outcome:success?'counterPressRecovered':'counterPressBypassed',
        ...(options.recordRandomRolls?{roll}:{}),foul:{occurred:false},factors:{nearbyPlayers:nearby.length,pressing,resistance}});
      actions.push({type:'counterPress',teamIndex:lost,seconds:spent,success,pressers:nearby.map(x=>x.p.id)});
      transfer.pressers=nearby.map(x=>x.p.id);
      if(success) {
        previousOwnerSeconds=spent;
        flow.counterPressRecoveries[lost]++;flow.owner=lost;flow.zone=flipFlowZone(flow.zone);flow.carrierId=nearby[0].p.id;
        flow.phase=phaseForZone(flow.zone);flow.transition=null;
      } else transfer.failed=true;
    }
  }
  const attacking=flow.owner,defending=1-attacking;
  const possessionType=flow.transition&&flow.transition.wonTeam===attacking?'transition':'normal';
  const startZone=flow.zone;
  stages.push({stage:'possession',owner:'possession',teamIndex:attacking,zone:flow.zone,probability:1,success:true,outcome:'continued'});
  const project=(stage,seconds,offset=spent)=>buildV2StageSpatialMatchup(snapshot,attacking,stage,{parameters,parametersResolved:true,
    flowState:{...flow,elapsedSeconds:flow.elapsedSeconds+offset},elapsedSeconds:seconds,
    ballLane:flow.zone.split(':')[1],possessionType});
  let spatial=project(flow.phase??phaseForZone(flow.zone),spent,0);
  const saveShape=()=>{flow.shapes=spatial.dynamicShape.teams.map(shape=>Object.fromEntries(shape.players.map(p=>[p.id,{...p.targetPosition}])));};
  saveShape();
  if(!flow.carrierId||!snapshot[attacking].players.some(p=>p.id===flow.carrierId))flow.carrierId=nearestFlowPlayer(spatial.teams[attacking],flow.zone)?.id??null;
  let recycles=0,replayShape=null;
  const remainingActions=parameters.v32.maxActions-actions.length;
  for(let index=0;index<remainingActions;index++) {
    const pressureContext=isV33(parameters)?prepareDefensiveAssignments(snapshot,flow):null;
    const phase=flow.phase??phaseForZone(flow.zone),team=spatial.teams[attacking],opponent=spatial.teams[defending];
    const trace=decisions?value=>decisions.push({stage:phase,...value}):null;
    const action=chooseFlowAction(team,opponent,flow.zone,phase,flow,rng,parameters,trace,recycles);
    if(spent+action.seconds>available+.0001) {
      spatial=project(phase,Math.max(0,available-spent));saveShape();
      spent=available;
      stages.push({stage:phase,teamIndex:attacking,zone:flow.zone,probability:0,success:false,outcome:'periodEnded',foul:{occurred:false},factors:{}});
      break;
    }
    const from=flow.zone,previousCarrier=flow.carrierId;
    flow.zone=action.target;
    if(action.type==='carry')flow.carryTarget={teamIndex:attacking,playerId:previousCarrier,point:zonePoint(flow.zone)};
    const attemptPhase=action.type==='longShot'?'shot':['recycle','switch'].includes(action.type)?'buildUp':phase;
    spatial=project(attemptPhase,action.seconds);saveShape();
    delete flow.carryTarget;
    const actualTeam=spatial.teams[attacking],actualOpponent=spatial.teams[defending];
    const connection=['create','shoot'].includes(action.type)?null:{...action,from,to:flow.zone,via:flow.zone};
    const state={...options.state,minute:Math.min(FLOW_PERIODS[flow.period].end,FLOW_PERIODS[flow.period].start+(flow.periodElapsed+spent)/60)};
    const result=attemptStage({team:actualTeam,opponent:actualOpponent,parameters,rng,outcomeRoll:options.outcomeRoll,
      domainRoll:options.domainRoll,recordRandomRolls:options.recordRandomRolls,state,environment:options.environment,
      chainIndex:options.chainIndex,possessionType,deferShotResolution:true,previousActorId:previousCarrier,continuationWeight:.85,
      preferredActorId:['carry','shoot','create','longShot'].includes(action.type)?previousCarrier:action.receiverId??null,
      actionType:action.type,decisionTrace:trace},attemptPhase,flow.zone,connection);
    result.actionType=action.type;result.actionSeconds=rounded(action.seconds);result.stageSpatialModelVersion=spatial.modelVersion;
    if(action.type==='longShot')result.baseXg=action.quality;
    if(phase==='finalThird'&&['pass','direct'].includes(action.type)) {
      const offsideChance=clamp(.018+Math.max(0,Number(actualOpponent.tacticalDimensions.defensiveLine)-50)*.0008+(actualOpponent.outOfPossessionDetails?.lineStrategy==='offside'?.035:0),.006,.14);
      if((options.domainRoll?.('execution')??rng())<offsideChance)Object.assign(result,{success:false,outcome:'offside',turnover:null,foul:{occurred:false},offsideProbability:offsideChance});
    }
    spent+=action.seconds;
    actions.push({type:action.type,from,to:flow.zone,actorId:result.actor?.id??null,seconds:rounded(action.seconds),success:result.success,
      ...(isV33(parameters)?{pressure:pressureContext,reasons:action.reasons??[],turnover:Boolean(result.turnover)}:{})});
    if(isV33(parameters))flow.previousAction={type:action.type,teamIndex:attacking};
    stages.push(result);
    if(options.recordReplayShape)replayShape=compactReplayShape(spatial.dynamicShape);
    if(result.actor?.id)flow.carrierId=result.actor.id;
    if(!result.success||attemptPhase==='shot')break;
    if(['recycle','switch'].includes(action.type))recycles++;
    flow.phase=phase==='chance'&&action.type==='create'?'shot':phaseForZone(flow.zone);
  }
  const last=stages.at(-1);
  const weather=options.environment?.weather??'sunny',weatherProbability=parameters.environment.weatherEventPerChain[weather]??0;
  const weatherChance=1-Math.pow(1-weatherProbability,spent/30);
  const weatherRoll=options.domainRoll?.('environment')??rng();
  return {engineVersion:parameters.engineVersion,modelVersion:isV33(parameters)?'possession-chain-v3.3':'possession-chain-v3.2',spatialModelVersion:'spatial-v3.2-continuous.1',
    context:{state:options.state??null,environment:options.environment??null,chainIndex:Number(options.chainIndex??0)},
    possessionType,attackingTeamIndex:attacking,defendingTeamIndex:defending,startZone,endZone:flow.zone,
    completedStages:stages.filter(s=>s.success).map(s=>s.stage),terminalOutcome:last.outcome,goal:false,
    xg:last.stage==='shot'?last.probability:0,stages,actions,previousOwnerSeconds,activeDurationSeconds:rounded(spent),nextFlow:flow,
    independentEvents:weatherRoll<weatherChance?[{type:['storm','superStorm'].includes(weather)?'lightningInjury':'weatherInjury',weather,probability:weatherChance}]:[],
    ...(decisions?{decisionTrace:decisions}:{}),...(replayShape?{replayShape}:{})};
}
