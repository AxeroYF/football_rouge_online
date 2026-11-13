import { MENTALITIES, PRINCIPLE_GROUPS } from "./tactical-principles.js";
import {TACTICAL_FLOW_GROUPS} from "./tactical-flow.js";
import {EXECUTION_GROUPS} from "./tactical-execution.js";

const CRITICAL = new Set(["goal", "ownGoal", "superWorldie", "butterFingers", "penalty", "penaltyAwarded", "penaltyShootoutKick", "penalties", "red", "injury", "lightning", "abandoned"]);
const STAGES = new Set(["halftime", "extra", "extraTime", "extraTimeHalfTime", "extraTimeEnd", "penaltyShootoutStart", "fulltime"]);
export const PLAN_LABELS = Object.freeze({ opening:"默认预案", leading:"领先预案", trailing:"落后预案" });

export function broadcastEventLevel(event) {
  return CRITICAL.has(event?.type) ? "critical" : event?.type === "tactical" || STAGES.has(event?.type) ? "tactical" : "normal";
}

// The spotlight is a local reading aid. The scoreboard, pitch and feed always use
// the newest authoritative snapshot, including while an earlier event is held.
export function createBroadcastHighlights() {
  let code, seen, current, until = 0, critical = [], tactical = null;
  return {
    reset() { code = undefined; seen = new Set(); current = null; until = 0; critical = []; tactical = null; },
    update(broadcast, now = Date.now()) {
      const events = broadcast.match.events ?? [];
      if (code !== broadcast.code) {
        this.reset(); code = broadcast.code;
        events.forEach(event => seen.add(event.id));
        current = broadcastEventLevel(events.at(-1)) !== "normal" ? events.at(-1) : null;
        until = now + (broadcastEventLevel(current) === "critical" ? 6000 : broadcastEventLevel(current) === "tactical" ? 3500 : 0);
      } else {
        for (const event of events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          if (broadcastEventLevel(event) === "critical") critical.push(event);
          else if (broadcastEventLevel(event) === "tactical") tactical = event;
        }
      }
      if (!current || now >= until) {
        const next = critical.shift() ?? tactical ?? null;
        if (next === tactical) tactical = null;
        if (next?.id !== current?.id) {
          current = next;
          const level = broadcastEventLevel(current);
          until = now + (level === "critical" ? 6000 : level === "tactical" ? 3500 : 0);
        }
      }
      return { event:current, level:broadcastEventLevel(current), pending:critical.length + Number(Boolean(tactical)),
        reviewing:Boolean(current && current.id !== events.at(-1)?.id), nextAt:current && until > now ? until : null };
    },
  };
}

export function broadcastTacticalSummary(team, events = [], teamIndex = 0) {
  if (team.tacticsHidden) return { hidden:true, plan:"对手战术已保护", mentality:"", principles:[], reason:"仅展示公开阵型与比赛表现" };
  const switched = [...events].reverse().find(event => event.type === "tactical" && event.teamIndex === teamIndex);
  const plan = team.activePlan ?? switched?.plan ?? "opening";
  const labels = Object.entries(PRINCIPLE_GROUPS).flatMap(([key, group]) => group.choices[team[key]] ? [{ label:group.label, value:group.choices[team[key]] }] : []);
  Object.entries(TACTICAL_FLOW_GROUPS).forEach(([key,group])=>{if(group.choices[team[key]])labels.push({label:group.label,value:group.choices[team[key]]});});
  for(const key of ['pressTrigger','buildUpRoute','defensiveFocus','setPieceRoutine']) {
    const group=EXECUTION_GROUPS[key];if(team[key]&&team[key]!==group.default)labels.push({label:group.label,value:group.choices[team[key]]});
  }
  const trigger = switched?.plan === plan && Number.isFinite(switched.goalDifference) ? switched : team.activePlanTrigger;
  const difference = Number(trigger?.goalDifference);
  const reason = Number.isFinite(difference) && plan !== "opening"
    ? `${plan === "leading" ? "领先" : "落后"} ${Math.abs(difference)} 球，达到 ${Number(trigger.threshold ?? trigger.triggerGoalDifference ?? 1)} 球切换条件`
    : plan === "opening" ? "执行默认预案；比分未达到领先或落后触发条件" : "根据比分触发预案";
  return { hidden:false, plan:PLAN_LABELS[plan] ?? "当前预案", mentality:MENTALITIES[team.tactic] ?? "", principles:labels,
    reason:`${switched ? `${switched.minute}' 切换 · ` : ""}${reason}${Number(trigger?.planAfter)>0?`，且已到 ${trigger.planAfter} 分钟`:''}` };
}

// Full-state fallback also supports older room broadcasts without a revision.
// remainingMs is transport timing; all rendered match and venue fields are kept.
export function broadcastRenderFingerprint(broadcast, highlight) {
  const { remainingMs, ...match } = broadcast.match;
  return JSON.stringify([broadcast.code, broadcast.revision ?? { ...broadcast, match }, highlight?.event?.id, highlight?.pending, highlight?.reviewing]);
}
