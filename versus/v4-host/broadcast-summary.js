import {publicMatchWeather,publicMatchReferee} from '../match-conditions.js';
import {createMatchCommentary} from './match-commentary.js';
import {decodeFrames} from '../v4-stream/codec.js';
import {createMatchMetrics} from './match-metrics.js';
import {analyzeElevenBoardFormation} from '../public/formation-rules.js';
import {appendGoalFrames} from './goal-clips.js';
import {REAL_PLAYER_BY_ID} from '../player-pool.js';
import {isGoalEvent} from '../public/goal-event.js';
import {broadcastCardArt} from '../broadcast-card-art.js';

// Only consumes released PUBLIC packets. Never reads the producer's final result.
// One incremental accumulator per registered match; requests share the same work.
export function createBroadcastSummary(input){
  const metrics=createMatchMetrics(),commentary=createMatchCommentary();let next=0,frame=null,pending=null;
  const goals=[],building=new Set();
  const boardSlots = new Map(input.teams.flatMap((team, side) => team.players.map(p => [side+':'+p.id,p])));
  const replaced = new Set();
  const lastExit = [null,null];
  function updateBoard(event) {
    if (event.type === 'injury' || event.type === 'redCard') lastExit[event.side] = event.actor;
    if (event.type !== 'substitution' && event.type !== 'emergencyKeeper') return;
    // Older public packets record the injury/dismissal immediately before its replacement.
    const departed = event.departed ?? lastExit[event.side];
    const slot = boardSlots.get(departed);
    if (slot) {
      boardSlots.set(event.actor,slot);
      replaced.add(departed);
    }
    lastExit[event.side] = null;
  }
  let recent=[];
  async function read(reader,head){
    while(next<head.segments.length){
      const packet=await reader.read(next,null);if(!packet)break;
      packet.events.forEach(updateBoard);
      metrics.consume(packet.events);commentary.consume(packet.events,input.teams);next++;
      const frames=decodeFrames(packet.frames);
      for(const event of packet.events.filter(isGoalEvent)){
        const clip={eventId:'v4-'+event.id,type:'goal',replayTime:event.time,frames:[]};
        appendGoalFrames(clip,recent);
        goals.push(clip);building.add(clip);
      }
      for(const clip of building){
        appendGoalFrames(clip,frames);
        if(frames.at(-1)?.time>=clip.replayTime+2)building.delete(clip);
      }
      if(frames.length){
        frame=frames.at(-1);
        recent=[...recent,...frames].filter(f=>f.time>=frame.time-13);
      }
    }
    const data=metrics.view(frame?.time??0);
    const credits=new Map();
    for(const goal of data.events){
      if(goal.type!=='goal'||goal.ownGoal)continue;
      for(const [id,field] of [[goal.actorId,'goals'],[goal.assistId,'assists']]){
        if(!id)continue;
        const key=goal.teamIndex+':'+id;
        const stats=credits.get(key)??{goals:0,assists:0};
        stats[field]++;
        credits.set(key,stats);
      }
    }
    const teams=input.teams.map((team,side)=>{
      const players=[...team.players,...(team.bench??[])].map(p=>{
        const key=side+':'+p.id,slot=boardSlots.get(key)??p;
        const live=frame?.players.find(row=>row.key===key),anchor=slot.anchor??{x:52.5,y:34};
        return {id:p.id,name:p.name,...broadcastCardArt(p),role:p.sourceRole??p.role,assignedRole:slot.sourceRole??slot.role,replacedOnBoard:replaced.has(key),
          overall:p.overall??0,grade:p.grade??p.sourceCard?.grade??REAL_PLAYER_BY_ID[p.id]?.grade,traits:(p.traitDefinitions??[]).map(({id,name,summary})=>({id,name,summary})),rating:null,fitness:null,
          heightCm:p.heightCm ?? REAL_PLAYER_BY_ID[p.spiritForm?.id ?? p.id]?.heightCm ?? null,
          naturalRole:p.naturalRole, nationality:p.nationality,club:p.club,upgradeLevel:p.upgradeLevel??0,
          active:live?.active??team.players.includes(p),sentOff:live?.status==='sentOff',injury:live?.status==='injured'?{}:null,
          position:{x:anchor.y/68*100,y:(1-anchor.x/105)*100},stats:credits.get(side+':'+p.id)??{goals:0,assists:0}};
      });
      const positions=Object.fromEntries(players.map(p=>[p.id,p.position]));
      return {id:team.id,name:team.name,formation:analyzeElevenBoardFormation(players.filter(p=>p.active),positions).name,players,positions,
        activeCount:players.filter(p=>p.active).length,stats:data.stats[side],tactic:null,style:null};
    });
    return {code:head.matchId,live:!head.complete,spectators:[],spectatorCount:0,scheduled:true,
      match:{version:4,engineVersion:head.engineVersion,engineProfile:'v4-spatial',phase:frame?.phase??'playing',
        segment:frame?.shootout?'penalties':frame?.clock.period>2?'extra':'regular',
        minute:frame?Math.floor((frame.clock.baseSeconds+frame.clock.elapsed)/60):0,score:frame?.score??[0,0],teams,
        weather:publicMatchWeather(input.environment),referee:publicMatchReferee(input.environment),events:commentary.feed(data.events),metricDefinitions:data.metricDefinitions,
        aggregateBaseScore:head.competition?.aggregate??null,
        penalties:frame?.shootout?{score:frame.shootout.score}:null,
        v4Replay:{matchId:head.matchId},keyPlays:goals.filter(c=>c.frames.length>=2&&(!building.has(c)||head.complete))}};
  }
  return async(reader,head)=>{if(pending)await pending;pending=read(reader,head);try{return await pending;}finally{pending=null;}};
}
