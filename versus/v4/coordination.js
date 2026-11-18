import {distance,coordinates,playerByKey,clamp,round} from './world.js';
import {activePlayers} from './rules.js';
import {effectiveTactics} from './tactical-plan.js';
import {dutyFor} from './execution.js';

export const activeTransition = state => state.transition && state.time < state.transition.until ? state.transition : null;
export const possessionSide = state => playerByKey(state,state.ball.holder)?.side ?? state.ball.flight?.side ?? state.lastOwner;
const ranked = (players,point) => [...players].sort((a,b)=>distance(a,point)-distance(b,point)||a.key.localeCompare(b.key));
const retain = (old,candidates,point,until,now) => {
  const best=ranked(candidates,point)[0],previous=candidates.find(p=>p.key===old);
  return previous&&until>now&&distance(previous,point)<distance(best??previous,point)+7?previous:best;
};

// Pure group planning. The engine commits it once per step; both teams see the same world.
export function planCoordination(state) {
  const {localPoint,worldPoint}=coordinates(state);
  const owner=possessionSide(state),holder=playerByKey(state,state.ball.holder),transition=activeTransition(state);
  return [0,1].map(side=>{
    const own=activePlayers(state).filter(p=>p.side===side),outfield=own.filter(p=>p.role!=='GK');
    const opponents=activePlayers(state).filter(p=>p.side!==side),old=state.coordination?.[side]??{};
    const tactics=effectiveTactics(state,side),ball=localPoint(state.ball,side),attacking=owner===side;
    const excluded=new Set([holder?.key,state.ball.flight?.to].filter(Boolean));
    const midfield=outfield.filter(p=>['DM','CM'].includes(p.role)&&!excluded.has(p.key));
    let overlap=old.overlap?structuredClone(old.overlap):null;
    if(overlap&&(!own.some(p=>p.key===overlap.runner)||!own.some(p=>p.key===overlap.cover)))overlap=null;
    const dutyRunner=own.find(p=>dutyFor(state,p)==='overlappingFullback'&&p.role===(ball.y>34?'RB':'LB'));
    const flank=dutyRunner?dutyRunner.role==='RB'?'right':'left':tactics.route==='right'?'right':'left';
    const runner=own.find(p=>p.role===(flank==='right'?'RB':'LB')),candidateCover=own.find(p=>p.role==='DM'&&!excluded.has(p.key))
      ??ranked(midfield,state.ball)[0];
    const requested=(tactics.overlap||dutyRunner)&&dutyFor(state,runner??{})!=='holdingFullback'&&attacking&&state.ball.mode!=='loose'&&ball.x>35&&(flank==='right'?ball.y>34:ball.y<34);
    if(!overlap&&requested&&runner&&candidateCover&&runner.key!==holder?.key)overlap={runner:runner.key,cover:candidateCover.key,flank,phase:'outbound',since:state.time,lastWanted:state.time};
    if(overlap) {
      const r=playerByKey(state,overlap.runner),cover=playerByKey(state,overlap.cover);
      const sameFlank=(overlap.flank??'left')===flank;
      if(requested&&sameFlank)overlap.lastWanted=state.time;
      if(!attacking||state.time-overlap.lastWanted>2)overlap.phase='returning';
      else if(requested&&sameFlank)overlap.phase='outbound';
      if((!cover||excluded.has(cover.key))&&candidateCover)overlap.cover=candidateCover.key;
      // Cover is released only after the overlapping fullback physically gets back.
      const local=localPoint(r,side);
      if(overlap.phase==='returning'&&local.x<=r.anchor.x+5&&Math.abs(local.y-r.anchor.y)<10)overlap=null;
    }
    const reservedSupport=new Set(overlap?[overlap.runner,overlap.cover]:[]);
    const restCount=tactics.restDefense==='conservative'?4:tactics.restDefense==='adventurous'?2:3;
    const roleRank=p=>p.role==='CB'?0:p.role==='DM'?1:['LB','RB'].includes(p.role)?2:3;
    const restDefense=outfield.filter(p=>!excluded.has(p.key)&&p.key!==overlap?.runner).sort((a,b)=>roleRank(a)-roleRank(b)||a.anchor.x-b.anchor.x||a.key.localeCompare(b.key)).slice(0,restCount).map(p=>p.key);
    const supportPool=midfield.filter(p=>!reservedSupport.has(p.key)&&!restDefense.includes(p.key));
    if(supportPool.length<2)supportPool.push(...outfield.filter(p=>['LW','RW'].includes(p.role)&&!excluded.has(p.key)&&!reservedSupport.has(p.key)));
    const support1=retain(old.support?.[0],supportPool,state.ball,old.supportUntil,state.time);
    const support2=retain(old.support?.[1],supportPool.filter(p=>p.key!==support1?.key),state.ball,old.supportUntil,state.time);
    const support=[support1?.key,support2?.key].filter(Boolean);
    const supportUntil=JSON.stringify(support)===JSON.stringify(old.support)?old.supportUntil:state.time+1.4;

    const lost=transition?.from===side,won=transition?.to===side;
    const counterPress=lost&&transition.lossMode==='counterPress'&&state.time<transition.at+3;
    const regroup=lost&&!counterPress;
    const recentPass=state.lastPass?.side===owner&&state.time-state.lastPass.at<4?state.lastPass:null;
    const instructionTrigger=tactics.pressTrigger==='balanced'||tactics.pressTrigger==='wide'&&(ball.y<15||ball.y>53)||tactics.pressTrigger==='ownHalf'&&ball.x<52.5||tactics.pressTrigger==='backPass'&&recentPass?.backward;
    const trigger=!attacking&&state.ball.mode!=='loose'&&!regroup&&((instructionTrigger&&ball.x<40+tactics.press*58)||counterPress);
    const beaten=old.press?.presser&&holder?.side!==side&&holder&&localPoint(playerByKey(state,old.press.presser),side).x>ball.x+3?old.press.presser:null;
    const recoverers=[...new Set([...(old.recoverers??[]),beaten].filter(Boolean))].filter(key=>{const p=own.find(p=>p.key===key);return !attacking&&p&&localPoint(p,side).x>ball.x+1;});
    const reserved=new Set([...(overlap?[overlap.cover,overlap.runner]:[]),...recoverers]);
    let press=null;
    if(trigger) {
      const pool=outfield.filter(p=>!reserved.has(p.key));
      const near=pool.filter(p=>distance(p,state.ball)<(counterPress?16:28)*(1+(p.attributes.workRate-75)*.003));
      const preferred=near.filter(p=>p.role!=='CB'||dutyFor(state,p)==='stopper');
      const eager=preferred.filter(p=>['stopper','ballWinningMidfielder'].includes(dutyFor(state,p))&&distance(p,state.ball)<12);
      const presser=retain(old.press?.presser,eager.length?eager:preferred.length?preferred:near,state.ball,old.press?.until,state.time);
      if(presser) {
        const outlets=opponents.filter(p=>p.key!==holder?.key&&p.role!=='GK'&&distance(p,state.ball)>4&&distance(p,state.ball)<40);
        const outlet=outlets.sort((a,b)=>{
          const focus=p=>tactics.defensiveFocus==='striker'&&p.role==='ST'||tactics.defensiveFocus==='wide'&&['LW','RW','LB','RB'].includes(p.role)||tactics.defensiveFocus==='creator'&&['DM','CM'].includes(p.role);
          const score=p=> (['DM','CM'].includes(p.role)?12:0)+(focus(p)?20:0)-distance(p,state.ball)*.15;
          return score(b)-score(a)||a.key.localeCompare(b.key);
        })[0];
        const lane=outlet?{x:state.ball.x+(outlet.x-state.ball.x)*.48,y:state.ball.y+(outlet.y-state.ball.y)*.48}
          :worldPoint({x:clamp(ball.x-7,5,100),y:34},side);
        // The press group must not consume both centre-backs: their goal-side marking is the last line.
        const screen=retain(old.press?.screen,pool.filter(p=>p.role!=='CB'&&p.key!==presser.key),lane,old.press?.until,state.time);
        const cover=ranked(pool.filter(p=>p.role!=='CB'&&p.key!==presser.key&&p.key!==screen?.key),worldPoint({x:ball.x-12,y:34},side))[0];
        const same=old.press?.presser===presser.key&&old.press?.screen===screen?.key&&old.press?.outlet===(outlet?.key??null);
        press={presser:presser.key,screen:screen?.key??null,cover:cover?.key??null,outlet:outlet?.key??null,
          lane,until:same?old.press.until:state.time+1.2,counterPress,source:counterPress?'lossTransition':'defensiveBlock'};
      }
    }
    const landing={x:clamp(state.ball.x+state.ball.vx*.45,1,104),y:clamp(state.ball.y+state.ball.vy*.45,1,67)};
    // A loose ball must not pull the temporary fullback cover out of its responsibility.
    const chasers=ranked(own.filter(p=>!reserved.has(p.key)&&(p.role!=='GK'||localPoint(state.ball,side).x<17)),landing);
    return {side,owner,support,supportUntil,overlap,press,restDefense,recoverers,transition:lost?(counterPress?'counterPress':'regroup'):won?(tactics.counterAttack<.4?'retain':'counterAttack'):null,
      secondBall:state.ball.mode==='loose'?{primary:chasers[0]?.key,backup:chasers[1]?.key,landing}:null};
  });
}

