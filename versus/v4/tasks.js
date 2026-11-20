import {clamp,distance,coordinates,playerByKey,STEP} from './world.js';
import {planCoordination,activeTransition} from './coordination.js';
import {activePlayers,offsideSnapshot} from './rules.js';
import {shotOpportunity} from './opportunity.js';
import {effectiveTactics,tacticalMode} from './tactical-plan.js';
import {progressUrgency} from './tempo.js';
import {dutyFor,roleTask,passIntentBonus,shotIntentBonus} from './execution.js';
export const TASK_LABELS = Object.freeze({keeper:'守门保护',press:'上抢',screen:'封线保护',mark:'跟防',recover:'回撤',
  support:'回接',width:'拉开',run:'前插',overlap:'套上',hold:'留守',carry:'持球推进',receive:'接球',chase:'争夺自由球',
  coverOverlap:'套上补位',recoverOverlap:'套上回追',pressCover:'压迫保护',counterPress:'丢球反抢',outlet:'转换出口',secondSupport:'二点保护',dismissed:'已被罚下',sentOff:'已被罚下',bench:'替补待命',injured:'受伤离场',substituted:'已被替换',setPiece:'定位球',secure:'控制与观察',interval:'阶段休息',shootoutWait:'点球大战等待'});

// Both sides plan from the same pre-movement world. No movement is committed here.
export function planTasks(state,groups=planCoordination(state)) {
  const {localPoint,worldPoint}=coordinates(state);
  const holder=playerByKey(state,state.ball.holder);
  const owner=holder?.side ?? state.ball.flight?.side ?? state.lastOwner;
  const transition=activeTransition(state);
  const tasks=new Map();
  for (let side=0;side<2;side++) {
    const own=activePlayers(state).filter(p=>p.side===side), opponent=activePlayers(state).filter(p=>p.side!==side);
    const tactics=effectiveTactics(state,side), ball=localPoint(state.ball,side), attacking=side===owner;
    const group=groups[side];
    const marks=new Set();
    for (const p of own) {
      if(state.shootout?.current){
        const keeper=p.key===state.shootout.current.keeper;
        const target=keeper&&p.penaltyDive&&state.time<p.penaltyDive.until?{x:p.x,y:34+p.penaltyDive.sign*3}:keeper?worldPoint({x:clamp(ball.x*.09,0,3),y:clamp(34+(ball.y-34)*.4,30.4,37.6)},side):{x:p.x,y:p.y};
        tasks.set(p.key,{type:keeper?'keeper':'shootoutWait',target,reason:keeper?'点球大战守门，按已发出的球路移动':'点球大战等待；主罚者不能补射',partners:[]});continue;
      }
      let type='recover', target={...p.anchor}, reason='保持本方防守结构',partners=[],targetPlayer=null;
      if (p.role==='GK') {
        const depth=clamp(ball.x*.09,2.5,7);
        type='keeper';target={x:depth,y:clamp(34+(ball.y-34)*depth/Math.max(depth,ball.x),28,40)};
        reason='沿球与球门中心连线调整站位，保持球门覆盖';
        const flight=state.ball.flight,reaction=.08+(100-p.attributes.reflexes)*.0015;
        const velocity=state.ball.vx*coordinates(state).direction(side);
        if(flight?.kind==='shot'&&flight.side!==side&&state.time-flight.startedAt>=reaction&&velocity<-.1){
          const arrival=(depth-ball.x)/velocity;
          if(arrival>=0){const crossing=localPoint({x:state.ball.x+state.ball.vx*arrival,y:state.ball.y+state.ball.vy*arrival},side);target.y=clamp(crossing.y,28,40);reason='射门已离脚，经过反应时间后按可见球路移动扑救';}
        }
        if(p.penaltyDive&&state.time<p.penaltyDive.until){target=localPoint({x:p.x,y:34+p.penaltyDive.sign*3},side);reason='点球前已选择扑救方向，按实际移动拦截球路';}
      } else if (attacking) {
        target={x:clamp(p.anchor.x+(ball.x-45)*.48+6+(tactics.mentality-.5)*10,8,100),y:clamp(34+(p.anchor.y-34)*tactics.width,4,64)};
        type=group.restDefense.includes(p.key)?'hold':['LW','RW'].includes(p.role)?'width':'run';
        reason=type==='hold'?'保留中路反击保护':type==='width'?'拉开宽度，提供边路出口':'向前提供接应';
        if (type==='hold') target.x=Math.min(target.x,Math.max(20,ball.x-12));
        const wideEntry=ball.x>75&&(ball.y<22||ball.y>46),inside=ball.y<34?1:-1;
        if(wideEntry&&p.role==='ST'){
          type='run';target={x:clamp(ball.x-3,72,97),y:34-inside*3};
          reason='边路深入后回到球后中路接应倒三角，避免一直顶着越位线';
        }
        if(wideEntry&&(['LW','RW'].includes(p.role))&&(p.anchor.y-34)*(ball.y-34)<0){
          type='run';target={x:clamp(ball.x-5,70,95),y:34+inside*10};
          reason='远侧边锋进入后点，和中锋错开横向接应位置';
        }
        const supportIndex=group.support.indexOf(p.key);
        if (supportIndex>=0 && holder) {
          const nearSide=ball.y<34?1:-1;
          type='support';target={x:clamp(ball.x+(supportIndex===0?-8:8),12,92),y:clamp(ball.y+nearSide*(supportIndex===0?10:8),7,61)};
          reason=supportIndex===0?'在持球者斜后方接应，保留安全出球':'与回接队友错开角度，形成第二个接球点';partners=[holder.key,...group.support.filter(key=>key!==p.key)];
          if(wideEntry&&supportIndex===1){target={x:clamp(ball.x-10,65,90),y:34};reason='第二接应点留在中路球后，与门前接应错开纵深';}
          if(holder.role==='GK'){
            target={x:clamp(ball.x+(supportIndex===0?18:28),15,45),y:clamp(ball.y+(supportIndex===0?-12:12),8,60)};
            reason=supportIndex===0?'门将持球时回接到防线前，提供斜向短传出口':'与第一接应点错开纵深，连接门将出球与中场推进';
          }
        }
        if(group.transition==='counterAttack'&&['LW','RW','ST'].includes(p.role)) {
          type='outlet';target.x=clamp(Math.max(target.x,ball.x+18+(tactics.counterAttack-.5)*16),25,100);reason='刚夺回球权，提供向前转换出口';partners=[holder?.key].filter(Boolean);
        }
      } else {
        // Press intensity controls who engages; it must not drag the entire back line excessively forward.
        target={x:clamp(p.anchor.x-10+(ball.x-50)*.28+(tactics.lineHeight-.45)*30,7,85),y:clamp(34+(p.anchor.y-34)*(1-.36*tactics.compactness)+(ball.y-34)*.12,5,63)};
        if(tactics.defensiveWidth==='protectCenter')target.y=34+(target.y-34)*.8;
        if(tactics.defensiveWidth==='forceWide')target.y=clamp(34+(target.y-34)*1.15,4,64);
        if(tactics.lineStrategy==='drop')target.x=Math.max(4,target.x-4);
        if(tactics.lineStrategy==='offside'&&p.role==='CB')target.x=clamp(18+tactics.lineHeight*30+(ball.x-50)*.18,10,48);
        if(tactics.defenseDirection==='left')target.y=Math.max(4,target.y-3);if(tactics.defenseDirection==='right')target.y=Math.min(64,target.y+3);
        if(tactics.defenseDirection==='center')target.y=34+(target.y-34)*.85;
        if(group.transition==='regroup'){target.x=Math.min(target.x,p.anchor.x,ball.x-5);target.x=clamp(target.x,4,95);reason='丢球转换：先回到球门侧恢复结构';}
        if ((p.role==='CB'&&tactics.marking!=='zonal')||tactics.marking==='man'&&['DM','CM'].includes(p.role)) {
          const threat=opponent.filter(q=>q.role!=='GK'&&!marks.has(q.key)).sort((a,b)=>distance(a,p)-distance(b,p)||a.key.localeCompare(b.key))[0];
          if(threat){const q=localPoint(threat,side);
            if(q.x<(tactics.marking==='man'?50:35)){type='mark';target={x:clamp(q.x-(2+(75-p.attributes.marking)*.015),5,tactics.marking==='man'?49:34),y:clamp(q.y,6,62)};targetPlayer=threat.key;marks.add(threat.key);reason='分担不同进攻人，保持球门侧跟防';}
          }
        }
        const press=group.press;
        if(press?.presser===p.key){type=press.counterPress?'counterPress':'press';target=tactics.pressAssignment==='screen'&&!press.counterPress?{x:clamp(ball.x-3,2,103),y:ball.y}:ball;reason=press.counterPress?'丢球后短时就近反抢；其他人保留封线和保护':tactics.pressAssignment==='screen'?'保持球门侧距离，优先封锁出球方向':'一人接近持球点，避免多人重复上抢';partners=[press.screen,press.cover].filter(Boolean);}
        if(press?.screen===p.key){type='screen';target=localPoint(press.lane,side);targetPlayer=press.outlet;partners=[press.presser];reason='移动到持球者与实际接应人的传球线上';}
        if(press?.cover===p.key){type='pressCover';target={x:clamp(ball.x-12,5,90),y:clamp(34+(ball.y-34)*.3,10,58)};partners=[press.presser,press.screen].filter(Boolean);reason='保护上抢和封线队友身后的纵深';}
      }
      if(group.overlap&&p.role!=='GK') {
        const overlap=group.overlap;
        if(p.key===overlap.runner) {
          type=overlap.phase==='outbound'?'overlap':'recoverOverlap';partners=[overlap.cover];
          target=overlap.phase==='outbound'?{x:clamp(ball.x+14,40,97),y:overlap.flank==='right'?63:5}:{...p.anchor};
          reason=overlap.phase==='outbound'?`${overlap.flank==='right'?'右':'左'}侧套上：中场已分配身后保护`:'套上后丢球或转移，实际跑回原防守位置';
        }
        if(p.key===overlap.cover){type='coverOverlap';partners=[overlap.runner];target={x:clamp(ball.x-17,18,58),y:overlap.flank==='right'?50:18};reason=`保护${overlap.flank==='right'?'右':'左'}侧套上空位，直到边卫实际回位`;}
      }
      if(group.recoverers.includes(p.key)){type='recover';target={x:clamp(ball.x-6,4,95),y:clamp(ball.y*.55+p.anchor.y*.45,4,64)};reason='压迫已被突破，先实际回到球门侧再重新施压';}
      if(group.secondBall) {
        if(group.secondBall.primary===p.key){type='chase';target=localPoint(group.secondBall.landing,side);partners=[group.secondBall.backup].filter(Boolean);reason='按移动球的落点争夺二点，不预先指定赢家';}
        else if(group.secondBall.backup===p.key&&p.role!=='GK'){type='secondSupport';const landing=localPoint(group.secondBall.landing,side);target={x:clamp(landing.x-5,3,102),y:clamp(landing.y+(p.anchor.y<34?-5:5),3,65)};partners=[group.secondBall.primary];reason='第一人争球，第二人保护后方与下一落点';}
      }
      ({type,target,reason}=roleTask(state,p,{type,target,reason},ball,attacking));
      if(attacking&&p.role!=='GK'&&p.key!==holder?.key&&state.ball.mode==='held'){
        const line=offsideSnapshot(state,holder).line;
        target.x=Math.min(target.x,Math.max(50,line-.8));
      }
      if(p.key===holder?.key&&p.role!=='GK'){type='carry';target={x:clamp(ball.x+8,5,101),y:clamp(ball.y+(34-ball.y)*.16,4,64)};reason='持球向前，等待可用出球窗口';}
      if(p.key===holder?.key&&p.control&&state.time<p.control.until){type='secure';target=localPoint(p.control.target,side);reason='先控制来球并观察接应，受压时可提前出球';}
      if(state.ball.flight?.to===p.key){type='receive';target=localPoint(state.ball.flight.receivePoint??state.ball.flight.target,side);reason=state.ball.flight.trajectory==='loft'?'移动到已经发出的高球接应点，按实际高度争顶':'根据已经发出的球路移动接球';partners=[state.ball.flight.from];}
      tasks.set(p.key,{type,target:worldPoint(target,side),reason,source:state.input.teams[side].preset,plan:tacticalMode(state,side),partners,targetPlayer,
        transitionId:transition?.id??null});
    }
  }
  return tasks;
}

