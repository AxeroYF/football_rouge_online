import {VERSION,FIELD,STEP,clamp,distance,round,worldPoint,coordinates,scoringSideAt,clockSnapshot,playerByKey,seedState,random,sweptContact,snapshot,assertWorld} from './world.js';
import {createClock,advanceClock,announceAllowance,periodDue,restartTiming} from './period-clock.js';
import {controlPlan,readyToDecide,updateProgress} from './tempo.js';
import {verticalAt,launchVertical,aerialReach,sweptAerialContact,goalFrameContact,frameRebound,GOAL_HEIGHT} from './aerial.js';
import {applyPassiveExit} from './availability.js';
import {captainModifiers} from './captaincy.js';
import {positionExecution} from './execution.js';
import {refreshPlayerEffects} from './player-effects.js';
import {resolutionAfterPeriod,createShootout,recordShootoutKick,aggregateScore} from './competition.js';
import {shotOpportunity,decisionTrace} from './opportunity.js';
import {tacticalMode,effectiveTactics} from './tactical-plan.js';
import {compileInput} from './fixtures.js';
import {planTasks,movePlayers,actionCandidates,commitTasks} from './tasks.js';
import {planCoordination,coordinationChanges,changePossession} from './coordination.js';
import {controlProfile,looseVelocity,boundaryCrossing,keeperContactRadius} from './ball-control.js';
import {activePlayers,offsideSnapshot,offsideInvolvement,opponentDeliberatePlay,outRestart,freeKickSpot,foulProfile,foulSanction,challengeIntent as tackleIntent,arrangeRestart,RESTART_NAMES,inPenaltyArea} from './rules.js';

function freeze(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;
}

export function createMatch(input,{recording=true,frameInterval=input.format==='full'||input.duration===5400?1:STEP}={}) {
  const locked=freeze(compileInput(input));
  const state={version:VERSION,input:locked,inputFingerprint:seedState(JSON.stringify(locked)),tick:0,time:0,score:[0,0],phase:'playing',restartSerial:0,
    clock:createClock(locked),activePlans:['normal','normal'],progress:null,pendingPenalty:null,shootout:null,result:null,lastOwner:0,restart:null,nextEventId:1,transition:null,transitionSerial:0,contestSerial:0,coordination:[{},{}],rules:{offside:null,restartTouch:null},
    random:Object.fromEntries(['decision','execution','availability','competition'].map(name=>[name,{value:seedState(`${locked.seed}:${name}`),draws:0}])),
    stats:[0,1].map(()=>({passes:0,completed:0,shots:0,interceptions:0,tackles:0,distance:0,pressSeconds:0,
      miscontrols:0,parries:0,deflections:0,secondBalls:0,transitions:0,counterPressRecoveries:0,fouls:0,offsides:0,yellowCards:0,redCards:0,headers:0,crosses:0,woodwork:0,injuries:0,substitutions:0})),
    players:locked.teams.flatMap((team,side)=>[...team.players,...team.bench].map((p,index)=>({...structuredClone(p),key:`${side}:${p.id}`,side,
      ...worldPoint(p.anchor,side),active:index<11,status:index<11?'playing':'bench',yellowCards:0,vx:0,vy:0,facing:side===0?0:Math.PI,task:null,control:null,nextDecision:0,nextTackle:0,nextTouch:0}))),
    ball:{mode:'dead',x:52.5,y:34,z:0,vx:0,vy:0,holder:null,flight:null}};
  if(!Number.isFinite(frameInterval)||frameInterval<STEP)throw new Error('录制间隔无效');
  const match={state,recording:Boolean(recording),frameInterval,events:[],frames:[]};
  refreshPlayerEffects(state);
  const carrier=state.players.find(p=>p.side===0&&p.role==='DM')??state.players.find(p=>p.side===0&&p.active&&p.role!=='GK');
  carrier.x=52.5;carrier.y=34;hold(state,carrier);carrier.nextDecision=.6;
  emit(match,'kickoff',carrier,{text:`开球：${locked.teams[0].name}开始组织`,reason:'双方按赛前锁定的阵容与战术，采用同一套空间规则'});
  state.restart={type:'kickoff',side:0,spot:{x:52.5,y:34},reason:'比赛开始，双方遵守中圈开球站位',until:0};
  beginRestart(match);
  state.coordination=planCoordination(state);commitTasks(state,planTasks(state,state.coordination));
  record(match);assertWorld(state);return match;
}