export function changePossession(state,side,time,cause) {
  if(state.lastOwner===side)return null;
  const from=state.lastOwner;
  const nearby=activePlayers(state).filter(p=>p.side===from&&p.role!=='GK'&&distance(p,state.ball)<16);
  const tactics=effectiveTactics(state,from);
  const lossMode=tactics.lossReaction!=='regroup'&&(tactics.lossReaction==='counterPress'||tactics.press>=.7)&&nearby.length>=2?'counterPress':'regroup';
  const transition={id:++state.transitionSerial,from,to:side,at:round(time),until:round(time+5),lossMode,
    point:{x:state.ball.x,y:state.ball.y},cause};
  state.transition=transition;state.lastOwner=side;return transition;
}

export function coordinationChanges(previous,next) {
  const changes=[];
  for(let side=0;side<2;side++) {
    const before=previous?.[side]??{},after=next[side];
    const a=before.overlap,b=after.overlap;
    if(b&&(!a||a.phase!==b.phase||a.cover!==b.cover))changes.push({side,type:'overlapCoordination',actor:b.runner,partners:[b.cover],
      text:b.phase==='outbound'?'边卫套上，中场接管身后保护':'套上球员回追，中场继续守住空位',reason:b.phase==='outbound'?'前插与保护分配给不同球员':'补位职责持续到边卫实际回到防守位置'});
    if(a&&!b)changes.push({side,type:'coverReleased',actor:a.cover,partners:[a.runner],text:'边卫回位，解除临时补位',reason:'回位距离满足条件后才交还防守区域'});
    for(const key of after.recoverers??[])if(!(before.recoverers??[]).includes(key))changes.push({side,type:'pressBeaten',actor:key,text:'压迫被越过，先回到球门侧',reason:'持球者已越过施压球员，实际回追后才能重新上抢'});
    if(after.press&&(!before.press||after.press.presser!==before.press.presser||after.press.screen!==before.press.screen||after.press.outlet!==before.press.outlet))changes.push({side,type:'pressCoordination',actor:after.press.presser,
      partners:[after.press.screen,after.press.cover].filter(Boolean),targetPlayer:after.press.outlet,lineTarget:after.press.lane,
      text:after.press.counterPress?'丢球后就近反抢，队友封住接应线':'一人上抢，队友封线并保护身后',reason:'分配持球施压、实际传球线路与纵深保护，避免全员追球'});
  }
  return changes;
}
