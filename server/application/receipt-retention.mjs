export const RECEIPT_LIMIT = 256;
export const RECEIPT_TTL = 7 * 86400000;
export function requestTime(id) {
 const m=/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(String(id));
 return m?parseInt(m[1]+m[2],16):null;
}
export function receipt(owner,bucket,id,now,key=id) {
 const prior=owner?.[bucket]?.[key];if(prior)return prior;
 const time=requestTime(id),floor=owner?.receiptRetention?.[bucket];
 if((time!==null&&(time<=(floor?.before??0)||time<now-RECEIPT_TTL||time>now+300000))||(time===null&&floor?.legacyClosed))
  throw Object.assign(Error('请求已过期，请刷新后确认当前结果，再重新操作'),{statusCode:409});
 return null;
}
export function pruneReceipts(owner,bucket,now,{limit=RECEIPT_LIMIT,ttl=RECEIPT_TTL,compound=false}={}) {
 const entries=Object.entries(owner?.[bucket]??{}).map(([key,value],index)=>{
  let id=key;if(compound){try{id=JSON.parse(key)[1];}catch{}}
  const issued=requestTime(id);return {key,value,index,issued,at:value.recordedAt??issued??now};
 });
 if(!entries.length)return false;
 entries.sort((a,b)=>b.at-a.at||b.index-a.index);
 const retired=entries.filter((e,i)=>i>=limit||e.at<now-ttl);
 const old=owner.receiptRetention?.[bucket]??{};
 let before=old.before??0;
 for(const e of retired)if(e.issued!==null)before=Math.max(before,e.issued);
 const removed=new Set(retired.map(e=>e.key));
 const kept=entries.filter(e=>!removed.has(e.key)&&(e.issued===null||e.issued>before));
 const changed=kept.length!==entries.length||entries.some(e=>e.value.recordedAt===undefined);
 if(!changed)return false;
 owner[bucket]=Object.fromEntries(kept.map(e=>[e.key,{...e.value,recordedAt:e.at}]));
 if(retired.length)owner.receiptRetention={...owner.receiptRetention,[bucket]:{before,legacyClosed:true}};
 return true;
}