function hold(state,p) {
  state.ball={mode:'held',holder:p.key,x:p.x,y:p.y,z:0,vx:p.vx,vy:p.vy,flight:null};
  state.lastOwner=p.side;
}
function takeControl(match,p,time,cause) {
  const s=match.state,previous=s.transition;
  s.rules.offside=null;
  const transition=changePossession(s,p.side,time,cause);
  if(transition) {
    s.stats[p.side].transitions++;
    if(previous?.from===p.side&&previous.lossMode==='counterPress'&&time<=previous.at+3)s.stats[p.side].counterPressRecoveries++;
    emit(match,'transition',p,{time:round(time),text:`${s.input.teams[p.side].name}获得控制，攻守转换`,
      reason:transition.lossMode==='counterPress'?'丢球方附近有协同人数，先进行3秒反抢；得球方寻找出口':'丢球方先回撤恢复结构，得球方寻找向前出口',transition:structuredClone(transition)});
  }
  hold(s,p);p.control=controlPlan(s,p,time);p.nextDecision=p.control.until;
}
function emit(match,type,actor,details={}) {
  const s=match.state;
  const event={id:s.nextEventId++,time:round(s.time),tick:s.tick,type,actor:actor?.key??null,side:actor?.side??null,
    position:{x:s.ball.x,y:s.ball.y},score:[...s.score],source:actor?s.input.teams[actor.side].preset:null,plan:actor?s.activePlans[actor.side]:null,
    sequence:{possession:s.transitionSerial,restart:s.restartSerial},...details,clock:clockSnapshot(s,details.time??s.time)};
  match.events.push(event);return event;
}
function record(match) {if(match.recording)match.frames.push(snapshot(match.state));}
function syncTacticalPlans(match){
  const s=match.state;
  for(const side of [0,1]){const mode=tacticalMode(s,side);if(mode===s.activePlans[side])continue;
    const before=s.activePlans[side];s.activePlans[side]=mode;
    for(const p of s.players.filter(p=>p.side===side))if(p.anchorPlans){p.anchor={...(p.anchorPlans[mode]??p.anchorPlans.normal)};}
    for(const p of s.players.filter(p=>p.side===side))if(p.rolePlans){p.role=p.rolePlans[mode]??p.rolePlans.normal;p.sourceRole=p.sourceRolePlans?.[mode]??p.sourceRole;}
    emit(match,'tacticalPlanChanged',null,{side,source:s.input.teams[side].preset,plan:mode,previousPlan:before,
      text:`${s.input.teams[side].name}执行${mode==='leading'?'领先':mode==='trailing'?'落后':'默认'}预案`,reason:'达到赛前锁定的比分与时间条件，改变任务和阵型目标；球员按实际跑动到位',instructions:structuredClone(effectiveTactics(s,side))});
  }
}
export function awardRestart(match,type,side,spot,reason,time=match.state.time,card=null) {
  if(!RESTART_NAMES[type])throw new Error('未知定位球');
  const s=match.state,timing=restartTiming(type,card);s.phase='restart';s.restart={type,side,reason,spot:freeKickSpot(spot,side,type,s),startedAt:time,
    until:round(time+timing.delay),lossStart:round(time+timing.normal),lossAccrued:0,lossCause:timing.cause};
  s.pendingPenalty=type==='penalty'?{side,kicker:null,kicked:false}:null;
  s.transition=null;s.coordination=[{},{}];
  s.rules={offside:null,restartTouch:null};
  s.ball={...s.ball,mode:'dead',holder:null,flight:null,z:0,vz:0,airborne:false,vx:0,vy:0};
  emit(match,'stoppage',null,{time:round(time),text:RESTART_NAMES[type],reason,side,restartType:type,spot:s.restart.spot});
}
function beginRestart(match) {
  const s=match.state,r=s.restart;s.restartSerial++;
  syncTacticalPlans(match);
  const {worldPoint}=coordinates(s);
  const carrier=arrangeRestart(s,r);
  hold(s,carrier);s.phase='playing';s.restart=null;
  s.rules.restartTouch={type:r.type,kicker:carrier.key,side:r.side};
  emit(match,'restart',carrier,{text:`${s.input.teams[carrier.side].name}执行${RESTART_NAMES[r.type]}`,reason:r.reason,restartType:r.type,spot:r.spot,lostSeconds:r.lossAccrued??0});
  if(r.type==='penalty')s.pendingPenalty={side:r.side,kicker:carrier.key,kicked:true};
  const candidates=actionCandidates(s,carrier);
  const shot=r.type==='penalty'||r.type==='directFreeKick'&&candidates[0].type==='shot';
  const opportunity=shot?shotOpportunity(s,carrier):null;
  let choice=shot?{type:'shot',utility:opportunity.utility,target:opportunity.target,opportunity:opportunity.evidence,reason:`${RESTART_NAMES[r.type]}直接射门：${opportunity.reason}`}:
    candidates.find(c=>c.type==='pass')??(()=>{const receiver=activePlayers(s).find(p=>p.side===r.side&&p.key!==carrier.key);return {type:'pass',to:receiver.key,target:{x:receiver.x,y:receiver.y},utility:0,reason:'定位球交给队友'};})();
  if(r.cornerTarget){const receiver=playerByKey(s,r.cornerTarget);choice={type:'pass',to:receiver.key,target:{x:receiver.x,y:receiver.y},trajectory:'loft',intent:'cross',utility:choice.utility,
    reason:`执行赛前${effectiveTactics(s,r.side).setPieceRoutine==='far'?'远点':'近点'}角球套路；按实际高球触球争顶，其他队员保留二点与反击保护`};}
  const legal=candidates.filter(c=>r.type==='penalty'?c.type==='shot':c.type==='pass'||r.type==='directFreeKick'&&c.type==='shot');
  if(r.type==='penalty')preparePenaltyKeeper(match,carrier.side);
  release(match,carrier,choice,[choice,...legal.filter(c=>c!==choice)],r.type);
  record(match);
}

function release(match,carrier,choice,candidates,restartType=null) {
  const {worldPoint}=coordinates(match.state);
  const s=match.state,goal=worldPoint({x:105,y:34},carrier.side);
  let target={...(choice.target??goal)};
  const attributes=carrier.attributes;
  let skill=choice.type==='shot'?distance(carrier,target)>22?attributes.finishing*.4+attributes.longShots*.6:attributes.finishing:
    choice.trajectory==='loft'?attributes.passing*.3+attributes.crossing*.7:attributes.passing;
  if(['corner','directFreeKick','indirectFreeKick'].includes(restartType))skill=clamp(skill+(attributes.setPieces-75)*.25,1,100);
  skill=clamp(skill*positionExecution(carrier),1,100);
  const pressure=Math.min(...activePlayers(s).filter(p=>p.side!==carrier.side).map(p=>distance(p,carrier)));
  const fatigueError=choice.type==='shot'?(100-carrier.fitness)*(restartType==='penalty'?.02:.06):0;
  const leadership=captainModifiers(s,carrier.side),leadershipEffect=leadership.stage[choice.type==='shot'?'shot':coordinates(s).localPoint(carrier,carrier.side).x<40?'buildUp':'progression']??0;
  // Contact variability remains at elite skill. The skill-dependent part is
  // additive: upgrading finishing must not erase the physical error floor.
  const skillError=choice.type==='shot'?.18+(100-skill)/100*.25:(100-skill)/100;
  const error=(skillError*(choice.type==='shot'?(restartType==='penalty'?4+distance(carrier,target)*.1:12+distance(carrier,target)*.4):distance(carrier,target)*.17)+(pressure<3?.7:0)+fatigueError)*(1+(75-attributes.composure)*.003)*(1-leadershipEffect);
  const deviation=(random(s,'execution')*2-1)*error;
  if(choice.type==='shot'){const aimed=coordinates(s).localPoint(target,carrier.side);target=worldPoint({x:105,y:aimed.y+(random(s,'execution')*2-1)*.6+deviation},carrier.side);}
  else {const dx=target.x-carrier.x,dy=target.y-carrier.y,d=Math.hypot(dx,dy);target={x:clamp(target.x-dy/d*deviation,.2,104.8),y:clamp(target.y+dx/d*deviation,.2,67.8)};}
  const d=distance(carrier,target),speed=choice.type==='shot'?24+skill*.06:22+skill*.035;
  const travel=choice.trajectory==='loft'?Math.max(1.3,d/speed):d/speed;
  const vertical=choice.trajectory==='loft'?launchVertical(0,1.8,travel):null;
  const landing=vertical?2*vertical.vz/9.81:travel;
  const landingTarget=vertical?{x:carrier.x+(target.x-carrier.x)*landing/travel,y:carrier.y+(target.y-carrier.y)*landing/travel}:target;
  const flight={kind:choice.type,side:carrier.side,from:carrier.key,to:choice.to??null,
    start:{x:carrier.x,y:carrier.y},target:landingTarget,receivePoint:target,startedAt:s.time,endsAt:s.time+landing,trajectory:choice.trajectory??'ground',restartType,decisionId:s.nextEventId};
  if(choice.type==='pass')s.lastPass={side:carrier.side,at:s.time,backward:(target.x-carrier.x)*coordinates(s).direction(carrier.side)<-3};
  s.ball={mode:'flight',holder:null,x:carrier.x,y:carrier.y,z:0,vx:(target.x-carrier.x)/travel,vy:(target.y-carrier.y)/travel,flight,
    ...(vertical??{})};
  s.rules.offside=offsideSnapshot(s,carrier,s.time,restartType);
  s.stats[carrier.side][choice.type==='shot'?'shots':'passes']++;
  if(choice.intent==='cross')s.stats[carrier.side].crosses++;
  emit(match,s.shootout?.active?'shootoutShot':choice.type,carrier,{to:choice.to??null,target:{...target},text:choice.type==='shot'?`${carrier.name}起脚射门`:`${carrier.name}传给${playerByKey(s,choice.to)?.name}`,
    reason:choice.reason,task:carrier.task?.type,actorRole:carrier.role,intent:choice.intent??null,trajectory:choice.trajectory??'ground',opportunity:choice.opportunity??null,decision:decisionTrace(choice,candidates),
    restartType,offside:structuredClone(s.rules.offside),execution:{skill,leadershipEffect,attributeContext:{passing:attributes.passing,crossing:attributes.crossing,finishing:attributes.finishing,longShots:attributes.longShots,setPieces:attributes.setPieces,composure:attributes.composure},fitness:round(carrier.fitness),fatigueError:round(fatigueError),pressureDistance:round(pressure),deviation:round(deviation),errorRange:round(error),distance:round(d)}});
}

