import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAlert } from "../src/subscribers.js";

const pred = (over) => ({ targetLabel: "2026.20.3", daysToMedian: 6, ...over });

test("alerts when the window is close and not yet notified", () => {
  assert.equal(shouldAlert(pred(), null, 10), true);
  assert.equal(shouldAlert(pred({ daysToMedian: 0 }), null, 10), true);
});

test("does NOT alert when the window is still far out", () => {
  assert.equal(shouldAlert(pred({ daysToMedian: 25 }), null, 10), false);
});

test("does NOT re-alert about a build we already emailed", () => {
  assert.equal(shouldAlert(pred(), "2026.20.3", 10), false);
  // but a NEWER target build is fair game
  assert.equal(shouldAlert(pred({ targetLabel: "2026.20.4" }), "2026.20.3", 10), true);
});

test("does NOT alert on capped / unavailable / dateless predictions", () => {
  assert.equal(shouldAlert({ capped: true }, null, 10), false);
  assert.equal(shouldAlert({ unavailable: true }, null, 10), false);
  assert.equal(shouldAlert({ targetLabel: "x", daysToMedian: null }, null, 10), false);
  assert.equal(shouldAlert(null, null, 10), false);
});

test("ignores ancient overdue predictions (>30d past)", () => {
  assert.equal(shouldAlert(pred({ daysToMedian: -45 }), null, 10), false);
  assert.equal(shouldAlert(pred({ daysToMedian: -5 }), null, 10), true); // recently due is still worth a nudge
});
