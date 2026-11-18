// Standalone, browser-compatible V4 prototype. No league, accounts or filesystem imports.
export const VERSION = '4.0.0-prototype.8';
export const FIELD = Object.freeze({length:105, width:68, goalWidth:7.32});
export const STEP = 0.2; // Football seconds, independent of wall/playback time.
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const round = n => Math.round(n * 1e6) / 1e6;
export const physicalSide = (side,state) => {
  if(state?.shootout?.current)return side===state.shootout.current.side?(state.shootout.goalX===105?0:1):(state.shootout.goalX===105?1:0);
  const period=state?.clock?.period??1;return side^((period-1)%2)^(period>2?(state.clock.extraEndsSwap??0):0);
};
export const direction = (side,state) => physicalSide(side,state) === 0 ? 1 : -1;
export const localPoint = (p, side,state) => physicalSide(side,state) === 0 ? {x:p.x, y:p.y} : {x:FIELD.length-p.x, y:FIELD.width-p.y};
export const worldPoint = localPoint;
export const coordinates=state=>({localPoint:(p,side)=>localPoint(p,side,state),worldPoint:(p,side)=>worldPoint(p,side,state),direction:side=>direction(side,state)});
export const scoringSideAt=(state,x)=>physicalSide(x>52.5?0:1,state);
export const playerByKey = (state, key) => state.players.find(p => p.key === key);

