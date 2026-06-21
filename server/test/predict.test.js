import { test } from "node:test";
import assert from "node:assert/strict";
import { predictNextOS, predictNextFSD } from "../src/predict.js";

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

test("predictNextFSD returns the next FSD version + carrier build for AU/HW4", () => {
  const p = predictNextFSD(auAI4);
  assert.equal(p.targetLabel, "v14.x");
  assert.equal(p.branch, "fsd");
  assert.equal(p.carrierBuild, "2026.14.6.11");
});

test("FSD is capped on hardware-limited config (Europe/AI3)", () => {
  const p = predictNextFSD({ market: "Europe", hardware: "AI3", earliness: 0.45 });
  assert.equal(p.capped, true);
});

test("invalid earliness does not produce NaN dates (defensive)", () => {
  const p = predictNextOS({ ...auAI4, earliness: 0.97 });
  assert.ok(!Number.isNaN(new Date(p.medianDate).getTime()));
});
