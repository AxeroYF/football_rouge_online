// Retain a small LRU of disk readers while a much larger historical match index
// remains addressable. HTTP request leases prevent eviction between head/read.
export function createBoundedReplayReaders({limit=16,onEvict=()=>{}}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>64||typeof onEvict!=='function')throw new Error('录像读取缓存上限无效');
  const entries=new Map();let closed=false;
  const touch=(key,entry)=>{entries.delete(key);entries.set(key,entry);};
  return {
    acquire(key,open){
      if(closed||typeof open!=='function')throw new Error('录像读取池已关闭或配置无效');
      let entry=entries.get(key);
      if(!entry){
        if(entries.size>=limit){const idle=[...entries].find(([,entry])=>entry.readers===0&&!entry.pending);if(!idle)throw new Error('录像读取池繁忙');onEvict(idle[0],idle[1].value);entries.delete(idle[0]);}
        entry={readers:0,value:null,pending:null,open};entries.set(key,entry);
      }
      entry.readers++;touch(key,entry);let released=false;
      return ()=>{if(!released){released=true;entry.readers--;}};
    },
    async get(key){
      const entry=entries.get(key);if(!entry?.readers)throw new Error('录像读取需要请求租约');touch(key,entry);
      if(!entry.value){entry.pending??=Promise.resolve().then(entry.open).then(value=>{entry.value=value;return value;}).finally(()=>{entry.pending=null;});await entry.pending;}
      return entry.value;
    },
    peek(key){return entries.get(key)?.value??null;},
    get stats(){return {entries:entries.size,active:[...entries.values()].filter(entry=>entry.readers).length,cachedBytes:[...entries.values()].reduce((n,entry)=>n+(entry.value?.cachedBytes??0),0)};},
    close(){if([...entries.values()].some(entry=>entry.readers||entry.pending))throw new Error('录像读取仍在进行');closed=true;entries.clear();},
  };
}
