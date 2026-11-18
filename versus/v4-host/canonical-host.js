import {createStreamService} from '../v4-stream/http-service.js';

// The production singleton is never imported here. The canonical host supplies
// its existing rooms/league instances; tests supply isolated instances.
export function createCanonicalStreamHost({enabled=false,rooms,league,...limits}={}){
  if(!enabled)return {enabled:false,handle:async()=>false,register(){throw new Error('V4发布宿主未启用');},unregister(){},release(){throw new Error('V4发布宿主未启用');}};
  if(typeof rooms?.account!=='function'||!Array.isArray(league?.state?.teams))throw new Error('V4宿主缺少正式账号与球队授权接口');
  const matches=new Map();
  const service=createStreamService({...limits,authorize:async(request,matchId)=>{
    const header=request.headers.authorization??'',encodedId=request.headers['x-player-id'];
    if(typeof encodedId!=='string'||encodedId.length>512||typeof header!=='string'||!header.startsWith('Bearer ')||header.length>4096)return null;
    let playerId;try{playerId=decodeURIComponent(encodedId);}catch{return null;}
    let account;try{account=rooms.account(playerId,header.slice(7));}catch(error){if([401,423].includes(error.statusCode))return null;throw error;}
    const match=matches.get(matchId);if(!match)return null;
    const teams=match.teamIds.map(id=>league.state.teams.find(t=>t.id===id));if(teams.some(t=>!t))return null;
    const owned=teams.flatMap((team,side)=>team.ownerId===account.id?[side]:[]);
    if(owned.length>1)return null;
    const ownerSide=owned[0]??null;
    if(ownerSide===null&&!match.publicWatch&&!match.allowedAccountIds.includes(account.id))return null;
    return {subject:account.id,ownerSide};
  }});
  return {
    enabled:true,
    handle:service.handle,
    register({matchId,homeId,awayId,publicWatch=false,allowedAccountIds=[]},archive){
      if(homeId===awayId||typeof publicWatch!=='boolean'||!Array.isArray(allowedAccountIds)||allowedAccountIds.some(id=>typeof id!=='string')||![homeId,awayId].every(id=>league.state.teams.some(t=>t.id===id)))throw new Error('宿主比赛授权信息无效');
      const teams=archive.manifest.teams;
      if(teams?.length!==2||teams[0].id!==homeId||teams[1].id!==awayId)throw new Error('归档球队与宿主授权不一致');
      service.register(matchId,archive);matches.set(matchId,{teamIds:[homeId,awayId],publicWatch,allowedAccountIds:[...allowedAccountIds],archive});
    },
    unregister(matchId){service.unregister(matchId);matches.delete(matchId);},
    release(matchId,time){const match=matches.get(matchId);if(!match)throw new Error('宿主比赛未注册');match.archive.publishUntil(time);}
  };
}
