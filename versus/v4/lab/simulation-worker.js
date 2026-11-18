import {advanceMatch} from '../engine.js';
import {createScenario} from '../scenarios.js';
self.onmessage=({data})=>{
  try {
    const started=performance.now(),match=createScenario(data.scenario??'match',data);
    while(match.state.phase!=='finished') {
      advanceMatch(match,50);
      const c=match.state.clock;
      self.postMessage({type:'progress',value:Math.min(.99,((c.period-1)*c.halfLength+Math.min(c.elapsed,c.halfLength))/match.state.input.duration)});
    }
    self.postMessage({type:'complete',frames:match.frames,events:match.events,input:match.state.input,
      duration:match.state.time,stats:match.state.stats,elapsedMs:performance.now()-started});
  } catch(error){self.postMessage({type:'error',message:error.message});}
};
