import {runShadowJob} from './shadow-job.js';

// Private child entry. It never loads the main server or a league singleton.
if(!process.send)throw new Error('比赛工作进程需要私有IPC通道');
process.once('disconnect',()=>process.exit(1));
process.once('message',async options=>{
  try{
    const jobs=options.jobs??[options];
    if(!Array.isArray(jobs)||jobs.length<1||jobs.length>4||new Set(jobs.map(job=>job.envelope?.input?.fixtureId)).size!==jobs.length)throw new Error('生产者比赛组无效');
    // Each bounded recorder yields during archive I/O. Sharing one process lets
    // all four matches advance while another is awaiting its committed chunk.
    const settled=await Promise.allSettled(jobs.map(job=>runShadowJob(job)));
    const results=settled.map((outcome,index)=>({fixtureId:jobs[index].envelope.input.fixtureId,...(outcome.status==='fulfilled'?{ok:true,segments:outcome.value.segments}:{ok:false,error:String(outcome.reason.message).slice(0,1000)})}));
    process.send({ok:true,results},()=>process.exit(0));
  }catch(error){process.send({ok:false,error:String(error.message).slice(0,1000)},()=>process.exit(1));}
});
