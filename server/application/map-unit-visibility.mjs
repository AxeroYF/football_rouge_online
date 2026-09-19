import {allianceMembers} from '../../shared/config/diplomacy.mjs';
import { territoryPointToDisplay } from '../../client/map/campaign-map-geometry.js';
import { project, unproject } from '../../client/map-three/projection.js';
import { unitTravelFrame } from '../../shared/map/unit-travel.mjs';
import { sponsoredTeamName } from '../../shared/config/sponsorship.mjs';

// Publish only the currently visible position, never another player's route or tasks.
export function visibleMapUnits({account,world,accounts,territoryIndex,fog,spatial,now}) {
  if(!account)return [];
  const metadata=new Map((territoryIndex?.territories??[]).map(t=>[t.territoryId,t]));
  const point=id=>{const t=metadata.get(id);return t?.centroid?territoryPointToDisplay(t.centroid,t.region):null;};
  const plan=fog?.enabled&&spatial?spatial.models(fog).current:null;
  const visible=new Set(fog?.visibleTerritoryIds??[]), result=[];
  const coalitions=Object.values(world?.coalitions??{}).filter(a=>!a.disbandedAt&&a.territoryId).map(a=>({id:a.id,setupComplete:true,homeTerritoryId:a.territoryId,draft:{teamName:a.name},mapColor:'#f0cb69',coalition:a,allied:allianceMembers(world,a.commanderId).includes(account.id)}));
  for(const owner of [...accounts.values(),...coalitions]) {
    if(owner.id===account.id||!owner.setupComplete||!owner.homeTerritoryId)continue;
    const units=owner.coalition?[{...owner.coalition,id:owner.id,kind:"coalition",name:"联军"}]:[...(owner.expeditionPiece?[{...owner.expeditionPiece,id:'expedition',kind:'expedition',name:'远征队'}]:[]),...Object.values(owner.scouting?.units??{}).map(u=>({...u,kind:'scout'}))];
    for(const unit of units){
      const frame=unitTravelFrame(unit.movement,now);
      let position=point(unit.territoryId),territoryId=unit.territoryId,moving=false;
      if(frame){const a=point(frame.fromTerritoryId),b=point(frame.toTerritoryId);if(a&&b){
        const from=project(a[1],a[0]),to=project(b[1],b[0]);
        const p=unproject(from.x+(to.x-from.x)*frame.progress,from.z+(to.z-from.z)*frame.progress);
        position=[p.lat,p.lng];moving=frame.progress<1;territoryId=moving?null:frame.toTerritoryId;
      }}
      if(!position)continue;
      if(!owner.allied&&fog?.enabled&&(plan?!spatial.pointVisible(plan,(()=>{const p=project(position[1],position[0]);return [p.x,p.z];})()):!visible.has(territoryId)))continue;
      result.push({coalitionId:owner.coalition?.id,allied:owner.allied,id:JSON.stringify([owner.id,unit.id]),kind:unit.kind,ownerId:owner.id,ownerName:sponsoredTeamName(owner,now),color:owner.mapColor??'#4fa86d',name:unit.name,tokenId:unit.kind==='expedition'?unit.tokenId:undefined,position,territoryId,moving});
    }
  }
  return result;
}
