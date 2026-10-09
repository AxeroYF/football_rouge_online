import {normalizeLeagueRegistration} from '../../shared/config/league-registration.mjs';
import {economicCheckpoint} from '../infrastructure/server-economy-clock.mjs';

// Keep this synchronous. Command success includes the repository commit, and a
// failed write must restore metadata before the domain's rollback runs.
export function persistCampaign(campaign) {
  const previous=campaign.world?.serverEconomyClock;
  const registrations=[...campaign.accounts.values()].map(a=>[a,a.leagueRegistration]);
  try{
    if(campaign.pauseEconomyWhenStopped&&campaign.world)campaign.world.serverEconomyClock=economicCheckpoint(campaign.world,campaign.now());
    for(const [a] of registrations)if(a.setupComplete)a.leagueRegistration=normalizeLeagueRegistration(a,campaign.now());
    campaign.repository.save({accounts:Object.fromEntries(campaign.accounts),world:campaign.world});
  }catch(error){
    if(campaign.world){if(previous===undefined)delete campaign.world.serverEconomyClock;else campaign.world.serverEconomyClock=previous;}
    for(const [a,value] of registrations){if(value===undefined)delete a.leagueRegistration;else a.leagueRegistration=value;}
    error.campaignPersistenceFailure=true;throw error;
  }
}
