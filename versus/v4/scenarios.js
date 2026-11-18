import {createMatch,awardRestart,injurePlayer,penalizeFoul} from './engine.js';
import {offsideSnapshot} from './rules.js';
import {demoInput} from './fixtures.js';
import {snapshot,playerByKey,seedState,worldPoint} from './world.js';
import {planCoordination,changePossession} from './coordination.js';
import {planTasks,commitTasks} from './tasks.js';
import {launchVertical} from './aerial.js';

export const SCENARIOS=Object.freeze({
  match:{name:'完整片段',description:'从开球观察双方战术'},
  periods:{name:'半场与换边',description:'按所选时长演示两个半场、换边和实际补时；缩短比赛的中场休息为6秒'},
  support:{name:'接应与封线',description:'从中场持球局面观察接应三角与对手封线'},
  overlapLoss:{name:'套上后丢球',description:'边卫尚未回位，观察中场保护与转换'},
  firstTouch:{name:'高速接球',description:'来球较快且接球队员受压，观察控制或失误'},
  parry:{name:'扑救与二点',description:'近距离射门，观察抱稳或脱手后的争夺'},
  secondBall:{name:'自由球竞速',description:'双方从不同位置争夺移动中的二点球'},
  offside:{name:'越位参与',description:'记录出球时的越位线，在实际参与时判罚'},
  foul:{name:'近身犯规',description:'身后争抢，观察犯规判定与随后的任意球'},
  freeKick:{name:'直接任意球',description:'观察距离约束、射门与防守'},
  corner:{name:'角球组织',description:'短角球重启，直接接球不判越位'},
  penalty:{name:'点球',description:'十一米主罚、门线守门与射后争夺'},
  shootingLane:{name:'射门线路',description:'前场存在射门窗口，比较球门角度与门将覆盖'},
  blockedFinish:{name:'受阻后回做',description:'同一前场持球点加入封堵，比较射门、回做与横传'},
  pressEscape:{name:'压迫被突破',description:'持球者已越过施压球员，观察回追与队友保护'},
  weakSide:{name:'寻找弱侧',description:'球侧形成压迫，观察对侧接应与线路比较'},
  cutback:{name:'边路倒三角',description:'边路进入前场，寻找中路已有接应点'},
  aerialCross:{name:'高球与争顶',description:'传中在接应点达到头部高度，球员必须实际进入可达范围'},
  postRebound:{name:'门柱与反弹',description:'高速球与门柱实际相交，反弹继续争夺，不预先指定进球'},
  highMiss:{name:'高出横梁',description:'球从门框上方越过门线，不能计为进球'},
  injuryExit:{name:'伤退与替补',description:'中场伤退后，按位置、体能与名额选择可用替补'},
  keeperDismissal:{name:'门将红牌',description:'被动换下一名外场球员、换上替补门将，仍少打一人'},
});

