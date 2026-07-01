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
  // all AI4 + same market so the laggard and the near-current car share one rollout context.
  const lag = predictNextOS({ market: "Australia", hardware: "AI4", installedVersion: "2026.2.6.1", earliness: 0.5, earlinessSource: "default" });
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
  // the laggard guard itself must not fire on the near-current car (it's <9 weeks behind). It may
  // still carry the separate slow-region fresh-build flag — that's a different, correct signal.
  assert.ok(near.weeksBehind < 9, "a 1-branch-behind car is not a deep laggard");
});

test("a deep laggard is flagged stale even WITH a logged early history (the early-user 'NOW' bug)", () => {
  // Reported by early users: logging an early-adopter history on a car ~18 weeks behind bypassed the
  // laggard guard and collapsed its next-update prediction to "NOW" (absurd — you can't be 18 weeks
  // behind AND get the newest right now). Being this far behind is itself laggard evidence.
  const far = predictNextOS({ market: "Australia", hardware: "AI3", installedVersion: "2026.2.6.1", earliness: 0.05, earlinessSource: "history" });
  assert.equal(far.stale, true, "18 weeks behind is a laggard regardless of a logged early history");
  assert.ok(far.daysToMedian > 1, `must not collapse to NOW, got ${far.daysToMedian}d`);
  // but the LAGGARD guard must NOT over-fire on a near-current car with history. Use a US car (the
  // US leads the rollout, so there's no slow-region fresh-build wait to confound this check).
  const near = predictNextOS({ market: "United States", hardware: "AI4", installedVersion: "2026.20", earliness: 0.5, earlinessSource: "history" });
  assert.ok(!near.stale, "a near-current US car with history is not auto-flagged stale");
});

test("a fresh, still-rolling build does NOT promise a slow RHD region a near-term date (the AU 'tomorrow' bug)", () => {
  // Two AU owner signals bracketed the truth: (1) a still-rolling US-led build landing "tomorrow" is
  // near-impossible for RHD AU, but (2) the rollout is ACTIVELY reaching AU now (some cars already had
  // 2026.20.3) — so ~3 weeks out was too far. The freshWait tail is calibrated to the real ~1-week AU
  // arrival: median is a modest few-days-to-~2-weeks (NOT "tomorrow", NOT weeks out), with a wide window
  // that opens today (some already have it) and an "actively rolling now" note.
  for (const market of ["Australia", "New Zealand"]) {
    const p = predictNextOS({ market, hardware: "AI4", installedVersion: "2026.14.6", earliness: 0.5, earlinessSource: "default" });
    assert.equal(p.targetLabel, "2026.20.3", `${market} should still target the newest in-region build`);
    assert.equal(p.freshWait, true, `${market} should get the fresh-build wait treatment`);
    assert.equal(p.stale, true, `${market} fresh-build wait reads as a wide, low-confidence window`);
    assert.ok(p.daysToMedian >= 4 && p.daysToMedian <= 20, `${market} median ~a week out (not tomorrow, not weeks), got ${p.daysToMedian}d`);
    const widthDays = (new Date(p.p90Date) - new Date(p.p10Date)) / 86400000;
    assert.ok(widthDays >= 20, `${market} window must be honestly wide, got ${Math.round(widthDays)}d`);
    assert.match(p.note || "", /actively rolling|already have it|wide window/i);
  }
  // the US LEADS the rollout — it must NOT get the fresh-build wait (no false delay for fast markets)
  const us = predictNextOS({ market: "United States", hardware: "AI4", installedVersion: "2026.14.6", earliness: 0.5, earlinessSource: "default" });
  assert.equal(us.freshWait, false, "the US leads rollout — no fresh-build wait");
});

test("HW3 and HW4 get the SAME OS build (software version is hardware-agnostic; only FSD differs)", () => {
  // Reality check (June 2026): mainstream OS builds like 2026.20.3 reach BOTH HW3 and HW4 — the
  // hardware split is entirely in the FSD version (HW3 capped at v12.6.4), NOT the OS build number.
  // (This reverts an earlier wrong assumption that HW3 rides an older OS track.)
  for (const market of ["Australia", "New Zealand", "United States", "Europe"]) {
    const hw3 = predictNextOS({ market, hardware: "AI3", installedVersion: "2026.2.6.5", earliness: 0.5, earlinessSource: "default" });
    const hw4 = predictNextOS({ market, hardware: "AI4", installedVersion: "2026.2.6.5", earliness: 0.5, earlinessSource: "default" });
    assert.equal(hw3.targetLabel, hw4.targetLabel, `${market}: HW3 and HW4 must get the same OS build`);
    assert.equal(hw3.hwOlderTrack, undefined, "no hardware OS-track flag anymore");
    // a mainstream OS build must never claim to bump HW3's FSD (HW3 is capped at v12.6.4)
    assert.equal(hw3.bringsNewFsd, false, `${market}: an OS build must not bump capped HW3 FSD`);
  }
});

