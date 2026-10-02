import {facilityEffects} from '../../shared/config/facility-levels.mjs';
// One route/timing policy for individual expeditions and coalition armies.
export function unitTravelEstimate(campaign,account,base) {
  if(!campaign.wonders.isSeaJourney(base.fromTerritoryId,base.toTerritoryId))return {...base,mode:'land'};
  const territory=campaign.world.territories[base.fromTerritoryId];
  const port=territory.ownerId===account.id?territory.buildings?.find(b=>b.type==='port'&&b.status==='active'):null;
  const sea=campaign.wonders.seaTravel(account,base);
  return {...sea,durationMs:Math.max(60000,Math.ceil(sea.durationMs*(port?facilityEffects('port',port.level).timeMultiplier:1))),mode:'sea'};
}
