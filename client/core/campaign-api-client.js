import {setRequestClock} from './request-id.js';
export const CAMPAIGN_TOKEN_KEY = "yellowdogs-chronicles-token";

export function createCampaignApiClient({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  tokenKey = CAMPAIGN_TOKEN_KEY,
  timeoutMs = 30000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Campaign API requires fetch");

  let token = String(storage?.getItem?.(tokenKey) ?? "");

  let stateBase=null,stateVersions=null,stateEpoch=0,stateSequence=0;
  const invalidateState=()=>{stateBase=null;stateVersions=null;stateEpoch++;};

  const executeRequest = async (url, options = {}) => {
    const controller = new AbortController();
    const isState=url==='/api/campaign/state'&&(options.method??'GET')==='GET',epoch=stateEpoch,base=stateBase;
    const sequence=isState?++stateSequence:0;
    const deltaHeaders=isState?{'x-campaign-delta':'1',...(stateVersions?{'x-campaign-versions':JSON.stringify(stateVersions)}:{})}:{};
    let timer;
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(url, {
          method: options.method || "GET",
          headers: { ...deltaHeaders, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: options.body ? JSON.stringify(options.body) : undefined,
          cache: "no-store", signal: controller.signal,
        });
        let value;
        try { value = await response.json(); }
        catch { throw Object.assign(new Error('服务器响应不完整，请稍后重试'), {status: response.status}); }
        if(controller.signal.aborted)throw Error('请求已超时，请重新同步');
        if (!response.ok) throw Object.assign(new Error(value.error || '请求失败'), {status: response.status});
        if(isState&&value.stateVersions&&value.statePatch){
          const merged={...base,...value.statePatch};
          for(const key of Object.keys(merged))if(!Object.hasOwn(value.stateVersions,key))delete merged[key];
          if(Object.keys(value.stateVersions).some(key=>!Object.hasOwn(merged,key)))throw Error('状态同步基线已失效，请重新同步');
          if(epoch!==stateEpoch||sequence!==stateSequence)throw Error('操作期间状态已变化，等待下一次同步');
          setRequestClock(value.serverNow);
          stateBase=structuredClone(merged);stateVersions=value.stateVersions;
          return {...value,state:merged};
        }
        return value;
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(options.method && options.method !== 'GET'
            ? '请求等待超时，请先刷新确认操作结果，勿重复提交'
            : '连接服务器超时，请稍后重试'));
          controller.abort();
        }, options.timeoutMs ?? timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };

  const reads=new Map();
  function request(url,options={}) {
    if ((options.method??'GET').toUpperCase()!=='GET') {
      reads.clear();stateEpoch++;
      return executeRequest(url,options).finally(()=>{reads.clear();stateEpoch++;});
    }
    const key=JSON.stringify([token,url,options.timeoutMs??timeoutMs]);
    let record=reads.get(key);
    if(!record){
      record={users:0};
      record.promise=executeRequest(url,options).finally(()=>{if(reads.get(key)===record)reads.delete(key);});
      reads.set(key,record);
    }
    record.users++;
    return record.promise.then(value=>record.users>1?structuredClone(value):value);
  }
  return {
    request,
    hasToken: () => Boolean(token),
    setToken(value) {
      reads.clear(); invalidateState(); token = String(value ?? "");
      if (token) storage?.setItem?.(tokenKey, token);
      else storage?.removeItem?.(tokenKey);
    },
    clearToken() {
      reads.clear(); invalidateState(); token = "";
      storage?.removeItem?.(tokenKey);
    },
  };
}
