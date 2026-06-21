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
function carrierBuild(hardware, nextMajor, versions) {
  if (!nextMajor) return null;
  return versions.filter(v => (v.status === "rolling" || v.status === "tapering" || v.status === "mature") && v.fsdBuild && v.fsdBuild[hardware] && W.fsdMajor(v.fsdBuild[hardware]) >= nextMajor)
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
  return { mean, sd: Math.max(3, sd) };
}

// car: { market, hardware, installedVersion, earliness, earlinessSource, earlyAccess }
export function predictNextOS(car, opts = {}) {
  const versions = opts.versions || W.versions, today = opts.today || W.today;
  const earliness = W.effEarliness(car);
  const delta = regionDelta(car.market);
  const myKey = W.verKey(car.installedVersion || "0");
  const newer = versions.filter(v => W.verKey(v.version) > myKey && (v.status === "rolling" || v.status === "tapering" || v.status === "mature")).sort((a, b) => W.verKey(b.version) - W.verKey(a.version));
  if (newer.length) {
    const v = newer[0];
    const out = mcPredict({ t0Days: daysBetween(today, v.t0) + delta, k: v.k, L: 0.95, earliness, today, seedStr: "OS" + v.version + car.market + earliness });
    out.targetLabel = v.version; out.kind = "distributed"; out.branch = "os"; out.earliness = earliness;
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

  const nextMajor = W.fsdMajor(f.next);
  const carrier = carrierBuild(car.hardware, nextMajor, versions);
  const carrierFloor = carrier ? Math.max(0, daysBetween(today, carrier.t0) + regionDelta(car.market) - 4) : null;

  let out, wave = null;
  if (f.mode === "rolling" || f.mode === "early") {
    // major FSD version jumps reach new deliveries first; the existing fleet gets a later wave
    const existingWave = f.newDeliveryFirst && !car.newCar;
    if (f.newDeliveryFirst) wave = car.newCar ? "new" : "existing";
    const t0Days = daysBetween(today, f.t0) + (existingWave ? (f.existingFleetDelayDays || 45) : 0);
    const t0Sigma = existingWave ? (f.existingFleetSigma || 21) : (f.t0Sigma || (f.mode === "early" ? 7 : 3));
    out = mcPredict({ t0Days, k: f.k, L: 0.9, earliness, t0Sigma, floorDays: carrierFloor, today, seedStr: "FSD" + f.next + car.market + earliness + (existingWave ? "x" : "n") });
  } else if (f.mode === "gated") {
    out = mcPredict({ approval: f.approval, k: f.k, L: 0.9, earliness, today, seedStr: "FSDg" + f.next + car.market + earliness });
  } else { // current
    out = mcPredict({ t0Days: f.cadenceDays || 35, k: f.k || 0.15, L: 0.9, earliness, t0Sigma: (f.cadenceDays || 35) * 0.45, today, seedStr: "FSDc" + car.market + earliness });
  }
  out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd"; out.earliness = earliness;
  out.carrierBuild = carrier ? carrier.version : null; out.wave = wave;
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
