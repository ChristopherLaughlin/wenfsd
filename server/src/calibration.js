// Honest model calibration / back-test against real tracker history.
//
// We deliberately DON'T publish a "measured rollout-k vs assumed-k" number: the only public
// time-series available (TeslaFi daily installs, ~8-day window, ~13k-car sample) measures
// install FLOW for a small sample, not the fleet-wide STOCK adoption curve the model's k
// describes — comparing them would be fake precision. Instead we report what the data DOES
// support, honestly labelled:
//   1) release cadence   — real days between OS branches (what the "next update" engine uses)
//   2) rollout velocity  — how fast installs concentrate once a version reaches cars
//   3) coverage          — versions × live sources backing the numbers
//   4) an explicit note that per-car accuracy is validated against connected cars, not faked.
import { merge } from "./sources/index.js";
import { fetchDailySeries } from "./sources/teslafi.js";
import { query, hasDb } from "./db.js";
import * as W from "./wendata.js";

function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function median(xs) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function sd(xs, mean) { if (xs.length < 2) return null; return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)); }

// real release cadence from first-seen dates, grouped by branch (year.week)
function cadence(versions) {
  const branch = {};
  for (const v of versions) {
    if (!v.firstSeen) continue;
    const m = /^(\d{4})\.(\d+)/.exec(v.version);
    if (!m) continue;
    const key = `${m[1]}.${m[2]}`;
    if (!branch[key] || v.firstSeen < branch[key]) branch[key] = v.firstSeen;
  }
  const dates = Object.values(branch).sort();
  if (dates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { medianDays: median(gaps), meanDays: Math.round(mean * 10) / 10, sdDays: Math.round((sd(gaps, mean) || 0) * 10) / 10, branches: dates.length, gaps: gaps.length };
}

// how fast a rollout concentrates: days for in-window installs to go 25% → 75% of their total.
// Honest framing: this is observed install concentration once a version reaches cars — not the
// fleet-wide curve steepness.
function velocity(series) {
  const spans = [];
  const examples = [];
  for (const s of series) {
    if (!s.daily || s.total < 50) continue;            // need signal
    let acc = 0; const frac = s.daily.map(d => (acc += d) / s.total);
    const cross = (th) => { for (let i = 0; i < frac.length; i++) if (frac[i] >= th) return i === 0 ? 0 : (i - 1) + (th - frac[i - 1]) / (frac[i] - frac[i - 1]); return null; };
    const t25 = cross(0.25), t75 = cross(0.75);
    if (t25 == null || t75 == null || t75 < t25) continue;
    const span = Math.round((t75 - t25) * 10) / 10;
    spans.push(span);
    examples.push({ version: s.version, daysQ1toQ3: span, installs: s.total });
  }
  if (!spans.length) return null;
  examples.sort((a, b) => b.installs - a.installs);
  return { medianDaysQ1toQ3: median(spans), sampleVersions: spans.length, examples: examples.slice(0, 5) };
}

// WALK-FORWARD BACK-TEST of the branch-cadence predictor — the engine behind "next update" when
// you're already current. At each historical branch release, we predict the NEXT branch's arrival
// using ONLY the gaps observed before it, build an 80% window the same way the model does, then
// check whether the real date landed inside it. This proves the prediction against data we already
// ingest (tracker first-seen dates) — no connected cars required. A well-calibrated 80% window
// should capture the truth ~80% of the time; we publish the number we actually get.
const Z80 = 1.2816;   // two-sided 80% normal quantile
const COVERAGE_MIN_N = 8;   // don't headline a back-test hit-rate % until ≥8 walk-forward trials
export function backtest(versions) {
  const branch = {};
  for (const v of versions || []) {
    if (!v.firstSeen) continue;
    const m = /^(\d{4})\.(\d+)/.exec(v.version); if (!m) continue;
    const key = `${m[1]}.${m[2]}`;
    if (!branch[key] || v.firstSeen < branch[key]) branch[key] = v.firstSeen;
  }
  const dates = Object.values(branch).sort();
  if (dates.length < 5) return null;                         // need enough history to walk forward
  const day = 86400000;
  const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  let tested = 0, inWindow = 0; const errs = [], zs = [];
  for (let i = 4; i < dates.length; i++) {                   // warm-up: ≥3 prior gaps before predicting
    const prior = gaps.slice(0, i - 1);
    const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
    const s = sd(prior, mean) || mean * 0.4;
    const predMid = Date.parse(dates[i - 1]) + mean * day;
    const lo = predMid - Z80 * s * day, hi = predMid + Z80 * s * day;
    const actual = Date.parse(dates[i]);
    tested++; if (actual >= lo && actual <= hi) inWindow++;
    const errDays = Math.round((actual - predMid) / day);
    errs.push(Math.abs(errDays));
    if (s > 0) zs.push(Math.abs((actual - predMid) / day) / s);   // standardized residual
  }
  if (!tested) return null;
  // CONFORMAL band-calibration: the empirical 80th-percentile standardized residual is the
  // half-width (in sigmas) that WOULD have captured 80% of real releases. bandFactor scales the
  // model's assumed normal half-width (1.2816σ) to that empirical value → self-calibrating windows.
  // Only trust it with enough points; clamp so a noisy sample can't distort the live model.
  let bandFactor = null;
  if (tested >= 6) {
    const q80 = quantile(zs, 0.8);
    if (q80 > 0) bandFactor = Math.round(Math.min(2.5, Math.max(0.6, q80 / Z80)) * 100) / 100;
  }
  return {
    tested, branches: dates.length, targetCoverage: 80,
    // A binary hit-rate over a handful of trials is too noisy to headline as "the model works" (with 4
    // releases, coverage moves in 25% steps — the sample set's 4 points read as a misleading "50%"). Only
    // publish the coverage % once the walk-forward has tested enough real branches; below COVERAGE_MIN_N
    // the UI shows "warming up — N/8". medianAbsErrorDays is more robust at small n, so it's always shown.
    coveragePct: tested >= COVERAGE_MIN_N ? Math.round((inWindow / tested) * 100) : null,
    medianAbsErrorDays: median(errs),
    bandFactor,   // null until enough history; the client widens/narrows its 80% window by this
  };
}
function quantile(xs, q) {
  if (!xs || !xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

// ---- FIT-FROM-OBSERVATIONS: learn k + t0 from real install timing instead of hand-set priors ----
// Given the days-since-release on which cars actually received a build, fit the logistic adoption
// curve F(t) = 1/(1+e^-k(t-t0)). logit(F) = k·t − k·t0 is linear in t, so an OLS regression of
// logit(plotting-position fraction) on day recovers slope k and intercept → t0 = −intercept/k.
// Returns null until there are enough observations to fit honestly (no fabricated params).
export function fitRollout(installDays, minPoints = 8) {
  const xs = (installDays || []).filter(d => Number.isFinite(d)).sort((a, b) => a - b);
  const n = xs.length;
  if (n < minPoints) return null;
  // plotting-position fraction for the i-th of n sorted installs (avoids logit(0)/logit(1))
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const ys = xs.map((_, i) => Math.log(((i + 0.5) / n) / (1 - (i + 0.5) / n)));
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  let k = (n * sxy - sx * sy) / denom;          // slope
  const b = (sy - k * sx) / n;                  // intercept
  if (!(k > 0)) return null;                    // non-increasing ⇒ not a rollout we can fit
  k = Math.min(0.6, Math.max(0.04, k));
  const t0Days = Math.round((-b / k) * 10) / 10;
  // residual spread (days): how far each real install sat from where the fitted curve placed it
  const resid = xs.map((x, i) => x - (t0Days + ys[i] / k));
  const mean = resid.reduce((a, c) => a + c, 0) / n;
  const sigmaDays = Math.round((sd(resid, mean) || 0) * 10) / 10;
  return { k: Math.round(k * 1000) / 1000, t0Days, n, sigmaDays };
}

// Fit every build that has enough real install snapshots (version_snapshots). Days are measured
// from each build's first observation. Returns { "2026.20.3": {k,t0Days,n,sigmaDays}, ... }.
export async function fitBuilds() {
  if (!hasDb()) return null;
  try {
    const r = await query(`SELECT version, observed_at FROM version_snapshots WHERE version IS NOT NULL ORDER BY version, observed_at`);
    const byVer = new Map();
    for (const row of r.rows) { if (!byVer.has(row.version)) byVer.set(row.version, []); byVer.get(row.version).push(Date.parse(row.observed_at)); }
    const fitted = {};
    for (const [version, ts] of byVer) {
      const t0ms = Math.min(...ts);
      const days = ts.map(t => (t - t0ms) / 86400000);
      const f = fitRollout(days);
      if (f) fitted[version] = f;
    }
    return Object.keys(fitted).length ? fitted : null;
  } catch { return null; }
}

// REAL per-car prediction accuracy from scored predictions (the connected-car back-test).
// Empty until cars actually update after we've made a prediction — then it fills automatically.
async function accuracy() {
  if (!hasDb()) return null;
  try {
    const r = await query(
      `SELECT count(*) FILTER (WHERE scored)::int AS scored,
              count(*) FILTER (WHERE hit)::int AS hits,
              count(*) FILTER (WHERE NOT scored)::int AS open,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(error_days)) FILTER (WHERE scored) AS median_abs_err
         FROM predictions`);
    const row = r.rows[0] || {};
    const scored = +row.scored || 0;
    return {
      scored, open: +row.open || 0,
      hitRate: scored ? Math.round((+row.hits / scored) * 100) : null,
      medianAbsErrorDays: row.median_abs_err != null ? Math.round(row.median_abs_err) : null,
    };
  } catch { return null; }
}

export async function computeCalibration({ live = false } = {}) {
  const acc = await accuracy();
  if (!live) return { mode: "sample", accuracy: acc, backtest: backtest(W.versionHistory) };
  const [merged, daily] = await Promise.all([
    merge({ live: true }).catch(() => []),
    fetchDailySeries().catch(() => ({ series: [] })),
  ]);
  const sources = [...new Set(merged.flatMap(v => v.sources || []))];
  const withPct = merged.filter(v => v.fleetPct != null).length;
  // back-test on the richer of: real merged tracker history, or the historical branch anchors
  const bt = backtest(merged.length >= 6 ? merged : W.versionHistory);
  const fitted = await fitBuilds();   // per-build k/t0/σ learned from real install snapshots
  return {
    mode: "live",
    cadence: cadence(merged),
    velocity: velocity(daily.series || []),
    backtest: bt,
    fitted,
    fittedCount: fitted ? Object.keys(fitted).length : 0,
    coverage: { versions: merged.length, versionsWithShare: withPct, sources, sourceCount: sources.length },
    accuracy: acc,
    honesty: (acc && acc.scored)
      ? `Prediction accuracy below is REAL: ${acc.scored} connected-car prediction${acc.scored === 1 ? "" : "s"} scored against what actually happened. Bands are modelled (logistic + Monte-Carlo); this hit-rate is measured, not fabricated.`
      : "Confidence bands are modelled (logistic rollout + Monte-Carlo). The back-test above scores the model against real historical release dates; per-car accuracy then validates against opted-in connected cars as the fleet grows — wenFSD publishes real numbers, never fabricated ones." + (acc && acc.open ? ` (${acc.open} prediction${acc.open === 1 ? "" : "s"} currently open, awaiting the next update.)` : ""),
  };
}
