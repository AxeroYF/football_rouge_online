import {roleGroup} from '../../shared/football/schema.js';
import {isV3} from './model-config.js';

export function defensiveInstructionPositions(positions,roles,details={},parameters) {
  if(!isV3(parameters))return positions;
  const shift=({left:-4,right:4})[details.defenseDirection]??0;
  const scale=({protectCenter:.86,forceWide:1.1})[details.defensiveWidth]??1;
  if(!shift&&scale===1)return positions;
  return Object.fromEntries(Object.entries(positions).map(([id,position])=>{
    const group=roleGroup(roles[id]);
    return [id,["DEF","MID"].includes(group)
      ? {...position,x:Math.max(0,Math.min(100,50+(position.x-50)*scale+shift))}
      : position];
  }));
}