test("a forthcoming FSD never lands before its OS build — even when the next OS is PROJECTED", () => {
  // Found by the full permutation sweep: a car already on the newest in-region build gets a PROJECTED
  // next OS, and a forthcoming FSD with an early t0 — made worse by an extreme-early
  // earliness pulling logit(p)/k strongly negative — was predicted to arrive BEFORE the build carrying
  // it (FSD median in the past). FSD ships inside an OS build, so it can never precede your next update.
  for (const earliness of [0.05, 0.5, 0.92]) {
    const car = { market: "Canada", hardware: "AI4", installedVersion: "2026.20.3", earliness, earlinessSource: "history" };
    const os = predictNextOS(car);
    const fsd = predictNextFSD(car);
    assert.equal(os.kind, "projected", "car on newest in-region build → projected next OS");
    if (fsd.medianDate && os.medianDate) {
      const gap = (new Date(fsd.medianDate) - new Date(os.medianDate)) / 86400000;
      assert.ok(gap >= -1, `FSD must not precede its OS build (gap ${Math.round(gap)}d, earliness ${earliness})`);
    }
    assert.ok(!fsd.medianDate || new Date(fsd.medianDate) >= new Date("2026-06-26"), "FSD median must not be in the past");
  }
});

test("AU/NZ HW3 FSD is 'promised' with NO invented date (never delivered)", () => {
  for (const market of ["Australia", "New Zealand"]) {
    const p = predictNextFSD({ market, hardware: "AI3", installedVersion: "2026.14.6", earliness: 0.5 });
    assert.equal(p.promised, true, `${market} HW3 FSD should be promised, not dated`);
    assert.ok(!p.medianDate, `${market} HW3 FSD must not produce a confident date`);
    assert.match(p.note || "", /never|no committed|skeptic/i);
  }
});

test("HW3 v14 Lite: US is now ROLLING (early access, started 29 Jun 2026) with a modelled window; AU/NZ/EU stay 'promised'", () => {
  // Reality flipped 2026-06-29: Tesla started the US early-access rollout of FSD v14 Lite for HW3
  // (build 2026.20.5.1, AI chief Ashok Elluswamy). So the US is no longer 'promised' — it produces an
  // honest modelled window (mode 'early'). RHD/EU markets are still genuinely undated and follow the
  // US "in the coming weeks", so they stay 'promised' (no fabricated date).
  const us = predictNextFSD({ market: "United States", hardware: "AI3", installedVersion: "2026.20.3", earliness: 0.5 });
  assert.ok(!us.promised, "US HW3 v14 Lite is no longer 'promised' — it's rolling");
  assert.equal(us.targetLabel, "v14 Lite");
  assert.ok(us.medianDate, "US HW3 now gets a modelled v14 Lite window");
  assert.ok(us.daysToMedian >= 0, "US v14 Lite median is in the (near) future, not the past");
  // FSD can never beat the OS build that carries it — the v14 Lite window must not precede the next OS update.
  const osUs = predictNextOS({ market: "United States", hardware: "AI3", installedVersion: "2026.20.3", earliness: 0.5 });
  if (osUs.daysToMedian != null) assert.ok(us.daysToMedian >= osUs.daysToMedian - 0.001, "v14 Lite floored at the next OS update");
  for (const market of ["Australia", "New Zealand", "Europe"]) {
    const p = predictNextFSD({ market, hardware: "AI3", installedVersion: "2026.20.3", earliness: 0.5 });
    assert.equal(p.promised, true, `${market} HW3 v14 Lite stays promised (no committed date)`);
    assert.ok(!p.medianDate, `${market} HW3 must not fabricate a v14 Lite date`);
    assert.equal(p.targetLabel, "v14 Lite");
  }
});