export function seedState(seed) {
  let n = 2166136261;
  for (const ch of String(seed)) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function random(state, domain) {
  const stream = state.random[domain];
  stream.value = (stream.value + 0x6D2B79F5) >>> 0;
  stream.draws++;
  let n = stream.value;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}

// Earliest contact of a moving point with a moving circle during one step.
// This catches a fast ball crossing a defender between frame endpoints.
export function sweptContact(ballFrom, ballTo, playerFrom, playerTo, radius) {
  const x = ballFrom.x-playerFrom.x, y = ballFrom.y-playerFrom.y;
  const vx = ballTo.x-ballFrom.x-(playerTo.x-playerFrom.x);
  const vy = ballTo.y-ballFrom.y-(playerTo.y-playerFrom.y);
  const c = x*x+y*y-radius*radius;
  if (c <= 0) return 0;
  const a = vx*vx+vy*vy;
  if (a < 1e-12) return null;
  const b = 2*(x*vx+y*vy), disc = b*b-4*a*c;
  if (disc < 0) return null;
  const t = (-b-Math.sqrt(disc))/(2*a);
  return t >= 0 && t <= 1 ? t : null;
}

export function snapshot(state) {
  return {
    tick:state.tick, time:state.time, score:[...state.score], phase:state.phase,
    restartSerial:state.restartSerial, ball:structuredClone(state.ball),activePlans:[...state.activePlans],progress:structuredClone(state.progress),
    transition:structuredClone(state.transition),coordination:structuredClone(state.coordination),
    rules:structuredClone(state.rules),restart:structuredClone(state.restart),clock:clockSnapshot(state),
    shootout:state.shootout?{active:state.shootout.active,score:[...state.shootout.score],taken:[...state.shootout.taken],goalX:state.shootout.goalX,winner:state.shootout.winner,
      current:state.shootout.current?{side:state.shootout.current.side,kicker:state.shootout.current.kicker,keeper:state.shootout.current.keeper}:null}:null,
    players:state.players.map(({key, side, number, name, role, active, status, injury, yellowCards, x, y, vx, vy, facing, fitness, task}) =>
      ({key, side, number, name, role, active, status, injury:structuredClone(injury??null),yellowCards, x, y, vx, vy, facing, fitness, task:structuredClone(task)})),
    eventCursor:state.nextEventId-1,
  };
}
export function clockSnapshot(state,time=state.time){
  const c=state.clock,i=c.period-1;
  return {mode:c.mode,period:c.period,halfLength:c.periodLengths?.[i]??c.halfLength,baseSeconds:c.periodLengths?.slice(0,i).reduce((a,b)=>a+b,0)??i*c.halfLength,
    attackDirections:[direction(0,state),direction(1,state)],elapsed:round(c.elapsed+(!state.shootout&&['playing','restart'].includes(state.phase)?time-state.time:0)),
    announcedSeconds:c.announced[i],addedSeconds:c.added[i],lostSeconds:c.lost[i],intervalRemaining:c.intervalRemaining,extendingPenalty:c.extendingPenalty};
}

export function assertWorld(state) {
  if (state.version !== VERSION || !Number.isInteger(state.tick) || state.tick < 0 || state.time !== round(state.tick*STEP)) throw new Error('V4 时间或版本损坏');
  const rosterSize=state.input.teams.reduce((n,t)=>n+t.players.length+(t.bench?.length??0),0);
  if (state.players.length !== rosterSize || new Set(state.players.map(p=>p.key)).size !== rosterSize) throw new Error('V4 球员实例必须唯一且与名单一致');
  if (!['playing','restart','halftime','shootout','finished'].includes(state.phase)) throw new Error('V4 比赛阶段损坏');
  if(!Array.isArray(state.activePlans)||state.activePlans.length!==2||state.activePlans.some(p=>!['normal','leading','trailing'].includes(p)))throw new Error('V4 战术预案状态损坏');
  if(state.progress&&(![0,1].includes(state.progress.side)||![state.progress.at,state.progress.maxX,state.progress.restartSerial].every(Number.isFinite)||state.progress.at>state.time||state.progress.maxX<0||state.progress.maxX>105))throw new Error('V4 推进记忆损坏');
  const c=state.clock;
  const periods=c?.periodLengths?.length??0;
  if(!c||!['full','clip'].includes(c.mode)||!Number.isInteger(c.period)||c.period<1||c.period>periods||!['lost','added','played','dead','announced','lostByCause'].every(key=>Array.isArray(c[key])&&c[key].length===Math.max(2,periods))||
    ![c.elapsed,c.halfLength,c.intervalLength,c.intervalRemaining,...c.lost,...c.added,...c.played,...c.dead].every(n=>Number.isFinite(n)&&n>=0)||
    !c.announced.every(n=>n===null||Number.isFinite(n)&&n>=0)||!Array.isArray(c.completed)||typeof c.extendingPenalty!=='boolean'||
    c.mode!==state.input.format||c.halfLength!==(c.mode==='full'?state.input.duration/2:state.input.duration)||
    c.intervalRemaining>c.intervalLength||state.phase==='halftime'&&(c.mode!=='full'||c.period===periods)||
    !c.periodLengths.every(n=>Number.isFinite(n)&&n>0))throw new Error('V4 半场时钟损坏');
  for (const p of state.players) {
    if (![p.x,p.y,p.vx,p.vy,p.facing,p.fitness].every(Number.isFinite) || p.x<0 || p.x>105 || p.y<0 || p.y>68 || p.fitness<0 || p.fitness>100) throw new Error('V4 球员空间状态损坏');
  }
  const shootout=state.shootout;
  if(shootout){
    const pair=v=>Array.isArray(v)&&v.length===2;
    if(typeof shootout.active!=='boolean'||![0,1].includes(shootout.turn)||![0,105].includes(shootout.goalX)||!Number.isFinite(shootout.nextAt)||
      !pair(shootout.eligible)||shootout.eligible.some((keys,side)=>!Array.isArray(keys)||keys.length===0||new Set(keys).size!==keys.length||keys.some(key=>{const p=playerByKey(state,key);return !p?.active||p.side!==side;}))||
      shootout.eligible[0].length!==shootout.eligible[1].length||!pair(shootout.score)||!pair(shootout.taken)||
      [...shootout.score,...shootout.taken].some(n=>!Number.isSafeInteger(n)||n<0)||shootout.score.some((n,i)=>n>shootout.taken[i])||Math.abs(shootout.taken[0]-shootout.taken[1])>1||
      !Array.isArray(shootout.kicks)||shootout.kicks.length!==shootout.taken[0]+shootout.taken[1]||
      (shootout.active?shootout.winner!==null:![0,1].includes(shootout.winner)))throw new Error('V4 点球大战状态损坏');
    const kick=shootout.current;
    if(kick&&(kick.side!==shootout.turn||kick.kicker!==shootout.eligible[kick.side][shootout.taken[kick.side]%shootout.eligible[kick.side].length]||playerByKey(state,kick.keeper)?.side!==1-kick.side))throw new Error('V4 点球主罚状态损坏');
  }else if(state.phase==='shootout')throw new Error('V4 点球大战状态缺失');
  const b = state.ball;
  if (![b.x,b.y,b.vx,b.vy,b.z].every(Number.isFinite) || b.x<0 || b.x>105 || b.y<0 || b.y>68) throw new Error('V4 球状态损坏');
  if(b.z<0||b.z>100||b.airborne&&!Number.isFinite(b.vz))throw new Error('V4 球高度状态损坏');
  if (!['held','flight','loose','dead'].includes(b.mode)) throw new Error('V4 球阶段损坏');
  const holder = playerByKey(state,b.holder);
  if (b.mode==='held' ? !holder || distance(holder,b)>1e-5 : b.holder!==null) throw new Error('V4 持球归属损坏');
  if (b.mode==='flight' && (!b.flight || !['pass','shot'].includes(b.flight.kind))) throw new Error('V4 球路缺失');
  if (!Array.isArray(state.coordination)||state.coordination.length!==2||!Number.isSafeInteger(state.transitionSerial)||!Number.isSafeInteger(state.contestSerial)) throw new Error('V4 协同状态损坏');
  if(!state.rules||!Object.hasOwn(state.rules,'offside')||!Object.hasOwn(state.rules,'restartTouch'))throw new Error('V4 规则状态损坏');
  const offside=state.rules.offside,rt=state.rules.restartTouch;
  if(offside&&(![0,1].includes(offside.side)||![offside.at,offside.line,offside.ballX,offside.secondLastX].every(Number.isFinite)||!Array.isArray(offside.candidates)||offside.candidates.some(key=>playerByKey(state,key)?.side!==offside.side)))throw new Error('V4 越位状态损坏');
  const restartTypes=['kickoff','throwIn','goalKick','corner','directFreeKick','indirectFreeKick','penalty'];
  if(rt&&(!restartTypes.includes(rt.type)||playerByKey(state,rt.kicker)?.side!==rt.side))throw new Error('V4 定位球触球状态损坏');
  if(state.phase==='restart'&&(!state.restart||!restartTypes.includes(state.restart.type)||![0,1].includes(state.restart.side)||![state.restart.until,state.restart.spot?.x,state.restart.spot?.y].every(Number.isFinite)))throw new Error('V4 定位球状态损坏');
  for(const p of state.players)if(typeof p.active!=='boolean'||!Number.isInteger(p.yellowCards)||p.yellowCards<0||p.yellowCards>1000)throw new Error('V4 纪律状态损坏');
  if (state.transition && (![0,1].includes(state.transition.from)||state.transition.to!==1-state.transition.from||!Number.isFinite(state.transition.until)||state.transition.until<=state.transition.at)) throw new Error('V4 转换状态损坏');
  for(const p of state.players) if(!Number.isFinite(p.nextTouch)||!Number.isFinite(p.nextDecision)||!Number.isFinite(p.nextTackle))throw new Error('V4 行动冷却损坏');
  for (const stream of Object.values(state.random)) if (!Number.isInteger(stream.value)||stream.value<0||stream.value>0xffffffff||!Number.isSafeInteger(stream.draws)||stream.draws<0) throw new Error('V4 随机状态损坏');
  return true;
}
