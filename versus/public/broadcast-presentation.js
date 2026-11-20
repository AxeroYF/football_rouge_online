import { MENTALITIES, PRINCIPLE_GROUPS } from "./tactical-principles.js";
import {TACTICAL_FLOW_GROUPS} from "./tactical-flow.js";
import {EXECUTION_GROUPS} from "./tactical-execution.js";

import {isGoalEvent} from "./goal-event.js";
export const PLAN_LABELS = Object.freeze({ opening:"默认预案", leading:"领先预案", trailing:"落后预案" });

const CRITICAL_TYPES = new Set([
  "red", "redCard", "penaltyAwarded", "blackWhistle", "brawl",
  "lightning", "spiritPossession", "keeperSpill", "butterFingers",
  "superWorldie", "ownGoal", "penaltyShootoutStart", "penaltyShootoutKick", "abandoned",
]);

const HIGHLIGHT_TYPES = new Set([
  "save", "woodwork", "traitActivated", "bondActive", "captainBoost",
  "emergencyKeeper", "substitution", "injury", "matchInjury", "weatherInjury",
]);

export function broadcastEventLevel(event) {
  if (!event) return "normal";
  if (event.level === "critical" || isGoalEvent(event) || CRITICAL_TYPES.has(event.type)) return "critical";
  if (event.level === "highlight" || HIGHLIGHT_TYPES.has(event.type)) return "highlight";
  return "normal";
}

function spotlightDurationMs(level) {
  return level === "critical" ? 6000 : level === "highlight" ? 3500 : 0;
}

// The spotlight is a local reading aid. The scoreboard, pitch and feed always use
// the newest authoritative snapshot, including while an earlier event is held.
export function createBroadcastHighlights() {
  let code, seen, current, until = 0, queue = [];
  return {
    reset() { code = undefined; seen = new Set(); current = null; until = 0; queue = []; },
    update(broadcast, now = Date.now()) {
      const events = broadcast.match.events ?? [];
      if (code !== broadcast.code) {
        this.reset(); code = broadcast.code;
        events.forEach(event => seen.add(event.id));
        const latest = events.at(-1);
        const latestLevel = broadcastEventLevel(latest);
        current = latestLevel !== "normal" ? latest : null;
        until = current ? now + spotlightDurationMs(latestLevel) : 0;
      } else {
        for (const event of events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          const lvl = broadcastEventLevel(event);
          if (lvl === "critical") {
            // Critical moments jump ahead of queued secondary highlights
            const idx = queue.findIndex(item => broadcastEventLevel(item) !== "critical");
            if (idx === -1) queue.push(event);
            else queue.splice(idx, 0, event);
          } else if (lvl === "highlight") {
            if (queue.length < 4) queue.push(event);
          }
        }
      }
      if (!current || now >= until) {
        const next = queue.shift() ?? null;
        if (next?.id !== current?.id) {
          current = next;
          until = current ? now + spotlightDurationMs(broadcastEventLevel(current)) : 0;
        }
      }
      return {
        event: current,
        level: broadcastEventLevel(current),
        pending: queue.length,
        reviewing: Boolean(current && current.id !== events.at(-1)?.id),
        nextAt: current && until > now ? until : null,
      };
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
