import {
  DEFAULT_IN_POSSESSION_DETAILS, DEFAULT_OUT_OF_POSSESSION_DETAILS,
  resolveV2SplitTacticalPlan, v2TacticalDetailAdjustments,
  V2_POSSESSION_STYLES, V2_DEFENSIVE_BLOCKS, V2_TRANSITION_STYLES, V2_DUEL_INTENSITIES,
} from "./v2-tactical-profiles.js";
import {TACTICAL_FLOW_GROUPS,tacticalFlowFields} from "./tactical-flow.js";
import {EXECUTION_GROUPS,tacticalExecutionFields} from "./tactical-execution.js";

export const TACTICAL_MODEL_VERSION = "principles-1";
export const MENTALITIES = Object.freeze({ parkBus:"谨慎", defensive:"稳健", balanced:"均衡", positive:"积极", allOutAttack:"全力进攻" });
export const MENTALITY_VALUES = Object.freeze({ parkBus:20, defensive:34, balanced:50, positive:66, allOutAttack:92 });
export const MENTALITY_DESCRIPTIONS = Object.freeze({
  parkBus:"优先保持结构，减少前压和冒险投入。", defensive:"控制风险，保留适度的向前支援。",
  balanced:"在前压与保护之间保持常规投入。", positive:"增加向前支援，接受更多转换风险。",
  allOutAttack:"最大限度争取进攻，承担较高消耗与身后风险。",
});
export const PRINCIPLE_GROUPS = Object.freeze({
  possessionStyle:{ label:"组织方式", choices:V2_POSSESSION_STYLES, dimensions:["tempo","directness","attackingWidth"] },
  defensiveBlock:{ label:"防守区块", choices:V2_DEFENSIVE_BLOCKS, dimensions:["defensiveLine","pressing","compactness"] },
  transitionStyle:{ label:"得球策略", choices:V2_TRANSITION_STYLES, dimensions:["counterAttack"] },
  duelIntensity:{ label:"对抗强度", choices:V2_DUEL_INTENSITIES, dimensions:[] },
});
export const PRINCIPLE_DESCRIPTIONS = Object.freeze({
  balanced:"根据局面选择推进与对抗方式。", possession:"优先短传接应，需要稳定传接，减少直接向前。",
  vertical:"更快向前连接，也承担更多失去球权的风险。", wingPlay:"拉开进攻宽度，需要边路配合和禁区接应。",
  longBall:"直接寻找前场，需要争顶和二点球接应。", highPress:"前场施压，需要连续跑动和身后保护。",
  midBlock:"在中场建立防守，兼顾前后连接。", lowBlock:"优先保护纵深，可用心态限制为均衡及以下。",
  retain:"先稳住球权，可能放弃部分反击窗口。", counterAttack:"得球后优先向前，需要可用的前场接球点。",
  cautious:"减少冒险对抗，也可能让出部分争夺。", roughPlay:"积极争夺，承担更多犯规与黄红牌风险。",
});
export const TACTICAL_DIMENSION_LABELS = Object.freeze({ tempo:"比赛节奏", directness:"传球纵深", attackingWidth:"进攻宽度", defensiveLine:"防线高度", pressing:"压迫强度", compactness:"阵型紧凑", counterAttack:"反击倾向" });
const ORGANIZATION_VALUES = Object.freeze({ balanced:[50,50,50], possession:[42,28,46], vertical:[59,65,50], wingPlay:[55,55,80], longBall:[57,80,56] });
const BLOCK_VALUES = Object.freeze({ highPress:[72,82,67], midBlock:[50,50,55], lowBlock:[30,34,73] });
const TRANSITION_VALUES = Object.freeze({ retain:32, balanced:50, counterAttack:70 });
const OVERRIDE_KEYS = [...Object.keys(TACTICAL_DIMENSION_LABELS), "timeWasting"];
const clamp = value => Math.max(0, Math.min(100, Math.round(Number(value))));
export const isPrinciplesPlan = plan => plan?.tacticalModelVersion === TACTICAL_MODEL_VERSION;

// Only schema-owned fields cross the persistence boundary. Legacy plans stay legacy.
export function tacticalPrincipleFields(plan = {}, fallback = {}) {
  const source = Object.hasOwn(plan, "tacticalModelVersion") ? plan : { ...fallback, ...plan };
  if (Object.hasOwn(source, "tacticalModelVersion") && source.tacticalModelVersion !== TACTICAL_MODEL_VERSION) throw new Error("不支持的战术配置版本，请刷新页面");
  const fields = {};
  if(Object.keys(EXECUTION_GROUPS).some(key=>Object.hasOwn(plan,key)||Object.hasOwn(fallback,key)))Object.assign(fields,tacticalExecutionFields(plan,fallback));
  if(isPrinciplesPlan(source)||Object.keys(TACTICAL_FLOW_GROUPS).some(key=>Object.hasOwn(plan,key)||Object.hasOwn(fallback,key)))Object.assign(fields,tacticalFlowFields(plan,fallback));
  if (isPrinciplesPlan(source)) {
    fields.tacticalModelVersion = TACTICAL_MODEL_VERSION;
    fields.dimensionOverrides = Object.fromEntries(OVERRIDE_KEYS.flatMap(key => {
      const value = source.dimensionOverrides?.[key];
      return value !== null && value !== "" && Number.isFinite(Number(value)) ? [[key, clamp(value)]] : [];
    }));
    Object.assign(fields, resolveV2SplitTacticalPlan(source));
    fields.tactic = Object.hasOwn(MENTALITIES, source.tactic) ? source.tactic : "balanced";
    if (fields.defensiveBlock === "lowBlock" && MENTALITY_VALUES[fields.tactic] > 50) fields.tactic = "balanced";
  } else if (Object.keys(PRINCIPLE_GROUPS).some(key => Object.hasOwn(source, key))) {
    Object.assign(fields, resolveV2SplitTacticalPlan(source));
  }
  return fields;
}

