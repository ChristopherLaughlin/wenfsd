import { test } from "node:test";
import assert from "node:assert/strict";
import { predictNextOS, predictNextFSD } from "../src/predict.js";
import { parseOS, verKey } from "../src/wendata.js";

test("verKey parses + orders multi-part versions (incl. 2026.8.3.10)", () => {
  assert.deepEqual(parseOS("2026.8.3.10").parts, [8, 3, 10]);
  assert.ok(verKey("2026.8.3.10") < verKey("2026.14.6"));
  assert.ok(verKey("2026.14.6") < verKey("2026.20.3"));
  assert.ok(verKey("2026.8.3.10") < verKey("2026.8.3.11"));
  assert.equal(verKey("not-a-version"), 0);
});

test("a car on an old build (2026.8.3.10) still predicts the newest rolling build", () => {
  const p = predictNextOS({ market: "Australia", hardware: "AI4", installedVersion: "2026.8.3.10", earliness: 0.45 });
  assert.equal(p.targetLabel, "2026.20.3");
});

test("a deep laggard (months-behind build, no history) is flagged stale + predicted much later", () => {
  const lag = predictNextOS({ market: "Australia", hardware: "AI3", installedVersion: "2026.2.6.1", earliness: 0.5, earlinessSource: "default" });
  const near = predictNextOS({ market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", earliness: 0.5, earlinessSource: "default" });
  assert.equal(lag.stale, true, "a ~18-week-behind car should be flagged stale");
  assert.ok(lag.weeksBehind >= 15);
  assert.ok(lag.daysToMedian > near.daysToMedian + 14, `laggard should predict far later (lag ${lag.daysToMedian}d vs near ${near.daysToMedian}d)`);
  const widthDays = (new Date(lag.p90Date) - new Date(lag.p10Date)) / 86400000;
  assert.ok(widthDays >= 14, `stale window should be wide, got ${Math.round(widthDays)}d`);
  assert.equal(near.stale, false, "a 1-branch-behind car is not stale");
});

test("measured history overrides the staleness guard (no false 'stale')", () => {
  const p = predictNextOS({ market: "Australia", hardware: "AI3", installedVersion: "2026.2.6.1", earliness: 0.5, earlinessSource: "history" });
  assert.ok(!p.stale, "a car with real update history should not be auto-flagged stale");
});

test("AU/NZ HW3 FSD is 'promised' with NO invented date (never delivered)", () => {
  for (const market of ["Australia", "New Zealand"]) {
    const p = predictNextFSD({ market, hardware: "AI3", installedVersion: "2026.14.6", earliness: 0.5 });
    assert.equal(p.promised, true, `${market} HW3 FSD should be promised, not dated`);
    assert.ok(!p.medianDate, `${market} HW3 FSD must not produce a confident date`);
    assert.match(p.note || "", /never|no committed|skeptic/i);
  }
});

test("US HW3 gets FSD v14 Lite first (a real date), AU/NZ do not", () => {
  const us = predictNextFSD({ market: "United States", hardware: "AI3", installedVersion: "2026.14.6", earliness: 0.5 });
  assert.ok(!us.promised, "US HW3 should have an actual rollout, not 'promised'");
  assert.ok(us.medianDate, "US HW3 should produce a date");
  const au = predictNextFSD({ market: "Australia", hardware: "AI3", installedVersion: "2026.14.6", earliness: 0.5 });
  assert.equal(au.promised, true);
});

const auAI4 = { market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", earliness: 0.45, earlinessSource: "default", earlyAccess: false };

test("predictNextOS picks the newest distributed build above yours", () => {
  const p = predictNextOS(auAI4);
  assert.equal(p.targetLabel, "2026.20.3");
  assert.equal(p.branch, "os");
  assert.ok(Number.isFinite(p.daysToMedian));
});

test("prediction quantiles are ordered p10 <= median <= p90", () => {
  const p = predictNextOS(auAI4);
  const d = (x) => new Date(x).getTime();
  assert.ok(d(p.p10Date) <= d(p.medianDate));
  assert.ok(d(p.medianDate) <= d(p.p90Date));
});

test("Early Access shifts the prediction earlier (never later)", () => {
  const base = predictNextOS(auAI4);
  const eap = predictNextOS({ ...auAI4, earlyAccess: true });
  assert.ok(eap.daysToMedian <= base.daysToMedian);
  assert.ok(eap.earliness < base.earliness);
});

test("within-window probabilities are monotonic and in [0,1]", () => {
  const p = predictNextOS(auAI4);
  const w7 = p.probWithin(7), w30 = p.probWithin(30);
  for (const w of [w7, w30]) { assert.ok(w >= 0 && w <= 1); }
  assert.ok(w30 >= w7);
});

test("when the next OS build bumps FSD, it bundles (same build, same date, real FSD version)", () => {
  // AU AI4 on 2026.14.6 (FSD v13.2.9) → next build 2026.20.3 carries FSD v14.3.4 → they ride together
  const fsd = predictNextFSD(auAI4);
  const os = predictNextOS(auAI4);
  assert.match(fsd.targetLabel, /^v14/, "FSD target is the concrete version the build carries, not a placeholder");
  assert.equal(fsd.branch, "fsd");
  assert.equal(fsd.fsdChanges, true);
  assert.equal(fsd.bundledWith, os.targetLabel, "FSD rides inside the next OS build");
  assert.equal(+new Date(fsd.medianDate), +new Date(os.medianDate), "same build → same date");
});

test("a maintenance build that keeps the same FSD is flagged sameFsd (no invented FSD date)", () => {
  // AU AI4 already on 2026.14.6.11 / FSD v14.3.4 → next build 2026.20.3 ALSO carries v14.3.4
  const car = { market: "Australia", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4", earliness: 0.45, earlinessSource: "default" };
  const fsd = predictNextFSD(car);
  assert.equal(fsd.sameFsd, true, "next software update carries no newer FSD");
  assert.ok(!fsd.medianDate, "we must NOT fabricate an FSD date when nothing newer is in the pipeline");
  assert.equal(fsd.current, "v14.3.4");
});

test("predictNextOS reports whether the next software build changes FSD", () => {
  const bumps = predictNextOS(auAI4); // v13.2.9 → next build carries v14.3.4
  assert.equal(bumps.bringsNewFsd, true);
  assert.match(bumps.fsdInBuild, /^v14/);
  const maint = predictNextOS({ market: "Australia", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4", earlinessSource: "default" });
  assert.equal(maint.bringsNewFsd, false, "a same-FSD build must not claim to bring new FSD");
});

test("EU HW3 FSD is 'promised' (undelivered, no date) — not a fabricated ETA", () => {
  const p = predictNextFSD({ market: "Europe", hardware: "AI3", earliness: 0.45 });
  assert.equal(p.promised, true);
  assert.ok(!p.medianDate);
});

test("invalid earliness does not produce NaN dates (defensive)", () => {
  const p = predictNextOS({ ...auAI4, earliness: 0.97 });
  assert.ok(!Number.isNaN(new Date(p.medianDate).getTime()));
});
