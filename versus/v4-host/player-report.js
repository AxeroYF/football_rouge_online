import {createHash} from 'node:crypto';
import {analyzeElevenBoardFormation} from '../public/formation-rules.js';
import {STEP,round} from '../v4/world.js';
import {createMatchMetrics,METRIC_DEFINITIONS} from './match-metrics.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields=['passes','completed','shots','shotsOnTarget','goals','ownGoals','assists','saves','parries','tackles','interceptions','clearances','blocks','pressuresWon','penaltiesWon','fouls','yellowCards','redCards','headers','crosses','miscontrols','secondBalls'];
const fresh=()=>Object.fromEntries(fields.map(name=>[name,0]));
const copy=value=>structuredClone(value);
const position=p=>({x:p.anchor.y/68*100,y:(1-p.anchor.x/105)*100});

// Match the established league adapter's event-based rating scale, rather than
// importing its simulator or inventing ratings from player overall ability.
export function legacyScaleRating(stats){
  const defensive=stats.tackles*.08+stats.interceptions*.09+stats.clearances*.055+stats.blocks*.12+stats.pressuresWon*.035;
  return Number(Math.max(4,Math.min(10,6.5+stats.goals*.8+stats.assists*.5+stats.saves*.12+defensive-stats.redCards*1.5)).toFixed(1));
}

