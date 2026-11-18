import {STREAM_FORMAT,encodeFrames,decodeFrames,publicFrame,publicEvent} from './codec.js';

const same=(a,b)=>a.frame===b.frame&&a.event===b.event;
const validCursor=c=>c&&Number.isSafeInteger(c.frame)&&c.frame>=-1&&Number.isSafeInteger(c.event)&&c.event>=0;
const eventPrefix=(events,through)=>{const result=[];for(const event of events){if(event.time>through)break;result.push(event);}return result;};
export const INITIAL_CURSOR=Object.freeze({frame:-1,event:0});

// The trusted server owns publishUntil. A viewer may request older data and
// alter local playback speed, but read() has no parameter that advances release.
// Authorization must bind ownerSide on the server, not from a query parameter.
export function createPublisher(recording,{matchId,engineVersion,ownerSide=null}={}){
  if(typeof matchId!=='string'||!matchId||typeof engineVersion!=='string'||!engineVersion||![null,0,1].includes(ownerSide))throw new Error('回放发布身份无效');
  let publishedThrough=-1;
  return {
    publishUntil(time){
      const produced=recording.frames.at(-1)?.time??-1;
      if(!Number.isFinite(time)||time<publishedThrough||time>produced)throw new Error('发布游标不能倒退或超前于已生成状态');
      publishedThrough=time;
    },
    read(after=INITIAL_CURSOR,{maxFrames=128,maxEvents=256}={}){
      if(!validCursor(after)||![maxFrames,maxEvents].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=2048))throw new Error('回放请求游标无效');
      const releasedFrames=recording.frames.filter(f=>f.time<=publishedThrough),releasedEvents=eventPrefix(recording.events,publishedThrough);
      if(after.frame>=releasedFrames.length||after.event>(releasedEvents.at(-1)?.id??0))throw new Error('请求包含尚未发布的游标');
      const upcoming=releasedFrames.slice(after.frame+1),events=releasedEvents.filter(e=>e.id>after.event);
      let cutoff=publishedThrough;
      if(upcoming.length>maxFrames)cutoff=Math.min(cutoff,upcoming[maxFrames-1].time);
      if(events.length>maxEvents)cutoff=Math.min(cutoff,events[maxEvents-1].time);
      const selected=upcoming.filter(f=>f.time<=cutoff),selectedEvents=eventPrefix(events,cutoff);
      const to={frame:after.frame+selected.length,event:selectedEvents.at(-1)?.id??after.event};
      const base=after.frame>=0?releasedFrames[after.frame]:null;
      const frames=[...(base?[base]:[]),...selected].map(f=>publicFrame(f,ownerSide));
      return {format:STREAM_FORMAT,matchId,engineVersion,ownerSide,from:{...after},to,publishedThrough,through:cutoff,hasBase:Boolean(base),
        frames:encodeFrames(frames),events:selectedEvents.map(e=>publicEvent(e,ownerSide)).filter(Boolean),
        complete:recording.frames.at(-1)?.phase==='finished'&&publishedThrough>=recording.frames.at(-1).time&&to.frame===recording.frames.length-1&&to.event===(recording.events.at(-1)?.id??0)};
    }
  };
}

export function createViewer({matchId,engineVersion,ownerSide=null,initialCursor=INITIAL_CURSOR,initialFrame=null,maxFrames=20000,maxEvents=10000}){
  if(!validCursor(initialCursor)||Boolean(initialCursor.frame>=0)!==Boolean(initialFrame)||initialFrame&&!Number.isFinite(initialFrame.time)||![maxFrames,maxEvents].every(n=>Number.isSafeInteger(n)&&n>=2))throw new Error('回放缓存或恢复起点无效');
  let cursor={...initialCursor},through=initialFrame?.time??-1,complete=false;
  const frames=initialFrame?[structuredClone(initialFrame)]:[],events=[];
  return {
    get cursor(){return {...cursor};},get through(){return through;},get complete(){return complete;},frames,events,
    accept(packet){
      if(packet?.format!==STREAM_FORMAT||packet.matchId!==matchId||packet.engineVersion!==engineVersion||packet.ownerSide!==ownerSide||!validCursor(packet.from)||!validCursor(packet.to))throw new Error('回放身份或版本不匹配');
      if(same(packet.to,cursor)&&!same(packet.from,cursor))return false; // Retried delivery.
      if(!same(packet.from,cursor)||packet.to.frame<cursor.frame||packet.to.event<cursor.event)throw new Error('回放增量有缺口');
      if(!Number.isFinite(packet.through)||packet.through>packet.publishedThrough||packet.through<through)throw new Error('回放时间游标无效');
      const decoded=decodeFrames(packet.frames),incoming=packet.hasBase?decoded.slice(1):decoded;
      if(packet.hasBase!==Boolean(cursor.frame>=0)||incoming.length!==packet.to.frame-cursor.frame)throw new Error('回放关键帧不匹配');
      if(packet.hasBase&&JSON.stringify(decoded[0])!==JSON.stringify(frames.at(-1)))throw new Error('回放关键帧与已接收状态冲突');
      let last=frames.at(-1)?.time??-Infinity;
      for(const f of incoming){if(!Number.isFinite(f.time)||f.time<last||f.time>packet.through)throw new Error('回放帧超出发布范围');last=f.time;}
      if(!Array.isArray(packet.events))throw new Error('回放事件无效');
      let eventId=cursor.event;
      for(const e of packet.events){if(!Number.isSafeInteger(e.id)||e.id<=eventId||e.time>packet.through)throw new Error('回放事件游标无效');eventId=e.id;}
      if(eventId>packet.to.event)throw new Error('回放末尾事件不匹配');
      frames.push(...incoming);events.push(...structuredClone(packet.events));
      if(frames.length>maxFrames)frames.splice(0,frames.length-maxFrames);
      if(events.length>maxEvents)events.splice(0,events.length-maxEvents);
      cursor={...packet.to};through=packet.through;complete=Boolean(packet.complete);return true;
    }
  };
}