function decide(match) {
  const s=match.state,carrier=playerByKey(s,s.ball.holder);
  if(s.shootout)return;
  if(!carrier || !readyToDecide(s,carrier))return;
  carrier.control=null;carrier.nextDecision=round(s.time+1.2);
  const candidates=actionCandidates(s,carrier),best=candidates[0].utility;
  const tolerance=.02+(100-carrier.attributes.decisions)*.002;
  const eligible=candidates.filter(c=>c.utility>=best-tolerance);
  const choice=eligible[Math.floor(random(s,'decision')*eligible.length)];
  if(choice.type!=='carry')release(match,carrier,choice,candidates);
  else emit(match,'carry',carrier,{text:`${carrier.name}继续持球推进`,reason:choice.reason,task:'carry',
    decision:decisionTrace(choice,candidates)});
}

function contactRecord(match,oldPlayers,alpha,point,event) {
  if(!match.recording)return;
  const frame=snapshot(match.state);
  frame.time=round(match.state.time+STEP*alpha);
  frame.clock=clockSnapshot(match.state,frame.time);
  frame.contact=true;
  frame.players=frame.players.map(p=>{const old=oldPlayers.find(q=>q.key===p.key);return {...p,x:old.x+(p.x-old.x)*alpha,y:old.y+(p.y-old.y)*alpha};});
  frame.ball={...structuredClone(match.state.ball),x:point.x,y:point.y};
  if(frame.ball.mode==='held'){frame.ball.mode='loose';frame.ball.holder=null;}
  frame.score=[...event.score];frame.eventCursor=event.id;
  match.frames.push(frame);
}

function headBall(match,player,actual,point,time,flight,contact,duel,world){
  const s=match.state,{localPoint,worldPoint}=coordinates(s),local=localPoint(point,player.side),shot=local.x>75&&Math.abs(local.y-34)<22;
  const skill=player.attributes.heading,roll=random(s,'execution'),error=(100-skill)/100*(4+(105-local.x)*.16);
  const target=worldPoint(shot?{x:105,y:34+(roll*2-1)*error}:{x:clamp(local.x+30,5,103),y:clamp(local.y+(local.y<34?-1:1)*10,1,67)},player.side);
  const distanceTo=Math.hypot(target.x-point.x,target.y-point.y),travel=Math.max(.2,distanceTo/(shot?18+skill*.04:16));
  const height=shot?clamp(1+(random(s,'execution')*2-1)*(100-skill)*.025,0,4):0;
  const source=flight?.decisionId??s.ball.decisionId??null;
  if(flight?.kind==='pass'){if(flight.side===player.side)s.stats[player.side].completed++;else s.stats[player.side].interceptions++;}
  s.stats[player.side].headers++;s.stats[player.side][shot?'shots':'passes']++;
  const event=emit(match,shot?'shot':'pass',player,{time,text:`${player.name}${shot?'头球攻门':'头球解围'}`,bodyPart:'head',actorRole:player.role,
    reason:shot?'实际进入高球触球范围后，用头球把来球送向球门':'实际争到高球后向前场边侧解围，下一次触球仍须争夺',
    target:{...target,z:height},decisionId:source,from:flight?.from??null,contact,duel,intent:shot?'headerShot':'clearance',
    aerial:{height:point.z,reach:aerialReach(player),heading:skill,jumping:player.attributes.jumping,roll},execution:{skill,distance:distanceTo,deviation:(roll*2-1)*error}});
  s.ball={mode:'flight',holder:null,x:point.x,y:point.y,...launchVertical(point.z,height,travel),vx:(target.x-point.x)/travel,vy:(target.y-point.y)/travel,
    flight:{kind:shot?'shot':'pass',side:player.side,from:player.key,to:null,start:{x:point.x,y:point.y},target,startedAt:time,endsAt:time+travel,decisionId:event.id,trajectory:'header'}};
  s.rules.offside=offsideSnapshot({...world,ball:s.ball},actual,time);
  player.nextTouch=time+.45;return event;
}

