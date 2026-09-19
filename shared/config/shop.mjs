import {PLAYER_PACK_DEFINITIONS,PLAYER_PACK_TYPES} from './player-packs.mjs';
export const SHOP_ROTATION_MS=3*60*60*1000;
export const SHOP_LEGEND_PRICE=100_000;
export const SHOP_LEGEND_OIL_PRICE=150;
export const SHOP_LEGEND_LEVEL=3;
export const SHOP_LEGEND_COUNT=3;
const prices={[PLAYER_PACK_TYPES.COMMON]:1000,[PLAYER_PACK_TYPES.RARE]:3000,[PLAYER_PACK_TYPES.EXOTIC]:8000,[PLAYER_PACK_TYPES.LEGENDARY]:20000};
export const SHOP_PACKS=Object.freeze(Object.entries(prices).map(([type,price])=>Object.freeze({...PLAYER_PACK_DEFINITIONS[type],price})));
export const SHOP_PACK_ART=Object.freeze({
 'legendary-player-pack':'./assets/player-packs/player-pack-icon-red-gold-v4-cutout.png',
 'exotic-player-pack':'./assets/player-packs/player-pack-icon-purple-green-v5-cutout.png',
 'rare-player-pack':'./assets/player-packs/player-pack-icon-white-blue-v4-cutout.png',
 'common-player-pack':'./assets/player-packs/player-pack-icon-black-v4-cutout.png',
});
