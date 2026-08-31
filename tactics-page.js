import {
  DEFAULT_FORMATION_LINES,
  FORMATION_LINE_KEYS,
  analyzeElevenBoardFormation,
  formationRoleZones,
  moveFormationLine,
  sanitizeFormationLines,
} from "./formation-rules.js";
import { optimalLineupAssignment, remapLineupPresetSlots } from "./tactics-lineup-rules.js";
import { PLAY_STYLE_LABELS as STYLES, ROLE_LABELS, TACTIC_LABELS as TACTICS } from "./shared/football/labels.js";
import {
  activateWideWindow,
  deactivateWideWindow,
  registerWideWindow,
} from "./client/ui/wide-window.js";

const BENCH_ROLE_ORDER = Object.freeze(["GK","CB","LB","RB","LWB","RWB","DM","AM","LM","RM","ST","LW","RW"]);
const BENCH_ROLE_RANK = new Map(BENCH_ROLE_ORDER.map((role,index)=>[role,index]));
const PLAN_META = { opening:["默认方案","开局与平局阶段","position1"], leading:["领先方案","达到领先节点后","position2"], trailing:["落后方案","达到落后节点后","position3"] };
const POSITION_META = { position1:["站位一","默认"], position2:["站位二","领先"], position3:["站位三","落后"] };
const ROLE_CORE_ATTRIBUTES = {
  GK:["goalkeeping","reflexes","positioning","composure"],
  DEF:["tackling","marking","positioning","strength","pace"],
  MID:["passing","vision","decisions","firstTouch","stamina"],
  ATT:["finishing","offBall","pace","dribbling","composure"],
};
const ATTRIBUTE_LABELS = { passing:"传球",firstTouch:"停球",dribbling:"盘带",crossing:"传中",finishing:"射门",longShots:"远射",heading:"头球",setPieces:"定位球",tackling:"抢断",marking:"盯人",positioning:"站位",vision:"视野",decisions:"决策",composure:"冷静",offBall:"无球",discipline:"纪律",pace:"速度",acceleration:"加速",strength:"力量",stamina:"耐力",agility:"灵活",jumping:"弹跳",workRate:"投入",aggression:"侵略性",goalkeeping:"守门",reflexes:"反应" };
const DIMENSIONS = { tempo:"比赛节奏", directness:"传球纵深", attackingWidth:"进攻宽度", defensiveLine:"防线高度", pressing:"压迫强度", compactness:"阵型紧凑", counterAttack:"反击倾向", timeWasting:"比赛控制" };
const DIMENSION_PRESETS = {
  allOutAttack:{ tempo:72,directness:58,attackingWidth:60,defensiveLine:76,pressing:72,compactness:42,counterAttack:36,timeWasting:0 },
  positive:{ tempo:60,directness:53,attackingWidth:55,defensiveLine:58,pressing:58,compactness:54,counterAttack:44,timeWasting:5 },
  balanced:{ tempo:50,directness:50,attackingWidth:50,defensiveLine:50,pressing:50,compactness:55,counterAttack:50,timeWasting:15 },
  defensive:{ tempo:44,directness:56,attackingWidth:46,defensiveLine:42,pressing:42,compactness:64,counterAttack:62,timeWasting:32 },
  parkBus:{ tempo:36,directness:60,attackingWidth:42,defensiveLine:28,pressing:30,compactness:72,counterAttack:64,timeWasting:55 },
};
const STYLE_ADJUSTMENTS = {
  possession:{ tempo:-8,directness:-22,attackingWidth:-4,compactness:8,counterAttack:-18 },
  longBall:{ tempo:7,directness:30,attackingWidth:6,counterAttack:8 }, wingPlay:{ tempo:5,directness:5,attackingWidth:30,compactness:-8 },
  counterAttack:{ tempo:8,directness:14,defensiveLine:-10,pressing:-6,compactness:8,counterAttack:20 },
  highPress:{ tempo:10,directness:-4,defensiveLine:22,pressing:32,compactness:12 }, lowBlock:{ tempo:-10,directness:8,defensiveLine:-20,pressing:-16,compactness:18,counterAttack:8 },
  roughPlay:{ tempo:4,directness:8,pressing:16,compactness:6 },
};
const IN_DETAILS = {
  attackDirection:["进攻方向",{ left:"左路",leftHalf:"左肋",center:"中路",rightHalf:"右肋",right:"右路",balanced:"均衡" }],
  chanceCreation:["机会创造",{ patient:"耐心寻找",balanced:"均衡",shootOnSight:"尽快起脚" }],
  longShots:["远射倾向",{ reduce:"减少",balanced:"均衡",increase:"增加" }], crossing:["传中倾向",{ reduce:"减少",balanced:"均衡",increase:"增加" }],
};
const OUT_DETAILS = {
  defensiveWidth:["防守宽度",{ protectCenter:"保护中路",balanced:"均衡",forceWide:"封锁边路" }],
  defenseDirection:["防守方向",{ left:"重点防左",center:"重点防中",right:"重点防右",balanced:"均衡" }],
  marking:["盯人方式",{ zonal:"区域防守",mixed:"混合",man:"贴身盯人" }], lineStrategy:["防线策略",{ drop:"回收",hold:"保持",offside:"造越位" }],
};
const DUTIES = {
  ST:[["","默认职责"],["advancedForward","突前前锋"],["targetForward","支点中锋"],["deepLyingForward","回撤前锋"]],
  LW:[["","默认职责"],["bylineWinger","下底边锋"],["insideForward","内切边锋"]], RW:[["","默认职责"],["bylineWinger","下底边锋"],["insideForward","内切边锋"]],
  AM:[["","默认职责"],["advancedPlaymaker","前场组织核心"],["shadowStriker","影子前锋"]],
  DM:[["","默认职责"],["anchor","防守锚点"],["ballWinningMidfielder","抢球后腰"],["deepLyingPlaymaker","拖后组织核心"]],
  LM:[["","默认职责"],["wideMidfielder","传统边前卫"],["invertedWideMidfielder","内收边前卫"],["defensiveWideMidfielder","防守边前卫"]],
  RM:[["","默认职责"],["wideMidfielder","传统边前卫"],["invertedWideMidfielder","内收边前卫"],["defensiveWideMidfielder","防守边前卫"]],
  LB:[["","默认职责"],["holdingFullback","留守边卫"],["overlappingFullback","套边边卫"],["invertedFullback","内收边卫"]],
  RB:[["","默认职责"],["holdingFullback","留守边卫"],["overlappingFullback","套边边卫"],["invertedFullback","内收边卫"]],
  LWB:[["","默认职责"],["holdingFullback","留守边卫"],["overlappingFullback","套边边卫"],["invertedFullback","内收边卫"]],
  RWB:[["","默认职责"],["holdingFullback","留守边卫"],["overlappingFullback","套边边卫"],["invertedFullback","内收边卫"]],
  CB:[["","默认职责"],["ballPlayingDefender","出球中卫"],["stopper","上抢中卫"],["coverDefender","拖后中卫"]], GK:[["","门线门将"]],
};
const DEFAULT_IN = { attackDirection:"balanced",chanceCreation:"balanced",longShots:"balanced",crossing:"balanced" };
const DEFAULT_OUT = { defensiveWidth:"balanced",defenseDirection:"balanced",marking:"mixed",lineStrategy:"hold" };
const clone = (value) => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[char]);
const options = (items, selected) => Object.entries(items).map(([value,label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");

function compareBenchPlayers(left,right) {
  const roleDifference=(BENCH_ROLE_RANK.get(String(left.role??""))??BENCH_ROLE_ORDER.length)-(BENCH_ROLE_RANK.get(String(right.role??""))??BENCH_ROLE_ORDER.length);
  if(roleDifference)return roleDifference;
  const overallDifference=Number(right.effectiveOverall??right.overall??0)-Number(left.effectiveOverall??left.overall??0);
  return overallDifference||String(left.name??left.id).localeCompare(String(right.name??right.id),"zh-CN");
}

function frameThrottlePointerMove(handler) {
  let animationFrame=null,pendingPoint=null;
  const applyPending=()=>{animationFrame=null;const point=pendingPoint;pendingPoint=null;if(point)handler(point);};
  const listener=(event)=>{pendingPoint={clientX:event.clientX,clientY:event.clientY};if(animationFrame===null)animationFrame=requestAnimationFrame(applyPending);};
  listener.flush=(event)=>{pendingPoint={clientX:event.clientX,clientY:event.clientY};if(animationFrame!==null)cancelAnimationFrame(animationFrame);applyPending();};
  listener.cancel=()=>{if(animationFrame!==null)cancelAnimationFrame(animationFrame);animationFrame=null;pendingPoint=null;};
  return listener;
}

function defaultDimensions(tactic="balanced", style="possession") {
  const base = DIMENSION_PRESETS[tactic] ?? DIMENSION_PRESETS.balanced;
  const adjustment = STYLE_ADJUSTMENTS[style] ?? {};
  return Object.fromEntries(Object.keys(DIMENSIONS).map((key) => [key,clamp(Math.round(base[key] + Number(adjustment[key] ?? 0)),0,100)]));
}
function defaultPositions(roster) {
  const groups = { GK:[],DEF:[],MID:[],ATT:[] };
  roster.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const result = {};
  [["GK",90],["DEF",68],["MID",44],["ATT",20]].forEach(([key,y]) => groups[key].forEach((player,index) => { result[player.id] = { x:Math.round(12 + (index + 1) * 76 / (groups[key].length + 1)),y }; }));
  return result;
}
function defaultPlan(tactic, style, positionPreset, triggerGoalDifference) {
  return { tactic,style,positionPreset,...(triggerGoalDifference ? { triggerGoalDifference } : {}),inPossessionDetails:{...DEFAULT_IN},outOfPossessionDetails:{...DEFAULT_OUT},tacticalDimensions:defaultDimensions(tactic,style),playerDuties:{} };
}
function normalizePlan(value, fallback) {
  const tactic = TACTICS[value?.tactic] ? value.tactic : fallback.tactic;
  const style = STYLES[value?.style] ? value.style : fallback.style;
  return { ...fallback,...value,tactic,style,inPossessionDetails:{...DEFAULT_IN,...value?.inPossessionDetails},outOfPossessionDetails:{...DEFAULT_OUT,...value?.outOfPossessionDetails},tacticalDimensions:{...defaultDimensions(tactic,style),...value?.tacticalDimensions},playerDuties:{...value?.playerDuties} };
}
function normalizeState(saved, roster) {
  const embedded = saved?.planSnapshots?.__s4V2 ?? {};
  const ids = new Set(roster.map((player) => player.id));
  const starters = [...new Set((embedded.starters ?? saved?.starters ?? roster.slice(0,11).map((player) => player.id)).filter((id) => ids.has(id)))].slice(0,11);
  roster.forEach((player) => { if (starters.length < 11 && !starters.includes(player.id)) starters.push(player.id); });
  const basePositions = { ...defaultPositions(roster),...(saved?.positions ?? {}),...(embedded.positionPresets?.position1 ?? {}) };
  const state = {
    starters, activePositionPreset:embedded.activePositionPreset ?? "position1", activePlan:embedded.activePlan ?? saved?.activePlan ?? "opening",
    positionPresets:{ position1:clone(basePositions),position2:clone(embedded.positionPresets?.position2 ?? basePositions),position3:clone(embedded.positionPresets?.position3 ?? basePositions) },
    formationLinePresets:{ position1:sanitizeFormationLines(embedded.formationLinePresets?.position1 ?? saved?.formationLines),position2:sanitizeFormationLines(embedded.formationLinePresets?.position2 ?? saved?.formationLines),position3:sanitizeFormationLines(embedded.formationLinePresets?.position3 ?? saved?.formationLines) },
    tacticalPlans:{
      opening:normalizePlan(embedded.tacticalPlans?.opening ?? saved?.planSnapshots?.opening,defaultPlan(saved?.attackStyle ?? "balanced",saved?.defenseStyle ?? "possession","position1")),
      leading:normalizePlan(embedded.tacticalPlans?.leading ?? saved?.planSnapshots?.leading,defaultPlan("defensive","counterAttack","position2",1)),
      trailing:normalizePlan(embedded.tacticalPlans?.trailing ?? saved?.planSnapshots?.trailing,defaultPlan("positive","possession","position3",1)),
    },
    captainId:ids.has(embedded.captainId) ? embedded.captainId : starters[0] ?? null, fitnessThreshold:clamp(Number(embedded.fitnessThreshold ?? 65),45,100), showRoleZones:Boolean(embedded.showRoleZones), showReferenceLines:embedded.showReferenceLines !== false,
  };
  return state;
}
function roleFit(player, role) {
  if (player.role === role) return "primary";
  if (player.secondaryRole === role) return "secondary";
  return "unfamiliar";
}
function playerFitness(player) { return clamp(Math.round(Number(player.effectiveFitness ?? player.state?.fitness ?? 100)),0,100); }
function playerTooltip(player, assignedRole=player.role) {
  const status=player.state?.injuryRounds?"伤停 "+player.state.injuryRounds+" 轮":player.state?.suspension?"停赛":"可出场";
  const group=assignedRole==="GK"?"GK":["CB","LB","RB","LWB","RWB"].includes(assignedRole)?"DEF":["ST","LW","RW"].includes(assignedRole)?"ATT":"MID";
  const attributes=ROLE_CORE_ATTRIBUTES[group].map((key)=>ATTRIBUTE_LABELS[key]+" "+Math.round(player.effectiveAttributes?.[key]??player.attributes?.[key]??0)).join(" · ");
  return [
    (player.nationality??"未知国籍")+(player.club?" · "+player.club:""),
    "综合能力："+(player.effectiveOverall??player.overall??"-")+(player.upgradeLevel?"（基础 "+(player.baseOverall??player.overall)+"，强化 +"+player.upgradeLevel+"）":""),
    "主位置："+(ROLE_LABELS[player.role]??player.role??"-")+" · 副位置："+(ROLE_LABELS[player.secondaryRole]??"无"),
    "当前位置："+(ROLE_LABELS[assignedRole]??assignedRole??"-"),
    "身高："+Math.round(player.effectiveHeightCm??player.heightCm??0)+"cm · 体能："+playerFitness(player)+" · "+status,
    attributes,
  ].join("\n");
}

export function createTacticsController({ panel, mapElement, getCampaignState, setCampaignState, request, showToast }) {
  let state = null;
  let saveTimer = null;
  let saving = false;
  let previewTimer = null;
  let mobileDutyPlayerId = null;
  const roster = () => getCampaignState()?.draft?.roster ?? [];
  const positions = () => state.positionPresets[state.activePositionPreset];
  const formationLines = () => state.formationLinePresets[state.activePositionPreset];
  const planState = () => ({ position1:"opening",position2:"leading",position3:"trailing" })[state.activePositionPreset];
  const activePlan = () => state.tacticalPlans[state.activePlan];
  const starters = () => state.starters.map((id) => roster().find((player) => player.id === id)).filter(Boolean);
  const analysis = () => analyzeElevenBoardFormation(starters(),positions(),formationLines());
  const presetAnalysis = (key) => analyzeElevenBoardFormation(starters(),state.positionPresets[key],state.formationLinePresets[key]);
  function formationValidity(key=state.activePositionPreset) {
    const shape=presetAnalysis(key); const requireOutfieldLines=key === "position1";
    const validOutfieldLines=[shape.counts.DEF,shape.counts.MID,shape.counts.ATT].every((count)=>count>=1);
    const valid=starters().length===11&&shape.counts.GK===1&&(!requireOutfieldLines||validOutfieldLines);
    const message=starters().length!==11?"场上必须保持恰好11名球员。":shape.counts.GK!==1?"门将位置必须且只能有一人。":requireOutfieldLines&&!validOutfieldLines?"后场、中场、前场必须各至少一人。":"阵型有效";
    return {...shape,valid,message};
  }
  const markDirty = (delay=650) => { setSaveStatus("dirty","有未保存修改"); clearTimeout(saveTimer); saveTimer=setTimeout(() => persist(true),delay); };
  function setSaveStatus(kind,text) { const node=panel.querySelector("[data-league-autosave-status]"); if(node){ node.dataset.state=kind === "dirty" ? "pending" : kind; const label=node.querySelector("[data-league-autosave-label]"); if(label) label.textContent=text; } }
  function serialize() {
    const current = state.tacticalPlans.opening;
    const currentPositions = state.positionPresets.position1;
    return { formation:analyzeElevenBoardFormation(starters(),currentPositions,state.formationLinePresets.position1).name,attackStyle:current.tactic,defenseStyle:current.style,starters:[...state.starters],bench:roster().map((p)=>p.id).filter((id)=>!state.starters.includes(id)),positions:clone(currentPositions),formationLines:clone(state.formationLinePresets.position1),tacticalBars:clone(current.tacticalDimensions),activePlan:state.activePlan,planSnapshots:{ opening:clone(state.tacticalPlans.opening),leading:clone(state.tacticalPlans.leading),trailing:clone(state.tacticalPlans.trailing),__s4V2:clone(state) } };
  }
  async function persist(silent=false) {
    const invalidKey=Object.keys(POSITION_META).find((key)=>!formationValidity(key).valid);
    if(invalidKey){ const validity=formationValidity(invalidKey); const label=POSITION_META[invalidKey][1]; setSaveStatus("error",`${label}站位未保存`); if(!silent)showToast(`${label}站位：${validity.message}`); return; }
    if (saving) return markDirty(800);
    saving=true; setSaveStatus("saving","正在自动保存…");
    try { const value=await request("/api/campaign/tactics",{method:"POST",body:serialize()}); setCampaignState(value.state); setSaveStatus("saved","已自动保存"); if(!silent) showToast("战术方案已保存"); }
    catch(error){ setSaveStatus("error","保存失败"); if(!silent) showToast(error.message||"战术保存失败"); }
    finally { saving=false; }
  }
  function roleZonesMarkup() {
    if(!state.showRoleZones) return "";
    return `<div class="formation-role-zones" aria-label="位置自动识别区域">${formationRoleZones(formationLines()).map((zone)=>`<span class="formation-role-zone role-${zone.role.toLowerCase()}" style="left:${zone.xMin}%;top:${zone.yMin}%;width:${zone.xMax-zone.xMin}%;height:${zone.yMax-zone.yMin}%"><b>${zone.role}</b><small>${ROLE_LABELS[zone.role]??zone.role}</small></span>`).join("")}</div>`;
  }
  function referenceLinesMarkup() {
    const labels={attack:"前场线",midfield:"中场线",defense:"后场线",goalkeeper:"门将线"};
    return FORMATION_LINE_KEYS.map((key)=>`<button type="button" class="formation-reference-line line-${key}" data-formation-line="${key}" style="top:${formationLines()[key]}%" aria-label="拖动${labels[key]}"><i></i></button>`).join("");
  }
  function dutyMarkup(playerId,role) {
    const choices=DUTIES[role]??DUTIES.DM; const selected=state.tacticalPlans[planState()].playerDuties[playerId]??""; const label=choices.find(([id])=>id===selected)?.[1]??choices[0][1];
    return role === "GK" ? `<span class="league-magnet-duty is-static"><b>门线门将</b></span>` : `<span class="league-magnet-duty"><button type="button" data-duty-step="-1" data-league-duty-step="-1" data-player="${esc(playerId)}">‹</button><b data-league-duty-label>${esc(label)}</b><button type="button" data-duty-step="1" data-league-duty-step="1" data-player="${esc(playerId)}">›</button></span>`;
  }
  function magnet(player,field=true) {
    const role=field ? analysis().roles[player.id]??player.role : player.role; const fit=roleFit(player,role); const fitness=playerFitness(player); const pos=positions()[player.id]??{x:50,y:50};
    return `<div class="magnet ${field?"league-squad-magnet":"bench-magnet league-bench-magnet"} grade-${String(player.grade??"C").toLowerCase()} fit-${fit}" tabindex="0" ${field?`data-league-magnet="${esc(player.id)}" style="left:${pos.x}%;top:${pos.y}%"`:`data-league-bench-magnet="${esc(player.id)}"`} data-primary-role="${esc(player.role)}" data-secondary-role="${esc(player.secondaryRole)}" data-traits="${esc(player.nationality)} · ${esc(player.club)} · 主位置 ${ROLE_LABELS[player.role]??player.role}${player.secondaryRole?` · 副位置 ${ROLE_LABELS[player.secondaryRole]??player.secondaryRole}`:""}">${player.id===state.captainId?`<span class="captain-c-badge">C</span>`:""}<span class="league-magnet-role">${ROLE_LABELS[role]??role}</span><b>${esc(player.name)}</b><i>${player.overall}</i><span class="league-magnet-fitness ${fitness<state.fitnessThreshold?"is-below-threshold":"is-above-threshold"}" data-magnet-fitness="${fitness}"><span style="width:${fitness}%"></span></span>${field?dutyMarkup(player.id,role):""}</div>`;
  }
  function dimensionsMarkup(key,plan) { return `<div class="league-tactical-dimensions">${Object.entries(DIMENSIONS).map(([dimension,label])=>`<label class="league-tactical-dimension"><span>${label}<output data-tactical-dimension-output="${key}Dimension_${dimension}">${plan.tacticalDimensions[dimension]}</output></span><input type="range" min="0" max="100" step="1" name="${key}Dimension_${dimension}" value="${plan.tacticalDimensions[dimension]}" data-dimension="${dimension}" data-plan="${key}"></label>`).join("")}</div>`; }
  function detailFieldsMarkup(key,collection,values,prefix) { return `<section><header><b>${prefix==="in"?"持球进攻":"无球防守"}</b></header><div>${Object.entries(collection).map(([field,[label,entries]])=>`<label class="field"><span>${label}</span><select data-detail="${prefix}" data-field="${field}" data-plan="${key}" name="${key}${prefix==="in"?"In":"Out"}Detail_${field}">${options(entries,values[field])}</select></label>`).join("")}</div></section>`; }
  function planMarkup(key) {
    const plan=state.tacticalPlans[key]; const [title]=PLAN_META[key];
    return `<section class="league-match-plan" data-plan-state="${key}"><header><b>${title.replace("方案","战术")}</b></header><div class="league-match-plan-fields league-match-plan-preset-fields"><label class="field"><span>比赛心态</span><select data-plan-tactic="${key}" name="${key}Tactic">${options(TACTICS,plan.tactic)}</select></label><label class="field"><span>预设打法</span><select data-plan-style="${key}" name="${key}Style">${options(STYLES,plan.style)}</select></label></div>${dimensionsMarkup(key,plan)}<div class="league-phase-instructions">${detailFieldsMarkup(key,IN_DETAILS,plan.inPossessionDetails,"in")}${detailFieldsMarkup(key,OUT_DETAILS,plan.outOfPossessionDetails,"out")}</div></section>`;
  }
  function tacticalFit(key) {
    const preset=PLAN_META[key][2], pos=state.positionPresets[preset], lines=state.formationLinePresets[preset]; const shape=analyzeElevenBoardFormation(starters(),pos,lines); const plan=state.tacticalPlans[key];
    const playerScore=starters().reduce((sum,p)=>sum+Number(p.overall??60)*({primary:1,secondary:.94,unfamiliar:.7}[roleFit(p,shape.roles[p.id])]??.8),0)/Math.max(1,starters().length);
    const gaps=Math.max(lines.midfield-lines.attack,lines.defense-lines.midfield,lines.goalkeeper-lines.defense); const structure=clamp(100-Math.abs(gaps-(25-plan.tacticalDimensions.compactness*.07))*2,55,100);
    return Math.round(clamp(playerScore*.78+structure*.22,45,99));
  }
  function pitchMarkup(content) {
    return `<div class="pitch" id="league-tactics-pitch"><div class="pitch-lines"><span class="pitch-halfway"></span><span class="pitch-center-circle"></span><span class="pitch-center-mark"></span><span class="pitch-penalty-box pitch-penalty-box-top"></span><span class="pitch-goal-box pitch-goal-box-top"></span><span class="pitch-penalty-arc pitch-penalty-arc-top"></span><span class="pitch-penalty-mark pitch-penalty-mark-top"></span><span class="pitch-penalty-box pitch-penalty-box-bottom"></span><span class="pitch-goal-box pitch-goal-box-bottom"></span><span class="pitch-penalty-arc pitch-penalty-arc-bottom"></span><span class="pitch-penalty-mark pitch-penalty-mark-bottom"></span></div>${content}</div>`;
  }
  function mobileDutySheetMarkup() {
    if(!mobileDutyPlayerId) return "";
    const player=roster().find((candidate)=>candidate.id===mobileDutyPlayerId); const role=analysis().roles[mobileDutyPlayerId]; if(!player||!role)return "";
    const choices=DUTIES[role]??DUTIES.DM; const selected=state.tacticalPlans[planState()].playerDuties[player.id]??""; const label=choices.find(([id])=>id===selected)?.[1]??choices[0][1];
    return `<div class="league-mobile-duty-backdrop"><section class="league-mobile-duty-sheet"><header><div><small>${ROLE_LABELS[role]??role} · ${esc(player.name)}</small><b>选择球员职责</b></div><button type="button" data-mobile-duty-close>×</button></header><div class="league-mobile-duty-selector"><button type="button" data-mobile-duty-step="-1">‹</button><div><small>当前职责</small><b>${esc(label)}</b><p>左右切换当前比赛阶段的球员职责。</p></div><button type="button" data-mobile-duty-step="1">›</button></div><footer>职责按默认、领先、落后三个战术阶段独立保存</footer></section></div>`;
  }
  function render() {
    stopPreview(); const rosterValue=roster(); const starterPlayers=starters(); const shape=analysis(); const bench=rosterValue.filter((player)=>!state.starters.includes(player.id)).sort(compareBenchPlayers);
    const fitCounts={primary:0,secondary:0,unfamiliar:0}; starterPlayers.forEach((player)=>{fitCounts[roleFit(player,shape.roles[player.id])]++}); const fitScore=Math.round((fitCounts.primary*100+fitCounts.secondary*90+fitCounts.unfamiliar*66)/Math.max(1,starterPlayers.length)); const activeFit=tacticalFit(planState()); const validity=formationValidity(); const allPresetsValid=Object.keys(POSITION_META).every((key)=>formationValidity(key).valid);
    const positionTabs=`<nav class="league-position-tabs" aria-label="保存站位">${Object.entries(POSITION_META).map(([key,[,label]])=>`<button type="button" data-league-position-preset="${key}" class="${state.activePositionPreset===key?"active":""} ${formationValidity(key).valid?"valid":"invalid"}" aria-pressed="${state.activePositionPreset===key}">${label}站位</button>`).join("")}</nav>`;
    const relationshipControls=`<label class="league-board-chemistry"><input type="checkbox" data-league-chemistry-toggle><span>默契连线</span></label><label class="league-board-chemistry"><input type="checkbox" data-league-bond-bonus-toggle><span>羁绊增益</span></label><label class="league-board-chemistry league-board-role-zones-toggle"><input type="checkbox" data-league-role-zones-toggle ${state.showRoleZones?"checked":""}><span>位置阴影</span></label><label class="league-board-fitness"><span>体力红线</span><input type="number" inputmode="numeric" min="45" max="100" value="${state.fitnessThreshold}" data-fitness-threshold><em>%</em></label>`;
    const schemeSwitcher=`<div class="league-lineup-scheme-switcher"><label><span>阵容方案</span><select aria-label="切换阵容方案"><option>方案 1</option></select></label><button type="button" title="重命名当前方案">✎</button><button type="button" title="新增阵容方案">＋</button><button type="button" class="danger" disabled>×</button><label class="league-lineup-assignment"><span>适配赛事</span><select><option>所有比赛</option><option>联赛</option><option>杯赛</option><option>友谊赛</option></select></label></div>`;
    const boardToolbar=`<div class="league-board-controls"><div class="league-board-tool-stack"><div class="league-relationship-controls">${relationshipControls}</div><div class="league-board-toolbar">${positionTabs}</div></div><div class="league-board-side">${schemeSwitcher}</div></div>`;
    const guidanceButtons=`<div class="league-bench-guidance"><button type="button" data-recommend-lineup title="默认站位可从全队选择首发；领先和落后站位只重排默认首发">自动替换球员</button><button type="button" data-recommend-duties>适配职责</button></div>`;
    const benchSummary=`<section class="league-bench-summary"><div class="league-bench-summary-title"><small>AUTO FORMATION</small><b>自动识别阵型</b></div><div class="league-bench-shape"><strong>${shape.name}</strong><span class="${validity.valid?"valid":"invalid"}">${validity.valid?"阵型有效":"需要调整"}</span></div><div class="league-fit-row"><div class="league-fit-block"><div class="league-fit-heading"><span>阵容适配度</span><b>${fitScore}<small>/100</small></b></div><div class="league-fit-bar"><span style="width:${fitScore}%"></span></div></div><div class="league-fit-block tactical"><div class="league-fit-heading"><span>战术适配度</span><b>${activeFit}<small>/100</small></b></div><div class="league-fit-bar"><span style="width:${activeFit}%"></span></div></div></div><div class="league-fit-counts"><span>主位置<b>${fitCounts.primary}</b></span><span>副位置<b>${fitCounts.secondary}</b></span><span>不适配<b>${fitCounts.unfamiliar}</b></span></div>${validity.valid?"":`<p>${validity.message}</p>`}</section>`;
    const previewMenu=`<details class="league-tactical-shape-preview-menu"><summary><span><small>当前站位动态</small><b>选择落位预览</b></span></summary><div class="league-tactical-shape-preview-list"><button type="button" data-league-tactical-shape-mode="base"><i>01</i><span><b>默认站位</b><small>回到当前战术板位置</small></span></button><button type="button" data-league-tactical-shape-mode="attack"><i>02</i><span><b>进攻落位</b><small>当前职责的持球目标位置</small></span></button><button type="button" data-league-tactical-shape-mode="defense"><i>03</i><span><b>防守落位</b><small>当前职责的禁区保护位置</small></span></button></div></details>`;
    const autosaveFooter=`<footer class="league-autosave-footer"><div class="league-autosave-status" data-league-autosave-status data-state="saved"><i></i><span class="league-autosave-copy"><small>战术实时保存</small><b data-league-autosave-label>已实时保存</b></span></div>${previewMenu}</footer>`;
    const captainControls=`<div class="league-captain-controls"><label><span>场上队长</span><select data-captain><option value="">未设置队长</option>${starterPlayers.map((p)=>`<option value="${esc(p.id)}" ${p.id===state.captainId?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label><label><span>队长风格</span><select><option>以身作则</option><option>鼓舞型</option><option>战术型</option></select></label></div>`;
    const nodeControls=`<div class="league-tactical-node-controls"><label><span>领先战术节点</span><select data-plan-trigger="leading">${[1,2,3,4,5].map((n)=>`<option value="${n}" ${n===state.tacticalPlans.leading.triggerGoalDifference?"selected":""}>${n===5?"5+":n} 球</option>`).join("")}</select></label><label><span>落后战术节点</span><select data-plan-trigger="trailing">${[1,2,3,4,5].map((n)=>`<option value="${n}" ${n===state.tacticalPlans.trailing.triggerGoalDifference?"selected":""}>${n===5?"5+":n} 球</option>`).join("")}</select></label></div>`;
    const mobileTabs=`<nav class="league-mobile-plan-tabs">${Object.entries(PLAN_META).map(([key,[title]])=>`<button type="button" data-select-plan="${key}" class="${state.activePlan===key?"active":""}">${title.replace("方案","战术")}</button>`).join("")}</nav>`;
    const aiTrainingActions=`<div class="league-ai-training-actions"><label class="league-mirror-upload"><input type="checkbox" disabled><span>上传完整战术镜像</span></label><button type="button" class="button secondary league-ai-training-open" disabled><span>▶</span> AI 对战</button></div>`;
    const nextMatch=`<section class="league-next-match"><div><small>NEXT MATCH</small><b>征程赛程待接入</b></div><div><small>比赛阶段</small><strong>阵容准备</strong></div><div><small>天气与裁判</small><strong>等待赛程生成</strong></div><div><small>战术提示</small><span>完整 S4 阵容战术面板已启用</span></div></section>`;
    panel.innerHTML=`<section class="league-squad-page"><form class="league-tactics-layout" id="league-squad-form" data-tactics-mode="club" data-active-mobile-plan="${state.activePlan}">${nextMatch}<section class="league-lineup-workspace"><section class="board-panel league-board-panel"><header class="league-board-heading">${boardToolbar}</header>${pitchMarkup(`${roleZonesMarkup()}${referenceLinesMarkup()}${starterPlayers.map((player)=>magnet(player,true)).join("")}`)}</section><aside class="tournament-bench league-bench"><header><div><small>FULL SQUAD</small><b>替补席 · ${bench.length}人</b></div><span>主力与替补磁贴可双向拖动交换</span>${guidanceButtons}</header><div class="bench-magnet-list">${bench.map((player)=>magnet(player,false)).join("")}</div>${autosaveFooter}</aside><aside class="league-tactics-detail"><header><div class="league-tactics-detail-title"><span><small>V2 TACTICAL CONTROL</small><b>细节战术</b></span>${captainControls}<div class="league-lineup-share-actions"><button type="button" class="button secondary">导出</button><button type="button" class="button secondary">导入</button></div>${nodeControls}${aiTrainingActions}</div></header>${mobileTabs}<div class="league-tactics-detail-scroll">${benchSummary}<section class="league-match-plans league-bench-match-plans"><header><b>赛中战术</b></header><div class="league-match-plan-grid">${Object.keys(PLAN_META).map(planMarkup).join("")}</div></section></div></aside></section>${allPresetsValid?"":`<p class="league-position-save-warning">默认站位需要保持完整阵型；领先与落后站位只要求场上保留一名门将。</p>`}</form>${mobileDutySheetMarkup()}</section>`;
    bind();
  }
  function setPreset(key) { state.activePositionPreset=key; state.activePlan=planState(); mobileDutyPlayerId=null; render(); }
  function swapStarter(benchId,starterId) {
    const index=state.starters.indexOf(starterId); if(index<0)return; state.starters[index]=benchId;
    Object.values(state.positionPresets).forEach((map)=>{ map[benchId]={...(map[starterId]??{x:50,y:50})}; delete map[starterId]; });
    Object.values(state.tacticalPlans).forEach((plan)=>{ if(Object.hasOwn(plan.playerDuties,starterId)){ plan.playerDuties[benchId]=plan.playerDuties[starterId]; delete plan.playerDuties[starterId]; } });
    if(state.captainId===starterId)state.captainId=benchId; render(); markDirty(180);
  }
  function recommendLineup() {
    const rosterValue=roster();
    const sourceStarterIds=[...state.starters];
    const canUseBench=state.activePositionPreset==="position1";
    const activePositions=state.positionPresets[state.activePositionPreset];
    const activeLines=state.formationLinePresets[state.activePositionPreset];
    const currentPlayers=sourceStarterIds.map((id)=>rosterValue.find((player)=>player.id===id)).filter(Boolean);
    const activeRoles=analyzeElevenBoardFormation(currentPlayers,activePositions,activeLines).roles;
    const slots=sourceStarterIds.map((playerId)=>({playerId,role:activeRoles[playerId]}));
    const candidates=canUseBench?rosterValue:currentPlayers;
    const assignments=optimalLineupAssignment(slots,candidates,(player,slot)=>{
      const unavailable=Boolean(player.state?.seasonFinalBanned||player.state?.seasonFinalSuspension||player.state?.suspension||player.state?.injuryRounds);
      const fit={primary:1,secondary:.9,unfamiliar:.66}[roleFit(player,slot.role)]??.66;
      const overall=Number(player.effectiveOverall??player.overall??0);
      const fitness=Number(player.effectiveFitness??player.state?.fitness??100);
      return (unavailable?-10_000_000:0)+fit*100_000+overall*100+fitness;
    });
    if(assignments.length!==sourceStarterIds.length){showToast("当前名单不足，无法完成自动替换");return;}
    const sourcePresets=clone(state.positionPresets);
    const targetPresets=canUseBench?Object.keys(sourcePresets):[state.activePositionPreset];
    const remapped=remapLineupPresetSlots(sourceStarterIds,assignments,sourcePresets,targetPresets);
    const sourceDuties=Object.fromEntries(Object.entries(state.tacticalPlans).map(([key,plan])=>[key,clone(plan.playerDuties??{})]));
    const stateByPreset={position1:"opening",position2:"leading",position3:"trailing"};
    targetPresets.forEach((preset)=>{
      const oldPlayers=sourceStarterIds.map((id)=>rosterValue.find((player)=>player.id===id)).filter(Boolean);
      const oldRoles=analyzeElevenBoardFormation(oldPlayers,sourcePresets[preset],state.formationLinePresets[preset]).roles;
      const planKey=stateByPreset[preset]; const nextDuties={};
      sourceStarterIds.forEach((oldPlayerId)=>{ const duty=sourceDuties[planKey]?.[oldPlayerId]; if(duty)nextDuties[remapped.slotPlayerMap.get(oldPlayerId)]=duty; });
      state.tacticalPlans[planKey].playerDuties=nextDuties;
    });
    state.positionPresets=remapped.positionPresets;
    if(canUseBench){ state.starters=remapped.nextStarterIds; if(!state.starters.includes(state.captainId))state.captainId=state.starters[0]; }
    mobileDutyPlayerId=null; render(); markDirty(180);
    if(canUseBench){ const replacements=state.starters.filter((id)=>!sourceStarterIds.includes(id)).length; showToast(`默认站位指导完成：替补更换 ${replacements} 人，并保留三套站位各自坐标`); }
    else showToast(`${state.activePositionPreset==="position2"?"领先":"落后"}站位指导完成：仅重排默认首发，其他站位未改变`);
  }
  function recommendDuties() { const roles=analysis().roles; const plan=state.tacticalPlans[planState()]; starters().forEach((p)=>{ const list=DUTIES[roles[p.id]]??[]; if(list.length>1)plan.playerDuties[p.id]=list[1][0]; }); render(); markDirty(); showToast("已为当前站位推荐球员职责"); }
  function stopPreview(){ clearInterval(previewTimer); previewTimer=null; panel.querySelector("#league-tactics-pitch")?.classList.remove("is-tactical-shape-previewing"); }
  function playPreview(){ stopPreview(); const pitch=panel.querySelector("#league-tactics-pitch"); if(!pitch)return; pitch.classList.add("is-tactical-shape-previewing"); let index=0; const keys=["position1","position2","position3","position1"]; const frame=()=>{ const target=state.positionPresets[keys[index++%keys.length]]; pitch.querySelectorAll("[data-league-magnet]").forEach((node)=>{ const pos=target[node.dataset.leagueMagnet]; if(pos){node.style.left=`${pos.x}%`;node.style.top=`${pos.y}%`;} }); }; frame(); previewTimer=setInterval(frame,1300); setTimeout(()=>{stopPreview();render();},5400); }
  function bindTooltips() {
    document.querySelector(".league-magnet-tooltip")?.remove();
    if(window.matchMedia("(hover: none), (pointer: coarse)").matches)return;
    let tooltip=null;
    const hide=()=>{tooltip?.remove();tooltip=null;};
    const show=(magnet,clientX,clientY)=>{
      hide();
      const id=magnet.dataset.leagueMagnet??magnet.dataset.leagueBenchMagnet;
      const player=roster().find((candidate)=>candidate.id===id);
      if(!player)return null;
      const assignedRole=magnet.dataset.leagueMagnet?(analysis().roles[id]??player.role):player.role;
      tooltip=document.createElement("div");
      tooltip.className="league-magnet-tooltip";
      tooltip.textContent=playerTooltip(player,assignedRole);
      document.body.appendChild(tooltip);
      const place=(x,y)=>{
        const rect=tooltip.getBoundingClientRect();
        const left=Math.max(10,Math.min(window.innerWidth-rect.width-10,x-rect.width/2));
        const preferredTop=y-rect.height-14;
        tooltip.style.left=left+"px";
        tooltip.style.top=(preferredTop>=10?preferredTop:Math.min(window.innerHeight-rect.height-10,y+18))+"px";
      };
      place(clientX,clientY);
      return place;
    };
    panel.querySelectorAll(".league-squad-magnet,.league-bench-magnet").forEach((magnet)=>{
      let place=null;
      magnet.addEventListener("pointerenter",(event)=>{place=show(magnet,event.clientX,event.clientY);});
      magnet.addEventListener("pointermove",(event)=>{if(place)place(event.clientX,event.clientY);});
      magnet.addEventListener("pointerleave",()=>{place=null;hide();});
      magnet.addEventListener("pointerdown",()=>{place=null;hide();});
      magnet.addEventListener("focus",()=>{const rect=magnet.getBoundingClientRect();place=show(magnet,rect.left+rect.width/2,rect.top);});
      magnet.addEventListener("blur",()=>{place=null;hide();});
    });
  }
  function bindReliableDrag() {
    const pitch=panel.querySelector("#league-tactics-pitch");
    if(!pitch)return;
    const clearHighlights=()=>panel.querySelectorAll(".role-swap-primary,.role-swap-secondary").forEach((node)=>node.classList.remove("role-swap-primary","role-swap-secondary"));
    const highlight=(source)=>{
      clearHighlights();
      const primary=source.dataset.primaryRole??"",secondary=source.dataset.secondaryRole??"";
      panel.querySelectorAll("[data-league-magnet],[data-league-bench-magnet]").forEach((node)=>{
        if(node===source)return;
        if(primary&&node.dataset.primaryRole===primary)node.classList.add("role-swap-primary");
        else if(secondary&&node.dataset.primaryRole===secondary)node.classList.add("role-swap-secondary");
      });
    };
    const benchSnapshot=()=>{
      const list=panel.querySelector(".league-bench .bench-magnet-list");
      if(!list)return null;
      return { listRect:list.getBoundingClientRect(),candidates:[...list.querySelectorAll("[data-league-bench-magnet]")].map((element)=>{
        const rect=element.getBoundingClientRect();
        return {element,rect,centerX:rect.left+rect.width/2,centerY:rect.top+rect.height/2};
      }) };
    };
    const benchTargetAt=(x,y,snapshot)=>{
      if(!snapshot)return null;
      const {listRect,candidates}=snapshot;
      if(x<listRect.left||x>listRect.right||y<listRect.top||y>listRect.bottom)return null;
      const direct=candidates.find(({rect})=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom);
      if(direct)return direct.element;
      return candidates.reduce((best,candidate)=>{
        const distance=Math.hypot(x-candidate.centerX,y-candidate.centerY);
        return !best||distance<best.distance?{element:candidate.element,distance}:best;
      },null)?.element??null;
    };
    panel.querySelectorAll("[data-league-magnet]").forEach((magnet)=>magnet.addEventListener("pointerdown",(event)=>{
      if(event.button!==0||event.target.closest("[data-duty-step]"))return;
      event.preventDefault();
      try{magnet.setPointerCapture(event.pointerId);}catch{}
      const playerId=magnet.dataset.leagueMagnet;
      const startPosition={...positions()[playerId]};
      const pointerStart={x:event.clientX,y:event.clientY};
      const pitchRect=pitch.getBoundingClientRect();
      const benchTargets=benchSnapshot();
      let moved=false,benchTarget=null,ghost=null;
      highlight(magnet);
      magnet.classList.add("dragging");
      const removeGhost=()=>{
        ghost?.remove();
        ghost=null;
        magnet.classList.remove("league-drag-source-hidden");
      };
      const moveGhost=(pointerEvent)=>{
        if(!ghost){
          ghost=magnet.cloneNode(true);
          ghost.removeAttribute("data-league-magnet");
          ghost.removeAttribute("style");
          ghost.removeAttribute("tabindex");
          ghost.setAttribute("aria-hidden","true");
          ghost.querySelector(".league-magnet-duty")?.remove();
          ghost.classList.remove("dragging");
          ghost.classList.add("bench-drag-ghost","league-field-drag-ghost");
          document.body.appendChild(ghost);
        }
        magnet.classList.add("league-drag-source-hidden");
        ghost.style.left=pointerEvent.clientX+"px";
        ghost.style.top=pointerEvent.clientY+"px";
      };
      const applyMove=(pointerEvent)=>{
        moved ||= Math.hypot(pointerEvent.clientX-pointerStart.x,pointerEvent.clientY-pointerStart.y)>=3;
        if(!moved)return;
        const nextTarget=benchTargetAt(pointerEvent.clientX,pointerEvent.clientY,benchTargets);
        if(nextTarget!==benchTarget){benchTarget?.classList.remove("swap-target");benchTarget=nextTarget;benchTarget?.classList.add("swap-target");}
        const insidePitch=pointerEvent.clientX>=pitchRect.left&&pointerEvent.clientX<=pitchRect.right&&pointerEvent.clientY>=pitchRect.top&&pointerEvent.clientY<=pitchRect.bottom;
        if(benchTarget||!insidePitch){moveGhost(pointerEvent);return;}
        removeGhost();
        const x=clamp((pointerEvent.clientX-pitchRect.left)/pitchRect.width*100,8,92);
        const y=clamp((pointerEvent.clientY-pitchRect.top)/pitchRect.height*100,6,94);
        positions()[playerId]={x:Math.round(x),y:Math.round(y)};
        magnet.style.left=x+"%";
        magnet.style.top=y+"%";
      };
      const move=frameThrottlePointerMove(applyMove);
      const cleanup=()=>{
        clearHighlights();
        magnet.classList.remove("dragging");
        benchTarget?.classList.remove("swap-target");
        removeGhost();
        window.removeEventListener("pointermove",move);
        window.removeEventListener("pointerup",finish);
        window.removeEventListener("pointercancel",cancel);
      };
      const finish=(pointerEvent)=>{
        move.flush(pointerEvent);
        cleanup();
        if(!moved&&window.matchMedia("(max-width:1050px), (pointer:coarse)").matches){mobileDutyPlayerId=playerId;render();return;}
        if(benchTarget){positions()[playerId]=startPosition;swapStarter(benchTarget.dataset.leagueBenchMagnet,playerId);return;}
        if(!moved){positions()[playerId]=startPosition;render();return;}
        const rejected=analysis().counts.GK>1;
        if(rejected){positions()[playerId]=startPosition;showToast("门将位置最多只能安排一名球员");}
        render();
        if(!rejected)markDirty(180);
      };
      const cancel=()=>{
        move.cancel();
        positions()[playerId]=startPosition;
        cleanup();
        render();
      };
      window.addEventListener("pointermove",move,{passive:false});
      window.addEventListener("pointerup",finish,{once:true});
      window.addEventListener("pointercancel",cancel,{once:true});
    }));
    panel.querySelectorAll("[data-league-bench-magnet]").forEach((magnet)=>magnet.addEventListener("pointerdown",(event)=>{
      if(event.button!==0)return;
      event.preventDefault();
      try{magnet.setPointerCapture(event.pointerId);}catch{}
      const benchId=magnet.dataset.leagueBenchMagnet;
      const ghost=magnet.cloneNode(true);
      ghost.removeAttribute("data-league-bench-magnet");
      ghost.removeAttribute("tabindex");
      ghost.setAttribute("aria-hidden","true");
      ghost.classList.remove("bench-magnet","league-bench-magnet");
      ghost.classList.add("bench-drag-ghost");
      document.body.appendChild(ghost);
      magnet.classList.add("league-bench-source-removed");
      highlight(magnet);
      let target=null;
      const fieldTargets=[...panel.querySelectorAll("[data-league-magnet]")].map((element)=>({element,rect:element.getBoundingClientRect()}));
      const applyMove=(pointerEvent)=>{
        ghost.style.left=pointerEvent.clientX+"px";
        ghost.style.top=pointerEvent.clientY+"px";
        const next=fieldTargets.find(({rect})=>pointerEvent.clientX>=rect.left&&pointerEvent.clientX<=rect.right&&pointerEvent.clientY>=rect.top&&pointerEvent.clientY<=rect.bottom)?.element??null;
        if(next!==target){target?.classList.remove("swap-target");target=next;target?.classList.add("swap-target");}
      };
      const move=frameThrottlePointerMove(applyMove);
      const cleanup=()=>{
        clearHighlights();
        target?.classList.remove("swap-target");
        ghost.remove();
        magnet.classList.remove("league-bench-source-removed");
        window.removeEventListener("pointermove",move);
        window.removeEventListener("pointerup",finish);
        window.removeEventListener("pointercancel",cancel);
      };
      const finish=(pointerEvent)=>{
        move.flush(pointerEvent);
        const starterId=target?.dataset.leagueMagnet;
        cleanup();
        if(starterId)swapStarter(benchId,starterId);
      };
      const cancel=()=>{move.cancel();cleanup();};
      applyMove(event);
      window.addEventListener("pointermove",move,{passive:false});
      window.addEventListener("pointerup",finish,{once:true});
      window.addEventListener("pointercancel",cancel,{once:true});
    }));
  }
  function bindDrag() {
    const pitch=panel.querySelector("#league-tactics-pitch");
    if(!pitch)return;
    panel.querySelectorAll("[data-formation-line]").forEach((handle)=>handle.addEventListener("pointerdown",(event)=>{
      if(event.button!==0)return;
      event.preventDefault();
      const key=handle.dataset.formationLine,rect=pitch.getBoundingClientRect();
      const move=(e)=>{
        state.formationLinePresets[state.activePositionPreset]=moveFormationLine(formationLines(),key,(e.clientY-rect.top)/rect.height*100);
        handle.style.top=`${formationLines()[key]}%`;
      };
      const up=()=>{window.removeEventListener("pointermove",move);render();markDirty(180);};
      window.addEventListener("pointermove",move);
      window.addEventListener("pointerup",up,{once:true});
    }));
    const highlight=(source,on)=>panel.querySelectorAll("[data-league-magnet],[data-league-bench-magnet]").forEach((node)=>{
      if(node===source)return;
      const primary=source.dataset.primaryRole;
      node.classList.toggle("role-swap-primary",on&&primary&&node.dataset.primaryRole===primary);
      node.classList.toggle("role-swap-secondary",on&&source.dataset.secondaryRole&&node.dataset.primaryRole===source.dataset.secondaryRole);
    });
    panel.querySelectorAll("[data-league-magnet]").forEach((node)=>node.addEventListener("pointerdown",(event)=>{
      if(event.button!==0||event.target.closest("[data-duty-step]"))return;
      event.preventDefault();
      const id=node.dataset.leagueMagnet,start={...positions()[id]},rect=pitch.getBoundingClientRect(),targets=[...panel.querySelectorAll("[data-league-bench-magnet]")];
      let target=null,moved=false;
      node.classList.add("dragging");
      highlight(node,true);
      const move=(e)=>{
        moved=true;
        const next=targets.find((item)=>{const r=item.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;})??null;
        if(next!==target){target?.classList.remove("swap-target");target=next;target?.classList.add("swap-target");}
        if(!target&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom){
          const x=clamp((e.clientX-rect.left)/rect.width*100,8,92),y=clamp((e.clientY-rect.top)/rect.height*100,6,94);
          positions()[id]={x:Math.round(x),y:Math.round(y)};
          node.style.left=`${x}%`;
          node.style.top=`${y}%`;
        }
      };
      const up=()=>{
        window.removeEventListener("pointermove",move);
        node.classList.remove("dragging");
        target?.classList.remove("swap-target");
        highlight(node,false);
        if(target)return swapStarter(target.dataset.leagueBenchMagnet,id);
        if(!moved&&window.matchMedia("(max-width:1050px), (pointer:coarse)").matches){mobileDutyPlayerId=id;return render();}
        if(!moved)positions()[id]=start;
        const rejected=moved&&analysis().counts.GK>1;
        if(rejected){positions()[id]=start;showToast("门将位置最多只能安排一名球员");}
        render();
        if(moved&&!rejected)markDirty(180);
      };
      window.addEventListener("pointermove",move);
      window.addEventListener("pointerup",up,{once:true});
    }));
    panel.querySelectorAll("[data-league-bench-magnet]").forEach((node)=>node.addEventListener("pointerdown",(event)=>{
      if(event.button!==0)return;
      event.preventDefault();
      const ghost=node.cloneNode(true);
      ghost.classList.add("bench-drag-ghost");
      document.body.appendChild(ghost);
      const targets=[...panel.querySelectorAll("[data-league-magnet]")];
      let target=null;
      highlight(node,true);
      const move=(e)=>{
        ghost.style.left=`${e.clientX}px`;
        ghost.style.top=`${e.clientY}px`;
        const next=targets.find((item)=>{const r=item.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;})??null;
        if(next!==target){target?.classList.remove("swap-target");target=next;target?.classList.add("swap-target");}
      };
      const up=()=>{
        window.removeEventListener("pointermove",move);
        ghost.remove();
        target?.classList.remove("swap-target");
        highlight(node,false);
        if(target)swapStarter(node.dataset.leagueBenchMagnet,target.dataset.leagueMagnet);
      };
      move(event);
      window.addEventListener("pointermove",move);
      window.addEventListener("pointerup",up,{once:true});
    }));
  }
  function bind() {
    panel.querySelector("[data-save-tactics]")?.addEventListener("click",()=>persist(false));
    panel.querySelectorAll("[data-league-position-preset]").forEach((button)=>button.addEventListener("click",()=>setPreset(button.dataset.leaguePositionPreset)));
    panel.querySelectorAll("[data-select-plan]").forEach((button)=>button.addEventListener("click",()=>{state.activePlan=button.dataset.selectPlan;state.activePositionPreset=PLAN_META[state.activePlan][2];render();markDirty();}));
    panel.querySelector("[data-league-role-zones-toggle]")?.addEventListener("change",(event)=>{state.showRoleZones=event.target.checked;render();markDirty();});
    panel.querySelector("[data-league-chemistry-toggle]")?.addEventListener("change",()=>showToast("当前名单后端尚未提供默契关系数据"));
    panel.querySelector("[data-league-bond-bonus-toggle]")?.addEventListener("change",()=>showToast("当前名单后端尚未提供羁绊数据"));
    panel.querySelector("[data-recommend-lineup]")?.addEventListener("click",recommendLineup);panel.querySelector("[data-recommend-duties]")?.addEventListener("click",recommendDuties);panel.querySelectorAll("[data-league-tactical-shape-mode]").forEach((button)=>button.addEventListener("click",playPreview));
    panel.querySelector("[data-captain]")?.addEventListener("change",(e)=>{state.captainId=e.target.value;render();markDirty();});panel.querySelector("[data-fitness-threshold]")?.addEventListener("change",(e)=>{state.fitnessThreshold=clamp(Number(e.target.value),45,100);render();markDirty();});
    panel.querySelectorAll("[data-plan-tactic]").forEach((select)=>select.addEventListener("change",()=>{const plan=state.tacticalPlans[select.dataset.planTactic];plan.tactic=select.value;plan.tacticalDimensions=defaultDimensions(plan.tactic,plan.style);render();markDirty();}));panel.querySelectorAll("[data-plan-style]").forEach((select)=>select.addEventListener("change",()=>{const plan=state.tacticalPlans[select.dataset.planStyle];plan.style=select.value;plan.tacticalDimensions=defaultDimensions(plan.tactic,plan.style);render();markDirty();}));
    panel.querySelectorAll("[data-plan-trigger]").forEach((select)=>select.addEventListener("change",()=>{state.tacticalPlans[select.dataset.planTrigger].triggerGoalDifference=Number(select.value);markDirty();}));
    panel.querySelectorAll("[data-dimension]").forEach((input)=>input.addEventListener("input",()=>{state.tacticalPlans[input.dataset.plan].tacticalDimensions[input.dataset.dimension]=Number(input.value);const output=input.parentElement.querySelector("output");if(output)output.value=input.value;markDirty();}));
    panel.querySelectorAll("[data-detail]").forEach((select)=>select.addEventListener("change",()=>{const plan=state.tacticalPlans[select.dataset.plan];plan[select.dataset.detail==="in"?"inPossessionDetails":"outOfPossessionDetails"][select.dataset.field]=select.value;markDirty();}));
    panel.querySelectorAll("[data-duty-step]").forEach((button)=>button.addEventListener("click",(event)=>{event.stopPropagation();const id=button.dataset.player,role=analysis().roles[id],list=DUTIES[role]??DUTIES.DM,plan=state.tacticalPlans[planState()],current=plan.playerDuties[id]??"",index=list.findIndex(([key])=>key===current);plan.playerDuties[id]=list[(index+Number(button.dataset.dutyStep)+list.length)%list.length][0];render();markDirty();}));
    panel.querySelector("[data-mobile-duty-close]")?.addEventListener("click",()=>{mobileDutyPlayerId=null;render();});
    panel.querySelectorAll("[data-mobile-duty-step]").forEach((button)=>button.addEventListener("click",()=>{const id=mobileDutyPlayerId,role=analysis().roles[id],list=DUTIES[role]??DUTIES.DM,plan=state.tacticalPlans[planState()],current=plan.playerDuties[id]??"",index=list.findIndex(([key])=>key===current);plan.playerDuties[id]=list[(index+Number(button.dataset.mobileDutyStep)+list.length)%list.length][0];render();markDirty();}));
    bindReliableDrag();
    bindTooltips();
  }
  function open() { if(!getCampaignState()?.setupComplete)return showToast("完成 22 名球员选择后才能设置战术");state=normalizeState(getCampaignState().tactics,roster());activateWideWindow(panel);mapElement.classList.add("is-tactics-open");render(); }
  function close() { stopPreview();document.querySelector(".league-magnet-tooltip")?.remove();panel.hidden=true;deactivateWideWindow(panel);mapElement.classList.remove("is-tactics-open"); }
  registerWideWindow(panel,{onRequestClose:close});
  return { open,close,save:()=>persist(false) };
}
