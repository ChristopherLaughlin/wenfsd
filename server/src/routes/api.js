// Public + per-user data API consumed by the wenFSD frontend.
import { Router } from "express";
import { config } from "../config.js";
import { query, hasDb } from "../db.js";
import { predict, estimateEarliness } from "../predict.js";
import { SEED_VERSIONS, SEED_FEED, SEED_STATS, SEED_FSD } from "../seed.js";

export const apiRouter = Router();
const REGION_LAG = { "United States": 0, Canada: 3, Europe: 9, Australia: 12, "New Zealand": 14 };

// ---- fleet firmware distribution ----
apiRouter.get("/fleet/firmware", async (req, res) => {
  if (config.mockMode || !hasDb()) {
    return res.json({ source: "mock", versions: SEED_VERSIONS });
  }
  const r = await query(
    `SELECT version, branch, first_seen, install_count, fleet_pct, fit_t0 AS t0, fit_k AS k
       FROM firmware_versions ORDER BY first_seen DESC NULLS LAST LIMIT 40`);
  res.json({ source: "db", versions: r.rows });
});

// ---- live update feed ----
apiRouter.get("/fleet/feed", async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ source: "mock", feed: SEED_FEED });
  const r = await query(
    `SELECT s.version AS "to", s.market AS region, s.hardware AS hw, s.observed_at
       FROM version_snapshots s ORDER BY s.observed_at DESC LIMIT 30`);
  res.json({ source: "db", feed: r.rows });
});

apiRouter.get("/stats", async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json(SEED_STATS);
  const r = await query(
    `SELECT (SELECT count(*) FROM vehicles) AS cars_tracked,
            (SELECT count(*) FROM vehicles WHERE market='Australia') AS au_cars,
            (SELECT count(*) FROM version_snapshots) AS updates_logged,
            (SELECT count(*) FROM firmware_versions) AS versions_tracked`);
  res.json(r.rows[0]);
});

// ---- this user's linked vehicles ----
apiRouter.get("/me/vehicles", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) {
    return res.json({ vehicles: [{ vin: "LRWYGDEK8TC000123", model: "Model Y", model_year: 2026, hardware: "AI4", market: "Australia", current_version: "2026.14.6" }] });
  }
  const r = await query(
    `SELECT vin, model, model_year, generation, hardware, market, drive, current_version, earliness
       FROM vehicles WHERE user_id=$1 ORDER BY created_at`, [req.session.userId]);
  res.json({ vehicles: r.rows });
});

// ---- prediction for a vehicle ----
// GET /api/predict?vin=...&target=standard|fsd
apiRouter.get("/predict", async (req, res) => {
  const { vin, target = "standard" } = req.query;
  const today = new Date();

  // resolve rollout params + vehicle earliness/market
  let versions = await loadVersionParams();
  let market = "Australia", earliness = 0.45;

  if (!config.mockMode && hasDb() && vin) {
    const v = await query(`SELECT market, earliness FROM vehicles WHERE vin=$1`, [vin]);
    if (v.rows[0]) { market = v.rows[0].market || market; if (v.rows[0].earliness != null) earliness = v.rows[0].earliness; }
    const snaps = await query(
      `SELECT version, observed_at FROM version_snapshots
         WHERE vehicle_id=(SELECT id FROM vehicles WHERE vin=$1) ORDER BY observed_at`, [vin]);
    const est = estimateEarliness(snaps.rows.map(s => ({ version: s.version, observed_at: new Date(s.observed_at) })), versions);
    if (est != null) earliness = est;
  }

  let params;
  if (target === "fsd") {
    const f = SEED_FSD; // (in real mode, fit from fsd-branch snapshots)
    params = { t0: new Date(f.t0 + "T00:00:00Z"), k: f.k, L: 0.9, t0SigmaDays: f.t0_sigma, earliness, today, regionLagDays: 0 };
  } else {
    const next = pickNext(versions);
    if (!next) return res.json({ error: "no rolling version" });
    const lagDelta = (REGION_LAG[market] ?? 12) - 12; // seed t0 is AU-based
    params = { t0: next.t0, k: next.k, L: 0.95, earliness, today, regionLagDays: lagDelta };
  }

  const p = predict(params);
  res.json({
    target, vin: vin || null, market, earliness: round(earliness, 3),
    medianDate: p.medianDate, p10Date: p.p10Date, p90Date: p.p90Date,
    daysToMedian: p.daysToMedian,
    within: { d7: round(p.probWithinDays(7), 3), d14: round(p.probWithinDays(14), 3), d30: round(p.probWithinDays(30), 3) },
  });
});

// rollout params as Map(version -> {t0:Date,k}) for both modes
async function loadVersionParams() {
  const m = new Map();
  if (config.mockMode || !hasDb()) {
    for (const v of SEED_VERSIONS) m.set(v.version, { t0: new Date(v.t0 + "T00:00:00Z"), k: v.k, status: v.status });
    return m;
  }
  const r = await query(`SELECT version, fit_t0, fit_k FROM firmware_versions WHERE fit_t0 IS NOT NULL`);
  for (const row of r.rows) m.set(row.version, { t0: new Date(row.fit_t0), k: row.fit_k });
  return m;
}
function pickNext(versions) {
  // newest 'rolling'/'tapering' in mock; in real mode pick most recent first_seen
  let best = null;
  for (const [ver, p] of versions) {
    if (p.status && (p.status === "rolling" || p.status === "tapering")) { if (!best || p.t0 > best.t0) best = p; }
    else if (!p.status) { if (!best || p.t0 > best.t0) best = p; }
  }
  return best;
}
function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
