import {clamp} from './world.js';
export const DUTIES=['advancedForward','targetForward','deepLyingForward','bylineWinger','insideForward','advancedPlaymaker','shadowStriker','anchor','ballWinningMidfielder','deepLyingPlaymaker','wideMidfielder','invertedWideMidfielder','defensiveWideMidfielder','holdingFullback','overlappingFullback','invertedFullback','ballPlayingDefender','stopper','coverDefender'];
export function dutyFor(state,player){
  const plans=player.dutyPlans,mode=state.activePlans[player.side];
  return plans && Object.hasOwn(plans,mode) ? plans[mode] : plans?.normal??null;
}
export const positionExecution=p=>.82+.18*(p.utilityPlayer||p.effectPositionRoles?.includes(p.sourceRole??p.role)?1:p.positionFitByRole?.[p.sourceRole??p.role]??1);
export function roleTask(state,p,task,ball,attacking){
  const duty=dutyFor(state,p);if(!duty||['keeper','press','counterPress','screen','pressCover','coverOverlap','recoverOverlap','overlap','chase','secondSupport','carry','secure','receive'].includes(task.type))return task;
  const result={...task,target:{...task.target}},at=result.target;
  if(task.type==='hold'&&!['anchor','holdingFullback','invertedFullback','coverDefender'].includes(duty))return task;
  if(attacking){
    if(duty==='advancedForward')at.x+=4;
    if(duty==='targetForward'){at.x-=4;at.y=34;}
    if(duty==='deepLyingForward'){at.x-=9;result.type='support';}
    if(duty==='bylineWinger'){at.x+=3;at.y=p.anchor.y<34?7:61;}
    if(duty==='insideForward')at.y=34+(at.y-34)*.45;
    if(duty==='advancedPlaymaker'){at.x-=5;result.type='support';}
    if(duty==='shadowStriker'){at.x+=7;at.y=34+(at.y-34)*.4;}
    if(duty==='anchor'){at.x=Math.min(at.x,p.anchor.x,ball.x-12);result.type='hold';}
    if(duty==='deepLyingPlaymaker'){at.x-=6;result.type='support';}
    if(duty==='invertedWideMidfielder')at.y=34+(at.y-34)*.4;
    if(duty==='wideMidfielder'){at.y=p.anchor.y<34?12:56;result.type='width';}
    if(duty==='defensiveWideMidfielder')at.x=Math.min(at.x,p.anchor.x+4);
    if(duty==='holdingFullback'){at.x=Math.min(at.x,p.anchor.x+2);result.type='hold';}
    if(duty==='invertedFullback'){at.y=34+(at.y-34)*.35;at.x=Math.min(at.x,ball.x-8);result.type='hold';}
  }else if(duty==='coverDefender')at.x-=5;
  else if(duty==='defensiveWideMidfielder')at.x-=4;
  at.x=clamp(at.x,4,100);at.y=clamp(at.y,4,64);result.reason+=`；执行职责 ${duty}`;return result;
}
export function passIntentBonus(tactics,carrier,receiver,targetLocal,carrierLocal,nearest,duty){
  const route=carrierLocal.x<55&&tactics.buildUpRoute!=='balanced'?tactics.buildUpRoute:tactics.route;
  const preferred=route==='left'&&targetLocal.y<28||route==='right'&&targetLocal.y>40||route==='center'&&Math.abs(targetLocal.y-34)<10||route==='leftHalf'&&targetLocal.y>=17&&targetLocal.y<30||route==='rightHalf'&&targetLocal.y>38&&targetLocal.y<=51;
  let bonus=preferred&&targetLocal.x>carrierLocal.x?.25:0;
  if(carrierLocal.x<65&&(tactics.buildUpOutlet==='pivot'&&receiver.role==='DM'||tactics.buildUpOutlet==='target'&&receiver.role==='ST'))bonus+=.3;
  if(nearest<5&&tactics.pressureEscape==='direct'&&targetLocal.x>carrierLocal.x+12)bonus+=.4;
  if(nearest<5&&tactics.pressureEscape==='switch'&&(targetLocal.y-34)*(carrierLocal.y-34)<0&&Math.abs(targetLocal.y-carrierLocal.y)>22)bonus+=.4;
  if(['deepLyingForward','advancedPlaymaker','deepLyingPlaymaker','ballPlayingDefender'].includes(duty))bonus+=.15;
  return bonus;
}
export function shotIntentBonus(tactics,distance,duty){
  return (tactics.chanceCreation==='patient'?-.35:tactics.chanceCreation==='shootOnSight'?.3:0)
    +(distance>22?(tactics.longShots==='reduce'?-.55:tactics.longShots==='increase'?.35:0):0)
    +(['insideForward','shadowStriker','advancedForward'].includes(duty)?.15:['deepLyingForward','advancedPlaymaker'].includes(duty)?-.3:0);
}
