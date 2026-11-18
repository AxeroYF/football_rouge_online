import {gzipSync} from 'node:zlib';

// No imports of the league singleton or account store. The host supplies an
// already-authenticated identity and a trusted match-to-owner authorization.
export function createStreamService({authorize,now=Date.now,maxMatches=16,maxClients=1000,requestsPerMinute=120,maxConcurrent=4,lifecycle=null}={}){
  if(typeof authorize!=='function'||![maxMatches,maxClients,requestsPerMinute,maxConcurrent].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('发布服务配置无效');
  const matches=new Map(),clients=new Map();let inFlight=0;
  const send=(res,status,value,gzip=false)=>{
    if(res.destroyed)return;
    const plain=Buffer.from(JSON.stringify(value)),body=gzip?gzipSync(plain):plain;
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Authorization, Accept-Encoding','X-Content-Type-Options':'nosniff','Content-Length':body.length,...(gzip?{'Content-Encoding':'gzip'}:{})});res.end(body);
  };
  return {
    register(matchId,archive){
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(matchId)||archive.manifest.matchId!==matchId||matches.has(matchId)||matches.size>=maxMatches)throw new Error('发布比赛注册无效');
      matches.set(matchId,archive);
    },
    unregister(matchId){matches.delete(matchId);},
    async handle(req,res){
      const url=new URL(req.url,'http://localhost');
      const route=/^\/v4\/matches\/([a-zA-Z0-9_-]{1,100})\/(head|broadcast|segments\/(\d{1,6}))$/.exec(url.pathname);
      if(!route)return false;
      if(req.method!=='GET'){send(res,405,{error:'只允许读取'});return true;}
      // Owner identity, release time and simulation speed are never URL knobs.
      if(url.search){send(res,400,{error:'回放请求不接受额外参数'});return true;}
      if(inFlight>=maxConcurrent){send(res,429,{error:'请求繁忙，请稍后重试'});return true;}
      inFlight++;let release=null;
      try{
        const identity=await authorize(req,route[1]);
        if(!identity||typeof identity.subject!=='string'||!identity.subject||identity.subject.length>256||![null,0,1].includes(identity.ownerSide)){send(res,403,{error:'无权观看此比赛'});return true;}
        const time=now();for(const [key,value] of clients)if(time-value.since>=60000)clients.delete(key);
        let limit=clients.get(identity.subject);
        if(!limit){if(clients.size>=maxClients){send(res,429,{error:'观看人数达到当前上限'});return true;}limit={since:time,count:0};clients.set(identity.subject,limit);}
        if(++limit.count>requestsPerMinute){send(res,429,{error:'请求过于频繁'});return true;}
        const archive=matches.get(route[1]);if(!archive){send(res,404,{error:'比赛暂不可用'});return true;}
        if(lifecycle)release=await lifecycle.acquire(route[1]);
        await archive.refresh({snapshot:false});
        if(route[2]==='broadcast'){
          if(typeof archive.broadcast!=='function')send(res,404,{error:'本场暂无直播摘要'});
          else send(res,200,await archive.broadcast(),/\bgzip\b/.test(req.headers['accept-encoding']??''));
        }else if(route[2]==='head'){
          let head;
          if(typeof archive.publishedHead==='function')head=archive.publishedHead();
          else{
            const manifest=archive.manifest,released=manifest.segments.filter(s=>s.through<=archive.publishedThrough);
            head={matchId:manifest.matchId,engineVersion:manifest.engineVersion,teams:manifest.teams??[],publishedThrough:archive.publishedThrough,
              segments:released.map(s=>({index:s.index,through:s.through})),complete:released.at(-1)?.complete??false};
          }
          send(res,200,{...head,ownerSide:identity.ownerSide});
        }else{
          const packet=await archive.read(Number(route[3]),identity.ownerSide);
          if(!packet)send(res,425,{error:'片段尚未发布'});
          else send(res,200,packet,/\bgzip\b/.test(req.headers['accept-encoding']??''));
        }
      }catch(error){if(error.code==='V4_REPLAY_EXPIRED')send(res,410,{error:'比赛录像已过期',code:'V4_REPLAY_EXPIRED'});else send(res,503,{error:'回放暂不可用，请重试'});}finally{release?.();inFlight--;}
      return true;
    }
  };
}

// Production host can use its canonical account verifier here. Verification
// and team ownership are both server callbacks; the requested side is ignored.
export function accountAuthorization({verifyAccount,matchAccess}){
  if(typeof verifyAccount!=='function'||typeof matchAccess!=='function')throw new Error('账号授权配置无效');
  return async(request,matchId)=>{
    const header=request.headers.authorization??'';
    if(!header.startsWith('Bearer ')||header.length>4096)return null;
    const account=await verifyAccount(header.slice(7));if(!account?.id)return null;
    const access=await matchAccess(account.id,matchId);
    if(!access?.canWatch||![null,0,1].includes(access.ownerSide))return null;
    return {subject:account.id,ownerSide:access.ownerSide};
  };
}
