export function createReadGate({now=Date.now}={}) {
 let running=false,epoch=0,failures=0,retryAt=0;
 return {
  reset(){epoch++;failures=0;retryAt=0;},
  async run(action){
   if(running||now()<retryAt)return;
   const version=epoch;running=true;const current=()=>version===epoch;
   try{const value=await action(current);if(current()){failures=0;retryAt=0;}return value;}
   catch(error){if(current()){retryAt=now()+Math.min(30000,1000*2**Math.min(++failures,5));throw error;}}
   finally{running=false;}
  }
 };
}
