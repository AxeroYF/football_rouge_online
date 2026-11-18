import {ATTRIBUTE_NAMES} from '../shared/football/schema.js';

// Only the verified historical Neuer override is migrated. A different admin
// edit must remain authoritative, and later edits carry the persisted revision.
const NEUER_LEGACY=[76,48,85,72,17,20,29,29,15,21,90,19,87,90,16,79,85,33,84,47,55,75,47,33,90,90];
export function migrateKnownPlayerDataPatch(id,patch) {
  if(id!=='s4-fc26-167495'||patch?.playerDataRevision>=1||patch?.role&&patch.role!=='GK'
    ||!ATTRIBUTE_NAMES.every((key,i)=>patch?.attributes?.[key]===NEUER_LEGACY[i]))return patch;
  return {...patch,playerDataRevision:1,attributes:{...patch.attributes,pace:39,dribbling:34}};
}