const auAI4 = { market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", earliness: 0.45, earlinessSource: "default", earlyAccess: false };
// Canada HW4 is actively rolling v14 (AU + NZ are both PAUSED — they share the Oceania rollout), so
// the FSD bundling/sameFsd/entitlement/invariant logic is exercised against a genuinely live region.
const caAI4 = { ...auAI4, market: "Canada" };

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
  const fsd = predictNextFSD(caAI4);
  const os = predictNextOS(caAI4);
  assert.match(fsd.targetLabel, /^v14/, "FSD target is the concrete version the build carries, not a placeholder");
  assert.equal(fsd.branch, "fsd");
  assert.equal(fsd.fsdChanges, true);
  assert.equal(fsd.bundledWith, os.targetLabel, "FSD rides inside the next OS build");
  assert.equal(+new Date(fsd.medianDate), +new Date(os.medianDate), "same build → same date");
});

test("a maintenance build that keeps the same FSD is flagged sameFsd (no invented FSD date)", () => {
  // AU AI4 already on 2026.14.6.11 / FSD v14.3.4 → next build 2026.20.3 ALSO carries v14.3.4
  const car = { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4", earliness: 0.45, earlinessSource: "default" };
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
  const car = { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", earlinessSource: "default" };
  const os = predictNextOS(car, { versions: liveVersions });
  const fsd = predictNextFSD(car, { versions: liveVersions });
  assert.equal(fsd.bundledWith, os.targetLabel, "unknown per-build FSD + region rolling → bundle with next update");
  assert.equal(+new Date(fsd.medianDate), +new Date(os.medianDate), "bundled → identical date");
});

test("a forthcoming FSD that rides in a later build lands on/after the next software update, never before", () => {
  // Canada HW4 is actively rolling v14 — a real forthcoming bundled FSD with a modelled date.
  // (AU + NZ are both paused; Canada is the live rolling region.)
  const car = { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6", earlinessSource: "default" };
  const os = predictNextOS(car);
  const fsd = predictNextFSD(car);
  assert.ok(fsd.medianDate, "a forthcoming bundled FSD has a modelled date");
  assert.ok(new Date(fsd.medianDate) >= new Date(os.medianDate), "FSD must not precede the software update that carries it");
});

test("no-date FSD modes expose NO probWithin() (the /api/predict crash contract)", () => {
  // /api/predict must not call probWithin() on these; this locks the shape so the P0 can't regress.
  const cases = [
    { market: "Australia", hardware: "AI3", installedVersion: "2026.14.6", fsdVersion: "none" },            // promised
    { market: "Australia", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9" },           // paused (AU v14 on hold)
    { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4" },      // sameFsd
    { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: "none" }, // notEntitled
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
  const car = { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: "none", earlinessSource: "default" };
  const fsd = predictNextFSD(car);
  assert.equal(fsd.notEntitled, true, "no plan → not entitled");
  assert.ok(!fsd.medianDate, "must not invent an FSD arrival date for a car that can't activate it");
  // the software update is unaffected by entitlement
  const os = predictNextOS(car);
  assert.ok(os.medianDate, "software update still predicted regardless of FSD entitlement");
});

test("FSD entitlement: an owned/subscription car still gets a normal FSD prediction", () => {
  for (const ent of ["owned", "subscription", "unknown", undefined]) {
    const car = { market: "Canada", hardware: "AI4", installedVersion: "2026.14.6", fsdVersion: "v13.2.9", fsdEntitlement: ent, earlinessSource: "default" };
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

test("predictNextOS reports whether the next software build changes FSD (only when FSD is flowing)", () => {
  // NZ AI4 is actively rolling v14 (not paused), so a build carrying newer FSD DOES bump it.
  const bumps = predictNextOS(caAI4); // v13.2.9 → next build carries v14.3.4
  assert.equal(bumps.bringsNewFsd, true);
  assert.match(bumps.fsdInBuild, /^v14/);
  const maint = predictNextOS({ market: "Canada", hardware: "AI4", installedVersion: "2026.14.6.11", fsdVersion: "v14.3.4", earlinessSource: "default" });
  assert.equal(maint.bringsNewFsd, false, "a same-FSD build must not claim to bring new FSD");
  // AU AI4 is PAUSED — a mainstream OS build must NOT claim to bump its FSD even though the build carries v14
  const paused = predictNextOS(auAI4);
  assert.equal(paused.bringsNewFsd, false, "a paused-FSD region's OS build must not claim to bring FSD");
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
