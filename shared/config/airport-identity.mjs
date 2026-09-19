// Shared airport identity for previews and live facilities.
export function airportIdentity({clubName='蓝港竞技',territoryName='',playerColor='#256ba4',playerId='preview-blue'}={}) {
  const club=String(clubName).trim().slice(0,40)||'俱乐部';
  const place=String(territoryName).trim().slice(0,40);
  const color=/^#[0-9a-f]{6}$/i.test(playerColor)?playerColor:'#256ba4';
  let hash=2166136261;for(const char of String(playerId||club))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const code=Array.from({length:3},(_,i)=>String.fromCharCode(65+Math.floor(hash/26**i)%26)).join('');
  return {clubName:club,territoryName:place,color,code,name:place?`${club} · ${place}机场`:`${club}机场`};
}

export function airportTerritoryIdentity(world,territoryId,territoryName='') {
  const territory=world?.territories?.[territoryId];
  const ownerId=territory?.ownerType==='player'?territory.ownerId:null;
  const owner=ownerId?world?.players?.[ownerId]:null;
  // The public map's player.color is authoritative; never index into a skin list.
  const playerColor=owner?(/^#[0-9a-f]{6}$/i.test(owner.color??'')?owner.color:'#4fa86d'):'#7f8b82';
  return {...airportIdentity({clubName:owner?.teamName??(ownerId?'未知俱乐部':'中立'),territoryName,playerColor,playerId:ownerId??territoryId}),ownerId};
}
