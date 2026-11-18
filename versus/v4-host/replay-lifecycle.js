// One owner coordinates HTTP readers and retention in a host process. A disk
// executor must hold exclusive ownership of its local root for that lifetime.
export function createReplayLifecycle({now=Date.now,leaseMs=90000,maxEntries=20000}={}){
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1000||!Number.isSafeInteger(maxEntries)||maxEntries<1)throw new Error('录像观看租约配置无效');
  const entries=new Map();let closed=false;
  function entry(id){
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new Error('录像标识无效');
    let value=entries.get(id);
    if(!value){if(entries.size>=maxEntries)throw new Error('录像生命周期容量已满');value={readers:0,until:0,expiring:false,expired:false};entries.set(id,value);}
    return value;
  }
  return {
    acquire(id){
      if(closed)throw new Error('录像宿主已关闭');
      const value=entry(id);
      if(value.expired)throw Object.assign(new Error('比赛录像已过期'),{code:'V4_REPLAY_EXPIRED'});
      if(value.expiring)throw new Error('比赛录像正在归档');
      value.readers++;value.until=Math.max(value.until,now()+leaseMs);let released=false;
      return ()=>{if(!released){released=true;value.readers--;value.until=Math.max(value.until,now()+leaseMs);}};
    },
    viewing(id){const value=entries.get(id);return Boolean(value&&(value.readers>0||value.until>now()));},
    expired(id){return Boolean(entries.get(id)?.expired);},
    close(){if([...entries.values()].some(value=>value.readers||value.expiring))throw new Error('录像仍有读取或清理活动');closed=true;},
    restoreExpired(id){const value=entry(id);if(value.readers||value.expiring)throw new Error('录像仍有读取活动');value.expired=true;},
    async expire(id,commit){
      const value=entry(id);
      if(value.expiring||value.readers||value.until>now())return {expired:false,reason:'viewing'};
      value.expiring=true;
      try{
        // The durable tombstone is committed before any payload deletion.
        // Failure leaves the gate reusable; the executor restores the tombstone
        // before retrying if the disk commit succeeded but its return failed.
        await commit();value.expired=true;return {expired:true};
      }finally{value.expiring=false;}
    },
  };
}