export function commitTasks(state,tasks) {
  for(const p of state.players){if(p.active===false){const labels={bench:'替补席等待',injured:'受伤离场',substituted:'已被替换',sentOff:'已被罚下'};p.task={type:p.status==='playing'?'dismissed':p.status??'dismissed',target:{x:p.x,y:p.y},reason:labels[p.status]??'不参与比赛',partners:[]};continue;}const task=tasks.get(p.key),same=p.task?.type===task.type&&p.task?.transitionId===task.transitionId;
    p.task={...task,since:same?p.task.since:state.time,until:same?p.task.until:state.time+.8};}
}

export function movePlayers(state, tasks) {
  commitTasks(state,tasks);
  const active=state.players.filter(p=>p.active!==false);
  const next=state.players.map(p=>{
    if(p.active===false)return {...p,vx:0,vy:0};
    // Group assignments own commitment; per-player stale tasks must not duplicate pressers or delay a turnover.
    const task=p.task;
    const dx=task.target.x-p.x,dy=task.target.y-p.y,d=Math.hypot(dx,dy);
    const response=task.type==='carry'?1+(p.attributes.dribbling-75)*.0015:
      ['run','support','width','overlap','outlet'].includes(task.type)?1+(p.attributes.offBall-75)*.0015:
      ['mark','screen','pressCover','recover','keeper'].includes(task.type)?1+(p.attributes.positioning-75)*.0015:1;
    const speed=(3.4+p.attributes.pace*.043)*(.65+.35*p.fitness/100)*(task.type==='carry'?.79:1)*response;
    const acceleration=(2+p.attributes.acceleration*.045)*(1+(p.attributes.agility-75)*.003);
    const approach=task.type==='receive'?Math.sqrt(2*acceleration*Math.max(0,d-.15)):Infinity;
    let vx=d>.15?dx/d*Math.min(speed,d/STEP,approach):0,vy=d>.15?dy/d*Math.min(speed,d/STEP,approach):0;
    // Local separation changes movement, not position by teleportation.
    for (const q of active) {
      if(q.key===p.key||q.active===false)continue;
      const gap=distance(p,q);
      if(gap<1.4&&gap>.001) {vx+=(p.x-q.x)/gap*(1.4-gap)*1.3;vy+=(p.y-q.y)/gap*(1.4-gap)*1.3;}
    }
    const magnitude=Math.hypot(vx,vy);if(magnitude>speed){vx*=speed/magnitude;vy*=speed/magnitude;}
    const change=Math.hypot(vx-p.vx,vy-p.vy),maxChange=acceleration*STEP;
    if(change>maxChange){vx=p.vx+(vx-p.vx)*maxChange/change;vy=p.vy+(vy-p.vy)*maxChange/change;}
    const x=clamp(p.x+vx*STEP,.3,104.7),y=clamp(p.y+vy*STEP,.3,67.7);
    vx=(x-p.x)/STEP;vy=(y-p.y)/STEP;
    const moving=Math.hypot(vx,vy),load=moving*STEP*(['press','counterPress'].includes(task.type)?.0025:.0014)*(1.25-p.attributes.stamina/200);
    const watchesBall=['keeper','receive','screen','mark'].includes(task.type);
    const facing=watchesBall?Math.atan2(state.ball.y-y,state.ball.x-x):moving>.05?Math.atan2(vy,vx):p.facing;
    return {...p,x,y,vx,vy,facing,fitness:p.fixedFitness??Math.max(0,p.fitness-load*(state.input.environment?.fatigue??1)),task};
  });
  state.players=next;
}

