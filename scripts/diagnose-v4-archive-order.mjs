import fs from 'node:fs';
import path from 'node:path';
import {createMatch,advanceMatch} from '../versus/v4/engine.js';
const directory=path.resolve(process.argv[2]),job=JSON.parse(fs.readFileSync(path.join(directory,'job.json'),'utf8'));
if(job.scope!=='shadow-only')throw new Error('需要影子任务');
const document=JSON.parse(fs.readFileSync(path.join(directory,'journal/journal.json'),'utf8')),input=document.fixtures[job.fixtureId].input;
const match=createMatch(input,{frameInterval:1});let cursor=0,base=null,chunks=0;
while(match.state.phase!=='finished'){
  advanceMatch(match,50);const frames=match.frames.filter(f=>f!==base),through=frames.at(-1).time;
  const events=match.events.filter(e=>e.id>cursor&&e.time<=through);let id=cursor;
  for(const event of events){
    if(event.id!==id+1){console.log(JSON.stringify({fixtureId:job.fixtureId,chunks,cursor,through,stateTime:match.state.time,phase:match.state.phase,expected:id+1,actual:event.id,events:match.events.filter(e=>e.id>=id-3&&e.id<=event.id+3).map(({id,time,tick,type})=>({id,time,tick,type})),frames:frames.slice(-3).map(f=>({time:f.time,phase:f.phase}))},null,2));process.exit(1);}
    id=event.id;
  }
  cursor=id;base=frames.at(-1);match.frames=[base];match.events=match.events.filter(e=>e.id>cursor);chunks++;
}
console.log(JSON.stringify({passed:true,chunks,cursor}));
