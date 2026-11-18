// Fetch only the released segments around the selected event, with the normal
// account/archived-report permission checks on every request.
export async function loadV4KeyClip(replay,clip,identity){
  const {decodeFrames}=await import('/v4-preview/v4-stream/codec.js');
  async function get(segment){
    const response=replay.reportId?await fetch('/api/versus/league/match/tactical-replay',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...identity,matchId:replay.reportId,segment}),cache:'no-store',
    }):await fetch(`/v4/matches/${encodeURIComponent(replay.matchId)}/${segment==='head'?'head':'segments/'+segment}`,{
      headers:{Authorization:`Bearer ${identity.accountToken}`,'X-Player-Id':encodeURIComponent(identity.playerId)},cache:'no-store',
    });
    if(!response.ok)throw new Error(response.status===410?'本场录像已过期':response.status===403?'无权读取此录像':'片段暂不可用，请稍后重试');
    return response.json();
  }
  const head=await get('head'),end=Math.min(clip.replayTime+2,head.segments.at(-1)?.through??0),start=Math.max(0,clip.replayTime-13);
  const first=head.segments.findIndex(s=>s.through>=start);
  if(first<0)throw new Error('片段尚未发布');
  const frames=[];
  for(let i=first;i<head.segments.length;i++){
    const packet=await get(i);
    frames.push(...decodeFrames(packet.frames).filter(f=>f.time>=start&&f.time<=end));
    if(head.segments[i].through>=end)break;
  }
  const unique=[...new Map(frames.map(f=>[f.time,f])).values()].sort((a,b)=>a.time-b.time);
  if(unique.length<2)throw new Error('片段尚未完整发布');
  return {...clip,frames:unique.map(f=>({time:f.time,ball:{x:f.ball.y/68*100,y:(1-f.ball.x/105)*100},
    players:f.players.filter(p=>p.active).map(p=>({id:p.key.slice(2),teamIndex:p.side,name:p.name,x:p.y/68*100,y:(1-p.x/105)*100}))}))};
}
