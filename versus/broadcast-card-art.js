import {REAL_PLAYER_BY_ID} from './player-pool.js';
import './player-card-studio-store.js'; // Registers published portraits in the catalogue, including on standalone broadcast hosts.
import {aPlayerProfileForPlayer} from './public/a-player-profiles.js';
import {legendaryProfileForPlayer} from './public/legendary-profiles.js';
import {xPlayerProfileForPlayer} from './public/x-player-profiles.js';

// Resolve artwork at presentation time so ongoing matches also see studio edits.
export function broadcastCardArt(player) {
  const shown = player.spiritForm ?? player;
  const profile = REAL_PLAYER_BY_ID[shown.id]?.cardProfile ?? shown.cardProfile
    ?? aPlayerProfileForPlayer(shown) ?? legendaryProfileForPlayer(shown) ?? xPlayerProfileForPlayer(shown);
  if (!profile) return player.spiritForm ? {spiritForm:shown} : {};

  const {imageUrl, xPercent, yPercent, widthPercent} = profile;
  const cardProfile = {imageUrl, xPercent, yPercent, widthPercent};
  return player.spiritForm ? {spiritForm:{...shown, cardProfile}} : {cardProfile};
}