// Resolve contacts and rebounds in chronological order within the same fixed step.
function ballStep(match,oldPlayers) {
  const s=match.state;
  const oldPositions=new Map(oldPlayers.map(p=>[p.key,p]));
  const positionAt=(p,offset)=>{const old=oldPositions.get(p.key);return {...p,x:old.x+(p.x-old.x)*offset/STEP,y:old.y+(p.y-old.y)*offset/STEP};};
  let offset=0,iterations=0;
  while(offset<STEP-1e-9&&['flight','loose'].includes(s.ball.mode)) {
    if(++iterations>30)throw new Error('V4 单步触球链超过安全上限');
    const b=s.ball,f=b.flight,start={x:b.x,y:b.y},remaining=STEP-offset;
    const duration=f?Math.min(remaining,Math.max(0,f.endsAt-(s.time+offset))):remaining;
    if(f&&duration<1e-9){
      const event=emit(match,'loose',playerByKey(s,f.from),{time:round(s.time+offset),text:'来球无人控制，形成自由球',reason:'落点无人及时接应',decisionId:f.decisionId});
      s.ball={mode:'loose',holder:null,flight:null,x:b.x,y:b.y,z:0,vx:b.vx*.65,vy:b.vy*.65,lastTouch:f.from,
        contest:{id:++s.contestSerial,kind:'unclaimed',createdAt:event.time,originEventId:event.id,touches:0}};
      continue;
    }
    const end=f&&f.endsAt<=s.time+offset+duration+1e-9?{...f.target}:{x:b.x+b.vx*duration,y:b.y+b.vy*duration};
    const boundary=boundaryCrossing(start,end),frameHit=goalFrameContact(b,duration),contacts=[];
    for(const p of activePlayers(s)) {
      if(s.shootout?.current&&![s.shootout.current.kicker,s.shootout.current.keeper].includes(p.key))continue;
      if(p.key===f?.from)continue;
      const validFrom=Math.max(offset,p.nextTouch-s.time);
      if(validFrom>offset+duration+1e-9)continue;
      const skip=duration>0?(validFrom-offset)/duration:0;
      const ballFrom={x:start.x+(end.x-start.x)*skip,y:start.y+(end.y-start.y)*skip};
      const from=positionAt(p,validFrom),to=positionAt(p,offset+duration),ownBox=inPenaltyArea(from,p.side,s);
      const penaltyKeeper=f?.restartType==='penalty'||s.shootout?.current?.keeper===p.key;
      const radius=p.role==='GK'&&ownBox?keeperContactRadius(p,penaltyKeeper):.72;
      const vertical=verticalAt(b,duration*skip),contactBall={...b,...vertical};
      const local=sweptAerialContact(ballFrom,end,from,to,radius,contactBall,duration*(1-skip),aerialReach(p,p.role==='GK'&&ownBox));
      if(local!==null)contacts.push({alpha:skip+(1-skip)*local,p,radius});
    }
    contacts.sort((a,b)=>a.alpha-b.alpha||a.p.key.localeCompare(b.p.key));
    let contact=contacts.find(c=>c.alpha<=boundary&&c.alpha<=(frameHit?.alpha??Infinity)),duel=null;
    if(contact) {
      const tied=contacts.filter(c=>Math.abs(c.alpha-contact.alpha)<1e-8);
      if(tied.length>1) {
        const high=verticalAt(b,duration*contact.alpha).z>1.15;
        const weights=tied.map(c=>high?c.p.attributes.heading*.5+c.p.attributes.jumping*.3+c.p.fitness*.2:c.p.attributes.firstTouch*.5+c.p.attributes.decisions*.3+c.p.fitness*.2);
        const total=weights.reduce((a,b)=>a+b,0),roll=random(s,'execution');let cursor=roll*total;
        contact=tied.at(-1);
        for(let i=0;i<tied.length;i++){cursor-=weights[i];if(cursor<0){contact=tied[i];break;}}
        duel={kind:high?'aerialContact':'simultaneousContact',candidates:tied.map((c,i)=>({key:c.p.key,share:round(weights[i]/total)})),roll:round(roll)};
      }
    }
    if(contact) {
      const {alpha,p,radius}=contact;offset+=duration*alpha;
      const time=round(s.time+offset),vertical=verticalAt(b,duration*alpha),point={x:start.x+(end.x-start.x)*alpha,y:start.y+(end.y-start.y)*alpha,z:vertical.z};
      const actual=positionAt(p,offset),world={...s,players:s.players.map(q=>positionAt(q,offset))};
      s.ball.x=point.x;s.ball.y=point.y;s.ball.z=point.z;
      if(s.pendingPenalty?.kicked&&!(p.side!==s.pendingPenalty.side&&p.role==='GK')){
        s.pendingPenalty=null;
        if(s.clock.extendingPenalty){s.ball={...s.ball,mode:'dead',holder:null,flight:null,vx:0,vy:0};return;}
      }
      const involvement=offsideInvolvement(world,actual,point);
      if(involvement){
        const offender=involvement.player;s.stats[offender.side].offsides++;
        const event=emit(match,'offside',offender,{time,text:`${offender.name}越位参与`,reason:involvement.kind==='touch'?'按队友触球时的位置判定，在实际触球时处罚':'出球时处于越位位置，并近身争抢影响对手',
          offside:structuredClone(involvement.snapshot),involvement:involvement.kind,position:{x:offender.x,y:offender.y}});
        awardRestart(match,'indirectFreeKick',1-offender.side,offender,event.reason,time);
        contactRecord(match,oldPlayers,offset/STEP,point,event);return;
      }
      const restartTouch=s.rules.restartTouch;
      if(restartTouch?.kicker===p.key){
        const event=emit(match,'doubleTouch',p,{time,text:`${p.name}定位球二次触球违例`,reason:'球触及其他球员前，主罚者不能再次触球'});
        awardRestart(match,'indirectFreeKick',1-p.side,point,event.reason,time);contactRecord(match,oldPlayers,offset/STEP,point,event);return;
      }
      if(restartTouch)s.rules.restartTouch=null;
      if(s.shootout?.current&&p.key!==s.shootout.current.keeper){finishShootoutAttempt(match,false,time,'主罚者再次触球，不能补射');return;}
      if(point.z>1.15&&!(p.role==='GK'&&inPenaltyArea(actual,p.side,s))){
        const event=headBall(match,p,actual,point,time,f,{point,playerPoint:{x:actual.x,y:actual.y},radius},duel,world);
        contactRecord(match,oldPlayers,offset/STEP,point,event);continue;
      }
      const profile=controlProfile(world,actual,b),roll=random(s,'execution'),controlled=roll<profile.probability;
      const deliberatePlay=s.rules.offside&&p.side!==s.rules.offside.side&&opponentDeliberatePlay(profile,controlled);
      if(deliberatePlay)s.rules.offside=null;
      const contest=b.contest,enemy=f&&p.side!==f.side;
      const type=controlled?(contest?'secondBall':enemy?(f.kind==='shot'?(profile.keeper?'save':'block'):'interception'):'receive')
        :profile.keeper&&profile.shot?'parry':profile.shot?'deflection':'miscontrol';
      const labels={secondBall:'抢到并控制二点球',save:'稳稳抱住射门',block:'封堵并控制球',interception:'截下并控制传球',receive:'接稳来球',parry:'扑救脱手，球仍可争夺',deflection:'封堵形成反弹球',miscontrol:'第一脚未停稳，球脱离控制'};
      const event=emit(match,type,p,{time,text:`${p.name}${labels[type]}`,from:f?.from??b.lastTouch??null,decisionId:f?.decisionId??null,
        reason:controlled?'实际先到达触球点，再按来球速度、朝向、压力与接球能力控制':'已碰到球但未能控制：来球速度、朝向、压力与能力共同影响',
        contact:{point,playerPoint:{x:actual.x,y:actual.y},radius},control:profile,roll:round(roll),duel,outcome:controlled?'controlled':'loose',offsideResetByDeliberatePlay:Boolean(deliberatePlay),
        contest:contest?{...contest,challengers:contacts.filter(c=>c.alpha<=alpha+.2).map(c=>({key:c.p.key,arrivalSeconds:round((c.alpha-alpha)*duration)}))}:null});
      p.nextTouch=round(time+(controlled?.2:.45));
      if(controlled) {
        if(s.shootout?.current){contactRecord(match,oldPlayers,offset/STEP,point,event);finishShootoutAttempt(match,false,time,'门将控制来球');return;}
        s.pendingPenalty=null;
        if(contest)s.stats[p.side].secondBalls++;
        if(enemy&&f.kind==='pass')s.stats[p.side].interceptions++;
        else if(f?.kind==='pass')s.stats[p.side].completed++;
        contactRecord(match,oldPlayers,offset/STEP,point,event);
        takeControl(match,p,time,type);event.controlPlan=structuredClone(p.control);return;
      }
      // A teammate's new touch sets a new line. Opponent deflections/saves retain the old line.
      if(s.rules.offside?.side===p.side)s.rules.offside=offsideSnapshot({...world,ball:s.ball},actual,time);
      const rebound=looseVelocity(b,actual,profile,random(s,'execution'),s);
      s.stats[p.side][type==='parry'?'parries':type==='deflection'?'deflections':'miscontrols']++;
      s.ball={mode:'loose',holder:null,flight:null,x:point.x,y:point.y,z:point.z,vz:0,airborne:point.z>0,vx:rebound.vx,vy:rebound.vy,lastTouch:p.key,decisionId:f?.decisionId??b.decisionId??null,
        contest:contest?{...contest,touches:contest.touches+1}:{id:++s.contestSerial,kind:rebound.kind,createdAt:time,originEventId:event.id,touches:1}};
      event.contest=structuredClone(s.ball.contest);event.rebound={vx:rebound.vx,vy:rebound.vy};
      contactRecord(match,oldPlayers,offset/STEP,point,event);
      continue;
    }
    if(frameHit&&frameHit.alpha<=boundary){
      offset+=frameHit.time;const time=round(s.time+offset),point=frameHit.point,rebound=frameRebound(b,frameHit),lastTouch=playerByKey(s,f?.from??b.lastTouch);
      const event=emit(match,'woodwork',lastTouch,{time,text:frameHit.kind==='crossbar'?'球击中横梁反弹':'球击中门柱反弹',reason:'球与球门框实际相交，未判进球，反弹后继续比赛',position:point,decisionId:f?.decisionId??b.decisionId??null,frame:frameHit.kind,normal:frameHit.normal,rebound});
      if(lastTouch)s.stats[lastTouch.side].woodwork++;
      s.ball={mode:'loose',holder:null,flight:null,x:clamp(point.x+frameHit.normal.x*1e-5,0,105),y:clamp(point.y+frameHit.normal.y*1e-5,0,68),z:Math.max(0,point.z+frameHit.normal.z*1e-5),
        ...rebound,airborne:point.z>0||rebound.vz>0,lastTouch:lastTouch?.key??null,decisionId:event.decisionId,
        contest:{id:++s.contestSerial,kind:'woodwork',createdAt:time,originEventId:event.id,touches:0}};
      contactRecord(match,oldPlayers,offset/STEP,point,event);continue;
    }
    if(boundary<=1) {
      offset+=duration*boundary;
      const point={x:clamp(start.x+(end.x-start.x)*boundary,0,105),y:clamp(start.y+(end.y-start.y)*boundary,0,68)};
      const vertical=verticalAt(b,duration*boundary);point.z=vertical.z;s.ball.x=point.x;s.ball.y=point.y;s.ball.z=point.z;
      const atGoalLine=point.x<1e-6||point.x>105-1e-6;
      let goal=atGoalLine&&Math.abs(point.y-34)<=FIELD.goalWidth/2&&point.z<=GOAL_HEIGHT;
      const scoringSide=scoringSideAt(s,point.x),lastTouch=playerByKey(s,f?.from??b.lastTouch);
      const rt=s.rules.restartTouch;
      const prohibitedDirect=goal&&rt&&(scoringSide!==rt.side||['indirectFreeKick','throwIn'].includes(rt.type));
      if(prohibitedDirect)goal=false;
      if(s.shootout?.current){
        const event=emit(match,goal?'shootoutGoal':'shootoutMiss',lastTouch,{time:round(s.time+offset),text:goal?'点球罚入':'点球未罚入',reason:goal?'球实际越过门框内的门线':'球实际越过门框外边界',position:point,decisionId:f?.decisionId??b.decisionId??null});
        contactRecord(match,oldPlayers,offset/STEP,point,event);finishShootoutAttempt(match,goal,event.time,event.reason);return;
      }
      if(goal)s.score[scoringSide]++;
      const event=emit(match,goal?'goal':'out',lastTouch,{time:round(s.time+offset),text:goal?'进球！球越过球门线':'球出界',
        reason:goal?'实际球路穿过球门范围内的门线':prohibitedDirect?'此定位球未经其他球员触球，不能直接计入该球门':'实际球路到达场地边界',decisionId:f?.decisionId??b.decisionId??null,position:point,
        scoringSide:goal?scoringSide:null,ownGoal:Boolean(goal&&lastTouch&&lastTouch.side!==scoringSide)});
      contactRecord(match,oldPlayers,offset/STEP,point,event);
      s.pendingPenalty=null;
      if(s.clock.extendingPenalty){s.ball={...s.ball,mode:'dead',holder:null,flight:null,vx:0,vy:0};return;}
      const next=goal?{type:'kickoff',side:1-scoringSide,spot:{x:52.5,y:34}}:outRestart(point,lastTouch?.side??s.lastOwner,s);
      awardRestart(match,next.type,next.side,next.spot,event.reason,event.time);return;
    }
    const vertical=verticalAt(b,duration);s.ball.x=end.x;s.ball.y=end.y;s.ball.z=vertical.z;if(s.ball.airborne){s.ball.vz=vertical.vz;if(vertical.z===0)s.ball.airborne=false;}offset+=duration;
    if(f&&offset<STEP-1e-9)continue;
    if(!f&&s.ball.z===0){const drag=Math.exp(-1.5*duration);s.ball.vx*=drag;s.ball.vy*=drag;if(Math.hypot(s.ball.vx,s.ball.vy)<.1){s.ball.vx=0;s.ball.vy=0;}}
    if(s.pendingPenalty?.kicked&&Math.hypot(s.ball.vx,s.ball.vy)<.1)s.pendingPenalty=null;
    if(s.shootout?.current&&Math.hypot(s.ball.vx,s.ball.vy)<.1&&s.ball.z===0){finishShootoutAttempt(match,false,s.time+offset,'球已停止运动');return;}
  }
}

