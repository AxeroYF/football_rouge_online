import {random} from './world.js';
export function compileCompetition(input){
  const supplied=input.competition??{};
  if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!['resolution','aggregate'].includes(k)))throw new Error('赛事决胜配置无效');
  const resolution=supplied.resolution??'draw',aggregate=supplied.aggregate??[0,0];
  if(!['draw','penalties','extraTimeAndPenalties'].includes(resolution)||!Array.isArray(aggregate)||aggregate.length!==2||aggregate.some(n=>!Number.isSafeInteger(n)||n<0||n>1000))throw new Error('赛事决胜配置无效');
  if(resolution!=='draw'&&input.format!=='full')throw new Error('决胜流程需要完整比赛协议');
  input.competition={resolution,aggregate:[...aggregate]};
}
export const aggregateScore=s=>s.score.map((n,i)=>n+s.input.competition.aggregate[i]);
export function resolutionAfterPeriod(state){
  const period=state.clock.period,aggregate=aggregateScore(state),winner=aggregate[0]===aggregate[1]?null:aggregate[0]>aggregate[1]?0:1;
  if(period===1||period===3)return {nextPeriod:period+1};
  if(winner!==null||state.input.competition.resolution==='draw')return {finish:true,winner,method:period>2?'extraTime':'regulation'};
  if(period===2&&state.input.competition.resolution==='extraTimeAndPenalties')return {nextPeriod:3};
  return {shootout:true};
}
export function createShootout(state){
  const available=[0,1].map(side=>state.players.filter(p=>p.active&&p.side===side));
  const count=Math.min(...available.map(ps=>ps.length));
  // Reduce to equal eligible numbers, keep a goalkeeper, then rank the kicking
  // order. Every eligible player kicks before the cycle repeats.
  const eligible=available.map(ps=>ps.sort((a,b)=>Number(b.role==='GK')-Number(a.role==='GK')||b.attributes.finishing-a.attributes.finishing||a.key.localeCompare(b.key))
    .slice(0,count).sort((a,b)=>b.attributes.finishing-a.attributes.finishing||a.key.localeCompare(b.key)).map(p=>p.key));
  return {active:true,eligible,score:[0,0],taken:[0,0],kicks:[],turn:random(state,'competition')<.5?0:1,goalX:random(state,'competition')<.5?0:105,nextAt:state.time+10,current:null,winner:null};
}
export function recordShootoutKick(shootout,{side,kicker,goal,time,reason}){
  if(!shootout.active||side!==shootout.turn||kicker!==shootout.eligible[side][shootout.taken[side]%shootout.eligible[side].length])throw new Error('点球大战轮次无效');
  shootout.taken[side]++;if(goal)shootout.score[side]++;
  shootout.kicks.push({side,kicker,goal,time,reason});
  const [a,b]=shootout.score,[na,nb]=shootout.taken;
  let winner=null;
  if(na<=5&&nb<=5){if(a>b+5-nb)winner=0;else if(b>a+5-na)winner=1;}
  if(na>=5&&nb>=5&&na===nb&&a!==b)winner=a>b?0:1;
  shootout.current=null;shootout.turn=1-side;shootout.nextAt=time+8;shootout.winner=winner;
  if(winner!==null)shootout.active=false;
  return winner;
}
export function shootoutView(value){
  return value?{active:value.active,score:[...value.score],taken:[...value.taken],goalX:value.goalX,winner:value.winner,
    current:value.current?{side:value.current.side,kicker:value.current.kicker,keeper:value.current.keeper}:null}:null;
}
