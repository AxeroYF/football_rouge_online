import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
test('independent watchdog identifies a blocked save and exits cleanly',async()=>{
 const code=`import {startStallMonitor} from './server/infrastructure/stall-monitor.mjs';const c={save(){const until=Date.now()+1800;while(Date.now()<until){};}};const m=startStallMonitor(c,{thresholdMs:400,checkMs:100});await new Promise(r=>setTimeout(r,300));c.save();await m.stop();`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',x=>output+=x);const timer=setTimeout(()=>child.kill(),10000);const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);assert.equal(status,0);assert.match(output,/campaign-stall/);assert.match(output,/"phase":"save"/);
});
