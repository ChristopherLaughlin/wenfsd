// Server-side prediction — mirrors the frontend js/predict.js exactly so /api/predict
// and the client agree. Rollout params come from wendata (mock) or DB-fitted values (real).
import * as W from "./wendata.js";

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
function hashInputs(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function mcPredict(o) {
  const N = o.N || 4000, L = o.L || 0.95;
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

// car: { market, hardware, installedVersion, earliness, earlinessSource, earlyAccess }
export function predictNextOS(car, opts = {}) {
  const versions = opts.versions || W.versions, today = opts.today || W.today;
  const earliness = W.effEarliness(car);
  const delta = regionDelta(car.market);
  const myKey = W.verKey(car.installedVersion || "0");
  const newer = versions.filter(v => W.verKey(v.version) > myKey && (v.status === "rolling" || v.status === "tapering" || v.status === "mature") && W.inRegion(v, car.market)).sort((a, b) => W.verKey(b.version) - W.verKey(a.version));
  if (newer.length) {
    const v = newer[0];
    let t0Days = daysBetween(today, v.t0) + delta, eff = earliness, t0Sigma;
    // STALENESS GUARD (mirrors client predict.js): a car many weeks behind the newest build it
    // could get is a demonstrated laggard — don't claim it leaps to the newest build at the
    // active-fleet midpoint. Push late, delay, widen. Only when we have no measured earliness.
    const pc = W.parseOS(car.installedVersion || "0"), pn = W.parseOS(v.version);
    const weeksBehind = (pc && pn) ? Math.max(0, (pn.year * 52 + pn.week) - (pc.year * 52 + pc.week)) : 0;
    const noHistory = car.earlinessSource == null || car.earlinessSource === "default";
    const stale = noHistory && weeksBehind >= 9;
    if (stale) {
      // bimodal arrival (offline → never; online → soon); push the midpoint out + widen hard
      eff = Math.min(0.95, Math.max(eff, weeksBehind >= 15 ? 0.9 : 0.82));
      t0Days += Math.min(120, Math.round(weeksBehind * 2.5));
      t0Sigma = Math.max(21, Math.min(70, Math.round(weeksBehind * 1.8)));
    }
    const out = mcPredict({ t0Days, k: v.k, L: 0.95, earliness: eff, t0Sigma, today, seedStr: "OS" + v.version + car.market + eff + (stale ? "s" : "") });
    out.targetLabel = v.version; out.kind = stale ? "stale" : "distributed"; out.branch = "os"; out.earliness = eff; out.stale = stale; out.weeksBehind = weeksBehind;
    if (stale) {
      const slowRegion = ((W.regions[car.market] || {}).osLagDays || 0) >= 9;
      out.note = slowRegion
        ? `This is the OS software update — separate from FSD (see below). ${car.market} gets far fewer OS builds than the US/Canada, and they arrive late and on no set schedule, so a car in ${car.market} sitting ~${weeksBehind} weeks behind the newest build it's even eligible for is closer to normal than alarming — it usually reflects how sparsely Tesla ships here, not anything wrong with your car. When the next one does land it may jump you straight to ${v.version}. Because there's no predictable cadence to fit, this is a wide, low-confidence guess — not a date to bank on.`
        : `This is the OS software update — separate from FSD (see below). Your ${car.installedVersion} is ~${weeksBehind} weeks behind, having skipped the builds since. That usually means the car hasn't been pulling updates (parked offline, sitting on an old branch, or set to decline them). If it starts updating again it could jump to ${v.version} fairly quickly; until then there's no reliable cadence to fit, so this is a wide, low-confidence guess — not a date to bank on.`;
    }
    return out;
  }
  const cad = osCadence(versions);
  const lastBranchDate = versions.map(v => v.firstSeen).sort().slice(-1)[0];
  const t0Days = Math.max(2, cad.mean - daysBetween(lastBranchDate, today)) + delta + 6;
  const p = W.parseOS(versions[0].version);
  const out = mcPredict({ t0Days, k: 0.33, L: 0.95, earliness, t0Sigma: cad.sd, today, seedStr: "OSproj" + car.market + earliness });
  out.targetLabel = `2026.${(p.week + Math.round(cad.mean / 7))}.x (projected)`; out.kind = "projected"; out.branch = "os"; out.earliness = earliness;
  return out;
}

export function predictNextFSD(car, opts = {}) {
  const versions = opts.versions || W.versions, today = opts.today || W.today;
  const earliness = W.effEarliness(car);
  const region = W.regions[car.market];
  const f = region && region.fsd ? region.fsd[car.hardware] : null;
  if (!f) return { unavailable: true, current: car.fsdVersion || "—" };
  if (f.mode === "capped") return { capped: true, current: f.current };
  // promised but never delivered, no committed timeline — refuse to invent a date (mirrors client)
  if (f.mode === "promised") return { promised: true, current: f.current, targetLabel: f.next, mode: "promised", branch: "fsd", note: f.note || null };

  const nextMajor = W.fsdMajor(f.next);

  if (f.mode === "current") {
    const out = mcPredict({ t0Days: f.cadenceDays || 35, k: f.k || 0.15, L: 0.9, earliness, t0Sigma: (f.cadenceDays || 35) * 0.45, today, seedStr: "FSDc" + car.market + earliness });
    out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd"; out.earliness = earliness;
    return out;
  }

  // FSD ships bundled in OS builds → its arrival = the OS prediction for the build that carries
  // it. Keeps next-OS-update and next-FSD consistent (see client predict.js for the rationale).
  const carrier = carrierBuild(car.hardware, nextMajor, versions, car.market);
  const myKey = W.verKey(car.installedVersion || "0");
  const nextBuild = versions.filter(v => W.verKey(v.version) > myKey && (v.status === "rolling" || v.status === "tapering" || v.status === "mature") && W.inRegion(v, car.market)).sort((a, b) => W.verKey(b.version) - W.verKey(a.version))[0];

  const _fb = nextBuild && nextBuild.fsdBuild && nextBuild.fsdBuild[car.hardware];
  const _fbMajor = (_fb && _fb !== "—") ? W.fsdMajor(_fb) : null;
  if (nextBuild && (_fbMajor == null || _fbMajor >= nextMajor)) {
    const os = predictNextOS(car, opts);
    os.targetLabel = f.next; os.current = f.current; os.mode = f.mode; os.branch = "fsd"; os.bundledWith = nextBuild.version;
    return os;
  }
  let out;
  if (f.mode === "gated") {
    out = mcPredict({ approval: f.approval, k: f.k, L: 0.9, earliness, today, seedStr: "FSDg" + f.next + car.market + earliness });
  } else if (carrier) {
    out = mcPredict({ t0Days: daysBetween(today, carrier.t0) + regionDelta(car.market), k: carrier.k || 0.33, L: 0.95, earliness, today, seedStr: "FSDcar" + f.next + car.market + earliness });
  } else {
    out = mcPredict({ t0Days: f.t0 ? daysBetween(today, f.t0) : 30, k: f.k || 0.1, L: 0.9, earliness, t0Sigma: f.t0Sigma || 12, today, seedStr: "FSDfb" + car.market });
  }
  out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd"; out.earliness = earliness;
  out.carrierBuild = carrier ? carrier.version : null;
  return out;
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
