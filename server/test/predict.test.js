import { test } from "node:test";
import assert from "node:assert/strict";
import { predictNextOS, predictNextFSD } from "../src/predict.js";
import { parseOS, verKey, versions } from "../src/wendata.js";

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

test("a deep laggard is flagged stale + WIDE, but its median stays near the next wave (not months out)", () => {
  const lag = predictNextOS({ market: "Australia", hardware: "AI3", installedVersion: "2026.2.6.1", earliness: 0.5, earlinessSource: "default" });
  const near = predictNextOS({ market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", earliness: 0.5, earlinessSource: "default" });
  const veryFar = predictNextOS({ market: "Australia", hardware: "AI4", installedVersion: "2025.20", earliness: 0.5, earlinessSource: "default" });
  assert.equal(lag.stale, true, "a ~18-week-behind car should be flagged stale");
  assert.ok(lag.weeksBehind >= 15);
  assert.ok(lag.daysToMedian > near.daysToMedian, "laggard predicts a bit later than a near-current car");
  // the bug we're guarding against: an online laggard catches the next rollout wave like everyone
  // else, so the MEDIAN must stay near-term (weeks), never get shoved months out.
  assert.ok(lag.daysToMedian < 45, `laggard median must stay near the next wave, got ${lag.daysToMedian}d`);
  assert.ok(veryFar.daysToMedian < 60, `even a year-behind car must not predict months out, got ${veryFar.daysToMedian}d`);
  // the uncertainty shows up as a WIDE window, not a late median
  const widthDays = (new Date(lag.p90Date) - new Date(lag.p10Date)) / 86400000;
  assert.ok(widthDays >= 40, `stale window should be wide, got ${Math.round(widthDays)}d`);
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
// New Zealand HW4 is still actively rolling v14 (same profile AU had before its rollout was paused),
// so the FSD bundling/sameFsd/entitlement/invariant logic is exercised against a live-rolling region.
const nzAI4 = { ...auAI4, market: "New Zealand" };

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
  const fsd = predictNextFSD(nzAI4);
  const os = predictNextOS(nzAI4);
  assert.match(fsd.targetLabel, /^v14/, "FSD target is the concrete version the build carries, not a placeholder");
  assert.equal(fsd.branch, "fsd");
  assert.equal(fsd.fsdChanges, true);
  assert.equal(fsd.bundledWith, os.targetLabel, "FSD rides inside the next OS build");
  assert.equal(+new Date(fsd.medianDate), +new Date(os.medianDate), "same build → same date");
});

test("a maintenance build that keeps the same FSD is flagged sameFsd (no invented FSD date)", () => {
  // AU AI4 already on 2026.14.6.11 / FSD v14.3.4 → next build 2026.20.3 ALSO carries v14.3.4
  const car = { market: "New Zealand", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4", earliness: 0.45, earlinessSource: "default" };
  const fsd = predictNextFSD(car);
  assert.equal(fsd.sameFsd, true, "next software update carries no newer FSD");
  assert.ok(!fsd.medianDate, "we must NOT fabricate an FSD date when nothing newer is in the pipeline");
  assert.equal(fsd.current, "v14.3.4");
});

test("a connected car's PENDING update overrides the model (observed, confident, near-term)", () => {
  // car reports it's downloading 2026.20.3 right now — that's reality, not a guess
  const car = { market: "Australia", hardware: "AI4", installedVersion: "2026.2.6.1", earlinessSource: "default", pendingUpdate: { version: "2026.20.3", status: "downloading" } };
  const p = predictNextOS(car);
  assert.equal(p.confirmed, true, "pending update → confirmed");
  assert.equal(p.kind, "confirmed");
  assert.equal(p.targetLabel, "2026.20.3");
  assert.ok(p.daysToMedian <= 3, `confirmed update is imminent, got ${p.daysToMedian}d`);
  const widthDays = (new Date(p.p90Date) - new Date(p.p10Date)) / 86400000;
  assert.ok(widthDays < 12, `confirmed window is tight, got ${Math.round(widthDays)}d`);
  // and it ignores the staleness path even though the car is far behind
  assert.ok(!p.stale);
});

test("a pending update for a version you already have does NOT override (no false confirm)", () => {
  const car = { market: "Australia", hardware: "AI4", installedVersion: "2026.20.3", earlinessSource: "default", pendingUpdate: { version: "2026.14.6", status: "available" } };
  const p = predictNextOS(car);
  assert.ok(!p.confirmed, "an older/stale pending version must not hijack the prediction");
});

test("INVARIANT: FSD never predicted before the next software update (it ships inside a build)", () => {
  // live-data path: trackers often omit per-build FSD. A car on v13 whose region is actively
  // rolling v14 must BUNDLE with the next software update — never get an earlier, separate date.
  const liveVersions = versions.map((v) => ({ ...v, fsdBuild: undefined }));
  const car = { market: "New Zealand", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", earlinessSource: "default" };
  const os = predictNextOS(car, { versions: liveVersions });
  const fsd = predictNextFSD(car, { versions: liveVersions });
  assert.equal(fsd.bundledWith, os.targetLabel, "unknown per-build FSD + region rolling → bundle with next update");
  assert.equal(+new Date(fsd.medianDate), +new Date(os.medianDate), "bundled → identical date");
});

test("a forthcoming FSD (US v14 Lite) lands on/after the next software update, never before", () => {
  const car = { market: "United States", hardware: "AI3", installedVersion: "2026.14.6", fsdVersion: "v12.6.4", earlinessSource: "default" };
  const os = predictNextOS(car);
  const fsd = predictNextFSD(car);
  assert.ok(fsd.medianDate, "US HW3 Lite has a modelled date");
  assert.ok(new Date(fsd.medianDate) >= new Date(os.medianDate), "FSD must not precede the next software update");
});

test("no-date FSD modes expose NO probWithin() (the /api/predict crash contract)", () => {
  // /api/predict must not call probWithin() on these; this locks the shape so the P0 can't regress.
  const cases = [
    { market: "Australia", hardware: "AI3", installedVersion: "2026.14.6", fsdVersion: "none" },            // promised
    { market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9" },           // paused (AU v14 on hold)
    { market: "New Zealand", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4" },      // sameFsd
    { market: "New Zealand", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: "none" }, // notEntitled
  ];
  for (const c of cases) {
    const p = predictNextFSD(c);
    assert.ok(p.promised || p.paused || p.sameFsd || p.notEntitled, `expected a no-date mode for ${JSON.stringify(c)}`);
    assert.equal(typeof p.probWithin, "undefined", "no-date modes must not carry probWithin()");
  }
  // a normal dated prediction DOES carry probWithin()
  const dated = predictNextFSD({ market: "United States", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9" });
  assert.equal(typeof dated.probWithin, "function");
});

test("FSD entitlement: a car with no FSD plan gets no FSD date (feature stays dormant)", () => {
  const car = { market: "New Zealand", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: "none", earlinessSource: "default" };
  const fsd = predictNextFSD(car);
  assert.equal(fsd.notEntitled, true, "no plan → not entitled");
  assert.ok(!fsd.medianDate, "must not invent an FSD arrival date for a car that can't activate it");
  // the software update is unaffected by entitlement
  const os = predictNextOS(car);
  assert.ok(os.medianDate, "software update still predicted regardless of FSD entitlement");
});

test("FSD entitlement: an owned/subscription car still gets a normal FSD prediction", () => {
  for (const ent of ["owned", "subscription", "unknown", undefined]) {
    const car = { market: "New Zealand", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: ent, earlinessSource: "default" };
    const fsd = predictNextFSD(car);
    assert.ok(!fsd.notEntitled, `entitlement ${ent} should predict normally`);
  }
});

test("a PAUSED FSD rollout (AU v14) is frozen: no date, no probWithin, honest note", () => {
  const fsd = predictNextFSD({ market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: "owned" });
  assert.equal(fsd.paused, true);
  assert.equal(fsd.mode, "paused");
  assert.ok(!fsd.medianDate, "no invented date while paused");
  assert.equal(typeof fsd.probWithin, "undefined", "paused must not carry probWithin()");
  assert.match(fsd.note, /hold|paused/i);
});

test("a confirmed RESUME event AUTO-UNPAUSES the AU FSD hold (no manual step)", () => {
  const car = { market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: "owned" };
  assert.equal(predictNextFSD(car).paused, true, "paused by default");
  const resumed = predictNextFSD(car, { events: [{ type: "resume", region: "Australia", version: "v14.x" }] });
  assert.ok(!resumed.paused, "a confirmed FSD resume clears the hold");
  assert.ok(resumed.medianDate || resumed.bundledWith, "and it predicts again");
  // a resume for a DIFFERENT region must not clear AU's hold
  assert.equal(predictNextFSD(car, { events: [{ type: "resume", region: "Europe", version: "v14.x" }] }).paused, true);
  // an OS-build resume (numeric version) must not clear the FSD hold
  assert.equal(predictNextFSD(car, { events: [{ type: "resume", region: "Australia", version: "2026.20.3" }] }).paused, true);
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
