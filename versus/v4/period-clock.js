import {round} from './world.js';

export function createClock(input){
  const lengths=input.format==='full'?[input.duration/2,input.duration/2]:[input.duration];
  if(input.competition?.resolution==='extraTimeAndPenalties')lengths.push(input.duration/6,input.duration/6);
  const count=Math.max(2,lengths.length),zeros=()=>Array(count).fill(0);
  return {mode:input.format,period:1,halfLength:input.format==='full'?input.duration/2:input.duration,elapsed:0,
    periodLengths:lengths,extraEndsSwap:0,extraKickoffSide:0,
    intervalLength:input.duration===5400?900:6,intervalRemaining:0,
    lost:zeros(),announced:Array(count).fill(null),added:zeros(),played:zeros(),dead:zeros(),lostByCause:Array.from({length:count},()=>({})),
    completed:[],extendingPenalty:false};
}
export function advanceClock(state,dt,inPlay,loss=0,cause='other'){
  const c=state.clock;
  if(state.shootout)return;
  if(state.phase==='halftime'){c.intervalRemaining=round(Math.max(0,c.intervalRemaining-dt));return;}
  const i=c.period-1;c.elapsed=round(c.elapsed+dt);c.played[i]=round(c.played[i]+inPlay);c.dead[i]=round(c.dead[i]+dt-inPlay);
  if(c.mode==='full'&&loss>0&&!c.extendingPenalty){
    c.lost[i]=round(c.lost[i]+loss);c.lostByCause[i][cause]=round((c.lostByCause[i][cause]??0)+loss);
    if(c.announced[i]!==null)c.added[i]=round(c.added[i]+loss);
  }
}
export function announceAllowance(clock){
  const i=clock.period-1;
  if(clock.mode!=='full'||clock.elapsed<periodLength(clock)||clock.announced[i]!==null)return null;
  // The announced whole minute is a minimum; subsequent actual losses extend it.
  clock.announced[i]=Math.ceil(clock.lost[i]/60)*60;clock.added[i]=clock.announced[i];
  return {period:clock.period,seconds:clock.announced[i],lostSeconds:clock.lost[i],causes:{...clock.lostByCause[i]}};
}
export const periodLength=c=>c.periodLengths?.[c.period-1]??c.halfLength;
export const periodDue=c=>c.mode==='full'&&c.announced[c.period-1]!==null&&c.elapsed>=periodLength(c)+c.added[c.period-1]-1e-7;
export function restartTiming(type,card=null){
  const normal={throwIn:18,goalKick:30,corner:30,directFreeKick:36,indirectFreeKick:24,penalty:30,kickoff:20}[type];
  const exceptional=(type==='penalty'?20:type==='kickoff'?30:0)+(card==='red'?25:card==='yellow'?12:0);
  return {delay:normal+exceptional,normal,exceptional,cause:card?'discipline':type==='kickoff'?'celebration':type==='penalty'?'penaltyPreparation':'routine'};
}
export function formatMatchClock(c){
  if(!c)return '00:00';
  const base=c.mode==='full'?(c.baseSeconds??(c.periodLengths?c.periodLengths.slice(0,c.period-1).reduce((a,b)=>a+b,0):(c.period-1)*c.halfLength)):0;
  const stamp=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const length=periodLength(c);
  return c.mode==='full'&&c.elapsed>=length?`${length%60===0?(base+length)/60:stamp(base+length)}+${stamp(c.elapsed-length)}`:stamp(base+c.elapsed);
}