function heldStep(match) {
  const s=match.state,carrier=playerByKey(s,s.ball.holder);hold(s,carrier);
  const opponents=activePlayers(s).filter(p=>p.side!==carrier.side&&distance(p,carrier)<1.45&&p.nextTackle<=s.time)
    .sort((a,b)=>distance(a,carrier)-distance(b,carrier)||a.key.localeCompare(b.key));
  const defender=opponents[0];if(!defender)return;
  defender.nextTackle=round(s.time+(defender.yellowCards?3.2:2));
  if(defender.yellowCards&&random(s,'decision')>.15)return;
  const foul=foulProfile(s,defender,carrier);
  const intensity=effectiveTactics(s,defender.side).duelIntensity;
  const leadership=captainModifiers(s,defender.side);foul.probability*=leadership.foulMultiplier;
  foul.cardMultiplier=leadership.cardMultiplier;foul.directRedMultiplier=leadership.directRedMultiplier;
  if(carrier.penaltyDraw){foul.drawTraitMultiplier=foul.penalty?carrier.penaltyDraw.penaltyMultiplier:carrier.penaltyDraw.foulMultiplier;foul.probability=clamp(foul.probability*foul.drawTraitMultiplier,.02,.5);}
  if(intensity==='roughPlay')foul.probability=clamp(foul.probability*1.25,.02,.4);
  const challengeIntent=tackleIntent(defender,foul)*(intensity==='cautious'?.65:1);
  if(challengeIntent<1&&random(s,'decision')>challengeIntent){
    emit(match,'contain',defender,{text:`${defender.name}在禁区内保持压迫`,reason:'近身不等于必须出脚；结合抢断能力、身后接近和相对速度避免高风险争抢',contactDistance:distance(defender,carrier),challengeIntent});return;
  }
  const foulRoll=random(s,'execution');
  if(foulRoll<foul.probability){
    const severityRoll=random(s,'execution');
    penalizeFoul(match,defender,carrier,{...foul,roll:foulRoll,severityRoll},foulSanction(foul,severityRoll),s.time+STEP);return;
  }
  const probability=clamp(.32+(defender.attributes.tackling-carrier.attributes.decisions)/180-(carrier.attributes.dribbling-75)*.002+(defender.attributes.strength-carrier.attributes.strength)*.001,.12,.72);
  if(random(s,'execution')<probability) {
    s.stats[defender.side].tackles++;
    emit(match,'tackle',defender,{time:round(s.time+STEP),text:`${defender.name}近身夺回球权`,from:carrier.key,
      reason:'进入近身争夺范围后，结合抢断与持球判断进行对抗',contactDistance:distance(defender,carrier),probability});
    takeControl(match,defender,s.time+STEP,'tackle');
  }
}

