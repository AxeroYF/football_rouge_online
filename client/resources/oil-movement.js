export {applyMovementOilChoice} from '../../shared/config/movement-oil.mjs';
export function oilMovementText(e) {
  if (e.oilRequired == null) return '';
  if (e.useOil === false) return `不耗石油 · 耗时 ×${e.oilMultiplier}`;
  return e.oilShortage ? `石油不足 · 耗时 ×${e.oilMultiplier}` : `消耗 ${e.oilSpent} 石油`;
}
export function oilMovementChoiceMarkup(e, attribute, disabled = false) {
  return `<label class="oil-movement-choice">移动方式<select ${attribute} ${disabled?'disabled':''}><option value="fuel" ${e.useOil!==false?'selected':''}>消耗石油</option><option value="slow" ${e.useOil===false?'selected':''}>慢速移动（不耗油）</option></select></label>`;
}
