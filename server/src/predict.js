// Server-side prediction — mirrors the frontend js/predict.js exactly so /api/predict
// and the client agree. Rollout params come from wendata (mock) or DB-fitted values (real).
import * as W from "./wendata.js";
import { applyEventOverlay, fsdResumed } from "./events.js";

const DAY = 86400000;
const AU_LAG = 12;

// ---- dates ----
function toDate(s) { return new Date(String(s).length <= 10 ? s + "T00:00:00Z" : s); }
function daysBetween(a, b) { return (toDate(b) - toDate(a)) / DAY; }
function addDays(today, n) { return new Date(toDate(today).getTime() + n * DAY); }

// ---- math ----
const logit = (p) => { p = Math.min(0.999, Math.max(0.001, p)); return Math.log(p / (1 - p)); };
const adoption = (t, k, L) => L / (1 + Math.exp(-k * t));
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function triangular(r, lo, mode, hi) { const u = r(), c = (mode - lo) / (hi - lo); return u < c ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode)); }
function quantile(s, q) { const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); }
function hashInputs(s) { s = String(s).slice(0, 256); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function mcPredict(o) {
  const N = Math.min(20000, Math.max(100, o.N || 4000)), L = o.L || 0.95;
  const r = rng(hashInputs(o.seedStr || "x"));
  const samples = [], approvals = [];
  for (let i = 0; i < N; i++) {
    let t0;
    if (o.approval) { const a = triangular(r, o.approval.earliestDays, o.approval.modeDays, o.approval.latestDays) + gauss(r) * 6; approvals.push(a); t0 = a + (o.midpointAfterApprovalDays || 22) + gauss(r) * 5; }
    else t0 = o.t0Days + gauss(r) * (o.t0Sigma || 2.4);
    const k = Math.max(0.04, o.k + gauss(r) * (o.k * 0.15));
    let p = o.earliness + gauss(r) * 0.10; p = Math.min(0.97, Math.max(0.03, p));
    let t = t0 + logit(p) / k;
    if (o.floorDays != null) t = Math.max(t, o.floorDays);
    samples.push(t);
  }
  samples.sort((a, b) => a - b);
  const median = quantile(samples, 0.5), p10 = quantile(samples, 0.1), p90 = quantile(samples, 0.9);
  const out = {
    daysToMedian: Math.round(median),
    medianDate: addDays(o.today, median), p10Date: addDays(o.today, p10), p90Date: addDays(o.today, p90),
    probWithin: (d) => samples.filter(s => s <= d).length / samples.length,
  };
  if (approvals.length) { approvals.sort((a, b) => a - b); out.approval = { p10: quantile(approvals, 0.1), median: quantile(approvals, 0.5), p90: quantile(approvals, 0.9) }; }
  return out;
}

function regionDelta(market) { const r = W.regions[market]; return (r ? r.osLagDays : AU_LAG) - AU_LAG; }
function carrierBuild(hardware, nextMajor, versions, market) {
  if (!nextMajor) return null;
  return versions.filter(v => (v.status === "rolling" || v.status === "tapering" || v.status === "mature") && W.inRegion(v, market) && v.fsdBuild && v.fsdBuild[hardware] && W.fsdMajor(v.fsdBuild[hardware]) >= nextMajor)
    .sort((a, b) => W.verKey(a.version) - W.verKey(b.version))[0] || null;
}

function osCadence(versions) {
  const branches = {};
  for (const v of versions) { const p = W.parseOS(v.version); const key = p.year + "." + p.week; if (!branches[key] || v.firstSeen < branches[key]) branches[key] = v.firstSeen; }
  const dates = Object.values(branches).sort();
  if (dates.length < 2) return { mean: 21, sd: 7 };
  const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) || mean * 0.4;
  // Floor sigma at ~30% of the mean gap so the projected "next update" 80% window honestly
  // reflects Tesla's variable branch cadence (the historical back-test flagged over-confidence).
  return { mean, sd: Math.max(sd, mean * 0.3, 5) };
}

// the FSD version a car is on now (its own reading, else the region's typical current)
function curFsd(car) {
  const v = car.fsdVersion;
  if (v && !/^(none|—|-|)$/i.test(String(v).trim())) return v;
  const r = W.regions[car.market];
  return (r && r.fsd && r.fsd[car.hardware]) ? r.fsd[car.hardware].current : null;
}