export function createPlayerReportLedger(input,engineVersion,saved=null){
  const fingerprint=digest({engineVersion,input});
  const roster=input.teams.flatMap((team,side)=>[...team.players,...team.bench].map(p=>({key:`${side}:${p.id}`,id:p.id,side})));
  const identities=new Map(roster.map(p=>[p.key,p]));
  const ledger=saved?copy(saved):{format:'v4-player-report-ledger-1',fingerprint,cursor:0,shootout:false,periodGoals:Array.from({length:4},()=>[0,0]),players:Object.fromEntries(roster.map(p=>[p.key,fresh()])),actions:[],lastPass:[null,null],lastTransition:null,importantEvents:[]};
  if(ledger.format!=='v4-player-report-ledger-1'||ledger.fingerprint!==fingerprint||!Number.isSafeInteger(ledger.cursor)||ledger.cursor<0||roster.some(p=>!ledger.players[p.key])||Object.keys(ledger.players).length!==roster.length)throw new Error('球员战报检查点与锁定输入不一致');
  if(Object.values(ledger.players).some(s=>fields.some(name=>!Number.isSafeInteger(s[name])||s[name]<0))||!Array.isArray(ledger.actions)||ledger.actions.length>256||!Array.isArray(ledger.importantEvents)||ledger.importantEvents.length>2048)throw new Error('球员战报检查点内容无效');
  if(!Array.isArray(ledger.periodGoals)||ledger.periodGoals.length!==4||ledger.periodGoals.some(score=>!Array.isArray(score)||score.length!==2||score.some(n=>!Number.isSafeInteger(n)||n<0)))throw new Error('球员战报阶段比分无效');
  const actions=new Map(ledger.actions.map(a=>[a.id,a]));
  const metrics=createMatchMetrics(ledger.metrics);
  const stats=key=>ledger.players[key],identity=key=>identities.get(key);
  function add(key,name,value=1){if(!stats(key))throw new Error('战报事件球员不在比赛名单');stats(key)[name]+=value;}
  function onTarget(action){if(action?.type==='shot'&&!action.onTarget){add(action.actor,'shotsOnTarget');action.onTarget=true;}}
  function important(event,type=event.type,extra={}){
    if(ledger.importantEvents.length>=2048)throw new Error('关键战报事件超过上限');
    ledger.importantEvents.push({id:`v4-${event.id}`,minute:Number(((event.clock.baseSeconds+event.clock.elapsed)/60).toFixed(2)),type,teamIndex:event.side,
      actorId:identity(event.actor)?.id??null,text:event.text??type,importance:'major',...extra});
  }
  return {
    get cursor(){return ledger.cursor;},
    consume(events){
      for(const event of events){
        if(event.id!==ledger.cursor+1)throw new Error('球员战报事件重复或缺失');ledger.cursor=event.id;
        metrics.consume([event]);
        if(event.type==='shootoutStart')ledger.shootout=true;
        if(ledger.shootout)continue; // Shootout contacts do not become regular saves/goals.
        const actor=identity(event.actor),source=actions.get(event.decisionId);
        if(actor&&event.bodyPart==='head'){
          add(event.actor,'headers');
          // A loose aerial rebound can retain the original decisionId. Only a
          // header whose incoming flight still names that passer completes or
          // intercepts the pass; a second-ball header has from:null.
          if(source?.type==='pass'&&event.from===source.actor){
            if(source.side===actor.side){add(source.actor,'completed');ledger.lastPass[actor.side]={from:source.actor,to:event.actor,at:event.time};}
            else {add(event.actor,'interceptions');ledger.lastPass=[null,null];}
          }
        }
        if(['pass','shot'].includes(event.type)){
          add(event.actor,event.type==='pass'?'passes':'shots');
          if(event.intent==='cross')add(event.actor,'crosses');if(event.intent==='clearance')add(event.actor,'clearances');
          const pass=ledger.lastPass[event.side],assist=pass?.to===event.actor&&pass.from!==event.actor&&event.time-pass.at<=10?pass.from:null;
          actions.set(event.id,{id:event.id,type:event.type,side:event.side,actor:event.actor,at:event.time,assist,
            aimInside:Math.abs(event.target.y-34)<=3.66&&(event.target.z??0)<=2.44,onTarget:false});
          if(event.type==='pass')ledger.lastPass[event.side]=null;
        }
        if(event.type==='receive'&&source?.type==='pass'&&actor?.side===source.side){add(source.actor,'completed');ledger.lastPass[actor.side]={from:source.actor,to:event.actor,at:event.time};}
        const count={tackle:'tackles',interception:'interceptions',save:'saves',block:'blocks',deflection:'blocks',foul:'fouls',yellowCard:'yellowCards',redCard:'redCards',miscontrol:'miscontrols',secondBall:'secondBalls'}[event.type];
        if(count)add(event.actor,count);
        if(event.type==='parry'){add(event.actor,'saves');add(event.actor,'parries');}
        if(['save','parry'].includes(event.type)&&source?.aimInside)onTarget(source);
        if(['interception','tackle','save','parry','block','deflection','miscontrol','secondBall','stoppage','halfTime'].includes(event.type))ledger.lastPass=[null,null];
        if(['save','parry','block','deflection','miscontrol','secondBall'].includes(event.type)&&source)source.assist=null;
        if(event.type==='transition'){
          const old=ledger.lastTransition;
          // prototype.8 tests tackles at raw step-start + STEP, while contact
          // controls use their rounded contact time. The published event time
          // rounds both: at exactly three seconds it can erase a floating-point
          // boundary that the locked engine used. Reconstruct that same tackle
          // clock from its tick; never change the frozen engine or its totals.
          if(event.transition?.cause==='tackle'&&(!Number.isSafeInteger(event.tick)||event.tick<0))throw new Error('抢断转换缺少原始步号');
          const controlledAt=event.transition?.cause==='tackle'?round(event.tick*STEP)+STEP:event.time;
          if(old?.from===event.side&&old.lossMode==='counterPress'&&controlledAt<=old.at+3)add(event.actor,'pressuresWon');
          ledger.lastTransition=copy(event.transition);
        }
        if(event.type==='transitionEnd'||event.type==='stoppage'||event.type==='halfTime')ledger.lastTransition=null;
        if(event.type==='goal'){
          if(![1,2,3,4].includes(event.clock.period)||![0,1].includes(event.scoringSide))throw new Error('进球阶段或得分方无效');
          ledger.periodGoals[event.clock.period-1][event.scoringSide]++;
          if(event.ownGoal)add(event.actor,'ownGoals');else {add(event.actor,'goals');onTarget(source);if(source?.assist)add(source.assist,'assists');}
          important(event,'goal',{teamIndex:event.scoringSide,ownGoal:Boolean(event.ownGoal),assistId:!event.ownGoal?identity(source?.assist)?.id??null:null});ledger.lastPass=[null,null];
        }
        if(event.type==='foul'&&event.foul.penalty){add(event.victim,'penaltiesWon');important(event,'penaltyAwarded',{opponentId:identity(event.victim)?.id});}
        if(event.type==='yellowCard'||event.type==='redCard')important(event,event.type==='yellowCard'?'yellow':'red');
        if(event.type==='injury'||event.type==='substitution')important(event,event.type,{outgoingId:identity(event.outgoing)?.id??null});
        for(const [id,action] of actions)if(event.time-action.at>30)actions.delete(id);
        if(actions.size>256)throw new Error('球员战报因果缓存超过上限');
      }
    },
    checkpoint(){return copy({...ledger,metrics:metrics.checkpoint(),actions:[...actions.values()]});},
    finish(state){
      if(state.phase!=='finished'||state.abandoned||state.clock.mode!=='full'||state.version!==engineVersion||digest({engineVersion,input:state.input})!==fingerprint||state.nextEventId-1!==ledger.cursor)throw new Error('战报尚未完整或比赛不可正常结算');
      const teams=input.teams.map((team,side)=>{
        const played=state.players.filter(p=>p.side===side&&p.status!=='bench'),positions=Object.fromEntries(played.map(p=>[p.id,position(p)]));
        const players=played.map(p=>{const s=copy(stats(p.key));return {id:p.id,name:p.name,role:p.sourceRole??p.role,assignedRole:p.sourceRole??p.role,secondaryRole:p.secondaryRole,overall:p.overall,
          position:positions[p.id],fitness:Number(p.fitness.toFixed(1)),active:p.active,sentOff:p.status==='sentOff',injury:copy(p.injury??null),captain:p.id===team.captainId,
          startedMatch:team.players.some(q=>q.id===p.id),enteredAsSubstitute:Number.isFinite(p.enteredAt),substitutedOut:['substituted','injured'].includes(p.status),substitutedForId:identity(p.substitutedFor)?.id??null,
          rating:legacyScaleRating(s),stats:s,traits:(p.traitDefinitions??[]).map(t=>({id:t.id,name:t.name}))};});
        const sum=name=>players.reduce((n,p)=>n+p.stats[name],0);
        for(const name of ['passes','completed','shots','interceptions','tackles','fouls','yellowCards','redCards','headers','crosses','secondBalls'])if(sum(name)!==state.stats[side][name])throw new Error(`球员统计与球队统计不一致：${side}/${name}`);
        if(sum('pressuresWon')!==state.stats[side].counterPressRecoveries)throw new Error('球员反抢统计与球队统计不一致');
        const opponentOwnGoals=state.players.filter(p=>p.side!==side).reduce((n,p)=>n+stats(p.key).ownGoals,0);
        if(sum('goals')+opponentOwnGoals!==state.score[side])throw new Error('球员进球与球队比分不一致');
        return {id:team.id,name:team.name,captainId:team.captainId??null,formation:analyzeElevenBoardFormation(players.filter(p=>p.active),positions).name,positions,players,
          stats:{...copy(state.stats[side]),...metrics.view(state.time).stats[side],passes:state.stats[side].passes,completed:state.stats[side].completed,goals:state.score[side],saves:sum('saves'),shotsOnTarget:sum('shotsOnTarget'),clearances:sum('clearances'),blocks:sum('blocks'),pressuresWon:sum('pressuresWon')}};
      });
      const possessionTotal=teams.reduce((n,t)=>n+t.stats.possession,0);
      for(const team of teams){team.stats.possessionSeconds=team.stats.possession;team.stats.possession=possessionTotal?Number((team.stats.possession/possessionTotal*100).toFixed(1)):null;}
      const periodScore=count=>[0,1].map(side=>ledger.periodGoals.slice(0,count).reduce((n,score)=>n+score[side],0));
      if(periodScore(4).some((n,side)=>n!==state.score[side]))throw new Error('阶段比分与完场比分不一致');
      return {schema:'v4-legacy-player-report-1',engineVersion,engineProfile:'v4-spatial',fixtureId:input.fixtureId??null,inputFingerprint:fingerprint,
        score:[...state.score],penalties:state.shootout?[...state.shootout.score]:null,winnerIndex:state.result?.winner??null,teams,importantEvents:[...metrics.view().events.map(e=>({...e,...ledger.importantEvents.find(row=>row.id===e.id)})),...ledger.importantEvents.filter(e=>!metrics.view().events.some(row=>row.id===e.id))].sort((a,b)=>a.minute-b.minute),
        halfTimeScore:periodScore(1),regulationScore:periodScore(2),extraTimeScore:state.clock.completed.length===4?ledger.periodGoals[2].map((n,side)=>n+ledger.periodGoals[3][side]):null,
        aggregateBaseScore:copy(input.competition.aggregate),aggregateScore:copy(state.result?.aggregate??null),
        extraTimePlayed:state.clock.completed.length===4,penaltyShootout:copy(state.shootout),settlementAllowed:false,
        metricDefinitions:{...METRIC_DEFINITIONS,assists:'Last completed teammate pass, at most ten football seconds before the first shot; deflections, saves, loose recovery and restarts clear eligibility.',pressuresWon:'Actual counterpress recoveries within the engine three-second transition window.'}};
    }
  };
}
