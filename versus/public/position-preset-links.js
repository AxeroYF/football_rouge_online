import {deriveFormationLines,sanitizeFormationLines} from './formation-rules.js';

export const LINKED_POSITION_PRESETS=['position2','position3'];
const copyPositions=positions=>Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{x:p.x,y:p.y}]));
export function samePositionMap(a={},b={}){
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(id=>Number(a[id]?.x)===Number(b[id]?.x)&&Number(a[id]?.y)===Number(b[id]?.y));
}
export function sameFormationLines(a,b){
  const left=sanitizeFormationLines(a),right=sanitizeFormationLines(b);
  return Object.keys(left).every(key=>left[key]===right[key]);
}
// Legacy saves have no edit history. Recognize equal/default templates; preserve
// other layouts rather than guessing that a deliberate adjustment was automatic.
export function resolvePositionPresetLinks(source){
  const base=source.positionPresets?.position1??source.positions??{};
  const stockSlots=[[50,90],[18,69],[39,69],[61,69],[82,69],[24,45],[50,45],[76,45],[22,19],[50,19],[78,19]];
  const stock=Object.fromEntries((source.preferredStarterIds??[]).slice(0,11).map((id,i)=>[id,{x:stockSlots[i][0],y:stockSlots[i][1]}]));
  const linesFor=positions=>deriveFormationLines(Object.entries(positions).map(([id,position])=>({id,position})));
  const positionPresets={position1:copyPositions(base)};
  const formationLinePresets={position1:sanitizeFormationLines(source.formationLinePresets?.position1??linesFor(base))};
  const positionPresetOverrides={};
  for(const key of LINKED_POSITION_PRESETS){
    const positions=source.positionPresets?.[key]??base;
    const lines=source.formationLinePresets?.[key]??linesFor(positions);
    const equalBase=samePositionMap(positions,base)&&sameFormationLines(lines,formationLinePresets.position1);
    const untouchedStock=Object.keys(stock).length===11&&samePositionMap(positions,stock)&&sameFormationLines(lines,linesFor(stock));
    const explicit=source.positionPresetOverrides?.[key];
    const independent=typeof explicit==='boolean'?explicit:!equalBase&&!untouchedStock;
    positionPresetOverrides[key]=independent;
    positionPresets[key]=copyPositions(independent?positions:base);
    formationLinePresets[key]=sanitizeFormationLines(independent?lines:formationLinePresets.position1);
  }
  return {positionPresets,formationLinePresets,positionPresetOverrides};
}
