import {relationKey} from '../shared/config/diplomacy.mjs';
// Existing combat regression fixtures represent players already at war.
export function setTestWar(world,a,b){world.diplomacy??={};world.diplomacy.relationships??={};world.diplomacy.relationships[relationKey(a,b)]={players:[a,b].sort(),state:'war',locations:{},condemnations:{}};}