// car: { market, hardware, installedVersion, earliness, earlinessSource, earlyAccess }
export function predictNextOS(car, opts = {}) {
  const versions = opts.versions || W.versions, today = opts.today || W.today;
  // self-calibrating window factor from the back-test (mirrors the client's WEN.cadenceBandFactor),
  // so the projected-build window the API + poller use matches what the dashboard shows.
  const bandFactor = Math.min(2.5, Math.max(0.6, +opts.bandFactor || 1));
  const earliness = W.effEarliness(car);
  const delta = regionDelta(car.market);
  // OBSERVED override: a connected car reporting a pending OTA is reality, not a model guess
  // (mirrors client predict.js). Tight, high-confidence window; only fires with a real pending read.
  const pu = car.pendingUpdate;
  if (pu && pu.version && W.verKey(pu.version) > W.verKey(car.installedVersion || "0")) {
    const st = String(pu.status || "").toLowerCase();
    const t0 = st.includes("install") ? 0 : (st.includes("download") || st.includes("schedul")) ? 1 : 3;
    const out = mcPredict({ t0Days: t0, k: 0.5, L: 0.95, earliness: 0.5, t0Sigma: 1.5, floorDays: 0, today, seedStr: "PU" + pu.version + st });
    const build = versions.find(v => v.version === pu.version);
    out.targetLabel = pu.version; out.kind = "confirmed"; out.branch = "os"; out.confirmed = true; out.pendingStatus = pu.status; out.earliness = 0.5;
    out.fsdCurrent = curFsd(car);
    out.fsdInBuild = (build && build.fsdBuild && build.fsdBuild[car.hardware]) || null;
    out.bringsNewFsd = !!(out.fsdInBuild && out.fsdInBuild !== "—" && W.fsdKey(out.fsdInBuild) > W.fsdKey(out.fsdCurrent));
    return applyEventOverlay(out, opts.events, car, today);
  }
  const myKey = W.verKey(car.installedVersion || "0");
  // The OS build (software version) is REGION-driven and hardware-AGNOSTIC: HW3 and HW4 receive the same
  // mainstream builds (e.g. 2026.20.3 reaches both). The hardware split lives entirely in the FSD axis
  // (HW3 capped at v12.6.4 — see predictNextFSD), NOT in the OS version. Don't filter builds by hardware.
  const newer = versions.filter(v => W.verKey(v.version) > myKey && (v.status === "rolling" || v.status === "tapering" || v.status === "mature") && W.inRegion(v, car.market)).sort((a, b) => W.verKey(b.version) - W.verKey(a.version));
  if (newer.length) {
    const v = newer[0];
    let t0Days = daysBetween(today, v.t0) + delta, eff = earliness, t0Sigma;
    // STALENESS GUARD (mirrors client predict.js): a car many weeks behind the newest build it
    // could get is a demonstrated laggard — don't claim it leaps to the newest build at the
    // active-fleet midpoint. Push late, delay, widen. Only when we have no measured earliness.
    const pc = W.parseOS(car.installedVersion || "0"), pn = W.parseOS(v.version);
    const weeksBehind = (pc && pn) ? Math.max(0, (pn.year * 52 + pn.week) - (pc.year * 52 + pc.week)) : 0;
    // A car 9+ weeks (~2 branches) behind the newest build is a laggard — even if it logged an early
    // adopter history. Being this far behind is itself evidence it isn't pulling promptly, so it
    // overrides the rosy earliness (otherwise logging an early history collapsed a way-behind car's
    // prediction to "NOW" — reported by early users).
    const stale = weeksBehind >= 9;
    const slowRegion = ((W.regions[car.market] || {}).osLagDays || 0) >= 9;
    // FRESH-BUILD GUARD for slow RHD/EU regions: a build that is still actively `rolling` reaches
    // the US/Canada first; AU/NZ/EU sit near the back of that queue and get it weeks later, on no
    // set schedule. The build's t0 is the US-led GLOBAL midpoint, so anchoring a confident near-term
    // date for a slow region is false precision — e.g. AU cars only ~6 weeks behind were being told
    // a still-rolling build lands "tomorrow", which is near-impossible for RHD. So even when <9 weeks
    // behind, push the median into that regional tail, widen, and flag low confidence. Excludes
    // builds already tapering/mature (those have already reached the region) and older rolling builds
    // whose global midpoint is well in the past (the region has had time to catch them).
    const freshWait = slowRegion && v.status === "rolling" && daysBetween(today, v.t0) > -7;
    if (stale) {
      // far-behind + no history: the newest build still reaches an online car on its own rollout
      // schedule (a laggard catches the next wave like everyone else), so keep the MEDIAN near
      // normal arrival + a modest nudge, and express uncertainty by widening hard + low confidence
      // (the wide late tail covers "might be offline for ages"). Don't shove the midpoint months out.
      eff = Math.min(0.8, Math.max(eff, 0.55));
      // Floor the base at 0 BEFORE the nudge: a laggard's target can be a mature build whose midpoint
      // is already in the PAST (esp. HW3, which rides older matured builds) — without the floor the
      // nudge can't lift the median off "today", re-collapsing to the NOW bug. A deep laggard won't
      // pull even an available build instantly, so keep a modest forward median + the wide late tail.
      t0Days = Math.max(t0Days, 0) + Math.min(21, Math.round(weeksBehind * 0.6));
      t0Sigma = Math.max(18, Math.min(60, Math.round(weeksBehind * 1.6)));
    }
    if (freshWait) {
      // A still-rolling, US-led build reaches slow RHD/EU regions weeks after its global midpoint —
      // ADDITIVE to any laggard nudge (the build is late here regardless of how behind the car is),
      // so a deep laggard never predicts a fresh build sooner than a moderately-behind car. The tail
      // is tied to the region's own steady-state lag (~1.8×, capped), pending real AU/NZ arrival
      // data — owner-tunable. Widen the window to honest weeks (keeping any wider laggard sigma).
      // The region's rollout of this build hasn't started yet, so even a usually-early adopter waits
      // for the regional delay — clamp earliness up so extreme-early history can't collapse to "today".
      eff = Math.max(eff, 0.4);
      t0Days += Math.min(45, Math.round(((W.regions[car.market] || {}).osLagDays || 12) * 1.8));
      t0Sigma = Math.max(t0Sigma || 2.4, 16);
    }
    const lowConf = stale || freshWait;
    const out = mcPredict({ t0Days, k: v.k, L: 0.95, earliness: eff, t0Sigma, floorDays: 0, today, seedStr: "OS" + v.version + car.market + eff + (stale ? "s" : "") + (freshWait ? "f" : "") });
    out.targetLabel = v.version; out.kind = lowConf ? "stale" : "distributed"; out.branch = "os"; out.earliness = eff; out.stale = lowConf; out.weeksBehind = weeksBehind; out.freshWait = freshWait;
    // does this particular software update change the FSD version, or leave it untouched? A build only
    // BRINGS new FSD if the region's FSD for this hardware is actively flowing — a mainstream OS build
    // never delivers FSD that's paused/gated/promised/capped for your region (that's the OS-vs-FSD split).
    out.fsdCurrent = curFsd(car);
    out.fsdInBuild = (v.fsdBuild && v.fsdBuild[car.hardware]) || null;
    const rf = (W.regions[car.market] || {}).fsd && W.regions[car.market].fsd[car.hardware];
    const fsdActive = !!(rf && !rf.paused && (rf.mode === "rolling" || rf.mode === "current" || rf.mode === "early"));
    out.bringsNewFsd = !!(out.fsdInBuild && out.fsdInBuild !== "—" && W.fsdKey(out.fsdInBuild) > W.fsdKey(out.fsdCurrent) && fsdActive);
    if (stale) {
      out.note = slowRegion
        ? `This is the OS software update — separate from FSD (see below). ${car.market} gets far fewer OS builds than the US/Canada, and they arrive late and on no set schedule, so a car in ${car.market} sitting ~${weeksBehind} weeks behind the newest build it's even eligible for is closer to normal than alarming — it usually reflects how sparsely Tesla ships here, not anything wrong with your car. When the next one does land it may jump you straight to ${v.version}. Because there's no predictable cadence to fit, this is a wide, low-confidence guess — not a date to bank on.`
        : `This is the OS software update — separate from FSD (see below). Your ${car.installedVersion} is ~${weeksBehind} weeks behind, having skipped the builds since. That usually means the car hasn't been pulling updates (parked offline, sitting on an old branch, or set to decline them). If it starts updating again it could jump to ${v.version} fairly quickly; until then there's no reliable cadence to fit, so this is a wide, low-confidence guess — not a date to bank on.`;
    } else if (freshWait) {
      out.note = `This is the OS software update — separate from FSD (see below). ${v.version} is still rolling out, and Tesla ships it to the US and Canada first. ${car.market} sits near the back of that queue and usually gets new builds weeks later, on no set schedule — so pinning a confident near-term date here would be fiction. This is a wide, low-confidence guess; when it does land it may jump you straight to ${v.version}. Not a date to bank on.`;
    }
    return applyEventOverlay(out, opts.events, car, today);
  }
  const cad = osCadence(versions);
  const lastBranchDate = versions.map(v => v.firstSeen).sort().slice(-1)[0];
  const t0Days = Math.max(2, cad.mean - daysBetween(lastBranchDate, today)) + delta + 6;
  const p = W.parseOS(versions[0].version);
  const out = mcPredict({ t0Days, k: 0.33, L: 0.95, earliness, t0Sigma: cad.sd * bandFactor, floorDays: 0, today, seedStr: "OSproj" + car.market + earliness });
  out.targetLabel = `2026.${(p.week + Math.round(cad.mean / 7))}.x (projected)`; out.kind = "projected"; out.branch = "os"; out.earliness = earliness;
  return applyEventOverlay(out, opts.events, car, today);
}

