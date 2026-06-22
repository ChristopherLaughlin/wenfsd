// Verifies the walk-forward back-test of the cadence predictor: it should score the model's
// 80% window against historical branch first-seen dates and return a coverage % + median error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest } from "../src/calibration.js";
import { computeCalibration } from "../src/calibration.js";

test("backtest returns null without enough branch history", () => {
  assert.equal(backtest([]), null);
  assert.equal(backtest([{ version: "2026.20", firstSeen: "2026-06-10" }]), null);
});

test("backtest scores a regular-cadence history near 100% in-window", () => {
  // perfectly regular 42-day cadence → every prediction should land in the 80% window
  const hist = [];
  let d = Date.parse("2025-01-01");
  for (let i = 0; i < 8; i++) { hist.push({ version: `2025.${i * 6 + 2}`, firstSeen: new Date(d).toISOString().slice(0, 10) }); d += 42 * 86400000; }
  const bt = backtest(hist);
  assert.ok(bt, "expected a backtest result");
  assert.ok(bt.tested >= 1, "should test at least one release");
  assert.equal(bt.targetCoverage, 80);
  assert.ok(bt.coveragePct >= 80, `regular cadence should be well-calibrated, got ${bt.coveragePct}%`);
  assert.ok(bt.medianAbsErrorDays <= 3, `regular cadence error should be tiny, got ${bt.medianAbsErrorDays}d`);
});

test("backtest coverage + median error are sane bounds", () => {
  const hist = [
    { version: "2025.26", firstSeen: "2025-07-14" }, { version: "2025.32", firstSeen: "2025-08-25" },
    { version: "2025.38", firstSeen: "2025-10-06" }, { version: "2025.44", firstSeen: "2025-11-17" },
    { version: "2026.2", firstSeen: "2026-01-19" }, { version: "2026.8", firstSeen: "2026-03-09" },
    { version: "2026.14", firstSeen: "2026-05-08" }, { version: "2026.20", firstSeen: "2026-06-10" },
  ];
  const bt = backtest(hist);
  assert.ok(bt && bt.tested > 0);
  assert.ok(bt.coveragePct >= 0 && bt.coveragePct <= 100);
  assert.ok(bt.medianAbsErrorDays >= 0);
});

test("computeCalibration (sample) includes a back-test from versionHistory", async () => {
  const cal = await computeCalibration({ live: false });
  assert.equal(cal.mode, "sample");
  assert.ok(cal.backtest, "sample calibration should carry a backtest");
  assert.ok(cal.backtest.tested > 0);
});
