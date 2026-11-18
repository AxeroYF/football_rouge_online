import {decodeFrames} from '../v4-stream/codec.js';
import {createMatchMetrics} from './match-metrics.js';
import {analyzeElevenBoardFormation} from '../public/formation-rules.js';

// Only consumes released PUBLIC packets. Never reads the producer's final result.
// One incremental accumulator per registered match; requests share the same work.
export function createBroadcastSummary(input){
  const metrics=createMatchMetrics();let next=0,frame=null,pending=null;
  async function read(reader,head){
    let last=null;
    while(next<head.segments.length){
      const packet=await reader.read(next,null);if(!packet)break;
      metrics.consume(packet.events);last=packet;next++;
    }
    if(last)frame=decodeFrames(last.frames).at(-1);
    const data=metrics.view(frame?.time??0);
    const teams=input.teams.map((team,side)=>{
      const players=[...team.players,...(team.bench??[])].map(p=>{
        const live=frame?.players.find(row=>row.key===`${side}:${p.id}`),anchor=p.anchor??{x:52.5,y:34};
        return {id:p.id,name:p.name,role:p.sourceRole??p.role,assignedRole:p.sourceRole??p.role,
          overall:p.overall??0,grade:p.grade??p.sourceCard?.grade??'C',traits:(p.traitDefinitions??[]).map(({id,name,summary})=>({id,name,summary})),rating:null,fitness:null,
          nationality:p.nationality,club:p.club,upgradeLevel:p.upgradeLevel??0,
          active:live?.active??team.players.includes(p),sentOff:live?.status==='sentOff',injury:live?.status==='injured'?{}:null,
          position:{x:anchor.y/68*100,y:(1-anchor.x/105)*100},stats:{goals:0,assists:0}};
      });
      const positions=Object.fromEntries(players.map(p=>[p.id,p.position]));
      return {id:team.id,name:team.name,formation:analyzeElevenBoardFormation(players.filter(p=>p.active),positions).name,players,positions,
        activeCount:players.filter(p=>p.active).length,stats:data.stats[side],tactic:null,style:null};
    });
    return {code:head.matchId,live:!head.complete,spectators:[],spectatorCount:0,scheduled:true,
      match:{version:4,engineVersion:head.engineVersion,engineProfile:'v4-spatial',phase:frame?.phase??'playing',
        segment:frame?.shootout?'penalties':frame?.clock.period>2?'extra':'regular',
        minute:frame?Math.floor((frame.clock.baseSeconds+frame.clock.elapsed)/60):0,score:frame?.score??[0,0],teams,
        weather:{id:'sunny',name:'晴天'},events:data.events,metricDefinitions:data.metricDefinitions,
        aggregateBaseScore:head.competition?.aggregate??null,
        penalties:frame?.shootout?{score:frame.shootout.score}:null,
        v4Replay:{matchId:head.matchId},keyPlays:data.events.filter(e=>['goal','shot','save','red'].includes(e.type)).map(e=>({eventId:e.id,type:e.type,replayTime:e.replayTime}))}};
  }
  return async(reader,head)=>{if(pending)await pending;pending=read(reader,head);try{return await pending;}finally{pending=null;}};
}