export function predictNextFSD(car, opts = {}) {
  const versions = opts.versions || W.versions, today = opts.today || W.today;
  const earliness = W.effEarliness(car);
  const region = W.regions[car.market];
  const f = region && region.fsd ? region.fsd[car.hardware] : null;
  if (!f) return { unavailable: true, current: car.fsdVersion || "—" };
  if (f.mode === "capped") return { capped: true, current: f.current };
  // PAUSED — the rollout started then Tesla put it on hold. Freeze (no invented date) UNLESS a
  // confirmed resume event has cleared it (auto-unpause). Mirrors client.
  if (f.paused && !fsdResumed(opts.events, car.market, f.next)) return { paused: true, current: f.current, targetLabel: f.next, mode: "paused", branch: "fsd", pausedSince: f.pausedSince || null, note: f.pauseNote || f.note || null };
  // promised but never delivered, no committed timeline — refuse to invent a date (mirrors client)
  if (f.mode === "promised") return { promised: true, current: f.current, targetLabel: f.next, mode: "promised", branch: "fsd", note: f.note || null };

  const nextMajor = W.fsdMajor(f.next);
  const cur = curFsd(car);
  const curKey = W.fsdKey(cur);

  // entitlement — FSD only activates on cars with it purchased/subscribed (mirrors client). This
  // must come BEFORE any date-producing path (incl. the gated regulatory window): if the car has no
  // FSD package, "you don't have FSD" is the honest answer — never an ETA it can't receive.
  if (car.fsdEntitlement === "none") {
    const capable = f.next || f.current || "FSD";
    return { notEntitled: true, current: cur, targetLabel: capable, mode: "notEntitled", branch: "fsd" };
  }

  // gated — regulators haven't cleared it for this region → modelled regulatory window
  if (f.mode === "gated") {
    const out = mcPredict({ approval: f.approval, k: f.k, L: 0.9, earliness, today, seedStr: "FSDg" + f.next + car.market + earliness });
    out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd"; out.earliness = earliness;
    return out;
  }

  // FSD rides inside OS builds, but most builds keep the same FSD version. Does the next software
  // update actually CHANGE the FSD version? (mirrors client predict.js exactly)
  const osNext = predictNextOS(car, opts);
  const nextIsConcrete = osNext.kind !== "projected";
  const buildFsd = osNext.fsdInBuild;
  const buildKey = (buildFsd && buildFsd !== "—") ? W.fsdKey(buildFsd) : null;

  // INVARIANT: FSD ships INSIDE an OS build, so it can never reach you before your next software
  // update — the soonest is bundled with it. Reuse the OS prediction so they can't invert.
  const bundleWithNext = (label) => {
    osNext.bundledWith = osNext.targetLabel;
    osNext.targetLabel = label; osNext.current = cur; osNext.mode = "bundled"; osNext.branch = "fsd"; osNext.fsdChanges = true;
    return osNext;
  };

  // (1) the build we know you're getting carries a NEWER FSD → bundled, same day
  if (nextIsConcrete && buildKey != null && buildKey > curKey) return bundleWithNext(buildFsd);

  const configHasNewer = nextMajor != null && nextMajor > (W.fsdMajor(cur) || 0) && (f.t0 || f.mode === "rolling" || f.mode === "early" || f.mode === "current");
  if (configHasNewer) {
    // a current in-region build already carries it (carrier ≤ the newest build you're getting) →
    // you receive it WITH your next software update → bundled. Also covers live data with no per-build FSD.
    const carrier = carrierBuild(car.hardware, nextMajor, versions, car.market);
    const carrierBundles = nextIsConcrete && carrier && W.verKey(carrier.version) <= W.verKey(osNext.targetLabel);
    const unknownButRolling = nextIsConcrete && buildKey == null && (f.mode === "rolling" || f.mode === "early" || f.mode === "current");
    if (carrierBundles || unknownButRolling) return bundleWithNext(f.next);
    // (2) genuinely forthcoming FSD (no build carries it yet) → later, separate build; floor it at
    //     the next-OS midpoint so it can never land before your next software update.
    // Floor the forthcoming FSD at the next-OS midpoint so it can never land before your next software
    // update — this must hold even when that next update is PROJECTED (you're already on the newest
    // in-region build): otherwise a forthcoming FSD with an early t0 could be shown arriving before the
    // build that would carry it (the NZ AI4 case). Concrete next-OS keeps a +7 buffer; for a projected
    // next-OS (already fuzzy/later) we floor at its midpoint itself.
    const floorDays = osNext.daysToMedian != null ? osNext.daysToMedian + (nextIsConcrete ? 7 : 0) : 0;
    const t0Days = Math.max(f.t0 ? daysBetween(today, f.t0) : 30, floorDays);
    // floor EVERY sample (not just t0) at the next-OS midpoint: an extreme-early earliness pulls
    // logit(p)/k strongly negative and would otherwise drag the median before your next OS update.
    const out = mcPredict({ t0Days, k: f.k || 0.1, L: 0.9, earliness, t0Sigma: f.t0Sigma || 14, floorDays, today, seedStr: "FSDfb" + car.market });
    out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd"; out.earliness = earliness; out.fsdChanges = true;
    return out;
  }

  // (3) 'current' — on the newest FSD; project the next point from cadence
  if (f.mode === "current") {
    const out = mcPredict({ t0Days: f.cadenceDays || 35, k: f.k || 0.15, L: 0.9, earliness, t0Sigma: (f.cadenceDays || 35) * 0.45, today, seedStr: "FSDc" + car.market + earliness });
    out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd"; out.earliness = earliness;
    return out;
  }

  // (4) nothing newer in the pipeline → next software update keeps FSD as-is
  return { sameFsd: true, current: cur, targetLabel: null, mode: "same", branch: "fsd", bundledWith: osNext.kind !== "projected" ? osNext.targetLabel : null };
}

// ---- kept for the poller: fit logistic + estimate earliness from real snapshots ----
export function fitLogistic(points) {
  const pts = points.filter(p => p.frac > 0.02 && p.frac < 0.98);
  if (pts.length < 2) return null;
  const xs = pts.map(p => p.t.getTime() / DAY), ys = pts.map(p => logit(p.frac)), n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den === 0) return null;
  const k = num / den, t0Days = mx - my / k;
  if (!isFinite(k) || k <= 0) return null;
  return { t0: new Date(t0Days * DAY), k };
}
export function estimateEarliness(snapshots, versionsMap) {
  let sum = 0, n = 0;
  for (const s of snapshots) {
    const v = versionsMap.get(s.version);
    if (!v || !v.t0 || !v.k) continue;
    sum += 1 / (1 + Math.exp(-v.k * ((s.observed_at.getTime() - v.t0.getTime()) / DAY))); n++;
  }
  return n ? Math.min(0.97, Math.max(0.03, sum / n)) : null;
}

export { adoption, addDays, daysBetween };
