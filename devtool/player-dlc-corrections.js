// Curated corrections to verified legacy records, applied after workbook import.
// Keep the historical raw reference untouched; the replacement is an estimate.
import {reviseDlcProfile} from './player-dlc-profile-revisions.js';
export function correctLegacyDlcPlayer(player, id) {
  if (id === 's4-dlc-20260731-009'
      && player.sourceName === 'Gary Neville'
      && player.source?.type === 'FIFA historical database archive'
      && player.source?.overall === 76
      && player.attributes?.composure === 1
      && player.attributes?.decisions === 72) {
    return {
      ...player,
      attributes: {...player.attributes, composure:72},
      dataCorrections: {...player.dataCorrections, composure:{
        revision:1, kind:'estimated-missing-value', rawValue:0, importedValue:1,
        replacement:72, basis:'historical-reactions',
        evidence:'data/player-dlc-ea-reference.json:dlc-garyneville.rawReferenceAttributes',
        note:'历史冷静字段为 0；以同条记录的 reactions=72 估算，非实测冷静值。',
      }},
    };
  }
  if (id === 's4-dlc-20260731-024'
      && player.sourceName === 'Fábio Coentrão'
      && player.role === 'LB' && player.pool === 'MID') {
    return {
      ...player, pool:'DEF',
      dataCorrections: {...player.dataCorrections, pool:{
        revision:1, previous:'MID', replacement:'DEF', basis:'primary-role-LB',
      }},
    };
  }
  return reviseDlcProfile(player,id);
}