function resolvePassiveExit(match,departed,cause,time){
  const s=match.state,result=applyPassiveExit(s,departed,cause);
  if(result.status==='ignored')return result;
  const incoming=playerByKey(s,result.incoming),outgoing=playerByKey(s,result.outgoing);
  if(result.status==='substituted')emit(match,'substitution',incoming,{time,text:`${incoming.name}替换${outgoing.name}${cause==='red'?'，接管门将职责':''}`,reason:cause==='red'?'门将被罚下，被动换下一名外场球员；场上仍少一人':'无法继续比赛，按位置匹配和体能选择可用替补',cause,departed:departed.key,outgoing:outgoing.key,used:s.stats[departed.side].substitutions});
  else if(result.status==='emergencyKeeper')emit(match,'emergencyKeeper',incoming,{time,text:`${incoming.name}临时担任门将`,reason:'没有可用的门将替补，由场上球员接管；不增加人数、不占换人名额',cause,failure:result.failure});
  else if(result.failure)emit(match,'replacementUnavailable',departed,{time,text:'本次伤退无法完成替补换人',reason:'没有满足名额、位置或体能要求的替补，暂时少一人',failure:result.failure});
  return result;
}
export function injurePlayer(match,player,{time=match.state.time,cause='contact'}={}){
  const s=match.state;
  if(!['restart','halftime'].includes(s.phase))throw new Error('伤退须先进入死球处理');
  if(!player?.active||player.injury)return {status:'ignored'};
  if(player.injuryImmune){emit(match,'traitActivated',player,{time,text:`${player.name}免于本次伤退`,reason:'已生效的伤病免疫特性'});return {status:'immune'};}
  const protector=activePlayers(s).find(p=>p.side===player.side&&p.key!==player.key&&p.injuryTransfer);
  if(protector){emit(match,'traitActivated',protector,{time,text:`${protector.name}承担队友的伤情`,reason:'已生效的团队伤情转移特性',protectedPlayer:player.key});player=protector;cause='traitTransfer';
    if(player.injuryImmune)return {status:'immune'};}
  player.active=false;player.status='injured';player.vx=0;player.vy=0;player.injury={time:round(time),cause,unableToContinue:true};s.stats[player.side].injuries++;
  emit(match,'injury',player,{time,text:`${player.name}受伤，无法继续比赛`,reason:'实际对抗后触发伤退，按被动换人规则处理',injury:structuredClone(player.injury)});
  const result=resolvePassiveExit(match,player,'injury',time);
  if(s.restart){s.restart.until+=45;s.restart.lossCause='injuryAndRestart';}
  if(activePlayers(s).filter(p=>p.side===player.side).length<7){s.phase='finished';s.abandoned=true;emit(match,'abandoned',null,{time,text:'人数不足，比赛终止',reason:'伤退后不足7人，不自动写入正式赛果'});}
  return result;
}
export function penalizeFoul(match,defender,carrier,profile,sanction,time=match.state.time) {
  const s=match.state;s.stats[defender.side].fouls++;
  if(defender.redCardImmune&&sanction.card==='red'){sanction={...sanction,card:'yellow',originalCard:'red'};emit(match,'traitActivated',defender,{time,text:`${defender.name}的红牌免疫生效`,reason:'既有游戏特性将本次直接红牌降为黄牌；此为特性规则例外'});}
  emit(match,'foul',defender,{time:round(time),text:`${defender.name}对${carrier.name}犯规`,reason:`近身争抢：${profile.behind?'从身后接近，':''}${sanction.severity==='careless'?'疏忽动作':sanction.severity==='reckless'?'鲁莽动作':'过度力量'}`,
    victim:carrier.key,foul:profile,sanction,position:{x:carrier.x,y:carrier.y}});
  if(sanction.card==='yellow'){defender.yellowCards++;s.stats[defender.side].yellowCards++;
    emit(match,'yellowCard',defender,{time:round(time),text:`${defender.name}被出示黄牌`,reason:profile.dogso?'禁区内试图争球但破坏明显进球机会':'鲁莽争抢',yellowCards:defender.yellowCards});}
  if(sanction.card==='yellow'&&defender.yellowCards>=2&&defender.redCardImmune)emit(match,'traitActivated',defender,{time,text:`${defender.name}累计黄牌后仍留场`,reason:'既有红牌免疫特性阻止两黄升级，黄牌统计保留'});
  if(sanction.card==='red'||defender.yellowCards>=2&&!defender.redCardImmune){
    defender.active=false;defender.status='sentOff';defender.vx=0;defender.vy=0;s.stats[defender.side].redCards++;
    emit(match,'redCard',defender,{time:round(time),text:`${defender.name}${defender.yellowCards>=2?'两黄变红':'被红牌罚下'}`,reason:profile.dogso?'破坏明显进球机会':'严重犯规或累计两张黄牌'});
    resolvePassiveExit(match,defender,'red',time);
  }
  const type=profile.penalty?'penalty':'directFreeKick';
  awardRestart(match,type,carrier.side,carrier,profile.penalty?'防守方在本方禁区内接触犯规':'接触犯规，原地直接任意球',time,defender.active===false?'red':sanction.card);
  const injuryChance=clamp(.003+Math.max(0,profile.speed-4)*.0015+(100-carrier.fitness)*.0001,0,.035);
  if(!carrier.injuryImmune&&random(s,'availability')<injuryChance)injurePlayer(match,carrier,{time});
  if(s.phase!=='finished'&&[0,1].some(side=>activePlayers(s).filter(p=>p.side===side).length<7)){s.phase='finished';s.abandoned=true;emit(match,'abandoned',null,{time:round(time),text:'人数不足，比赛终止',reason:'一方场上少于7人；不自动写入正式赛果'});}
  if(match.recording){const frame=snapshot(s);frame.time=round(time);frame.clock=clockSnapshot(s,time);match.frames.push(frame);}
}