export function compilePrincipleDimensions(plan) {
  const p = { ...plan, ...tacticalPrincipleFields(plan) };
  const organization = ORGANIZATION_VALUES[p.possessionStyle];
  const block = BLOCK_VALUES[p.defensiveBlock];
  const dimensions = {
    mentality:MENTALITY_VALUES[p.tactic] ?? 50,
    tempo:organization[0], directness:organization[1], attackingWidth:organization[2],
    defensiveLine:block[0], pressing:block[1], compactness:block[2],
    counterAttack:TRANSITION_VALUES[p.transitionStyle], timeWasting:15,
  };
  const details = v2TacticalDetailAdjustments(
    { ...DEFAULT_IN_POSSESSION_DETAILS, ...p.inPossessionDetails },
    { ...DEFAULT_OUT_OF_POSSESSION_DETAILS, ...p.outOfPossessionDetails },
  );
  Object.entries(details).forEach(([key, value]) => { dimensions[key] = clamp(dimensions[key] + value); });
  Object.assign(dimensions, p.dimensionOverrides);
  if (p.defensiveBlock === "lowBlock") dimensions.mentality = Math.min(50, dimensions.mentality);
  return dimensions;
}

export function effectivePrinciples(plan) {
  return resolveV2SplitTacticalPlan(plan);
}

export function upgradeToPrinciples(plan, legacyDimensions = {}) {
  if (isPrinciplesPlan(plan)) return structuredClone(plan);
  const next = { ...structuredClone(plan), tacticalModelVersion:TACTICAL_MODEL_VERSION, ...effectivePrinciples(plan), dimensionOverrides:{} };
  OVERRIDE_KEYS.forEach(key => { if (Number.isFinite(Number(legacyDimensions[key]))) next.dimensionOverrides[key] = clamp(legacyDimensions[key]); });
  next.inPossession = "balanced";
  next.outOfPossession = "balanced";
  return next;
}

export function changeTacticalPrinciple(plan, key, value, legacyDimensions) {
  if (key === "tactic" ? !Object.hasOwn(MENTALITIES, value) : !Object.hasOwn((PRINCIPLE_GROUPS[key]??TACTICAL_FLOW_GROUPS[key]??EXECUTION_GROUPS[key])?.choices ?? {}, value)) throw new Error("无效的战术选项");
  const next = upgradeToPrinciples(plan, legacyDimensions);
  next[key] = value;
  for (const dimension of PRINCIPLE_GROUPS[key]?.dimensions ?? []) delete next.dimensionOverrides[dimension];
  if (next.defensiveBlock === "lowBlock" && MENTALITY_VALUES[next.tactic] > 50) next.tactic = "balanced";
  return next;
}

const preset = (label, tactic, possessionStyle, defensiveBlock, transitionStyle, duelIntensity = "balanced") => Object.freeze({ label, tactic, possessionStyle, defensiveBlock, transitionStyle, duelIntensity });
export const TACTICAL_PRINCIPLE_PRESETS = Object.freeze({
  balanced:preset("均衡基础", "balanced", "balanced", "midBlock", "balanced"),
  control:preset("控球组织", "balanced", "possession", "midBlock", "retain"),
  vertical:preset("纵向快攻", "positive", "vertical", "midBlock", "balanced"),
  wing:preset("边路推进", "positive", "wingPlay", "midBlock", "balanced"),
  longBall:preset("长传支点", "balanced", "longBall", "midBlock", "balanced"),
  press:preset("前场压迫", "positive", "balanced", "highPress", "balanced"),
  counter:preset("低位反击", "defensive", "balanced", "lowBlock", "counterAttack"),
  protect:preset("低位守势", "parkBus", "balanced", "lowBlock", "retain", "cautious"),
});

export function applyPrinciplePreset(plan, id) {
  const selected = TACTICAL_PRINCIPLE_PRESETS[id];
  if (!selected) throw new Error("无效的战术预设");
  const { label, ...fields } = selected;
  const flow=id==="press"?{lossTransition:"counterPress",restDefense:"balanced",clockManagement:"quick"}
    :id==="protect"?{lossTransition:"regroup",restDefense:"conservative",clockManagement:"slow"}
      :id==="counter"?{lossTransition:"regroup",restDefense:"balanced",clockManagement:"quick"}:tacticalFlowFields({});
  return { ...structuredClone(plan), ...fields,...flow, tacticalModelVersion:TACTICAL_MODEL_VERSION, dimensionOverrides:{}, inPossession:"balanced", outOfPossession:"balanced" };
}

// Conditional traits retain their meaning when the old combined style is split.
export function tacticalStyleMatches(plan, style) {
  if (!isPrinciplesPlan(plan)) return plan.style === style;
  if (style === "highPress" || style === "lowBlock") return plan.defensiveBlock === style;
  if (style === "counterAttack") return plan.transitionStyle === style;
  if (style === "roughPlay") return plan.duelIntensity === style;
  return plan.possessionStyle === style;
}