export function actionCandidates(state,carrier) {
  const {localPoint,worldPoint,direction}=coordinates(state);
  const tactics=effectiveTactics(state,carrier.side),local=localPoint(carrier,carrier.side);
  const opponents=activePlayers(state).filter(p=>p.side!==carrier.side),goal=worldPoint({x:105,y:34},carrier.side);
  const nearest=Math.min(...opponents.map(p=>distance(p,carrier)));
  const urgency=progressUrgency(state,carrier.side);
  const candidates=[{type:'carry',utility:carrier.role==='GK'?-5:1.2+Math.min(10,nearest)*.29*clamp((102-local.x)/12,.1,1)+urgency*clamp((nearest-3)/5,0,1),progressUrgency:urgency,
    reason:urgency>.1?'本轮控球尚未向前推进，有空间时争取推进；靠近底线降低继续带球收益':'比较可用推进空间，接近底线时继续带球的收益下降'}];
  const offside=offsideSnapshot(state,carrier);
  for(const receiver of activePlayers(state).filter(p=>p.side===carrier.side&&p.key!==carrier.key)) {
    const d=distance(carrier,receiver);
    const receiverLocal=localPoint(receiver,carrier.side),weakSide=local.y<24&&receiverLocal.y>42||local.y>44&&receiverLocal.y<26;
    if(d<4||d>(weakSide?56:46)+(carrier.attributes.vision-75)*.12)continue;
    // Solve the moving-target intercept: a receiver running towards the passer
    // shortens the flight, while one running away lengthens it. Using d/s alone
    // overleads a fast approaching receiver beyond the reachable arrival point.
    const passSpeed=22+carrier.attributes.passing*.035;
    const rx=receiver.x-carrier.x,ry=receiver.y-carrier.y;
    const a=receiver.vx**2+receiver.vy**2-passSpeed**2,b=2*(rx*receiver.vx+ry*receiver.vy);
    const leadSeconds=clamp(2*d*d/(Math.sqrt(b*b-4*a*d*d)-b),0,2.5);
    const target={x:clamp(receiver.x+receiver.vx*leadSeconds,.5,104.5),y:clamp(receiver.y+receiver.vy*leadSeconds,.5,67.5)};
    const delta=(target.x-carrier.x)*direction(carrier.side);
    let margin=9,blockedNow=0;
    for(const defender of opponents) {
      const dx=target.x-carrier.x,dy=target.y-carrier.y;
      const lengthSquared=dx*dx+dy*dy;
      const u=clamp(((defender.x-carrier.x)*dx+(defender.y-carrier.y)*dy)/lengthSquared,0,1);
      const crossing={x:carrier.x+dx*u,y:carrier.y+dy*u};
      const gap=distance(defender,crossing),arrival=gap/(3.4+defender.attributes.pace*.043);
      if(u>0&&u<1&&gap<.9)blockedNow++;
      margin=Math.min(margin,arrival-(Math.sqrt(lengthSquared)*u/(22+carrier.attributes.passing*.035)));
    }
    const open=Math.min(...opponents.map(p=>distance(p,target)));
    const targetLocal=localPoint(target,carrier.side);
    const preferred=tactics.route==='left'&&targetLocal.y<28||tactics.route==='right'&&targetLocal.y>40;
    const transition=activeTransition(state),counterBonus=transition?.to===carrier.side&&delta>5?.35*tactics.directness:0;
    const switchBonus=weakSide&&opponents.filter(p=>distance(p,carrier)<16).length>=3?clamp((open-nearest)*.09,0,.65):0;
    const cutback=local.x>75&&(local.y<22||local.y>46)&&targetLocal.x>78&&Math.abs(targetLocal.y-34)<12&&delta<6;
    const cutbackBonus=cutback?.7*clamp(open/8,0,1)*clamp(margin+.2,0,1):0;
    const tacticalBias=passIntentBonus(tactics,carrier,receiver,targetLocal,local,nearest,dutyFor(state,carrier));
    const utility=1.15+delta*(.018+tactics.directness*.012)+Math.min(open,10)*.115+clamp(margin,-2,2)*1.1+counterBonus+switchBonus+cutbackBonus+urgency*clamp(delta/10,0,1)
      -(offside.candidates.includes(receiver.key)?5:0)
      +tacticalBias+(receiver.task?.type==='overlap'?.25:0)-(d>32?.3:0)-blockedNow*.8;
    const intent=cutbackBonus>0?'cutback':switchBonus>0?'switch':delta< -3?'layoff':Math.abs(delta)<=3?'square':'forward';
    candidates.push({type:'pass',to:receiver.key,target,utility,margin,leadSeconds,intent,tacticalBias,onside:!offside.candidates.includes(receiver.key),reason:cutbackBonus?'边路进入前场，寻找中路已有接应点的地面倒三角':switchBonus?'球侧受压且对侧接应更空，比较弱侧转移线路':counterBonus?'夺回球权后的向前出口，仍需比较封线风险':preferred?'按预设侧组织，结合线路与接应空间':intent==='layoff'?'回做给身后接应点，保留重新组织机会':intent==='square'?'横向转移到另一个接球角度':'比较向前收益、线路到达时间和接应空间'});
  }
  const goalDistance=distance(carrier,goal);
  if(local.x>72 && goalDistance<33){const shot=shotOpportunity(state,carrier),tacticalBias=shotIntentBonus(tactics,goalDistance,dutyFor(state,carrier));candidates.push({type:'shot',target:shot.target,utility:shot.utility+tacticalBias,tacticalBias,reason:shot.reason,opportunity:shot.evidence});}
  if(local.x>60&&(local.y<22||local.y>46))for(const ground of candidates.filter(c=>c.type==='pass')){
    const receiver=playerByKey(state,ground.to),at=localPoint(receiver,carrier.side),d=distance(carrier,receiver);
    if(at.x<75||Math.abs(at.y-34)>17||d<14||d>46)continue;
    const aerialSpace=Math.min(...opponents.map(p=>distance(p,receiver)));
    const utility=ground.utility-Math.max(0,-ground.margin)*.1-.45+clamp(-ground.margin,0,2)*.9+(receiver.attributes.heading-65)*.008-Math.max(0,4-aerialSpace)*.08+(tactics.crossing==='increase'?.4:tactics.crossing==='reduce'?-.6:0);
    candidates.push({...ground,trajectory:'loft',intent:'cross',utility,reason:'边路比较高球传中：越过地面封线，接应者仍须实际到达落点并争顶'});
  }
  return candidates.sort((a,b)=>b.utility-a.utility||String(a.to??a.type).localeCompare(String(b.to??b.type))||String(a.trajectory??'ground').localeCompare(String(b.trajectory??'ground')));
}