function preparePenaltyKeeper(match,kickingSide){
  const s=match.state,keeper=s.players.find(p=>p.active&&p.side!==kickingSide&&p.role==='GK');if(!keeper)return;
  const roll=random(s,'decision'),sign=roll<.45?-1:roll<.9?1:0;
  keeper.penaltyDive={sign,until:s.time+1.5};keeper.vy=sign*.5;
  emit(match,'keeperCommitment',keeper,{text:`${keeper.name}准备扑救点球`,reason:'出球执行误差产生前选择扑救方向，之后仍须实际移动接触球',direction:sign});
}
function startShootout(match){
  const s=match.state;s.shootout=createShootout(s);s.phase='shootout';
  emit(match,'shootoutStart',null,{text:'进入点球大战',reason:'常规赛果与总比分仍平局，点球大战单独记录胜负',eligibleCount:s.shootout.eligible[0].length,firstSide:s.shootout.turn,goalX:s.shootout.goalX});
}
function beginShootoutAttempt(match){
  const s=match.state,shootout=s.shootout,side=shootout.turn,kicker=playerByKey(s,shootout.eligible[side][shootout.taken[side]%shootout.eligible[side].length]);
  const keeper=s.players.find(p=>p.side!==side&&p.active&&p.role==='GK');if(!kicker||!keeper)throw new Error('点球大战缺少合法主罚者或门将');
  shootout.current={side,kicker:kicker.key,keeper:keeper.key,startedAt:s.time,statsBefore:structuredClone(s.stats)};
  const {worldPoint}=coordinates(s);
  for(const [i,p] of activePlayers(s).entries()){p.vx=0;p.vy=0;p.control=null;p.nextTouch=s.time;p.nextDecision=s.time+100;Object.assign(p,{x:48+i%5*2,y:15+Math.floor(i/5)*7});}
  Object.assign(kicker,worldPoint({x:94,y:34},side));Object.assign(keeper,worldPoint({x:105,y:34},side));
  s.phase='playing';s.restartSerial++;s.rules={offside:null,restartTouch:null};s.coordination=[{},{}];s.pendingPenalty=null;hold(s,kicker);
  emit(match,'shootoutReady',kicker,{text:`${kicker.name}准备主罚点球`,reason:'双方交替主罚；所有合格球员轮完后才能再次主罚',attempt:shootout.taken[side]+1,shootoutScore:[...shootout.score]});
  const opportunity=shotOpportunity(s,kicker),choice={type:'shot',target:opportunity.target,utility:opportunity.utility,reason:'点球大战主罚，按实际射门、扑救与球路判定',opportunity:opportunity.evidence};
  preparePenaltyKeeper(match,side);
  release(match,kicker,choice,[choice],'penalty');s.rules.offside=null;record(match);
}
function finishShootoutAttempt(match,goal,time,reason){
  const s=match.state,current=s.shootout.current;if(!current)return;
  s.stats=structuredClone(current.statsBefore);
  const winner=recordShootoutKick(s.shootout,{side:current.side,kicker:current.kicker,goal,time,reason});
  s.ball={...s.ball,mode:'dead',holder:null,flight:null,vx:0,vy:0,vz:0,airborne:false,z:0};s.phase=winner===null?'shootout':'finished';
  for(const p of s.players){p.vx=0;p.vy=0;}
  emit(match,'shootoutResult',playerByKey(s,current.kicker),{time,text:goal?'本轮点球罚入':'本轮点球未罚入',reason,goal,shootoutScore:[...s.shootout.score],taken:[...s.shootout.taken]});
  if(winner!==null){s.result={winner,method:'penalties',aggregate:aggregateScore(s),shootout:[...s.shootout.score]};emit(match,'fulltime',null,{time,text:'点球大战结束',reason:'一方已提前获胜，或相同轮数的突然死亡决出胜负',winner,shootoutScore:[...s.shootout.score]});}
  if(match.recording){const frame=snapshot(s);frame.time=round(time);frame.clock=clockSnapshot(s,time);match.frames.push(frame);}
}
function finishPeriod(match){
  const s=match.state,c=s.clock,i=c.period-1;
  c.completed.push({period:c.period,elapsed:c.elapsed,announced:c.announced[i],added:c.added[i],lost:c.lost[i],inPlay:c.played[i],dead:c.dead[i],endedAt:s.time});
  s.restart=null;s.pendingPenalty=null;s.transition=null;s.coordination=[{},{}];s.rules={offside:null,restartTouch:null};
  s.ball={...s.ball,mode:'dead',holder:null,flight:null,vx:0,vy:0};
  const resolution=resolutionAfterPeriod(s);
  for(const p of s.players){p.vx=0;p.vy=0;if(p.active)p.task={type:'interval',target:{x:p.x,y:p.y},partners:[],reason:resolution.finish?'比赛结束':resolution.shootout?'准备点球大战':'阶段休息，等待下一半场'};}
  if(resolution.nextPeriod){
    s.phase='halftime';c.intervalRemaining=c.period===1?c.intervalLength:c.period===2?(s.input.duration===5400?300:2):(s.input.duration===5400?60:1);
    if(resolution.nextPeriod===3){c.extraEndsSwap=random(s,'competition')<.5?0:1;c.extraKickoffSide=random(s,'competition')<.5?0:1;}
    emit(match,'halfTime',null,{text:c.period===1?'上半场结束':c.period===2?'常规时间平局，准备加时赛':'加时赛上半场结束',reason:'本阶段及补时结束，按赛前锁定的赛事方案继续',periodResult:structuredClone(c.completed.at(-1))});
  }else if(resolution.shootout)startShootout(match);
  else {s.phase='finished';s.result={winner:resolution.winner,method:resolution.method,aggregate:aggregateScore(s)};emit(match,'fulltime',null,{text:'全场比赛结束',reason:'比赛及补时结束，按本场及此前总比分确定结果',winner:resolution.winner,periodResult:structuredClone(c.completed.at(-1))});}
  record(match);
}
function startSecondHalf(match){
  const s=match.state,c=s.clock,previousDirection=coordinates(s).direction(0);c.period++;c.elapsed=0;c.extendingPenalty=false;
  s.phase='playing';s.restartSerial++;
  const switched=previousDirection!==coordinates(s).direction(0),side=c.period===2?1:c.period===3?c.extraKickoffSide:1-c.extraKickoffSide;
  for(const p of s.players){if(switched){p.x=105-p.x;p.y=68-p.y;p.facing+=Math.PI;}p.vx=0;p.vy=0;p.task=null;if(c.period===2)p.fitness=Math.min(100,p.fitness+Math.min(2,c.intervalLength/450));}
  emit(match,'endsChanged',null,{text:`${c.period===2?'双方换边，下半场':c.period===3?'加时赛开始':'加时赛换边'}由${s.input.teams[side].name}开球`,reason:'按半场和加时赛掷币结果安排方向与开球，纪律和比分继续有效',attackDirections:[coordinates(s).direction(0),coordinates(s).direction(1)]});
  s.restart={type:'kickoff',side,spot:{x:52.5,y:34},reason:c.period===2?'下半场开球':'加时赛开球',until:s.time};beginRestart(match);
}
export function advanceMatch(match,steps=1) {
  if(!Number.isSafeInteger(steps)||steps<0||steps>100000)throw new Error('推进步数无效');
  const s=match.state;
  for(let i=0;i<steps&&s.phase!=='finished';i++) {
    if(s.phase==='halftime'&&s.clock.intervalRemaining<=0)startSecondHalf(match);
    if(s.phase==='shootout'&&s.shootout.active&&s.time>=s.shootout.nextAt)beginShootoutAttempt(match);
    if(s.phase!=='halftime')syncTacticalPlans(match);
    if(s.input.playerEffects)for(const effects of refreshPlayerEffects(s))emit(match,'playerEffectsChanged',null,{side:effects.side,text:'球员特性与在场羁绊更新',reason:'根据当前时间、比分、职责和在场名单计算，不叠加上一次加成',effects});
    if(s.phase==='restart') {
      if(s.time>=s.restart.until)beginRestart(match);
      else for(const p of s.players){p.vx=0;p.vy=0;}
    }
    const start=s.time,phase=s.phase;
    if(s.phase==='playing') {
      updateProgress(s);
      if(s.transition&&s.time>=s.transition.until){emit(match,'transitionEnd',null,{text:'攻守转换窗口结束',reason:'按当前球权进入常规组织或防守',transitionId:s.transition.id});s.transition=null;}
      const groups=planCoordination(s);
      for(const change of coordinationChanges(s.coordination,groups)){const {actor,...details}=change;emit(match,change.type,playerByKey(s,actor),details);}
      s.coordination=groups;
      const tasks=planTasks(s,groups);commitTasks(s,tasks);
      decide(match);
      const old=s.players.map(p=>({key:p.key,x:p.x,y:p.y}));
      movePlayers(s,tasks);
      for(const p of s.players){const before=old.find(q=>q.key===p.key);s.stats[p.side].distance+=distance(p,before);if(['press','counterPress'].includes(p.task.type))s.stats[p.side].pressSeconds+=STEP;}
      if(['flight','loose'].includes(s.ball.mode))ballStep(match,old);
      else if(s.ball.mode==='held')heldStep(match);
    }
    const inPlay=phase==='playing'?clamp((s.restart?.startedAt??start+STEP)-start,0,STEP):0;
    const r=s.restart,loss=r?Math.max(0,Math.min(start+STEP,r.until)-Math.max(start,r.lossStart??Infinity)):0;
    if(r)r.lossAccrued=round((r.lossAccrued??0)+loss);
    advanceClock(s,STEP,inPlay,loss,r?.lossCause);
    s.tick++;s.time=round(s.tick*STEP);
    if(s.phase!=='finished'&&!s.shootout&&s.clock.mode==='full'&&s.phase!=='halftime'){
      const allowance=announceAllowance(s.clock);
      if(allowance)emit(match,'addedTime',null,{text:`${['上半场','下半场','加时上半场','加时下半场'][s.clock.period-1]}至少补时${allowance.seconds/60}分钟`,reason:'按本半场已经发生的庆祝、判罚等额外损失时间计算；常规重启不全部补回',allowance});
      if(periodDue(s.clock)){
        if(s.pendingPenalty){if(!s.clock.extendingPenalty){s.clock.extendingPenalty=true;emit(match,'penaltyExtension',null,{text:'延长本半场，完成点球',reason:'点球须罚完；不是允许额外一次普通进攻'});}}
        else finishPeriod(match);
      }
    }else if(s.clock.mode==='clip'&&s.time>=s.input.duration){s.phase='finished';emit(match,'fulltime',null,{text:'演示片段结束',reason:'达到片段时长；未冒充完整比赛'});}
    assertWorld(s);
    const last=match.frames.at(-1);
    if(phase!=='halftime'&&(s.time-(last?.time??-Infinity)>=match.frameInterval-1e-7||s.phase==='finished'))record(match);
  }
  return match;
}

