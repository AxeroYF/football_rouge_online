import test from "node:test";
import assert from "node:assert/strict";
import { createBroadcastHighlights, broadcastTacticalSummary, broadcastRenderFingerprint } from "../versus/public/broadcast-presentation.js";
import { withBroadcastRevision } from "../versus/broadcast-revision.js";

const event = (id, type = "attack") => ({ id, type, minute:12, text:id });
const view = events => ({ code:"YDL-LIVE", live:true, spectators:[], match:{ events, teams:[{ players:[{ fitness:90, rating:6.5 }], stats:{ shots:1 } }], score:[0, 0], remainingMs:1000 } });

test("进球停留六秒且普通进程继续更新，连续重要事件按顺序展示", () => {
  const highlights = createBroadcastHighlights();
  highlights.update(view([event("a")]), 0);
  const goal = event("g", "goal"), red = event("r", "red");
  let state = highlights.update(view([event("a"), goal, event("b")]), 100);
  assert.equal(state.event.id, "g"); assert.equal(state.nextAt, 6100); assert.equal(state.reviewing, true);
  state = highlights.update(view([event("a"), goal, event("b"), red, event("c")]), 5900);
  assert.equal(state.event.id, "g"); assert.equal(state.pending, 1);
  state = highlights.update(view([event("a"), goal, event("b"), red, event("c")]), 6100);
  assert.equal(state.event.id, "r"); assert.equal(state.nextAt, 12100);
  state = highlights.update(view([event("a"), goal, event("b"), red, event("c")]), 12100);
  assert.equal(state.event, null); assert.equal(state.nextAt, null);
});

test("新入场不回放历史队列，终场仍能读完关键事件，切换比赛清空队列", () => {
  const highlights = createBroadcastHighlights();
  assert.equal(highlights.update(view([event("old", "goal"), event("now")]), 0).event, null);
  highlights.update(view([event("now"), event("g", "goal")]), 10);
  let snapshot = view([event("now"), event("g", "goal"), event("end", "fulltime")]); snapshot.live = false;
  assert.equal(highlights.update(snapshot, 100).event.id, "g");
  assert.equal(highlights.update(snapshot, 6010).event.id, "end");
  snapshot = { ...view([event("new")]), code:"YDL-OTHER" };
  assert.equal(highlights.update(snapshot, 6020).event, null);
});

test("战术说明与真实预案及切换事件一致，隐藏镜像不推导原则", () => {
  const summary = broadcastTacticalSummary({ tactic:"positive", activePlan:"leading", possessionStyle:"vertical", defensiveBlock:"midBlock", transitionStyle:"counterAttack", duelIntensity:"roughPlay", activePlanTrigger:{ goalDifference:3, threshold:2 } }, [{ type:"tactical", teamIndex:0, plan:"leading", minute:54, goalDifference:2, triggerGoalDifference:2 }]);
  assert.equal(summary.plan, "领先预案"); assert.equal(summary.principles.length, 4);
  assert.match(summary.reason, /54'.*领先 2 球.*2 球/);
  const hidden = broadcastTacticalSummary({ tacticsHidden:true, possessionStyle:"possession" });
  assert.equal(hidden.principles.length, 0); assert.equal(hidden.mentality, "");
});

test("统计、体力、评分、球场和赛后字段变化均使 revision 与刷新指纹变化", () => {
  const base = view([]), original = withBroadcastRevision(base);
  assert.equal(withBroadcastRevision({ ...base, match:{ ...base.match, remainingMs:500 } }).revision, original.revision);
  for (const mutate of [v => v.match.teams[0].players[0].fitness--, v => v.match.teams[0].players[0].rating++, v => v.match.teams[0].stats.shots++, v => v.match.stadium = { name:"新球场" }, v => v.match.report = { score:[0,0] }, v => v.live = false]) {
    const changed = structuredClone(base); mutate(changed);
    assert.notEqual(withBroadcastRevision(changed).revision, original.revision);
    assert.notEqual(broadcastRenderFingerprint(changed), broadcastRenderFingerprint(base));
  }
  assert.notEqual(broadcastRenderFingerprint(original, { event:event("a") }), broadcastRenderFingerprint(original, { event:event("b") }));
});
