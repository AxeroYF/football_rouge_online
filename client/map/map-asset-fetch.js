// Time out stalled transfers, not downloads that are still making progress.
export async function fetchMapAsset(url, {fetchImpl=globalThis.fetch, type='json', signal,
  timeoutMs=30000, totalTimeoutMs=180000, retries=1, errorMessage='map data unavailable'}={}) {
  let lastError;
  const file=String(url).split('/').pop().split('?')[0];
  const label=({'campaign-territories.geojson':'领土地形','campaign-coastlines.json':'海岸线',
    'campaign-countries.geojson':'国家边界','europe-cities.json':'欧洲城市','south-america-cities.json':'南美城市',
    'europe-clubs.json':'俱乐部位置','territory-index.json':'地块信息','territory-resources.json':'资源分布',
    'map-relief-regions.json':'地形配置','map-nature.json':'自然地貌','europe.bin':'欧洲高程',
    'south-america.bin':'南美高程','svalbard.bin':'北极高程','europe.json':'欧洲高程说明',
    'south-america.json':'南美高程说明','svalbard.json':'北极高程说明'})[file]??'地图资源';
  const progress=(detail)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('campaign-map-progress',{detail:{label,...detail}}));};
  for(let attempt=0;attempt<=retries;attempt++) {
    if(signal?.aborted)throw signal.reason??new DOMException('Aborted','AbortError');
    const controller=new AbortController();let idleTimer,totalTimer,reader;
    const abort=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',abort,{once:true});
    let rejectTimeout;
    const timeout=new Promise((_,reject)=>{rejectTimeout=reject;});
    const expire=()=>{const error=new Error('map data timeout: '+label);rejectTimeout(error);controller.abort(error);};
    const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(expire,timeoutMs);};
    const canceled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason??new DOMException('Aborted','AbortError')),{once:true}));
    try {
      resetIdle();totalTimer=setTimeout(expire,totalTimeoutMs);progress({attempt,bytes:0});
      return await Promise.race([(async()=>{
        const response=await fetchImpl(url,{signal:controller.signal,cache:attempt?'reload':'default'});
        if(!response.ok)throw new Error(errorMessage+': '+label+' ('+response.status+')');
        resetIdle();
        if(!response.body?.getReader)return await response[type==='json'?'json':'arrayBuffer']();
        reader=response.body.getReader();const chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.byteLength;resetIdle();progress({attempt,bytes:size});}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        const result=type==='json'?JSON.parse(new TextDecoder().decode(bytes)):bytes.buffer;
        progress({attempt,bytes:size,complete:true});return result;
      })(),timeout,canceled]);
    }catch(error){lastError=error;controller.abort();if(signal?.aborted)throw signal.reason??error;}
    finally{clearTimeout(idleTimer);clearTimeout(totalTimer);signal?.removeEventListener('abort',abort);if(controller.signal.aborted)void reader?.cancel().catch(()=>{});}
  }
  throw lastError;
}
