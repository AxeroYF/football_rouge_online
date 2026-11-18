import {parentPort,workerData} from 'node:worker_threads';
import {produceArchive} from '../versus/v4-stream/producer.js';
const result=await produceArchive(workerData.input,workerData.directory,{matchId:workerData.matchId,
  onCommitted:value=>parentPort.postMessage({type:'committed',...value})});
parentPort.postMessage({type:'complete',metrics:result.metrics,score:result.state.score,stats:result.state.stats});
