export const STREAM_FORMAT='yffm-v4-stream-1';
const copy=value=>structuredClone(value);
const dangerous=new Set(['__proto__','prototype','constructor']);
const sameShape=(a,b)=>a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)&&
  JSON.stringify(Object.keys(a))===JSON.stringify(Object.keys(b));

// Independent packets: one complete frame followed by path-indexed deltas.
// This is a presentation codec, never a resumable simulation checkpoint.
export function encodeFrames(frames){
  const paths=[],ids=new Map(),deltas=[];
  const pathId=path=>{const key=JSON.stringify(path);if(!ids.has(key)){ids.set(key,paths.length);paths.push(path);}return ids.get(key);};
  const diff=(a,b,path,out)=>{
    if(Object.is(a,b))return;
    if(sameShape(a,b)){for(const key of Object.keys(b))diff(a[key],b[key],[...path,Array.isArray(b)?Number(key):key],out);}
    else out.push(pathId(path),copy(b));
  };
  for(let i=1;i<frames.length;i++){const changes=[];diff(frames[i-1],frames[i],[],changes);deltas.push(changes);}
  return {first:frames.length?copy(frames[0]):null,paths,deltas};
}

export function decodeFrames(data){
  if(!data||!Array.isArray(data.paths)||data.paths.length>20000||!Array.isArray(data.deltas)||data.deltas.length>4096)throw new Error('回放增量格式无效');
  for(const path of data.paths)if(!Array.isArray(path)||path.length>16||path.some(key=>!(typeof key==='string'||Number.isSafeInteger(key)&&key>=0)||dangerous.has(key)))throw new Error('回放路径无效');
  if(data.first===null){if(data.deltas.length)throw new Error('回放缺少关键帧');return [];}
  const frames=[copy(data.first)];
  for(const changes of data.deltas){
    if(!Array.isArray(changes)||changes.length%2||changes.length>40000)throw new Error('回放增量损坏');
    let frame=copy(frames.at(-1));
    for(let i=0;i<changes.length;i+=2){
      const id=changes[i];if(!Number.isSafeInteger(id)||id<0||id>=data.paths.length)throw new Error('回放路径索引无效');
      const path=data.paths[id],value=copy(changes[i+1]);
      if(!path.length){frame=value;continue;}
      let target=frame;
      for(const key of path.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,key))throw new Error('回放增量缺少父节点');target=target[key];}
      const key=path.at(-1);if(!target||typeof target!=='object'||!Object.hasOwn(target,key))throw new Error('回放增量不能创建路径');target[key]=value;
    }
    frames.push(frame);
  }
  return frames;
}

const cm=value=>Math.round(value*100)/100||0;
const projectPoint=value=>value?{x:cm(value.x),y:cm(value.y)}:null;
export function publicFrame(frame,ownerSide=null){
  const shootout=frame.shootout?Object.fromEntries(['active','score','taken','goalX','winner'].map(key=>[key,copy(frame.shootout[key])])):null;
  if(shootout)shootout.current=frame.shootout.current?Object.fromEntries(['side','kicker','keeper'].map(key=>[key,copy(frame.shootout.current[key])])):null;
  return {time:frame.time,tick:frame.tick,score:[...frame.score],phase:frame.phase,restartSerial:frame.restartSerial,eventCursor:frame.eventCursor,
    clock:copy(frame.clock),shootout,ball:{mode:frame.ball.mode,holder:frame.ball.holder,...projectPoint(frame.ball),z:cm(frame.ball.z),vx:cm(frame.ball.vx),vy:cm(frame.ball.vy)},
    players:frame.players.map(p=>({key:p.key,side:p.side,number:p.number,name:p.name,role:p.role,active:p.active,status:p.status??(p.active?'playing':'inactive'),yellowCards:p.yellowCards,
      ...projectPoint(p),vx:cm(p.vx),vy:cm(p.vy),facing:Math.round(p.facing*1000)/1000||0,
      ...(p.side===ownerSide?{fitness:cm(p.fitness),task:p.task?{...copy(p.task),target:projectPoint(p.task.target)}:null}:{})}))};
}
export function publicEvent(event,ownerSide=null){
  if((ownerSide===null||event.side!==ownerSide)&&['tacticalPlanChanged','pressCoordination','pressBeaten','overlapCoordination','coverReleased','transition','transitionEnd','playerEffectsChanged'].includes(event.type))return null;
  const keys=['id','time','tick','type','actor','side','position','score','clock','text','scoringSide','traitOpening','sponsorGoal','ownGoal','special','restartType','yellowCards'];
  const out=Object.fromEntries(keys.filter(key=>Object.hasOwn(event,key)).map(key=>[key,copy(event[key])]));
  if(event.traitOpening)out.level=event.level;
  if(['substitution','emergencyKeeper'].includes(event.type)&&event.departed)out.departed=event.departed;
  if(event.type==='goal')for(const key of ['assistId','bodyPart','keeperKey'])
    if(Object.hasOwn(event,key))out[key]=event[key];
  if(event.type==='shootoutResult')for(const key of ['goal','shootoutScore'])if(Object.hasOwn(event,key))out[key]=copy(event[key]);
  // Never publish an opponent's instructions, scoring alternatives or RNG draws.
  if(ownerSide!==null&&event.side===ownerSide)for(const key of ['reason','plan','decision','opportunity','decisionId','intent','effects'])if(Object.hasOwn(event,key))out[key]=copy(event[key]);
  return out;
}
