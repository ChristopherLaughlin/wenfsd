// Server-side prediction. Same model as the frontend, but the rollout parameters
// (t0, k) come from real fitted data in `firmware_versions`, and a vehicle's earliness
// comes from its own snapshot history.
const DAY = 86400000;
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));

function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function quantile(sorted, q) { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }

/**
 * Fit a logistic rollout (t0, k) from observed cumulative adoption points.
 * points: [{ t: Date, frac: 0..1 }] sorted by time. Uses linearised logit regression:
 *   logit(frac) = k*(t - t0)  → linear in t.
 * Returns { t0: Date, k } or null if not enough signal.
 */
export function fitLogistic(points) {
  const pts = points.filter(p => p.frac > 0.02 && p.frac < 0.98);
  if (pts.length < 2) return null;
  const xs = pts.map(p => p.t.getTime() / DAY);
  const ys = pts.map(p => logit(p.frac));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den === 0) return null;
  const k = num / den;                 // slope = steepness
  const t0Days = mx - my / k;          // where logit = 0
  if (!isFinite(k) || k <= 0) return null;
  return { t0: new Date(t0Days * DAY), k };
}

/**
 * Predict when a vehicle reaches a version given fitted rollout params + the vehicle's
 * earliness percentile. Monte Carlo → { medianDate, p10Date, p90Date, daysToMedian, pmf }.
 */
export function predict({ t0, k, L = 0.95, earliness, today = new Date(), regionLagDays = 0, t0SigmaDays = 2.2, N = 4000 }) {
  const t0Base = (t0.getTime() - today.getTime()) / DAY + regionLagDays;
  const rand = mulberry32(Math.round((t0Base + earliness * 1000 + k * 100) * 1000) | 0 || 12345);
  const samples = [];
  for (let i = 0; i < N; i++) {
    const mt0 = t0Base + gauss(rand) * t0SigmaDays;
    const mk = Math.max(0.04, k + gauss(rand) * (k * 0.15));
    let p = earliness + gauss(rand) * 0.10;
    p = Math.min(0.97, Math.max(0.03, p));
    samples.push(mt0 + logit(p) / mk);
  }
  samples.sort((a, b) => a - b);
  const median = quantile(samples, 0.5), p10 = quantile(samples, 0.1), p90 = quantile(samples, 0.9);
  const pmf = {};
  for (const s of samples) { const d = Math.max(0, Math.round(s)); pmf[d] = (pmf[d] || 0) + 1; }
  for (const key in pmf) pmf[key] /= samples.length;
  const addDays = (n) => new Date(today.getTime() + n * DAY);
  return {
    daysToMedian: Math.round(median),
    medianDate: addDays(median), p10Date: addDays(p10), p90Date: addDays(p90),
    probWithinDays: (d) => samples.filter(s => s <= d).length / samples.length,
    pmf,
  };
}

// Estimate a vehicle's earliness percentile from its snapshot history.
// snapshots: [{ version, observed_at: Date }], versions: Map(version -> { t0: Date, k }).
export function estimateEarliness(snapshots, versions) {
  let sum = 0, n = 0;
  for (const s of snapshots) {
    const v = versions.get(s.version);
    if (!v || !v.t0 || !v.k) continue;
    const delayDays = (s.observed_at.getTime() - v.t0.getTime()) / DAY;
    sum += 1 / (1 + Math.exp(-v.k * delayDays));
    n++;
  }
  if (!n) return null;
  return Math.min(0.97, Math.max(0.03, sum / n));
}
