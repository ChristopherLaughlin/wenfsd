// Verifies the walk-forward back-test of the cadence predictor: it should score the model's
// 80% window against historical branch first-seen dates and return a coverage % + median error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest, fitRollout } from "../src/calibration.js";
import { computeCalibration } from "../src/calibration.js";

// logit helper for synthesising install days from a known logistic curve
const logit = (p) => Math.log(p / (1 - p));

test("fitRollout recovers the k + t0 it was generated from (learns params from real timing)", () => {
  const k0 = 0.22, t0_0 = 18, n = 60;
  // simulate n cars receiving the build at the days a logistic(k0,t0_0) curve predicts
  const days = [];
  for (let i = 0; i < n; i++) { const p = (i + 0.5) / n; days.push(t0_0 + logit(p) / k0); }
  const fit = fitRollout(days);
  assert.ok(fit, "should fit with 60 observations");
  assert.ok(Math.abs(fit.k - k0) < 0.03, `k≈${k0}, got ${fit.k}`);
  assert.ok(Math.abs(fit.t0Days - t0_0) < 2, `t0≈${t0_0}, got ${fit.t0Days}`);
  assert.equal(fit.n, n);
});

test("fitRollout refuses to fit without enough observations (no fabricated params)", () => {
  assert.equal(fitRollout([1, 2, 3]), null);
  assert.equal(fitRollout([]), null);
});

test("fitRollout returns null for non-increasing/degenerate data", () => {
  assert.equal(fitRollout(new Array(12).fill(5)), null); // all same day → zero slope
});

test("backtest returns null without enough branch history", () => {
  assert.equal(backtest([]), null);
  assert.equal(backtest([{ version: "2026.20", firstSeen: "2026-06-10" }]), null);
});

test("backtest scores a regular-cadence history near 100% in-window", () => {
  // perfectly regular 42-day cadence → every prediction should land in the 80% window. Use 13 branches
  // so the walk-forward tests ≥8 releases and the coverage % is actually published (it's gated below 8).
  const hist = [];
  let d = Date.parse("2025-01-01");
  for (let i = 0; i < 13; i++) { hist.push({ version: `2025.${i * 4 + 2}`, firstSeen: new Date(d).toISOString().slice(0, 10) }); d += 42 * 86400000; }
  const bt = backtest(hist);
  assert.ok(bt, "expected a backtest result");
  assert.ok(bt.tested >= 8, "should test ≥8 releases so the coverage % is published");
  assert.equal(bt.targetCoverage, 80);
  assert.ok(bt.coveragePct >= 80, `regular cadence should be well-calibrated, got ${bt.coveragePct}%`);
  assert.ok(bt.medianAbsErrorDays <= 3, `regular cadence error should be tiny, got ${bt.medianAbsErrorDays}d`);
});

test("backtest gates the coverage % to null on too-thin history (but still reports median error)", () => {
  // 8 branches → only 4 walk-forward trials — too few to headline an 80%-window hit-rate honestly.
  const hist = [];
  let d = Date.parse("2025-01-01");
  for (let i = 0; i < 8; i++) { hist.push({ version: `2025.${i * 6 + 2}`, firstSeen: new Date(d).toISOString().slice(0, 10) }); d += 42 * 86400000; }
  const bt = backtest(hist);
  assert.equal(bt.tested, 4);
  assert.equal(bt.coveragePct, null, "coverage % must be gated (null) below 8 trials — no thin-data hit-rate");
  assert.ok(bt.medianAbsErrorDays >= 0, "median error is robust at small n and still reported");
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
  assert.ok(bt.coveragePct == null || (bt.coveragePct >= 0 && bt.coveragePct <= 100), "coverage % is either gated (null) or a sane percentage");
  assert.ok(bt.medianAbsErrorDays >= 0);
});

test("backtest derives a sane conformal bandFactor once there's enough history", () => {
  // 11 distinct branches → ≥6 tested points → a bandFactor should be computed and clamped
  const labels = ["2024.20", "2024.26", "2024.33", "2024.40", "2024.46", "2025.1", "2025.8", "2025.14", "2025.22", "2025.30", "2025.38"];
  const gaps = [40, 45, 35, 50, 30, 48, 38, 52, 33, 44];   // irregular but bounded cadence
  const hist = []; let d = Date.parse("2024-06-01");
  hist.push({ version: labels[0], firstSeen: new Date(d).toISOString().slice(0, 10) });
  for (let i = 0; i < gaps.length; i++) { d += gaps[i] * 86400000; hist.push({ version: labels[i + 1], firstSeen: new Date(d).toISOString().slice(0, 10) }); }
  const bt = backtest(hist);
  assert.ok(bt && bt.tested >= 6, `expected ≥6 tested, got ${bt && bt.tested}`);
  assert.ok(bt.bandFactor != null, "expected a bandFactor with enough history");
  assert.ok(bt.bandFactor >= 0.6 && bt.bandFactor <= 2.5, `bandFactor out of clamp: ${bt.bandFactor}`);
});

test("backtest withholds bandFactor when history is too thin", () => {
  const bt = backtest([
    { version: "2026.2", firstSeen: "2026-01-19" }, { version: "2026.8", firstSeen: "2026-03-09" },
    { version: "2026.14", firstSeen: "2026-05-08" }, { version: "2026.20", firstSeen: "2026-06-10" },
    { version: "2026.26", firstSeen: "2026-07-15" },
  ]);
  assert.ok(bt, "5 branches still back-tests");
  assert.equal(bt.bandFactor, null, "too few tested points → no bandFactor (avoids overfitting)");
});

test("computeCalibration (sample) includes a back-test from versionHistory", async () => {
  const cal = await computeCalibration({ live: false });
  assert.equal(cal.mode, "sample");
  assert.ok(cal.backtest, "sample calibration should carry a backtest");
  assert.ok(cal.backtest.tested > 0);
});
