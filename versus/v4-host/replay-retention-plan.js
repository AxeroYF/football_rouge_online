const day=86400000;
export const defaultReplayRetention=Object.freeze({maxBytes:16*1024**3,maxAgeMs:7*day,minAgeMs:2*day,keepLatest:16});

// Planning only: no filesystem, host mutation, or deletion. A future executor
// must recheck publication, settlement, active leases and exact archive identity.
export function planReplayRetention({records,now,policy={}}){
  const limits={...defaultReplayRetention,...policy};
  if(!Number.isSafeInteger(now)||now<0||!Array.isArray(records)||records.length>100000||Object.keys(policy).some(key=>!Object.hasOwn(defaultReplayRetention,key))||!['maxBytes','maxAgeMs','minAgeMs','keepLatest'].every(key=>Number.isSafeInteger(limits[key])&&limits[key]>=0)||limits.maxAgeMs<limits.minAgeMs)throw new Error('录像保留计划配置无效');
  const ids=new Set();let totalBytes=0;
  for(const record of records){
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(record.matchId??'')||ids.has(record.matchId)||!Number.isSafeInteger(record.bytes)||record.bytes<0||!Number.isSafeInteger(record.endedAt)||record.endedAt<0||!['settled','released','pinned','viewing'].every(key=>typeof record[key]==='boolean')||!/^[a-f0-9]{64}$/.test(record.manifestDigest??''))throw new Error('录像保留记录无效');
    ids.add(record.matchId);totalBytes+=record.bytes;if(!Number.isSafeInteger(totalBytes))throw new Error('录像总容量超出安全范围');
  }
  const ordered=[...records].sort((a,b)=>b.endedAt-a.endedAt||a.matchId.localeCompare(b.matchId)),latest=new Set(ordered.slice(0,limits.keepLatest).map(record=>record.matchId)),eligible=[],protectedRecords=[];
  for(const record of ordered){
    const reasons=[];if(!record.settled)reasons.push('unsettled');if(!record.released)reasons.push('unreleased');if(record.pinned)reasons.push('pinned');if(record.viewing)reasons.push('viewing');if(record.endedAt>now||now-record.endedAt<limits.minAgeMs)reasons.push('too-young');if(latest.has(record.matchId))reasons.push('recent');
    if(reasons.length)protectedRecords.push({matchId:record.matchId,reasons});else eligible.push(record);
  }
  eligible.sort((a,b)=>a.endedAt-b.endedAt||a.matchId.localeCompare(b.matchId));let projectedBytes=totalBytes;const expire=[];
  for(const record of eligible){
    const age=now-record.endedAt;if(age<limits.maxAgeMs&&projectedBytes<=limits.maxBytes)continue;
    expire.push({matchId:record.matchId,manifestDigest:record.manifestDigest,bytes:record.bytes,reason:age>=limits.maxAgeMs?'age':'budget'});projectedBytes-=record.bytes;
  }
  return {scope:'plan-only',limits,totalBytes,projectedBytes,budgetSatisfied:projectedBytes<=limits.maxBytes,expire,protected:protectedRecords,kept:records.length-expire.length};
}
