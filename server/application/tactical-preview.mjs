import { buildV21TacticalShapePreview } from "../../engine/s4-v2.1/versus/v2/tactical-shape-preview-v2.js";
import { V2_MATCH_PARAMETERS } from "../../engine/s4-v2.1/versus/v2/match-parameters-v2.js";
import { analyzeElevenBoardFormation, sanitizeFormationLines } from "../../formation-rules.js";

export function campaignTacticalPreview(account, body = {}) {
  const fail = (message) => { throw Object.assign(new Error(message),{statusCode:400}); };
  if (!account.setupComplete) fail("请先完成建队");
  const ids=body.starterIds;
  if(!Array.isArray(ids)||ids.length!==11||new Set(ids).size!==11) fail("动态预览需要完整的11人首发阵容");
  const players=ids.map(id=>account.draft?.roster?.find(player=>player.id===id));
  if(players.some(player=>!player)) fail("预览只能使用本队球员");
  const positions=Object.fromEntries(ids.map(id=>{
    const x=Number(body.positions?.[id]?.x),y=Number(body.positions?.[id]?.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))fail("预览站位无效");
    return [id,{x:Math.max(8,Math.min(92,x)),y:Math.max(6,Math.min(94,y))}];
  }));
  const roles=analyzeElevenBoardFormation(players,positions,sanitizeFormationLines(body.formationLines)).roles;
  const submitted=body.plan??{};
  const plan={...submitted,tacticalDimensions:Object.fromEntries(Object.entries(submitted.tacticalDimensions??{}).filter(([,v])=>Number.isFinite(Number(v))).map(([k,v])=>[k,Math.max(0,Math.min(100,Number(v)))])),playerDuties:Object.fromEntries(ids.map(id=>[id,submitted.playerDuties?.[id]??""]))};
  const scoreState=body.planState==="leading"?"leading":body.planState==="trailing"?"trailing":"level";
  return buildV21TacticalShapePreview({players,positions,roles,plan,scoreState,minute:scoreState==="level"?25:70,parameters:V2_MATCH_PARAMETERS});
}