export function exportCheckpoint(match) {return JSON.stringify({format:'yffm-v4-checkpoint-1',...match});}
export function restoreCheckpoint(json) {
  const parsed=typeof json==='string'?JSON.parse(json):structuredClone(json);
  if(parsed.format!=='yffm-v4-checkpoint-1')throw new Error('未知V4检查点');
  if(parsed.state?.version!==VERSION)throw new Error('V4检查点引擎版本不匹配，须使用原版本恢复');
  const compiled=compileInput(parsed.state.input);
  if(seedState(JSON.stringify(compiled))!==parsed.state.inputFingerprint||JSON.stringify(compiled)!==JSON.stringify(parsed.state.input))throw new Error('V4 锁定配置损坏');
  parsed.state.input=freeze(compiled);assertWorld(parsed.state);
  if(!Array.isArray(parsed.events)||!Array.isArray(parsed.frames)||typeof parsed.recording!=='boolean'||!Number.isFinite(parsed.frameInterval)||parsed.frameInterval<STEP)throw new Error('V4记录损坏');
  const {format,...match}=parsed;return match;
}
export function simulateMatch(input,options) {
  const match=createMatch(input,options);
  while(match.state.phase!=='finished'){
    advanceMatch(match,250);
    if(match.state.time>input.duration*3+1800)throw new Error('V4 比赛未在合理时长内结束');
  }
  return match;
}