// Initial conditions only. Every subsequent choice/contact is resolved by the normal engine.
export function createScenario(id='match',options={}) {
  if(!Object.hasOwn(SCENARIOS,id))throw new Error('未知V4局部场景');
  const input=demoInput({...options,...(id==='periods'?{format:'full'}:{})});input.scenario=id;
  if(options.resolution&&options.resolution!=='draw')input.format='full';
  input.competition={resolution:options.resolution??'draw',aggregate:options.aggregate??[0,0]};
  if(['injuryExit','keeperDismissal'].includes(id))input.teams[0].bench=['GK','CM'].map((role,i)=>({...structuredClone(input.teams[0].players.find(p=>p.role===role)),id:`b${i}`,name:`蓝替补${i+1}号`,number:12+i,fitness:90}));
  for(const [side,prefix] of [[0,'home'],[1,'away']]){
    if(options[`${prefix}Instructions`])input.teams[side].instructions=structuredClone(options[`${prefix}Instructions`]);
    if(options[`${prefix}ScorePlans`])input.teams[side].scorePlans=structuredClone(options[`${prefix}ScorePlans`]);
  }
  if(id==='firstTouch')input.teams[0].players.find(p=>p.id==='p10').attributes.firstTouch=35;
  if(id==='parry')Object.assign(input.teams[1].players[0].attributes,{goalkeeping:45,reflexes:50});
  if(id==='foul')input.teams[1].players[3].attributes.tackling=20;
  const match=createMatch(input);if(['match','periods'].includes(id))return match;
  const s=match.state;
  // Local scenarios replace the opening kickoff; retain no hidden opening statistics or RNG draws.
  s.rules={offside:null,restartTouch:null};s.restart=null;s.phase='playing';s.restartSerial=0;
  for(const stats of s.stats)for(const key of Object.keys(stats))stats[key]=0;
  for(const [name,stream] of Object.entries(s.random)){stream.value=seedState(`${s.input.seed}:${name}`);stream.draws=0;}
  for(const p of s.players)Object.assign(p,worldPoint(p.anchor,p.side),{vx:0,vy:0,task:null,nextDecision:.6,nextTouch:0,nextTackle:0});
  s.coordination=[{},{}];
  const place=(key,x,y)=>Object.assign(playerByKey(s,key),{x,y,vx:0,vy:0,task:null,nextDecision:.6});
  const held=key=>{const p=playerByKey(s,key);s.ball={mode:'held',holder:key,x:p.x,y:p.y,z:0,vx:0,vy:0,flight:null};s.lastOwner=p.side;};
  const flight=(kind,from,to,target,speed)=>{const p=playerByKey(s,from),d=Math.hypot(target.x-p.x,target.y-p.y);
    s.ball={mode:'flight',holder:null,x:p.x,y:p.y,z:0,vx:(target.x-p.x)/d*speed,vy:(target.y-p.y)/d*speed,
      flight:{kind,side:p.side,from,to,start:{x:p.x,y:p.y},target,startedAt:0,endsAt:d/speed,decisionId:1}};s.lastOwner=p.side;s.rules.offside=offsideSnapshot(s,p);};
  if(['aerialCross','postRebound','highMiss'].includes(id)){
    for(const p of s.players)Object.assign(p,{x:20,y:4+p.number});
    if(id==='aerialCross'){
      place('0:p9',80,12);place('0:p10',94,34);place('1:p1',102,42);place('1:p3',98,60);
      const receive={x:94,y:34},travel=1.3,vertical=launchVertical(0,1.8,travel),landing=2*vertical.vz/9.81;
      flight('pass','0:p9','0:p10',receive,Math.hypot(14,22)/travel);
      Object.assign(s.ball,vertical);Object.assign(s.ball.flight,{target:{x:80+14*landing/travel,y:12+22*landing/travel},receivePoint:receive,endsAt:landing,trajectory:'loft'});
    }else{
      place('0:p10',100,id==='postRebound'?30.34:34);flight('shot','0:p10',null,{x:110,y:id==='postRebound'?30.34:34},30);
      if(id==='highMiss')Object.assign(s.ball,{z:3.2,vz:0,airborne:true});
    }
  }else if(id==='pressEscape'){
    place('0:p7',65,34);place('1:p7',60,34);place('1:p8',73,42);held('0:p7');
    s.coordination[1]={press:{presser:'1:p7',until:10},recoverers:[]};
  } else if(['weakSide','cutback'].includes(id)){
    for(const p of s.players.filter(p=>p.side===1))Object.assign(p,{x:45,y:34});
    place('0:p9',82,12);place('0:p11',82,58);place('0:p10',85,34);place('1:p1',101,34);
    if(id==='weakSide'){place('1:p2',82,14);place('1:p3',79,17);place('1:p4',78,10);}
    else {place('0:p9',90,12);place('1:p2',65,5);place('1:p3',63,6);place('1:p4',61,7);}
    held('0:p9');playerByKey(s,'0:p9').nextDecision=0;
  } else if(['shootingLane','blockedFinish'].includes(id)) {
    for(const p of s.players)Object.assign(p,{x:35,y:4+p.number,vx:0,vy:0,nextDecision:0});
    place('0:p10',95,34);place('0:p8',83,44);place('1:p1',100,42);
    if(id==='blockedFinish'){place('1:p2',95.9,34);place('1:p3',99,32.8);place('1:p4',99,34);place('1:p5',99,35.2);}
    held('0:p10');playerByKey(s,'0:p10').nextDecision=0;
  } else if(id==='support') {
    place('0:p7',52,28);place('0:p6',43,39);place('0:p8',56,40);place('1:p7',57,29);place('1:p8',49,38);held('0:p7');
  } else if(id==='overlapLoss') {
    place('0:p2',76,7);place('0:p6',51,18);place('0:p9',68,12);place('1:p8',66,15);
    s.coordination[0]={overlap:{runner:'0:p2',cover:'0:p6',phase:'outbound',since:0,lastWanted:0}};
    held('1:p8');s.lastOwner=0;changePossession(s,1,0,'scenarioTurnover');
  } else if(id==='firstTouch') {
    place('0:p7',65,34);place('0:p10',80,34);place('1:p3',83,37);place('1:p4',86,44);
    place('1:p6',84,52);
    flight('pass','0:p7','0:p10',{x:80,y:34},29);
  } else if(id==='parry') {
    place('0:p10',87,34);place('1:p1',100,34);place('1:p3',95,44);place('1:p4',94,24);place('0:p8',93,39);
    flight('shot','0:p10',null,{x:105,y:34},34);
  } else if(id==='secondBall') {
    place('0:p10',64,31);place('1:p3',72,38);place('0:p8',60,40);place('1:p6',75,27);
    s.ball={mode:'loose',holder:null,flight:null,x:67,y:34,z:0,vx:2,vy:1,lastTouch:'0:p9',
      contest:{id:++s.contestSerial,kind:'unclaimed',createdAt:0,originEventId:1,touches:0}};
  } else if(id==='offside') {
    place('0:p7',78,30);place('0:p10',90,30);place('1:p3',80,50);place('1:p4',78,15);
    flight('pass','0:p7','0:p10',{x:90,y:30},22);
  } else if(id==='foul') {
    place('0:p10',75,34);place('1:p4',74.5,34);held('0:p10');
    playerByKey(s,'0:p10').nextDecision=10;playerByKey(s,'1:p4').vx=8;
  }
  const groups=planCoordination(s);commitTasks(s,planTasks(s,groups));if(id!=='pressEscape')s.coordination=groups;
  s.nextEventId=2;match.events=[{id:1,time:0,tick:0,type:'scenario',actor:null,side:null,position:{x:s.ball.x,y:s.ball.y},score:[0,0],source:null,
    text:SCENARIOS[id].name,reason:SCENARIOS[id].description}];
  if(['freeKick','corner','penalty'].includes(id)){
    const type=id==='freeKick'?'directFreeKick':id;
    awardRestart(match,type,0,id==='corner'?{x:104.9,y:.1}:id==='penalty'?{x:94,y:34}:{x:80,y:28},SCENARIOS[id].description);
  }
  if(id==='injuryExit'){awardRestart(match,'directFreeKick',0,{x:60,y:34},'接触后伤退');injurePlayer(match,playerByKey(s,'0:p7'));}
  if(id==='keeperDismissal')penalizeFoul(match,playerByKey(s,'0:p1'),playerByKey(s,'1:p10'),{penalty:true,dogso:true,speed:0,behind:false},{card:'red',severity:'excessive'});
  match.frames=match.recording?[snapshot(s)]:[];
  return match;
}
