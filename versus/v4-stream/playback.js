import {createViewer} from './publisher.js';
import {sampleReplay,eventsAt,playbackRate} from '../v4/replay.js';

// Playback owns only presentation time. It never imports the engine and cannot
// send speed, ownerSide or publishUntil to the release service.
export function createStreamPlayback({matchId,token='',fetcher=fetch,baseUrl='',maxFrames=4096,maxEvents=4096,lookAheadSeconds=20,settled=false}={}){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(matchId))throw new Error('比赛标识无效');
  if(!Number.isFinite(lookAheadSeconds)||lookAheadSeconds<1||lookAheadSeconds>120)throw new Error('预读时间无效');
  let head=null,viewer=null,nextSegment=0,time=0,playing=false,rate=1,slow=true,generation=0,closed=false,connected=true,busy=false,expired=false;
  const requests=new Set();
  const endpoint=`${baseUrl}/v4/matches/${matchId}`;
  async function get(suffix){
    if(closed)throw new Error('播放器已关闭');
    const controller=new AbortController();requests.add(controller);
    try{
      const response=await fetcher(endpoint+suffix,{headers:token?{Authorization:`Bearer ${token}`}:{},signal:controller.signal,cache:'no-store'});
      if(response.status===410){expired=true;closed=true;playing=false;generation++;for(const pending of requests)pending.abort();viewer=null;head=null;throw Object.assign(new Error('比赛录像已过期'),{code:'V4_REPLAY_EXPIRED'});}
      if(!response.ok)throw new Error(response.status===403?'无权观看此比赛':response.status===425?'片段尚未发布':'连接中断，等待重试');
      const value=await response.json();if(closed)throw Object.assign(new Error('播放器已关闭'),{name:'AbortError'});connected=true;return value;
    }catch(error){if(error.name!=='AbortError')connected=false;throw error;}finally{requests.delete(controller);}
  }
  async function refresh(){
    const value=await get('/head');
    if(value.matchId!==matchId||!Array.isArray(value.segments)||value.segments.length>20000||!Number.isFinite(value.publishedThrough)||![null,0,1].includes(value.ownerSide))throw new Error('发布信息无效');
    const competition=value.competition;
    if(competition&&(competition.kind!=='cup'||!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(competition.stage)||![1,2].includes(competition.leg)||!Array.isArray(competition.aggregate)||competition.aggregate.length!==2||competition.aggregate.some(n=>!Number.isSafeInteger(n)||n<0)))throw new Error('杯赛发布信息无效');
    if(head&&(value.engineVersion!==head.engineVersion||value.ownerSide!==head.ownerSide||value.publishedThrough<head.publishedThrough||JSON.stringify(competition??null)!==JSON.stringify(head.competition??null)))throw new Error('回放身份或发布时间改变');
    let previous=-1;for(const [i,entry] of value.segments.entries()){if(entry.index!==i||!Number.isFinite(entry.through)||entry.through<previous||entry.through>value.publishedThrough)throw new Error('发布片段索引无效');previous=entry.through;}
    head=value;return value;
  }
  async function load(index,reset,operation){
    const packet=await get(`/segments/${index}`);if(operation!==generation)return false;
    const metadata=head.segments[index];
    if(!metadata||packet.through!==metadata.through)throw new Error('片段与发布索引不一致');
    const target=reset?createViewer({matchId,engineVersion:head.engineVersion,ownerSide:head.ownerSide,maxFrames,maxEvents,
      initialCursor:packet.from,initialFrame:packet.hasBase?packet.frames.first:null}):viewer;
    target.accept(packet);viewer=target;nextSegment=index+1;return true;
  }
  async function seek(target){
    if(!Number.isFinite(target))throw new Error('播放时间无效');
    const operation=++generation;for(const request of requests)request.abort();
    if(!head)await refresh();if(operation!==generation)return;
    const end=head.segments.at(-1)?.through??0;target=Math.max(0,Math.min(target,end));
    if(viewer&&target>=viewer.frames[0]?.time&&target<=viewer.through){time=target;return;}
    const index=head.segments.findIndex(s=>s.through>=target);
    if(index<0){time=0;return;}
    if(await load(index,true,operation))time=Math.max(viewer.frames[0].time,target);
  }
  return {
    refresh,seek,
    async pump(){
      if(busy||closed)return;busy=true;const operation=generation;
      try{
        if(!settled||!head?.complete)await refresh();
        if(operation!==generation)return;
        if(!viewer&&head.segments.length){await load(0,true,operation);time=viewer?.frames[0]?.time??0;}
        let count=0;while(viewer&&nextSegment<head.segments.length&&viewer.through<time+lookAheadSeconds&&count++<4){if(!await load(nextSegment,false,operation))break;}
      }finally{busy=false;}
    },
    play(value=true){playing=Boolean(value);},
    setRate(value){if(![.5,1,2,4,8,16,64].includes(value))throw new Error('播放速度无效');rate=value;},
    slowMotion(value){slow=Boolean(value);},
    async catchUp(){if(!head)await refresh();await seek(Math.max(0,(head.segments.at(-1)?.through??0)-2));playing=true;},
    tick(seconds){
      if(!Number.isFinite(seconds)||seconds<0||seconds>1)throw new Error('播放步长无效');
      if(playing&&viewer){const speed=playbackRate(viewer.events,time,rate,slow);time=Math.min(viewer.through,time+seconds*speed);}
      return sampleReplay(viewer?.frames??[],time);
    },
    get frame(){return sampleReplay(viewer?.frames??[],time);},
    get events(){return eventsAt(viewer?.events??[],time);},
    get state(){return {time,playing,rate,slow,connected,expired,buffering:playing&&(!viewer||time>=viewer.through&&!viewer.complete),
      bufferedThrough:viewer?.through??0,publishedThrough:head?.segments.at(-1)?.through??0,complete:Boolean(viewer?.complete),ownerSide:head?.ownerSide??null,teams:structuredClone(head?.teams??[]),competition:structuredClone(head?.competition??null),frames:viewer?.frames.length??0,events:viewer?.events.length??0};},
    close(){closed=true;playing=false;generation++;for(const request of requests)request.abort();requests.clear();viewer=null;head=null;}
  };
}
