import fs from 'node:fs';
import {snapshotRuntimeMetrics} from '../src/runtime-metrics.js';
import {monitorEventLoopDelay} from 'node:perf_hooks';
const output=process.env.INBOX_LOAD_METRICS;
if (output) {
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  const samples=[];let previous=process.cpuUsage();
  setInterval(()=>{
    const cpu=process.cpuUsage(),memory=process.memoryUsage();
    samples.push({time:Date.now(),rss:memory.rss,heapUsed:memory.heapUsed,external:memory.external,cpuMicros:cpu.user+cpu.system-previous.user-previous.system,
      eventLoopP95Ms:delay.percentile(95)/1e6,eventLoopMaxMs:delay.max/1e6,timings:snapshotRuntimeMetrics().timings});
    previous=cpu;delay.reset();
    fs.writeFileSync(output,JSON.stringify(samples));
  },1000).unref();
}
