import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEventOverlay, activePause, detectStalls, cleanEventType, cleanRegion, cleanVersion, cleanReason, EVENT_TYPES, HIGH_IMPACT } from "../src/events.js";

const car = { market: "Australia", hardware: "AI4" };
const basePred = () => ({ targetLabel: "2026.20.3", kind: "distributed", medianDate: new Date("2026-07-28"), p90Date: new Date("2026-08-10") });

test("validators are closed enums / bounded", () => {
  assert.equal(cleanEventType("pause"), "pause");
  assert.equal(cleanEventType("explode"), null);
  assert.equal(cleanRegion("Australia"), "Australia");
  assert.equal(cleanRegion("Atlantis"), null);
  assert.equal(cleanVersion("2026.20.3"), "2026.20.3");
  assert.equal(cleanVersion("<script>"), null);
  assert.equal(cleanVersion("drop table"), null);
  assert.equal(cleanReason("a".repeat(500)).length, 280);
  assert.equal(cleanReason("<b>x</b>"), "bx/b");        // angle brackets stripped
  assert.ok(HIGH_IMPACT.has("pause") && HIGH_IMPACT.has("halt") && !HIGH_IMPACT.has("note"));
});

test("no events → prediction passes through untouched", () => {
  const p = applyEventOverlay(basePred(), [], car, "2026-06-21");
  assert.ok(!p.paused);
  assert.equal(p.kind, "distributed");
});

test("a confirmed pause for this region+build freezes the prediction (no invented date)", () => {
  const ev = [{ type: "pause", version: "2026.20.3", region: "Australia", reason: "unforeseen issues", source: "admin", effective_at: "2026-06-20" }];
  const p = applyEventOverlay(basePred(), ev, car, "2026-06-21");
  assert.equal(p.paused, true);
  assert.equal(p.kind, "paused");
  assert.equal(p.etaUnknown, true);
  assert.equal(p.pauseReason, "unforeseen issues");
});

test("a global (region-null) pause on the next build still applies", () => {
  const ev = [{ type: "pause", version: null, region: null, source: "admin", effective_at: "2026-06-20" }];
  assert.ok(applyEventOverlay(basePred(), ev, car, "2026-06-21").paused);
});

test("a pause for a DIFFERENT region does not apply", () => {
  const ev = [{ type: "pause", version: "2026.20.3", region: "United States", source: "admin", effective_at: "2026-06-20" }];
  assert.ok(!applyEventOverlay(basePred(), ev, car, "2026-06-21").paused);
});

test("a later resume cancels the pause", () => {
  const ev = [
    { type: "pause", version: "2026.20.3", region: "Australia", effective_at: "2026-06-20" },
    { type: "resume", version: "2026.20.3", region: "Australia", effective_at: "2026-06-25" },
  ];
  assert.equal(activePause(ev, basePred(), "Australia", "2026-06-26"), null);
  assert.ok(!applyEventOverlay(basePred(), ev, car, "2026-06-26").paused);
});

test("capped/unavailable predictions are never overlaid", () => {
  const ev = [{ type: "pause", region: "Australia", effective_at: "2026-06-20" }];
  const capped = applyEventOverlay({ capped: true }, ev, car, "2026-06-21");
  assert.ok(!capped.paused);
});

test("detectStalls flags a build that was rolling then flatlined", () => {
  const rolling = [40, 55, 60, 50, 45];           // was actively rolling
  const flat = [1, 0, 0];                          // then ~0 for 3 days
  const series = [{ version: "2026.20.3", daily: [...rolling, ...flat] }];
  const hits = detectStalls(series, { minStallDays: 3, priorMin: 20 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].version, "2026.20.3");
});

test("detectStalls does NOT flag a build that simply never rolled (no prior activity)", () => {
  const series = [{ version: "2026.21.0", daily: [0, 0, 1, 0, 0, 0, 0, 0] }];
  assert.equal(detectStalls(series, { minStallDays: 3, priorMin: 20 }).length, 0);
});

test("detectStalls does NOT flag a still-actively-rolling build", () => {
  const series = [{ version: "2026.20.3", daily: [40, 50, 60, 55, 48, 52, 50] }];
  assert.equal(detectStalls(series, { minStallDays: 3, priorMin: 20 }).length, 0);
});
