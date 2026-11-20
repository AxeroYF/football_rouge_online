import {REAL_PLAYERS} from './player-pool.js';
import {applyS4Enhancement,s4CardBaseOverall} from './s4-balance.js';
import {VERSUS_TRAIT_BY_ID} from './trait-pool.js';
import {applyKickoffTraits} from './v4/kickoff-traits.js';
import {seedState} from './v4/world.js';
import {playerTraitIds} from '../shared/football/trait-runtime.js';

export function hasSpiritPossession(player) {
  const definitions = player.traitDefinitions ?? playerTraitIds(player).map(id => VERSUS_TRAIT_BY_ID[id]);
  return definitions.some(trait => trait?.rules?.some(rule => rule.hook === 'spiritPossession'));
}

// The match keeps the carrier's ID, name, fitness, traits and tactical slot.
// Only the borrowed football profile and its spectator card last until full time.
export function possessPlayer(player, seed, side, catalog = REAL_PLAYERS, enhancementOptions) {
  if (player.spiritForm || !hasSpiritPossession(player)) return player;
  const legends = catalog.filter(p => p.grade === 'S')
    .sort((a,b) => a.id.localeCompare(b.id, 'en'));
  if (!legends.length) return player;
  const draw = seedState(JSON.stringify([seed, side, player.id, 'spirit-possession']));
  const target = legends[draw % legends.length];
  const form = applyS4Enhancement(target, 4, enhancementOptions);
  return {...player, carrierBaseOverall:player.card ? s4CardBaseOverall(player,player.card) : player.baseOverall ?? player.overall, bondIdentity:{club:player.club,nationality:player.nationality,upgradeLevel:player.upgradeLevel??player.card?.upgradeLevel??0}, grade:'S', legendary:true, xPlayer:false, role:form.role,
    secondaryRole:form.secondaryRole ?? null, pool:form.pool, nationality:form.nationality,
    club:form.club, preferredFoot:form.preferredFoot, heightCm:form.heightCm, hidden:form.hidden,
    attributes:form.attributes, overall:form.overall, baseOverall:form.baseOverall,
    upgradeLevel:4, upgradeBonus:form.upgradeBonus, legendAbility:form.legendAbility ?? null,
    spiritForm:{id:target.id, name:target.name, role:target.role, ...(target.cardProfile ? {cardProfile:structuredClone(target.cardProfile)} : {})}};
}

export function prepareLegacyTraitSeats(seats, seed, competition) {
  return possessMatchSeats(seats, seed).map((seat,side)=>({...seat,players:seat.players.map(p=>
    applyKickoffTraits(p,p.traitDefinitions ?? playerTraitIds(p).map(id=>VERSUS_TRAIT_BY_ID[id]),seed,side,competition,p.active !== false))}));
}

export function possessMatchSeats(seats, seed) {
  return seats.map((seat, side) => ({...seat, players:seat.players.map(player => {
    const form = possessPlayer(player, seed, side);
    if (form === player) return player;
    const chemistry = player.leagueChemistryBonus ?? 0;
    const attributes = Object.fromEntries(Object.entries(form.attributes).map(([key, value]) =>
      [key, Math.min(99, Number((value * (1 + chemistry)).toFixed(2)))]));
    return {...form, attributes, ydlBondBaseAttributes:attributes};
  })}));
}
