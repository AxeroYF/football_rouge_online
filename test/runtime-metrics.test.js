import test from "node:test";
import assert from "node:assert/strict";
import { measureRuntimeSync, recordRuntimeMetric, resetRuntimeMetricsForTest, snapshotRuntimeMetrics } from "../src/runtime-metrics.js";

test("runtime metrics retain cumulative counts and bounded latency summaries", () => {
  resetRuntimeMetricsForTest();
  [1, 2, 3, 4, 100].forEach((value) => recordRuntimeMetric("example", value));
  const snapshot = snapshotRuntimeMetrics();
  assert.equal(snapshot.timings.example.count, 5);
  assert.equal(snapshot.timings.example.p50Ms, 3);
  assert.equal(snapshot.timings.example.p95Ms, 100);
  assert.equal(snapshot.timings.example.maxMs, 100);
  assert.ok(snapshot.process.rssMb > 0);
  assert.ok(snapshot.eventLoop.p99Ms >= 0);
});

test("runtime metrics count failed measured operations", () => {
  resetRuntimeMetricsForTest();
  assert.throws(() => measureRuntimeSync("failure", () => { throw new Error("expected"); }), /expected/);
  const snapshot = snapshotRuntimeMetrics();
  assert.equal(snapshot.timings.failure.count, 1);
  assert.equal(snapshot.timings.failure.errors, 1);
});
