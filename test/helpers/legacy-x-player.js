import {REAL_PLAYERS,isXPlayer} from '../../versus/player-pool.js';
import {ATTRIBUTE_NAMES} from '../../shared/football/schema.js';

// A pre-pause save fixture, not an acquisition API. Existing X assets stay supported.
export function addLegacyXPlayer(service,user,{role='ST'}={}) {
  const team=service.accountTeam(user.id);
  const player=REAL_PLAYERS.find(p=>isXPlayer(p)&&!service.state.xPlayers.assignments[p.id]);
  const attributes=Object.fromEntries(ATTRIBUTE_NAMES.map(key=>[key,62]));
  const config={role,secondaryRole:role==='GK'?null:'LW',heightCm:180,attributes,baseAttributes:{...attributes},overall:62,baseAbilityOverall:62};
  service.state.xPlayers.assignments[player.id]=user.id;
  service.state.xPlayers.configs[player.id]=config;
  Object.assign(player,config,{pool:role==='GK'?'GK':'ATT'});
  team.rosterIds.push(player.id);
  team.playerState[player.id]={fitness:100,suspension:0,cupSuspension:0,seasonFinalSuspension:0,injuryRounds:0};
  service.grantS4Card(team,player.id,{grantOwnership:true,traitIds:[service.eligibleXTraits(role)[0].id],acquisitionSource:'legacy-save-fixture'});
  service.xGrowthState(player.id);
  return player.id;
}
