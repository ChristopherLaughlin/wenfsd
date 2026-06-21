// Public + per-user data API consumed by the wenFSD frontend.
import { Router } from "express";
import { config } from "../config.js";
import { query, hasDb } from "../db.js";
import { predictNextOS, predictNextFSD } from "../predict.js";
import { SEED_VERSIONS, SEED_FEED, SEED_STATS } from "../seed.js";

export const apiRouter = Router();

apiRouter.get("/fleet/firmware", async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ source: "mock", versions: SEED_VERSIONS });
  const r = await query(`SELECT version, branch, first_seen, install_count, fleet_pct, fit_t0 AS t0, fit_k AS k FROM firmware_versions ORDER BY first_seen DESC NULLS LAST LIMIT 40`);
  res.json({ source: "db", versions: r.rows });
});

apiRouter.get("/fleet/feed", async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ source: "mock", feed: SEED_FEED });
  const r = await query(`SELECT s.version AS "to", s.market AS region, s.hardware AS hw, s.observed_at FROM version_snapshots s ORDER BY s.observed_at DESC LIMIT 30`);
  res.json({ source: "db", feed: r.rows });
});

apiRouter.get("/stats", async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json(SEED_STATS);
  const r = await query(`SELECT (SELECT count(*) FROM vehicles) AS cars_tracked, (SELECT count(*) FROM vehicles WHERE market='Australia') AS au_cars, (SELECT count(*) FROM version_snapshots) AS updates_logged, (SELECT count(*) FROM firmware_versions) AS versions_tracked`);
  res.json(r.rows[0]);
});

apiRouter.get("/me/vehicles", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ vehicles: [{ vin: "LRWYGDEK8TC000123", model: "Model Y", model_year: 2026, hardware: "AI4", market: "Australia", current_version: "2026.14.6" }] });
  const r = await query(`SELECT vin, model, model_year, generation, hardware, market, drive, current_version, earliness, early_access, opted_in FROM vehicles WHERE user_id=$1 ORDER BY created_at`, [req.session.userId]);
  res.json({ vehicles: r.rows });
});

// ---- prediction: identical model to the frontend (predictNextOS / predictNextFSD) ----
// GET /api/predict?target=standard|fsd & (vin=… | market=…&hardware=…&installed=…&earliness=…&earlyAccess=true)
apiRouter.get("/predict", async (req, res) => {
  const target = req.query.target === "fsd" ? "fsd" : "standard";
  const car = {
    market: req.query.market || "Australia",
    hardware: req.query.hardware || "AI4",
    installedVersion: req.query.installed || "2026.14.6",
    earliness: req.query.earliness != null ? +req.query.earliness : 0.45,
    earlinessSource: "default",
    earlyAccess: req.query.earlyAccess === "true",
    fsdVersion: req.query.fsd,
  };

  if (!config.mockMode && hasDb() && req.query.vin) {
    const v = await query(`SELECT market, hardware, current_version, earliness, early_access FROM vehicles WHERE vin=$1`, [req.query.vin]);
    if (v.rows[0]) {
      const r = v.rows[0];
      if (r.market) car.market = r.market;
      if (r.hardware) car.hardware = r.hardware;
      if (r.current_version) car.installedVersion = r.current_version;
      if (r.earliness != null) { car.earliness = r.earliness; car.earlinessSource = "history"; }
      car.earlyAccess = !!r.early_access;
    }
  }

  const p = target === "fsd" ? predictNextFSD(car) : predictNextOS(car);
  if (p.capped || p.unavailable) return res.json({ target, vin: req.query.vin || null, capped: !!p.capped, unavailable: !!p.unavailable, current: p.current });

  res.json({
    target, vin: req.query.vin || null, market: car.market, hardware: car.hardware,
    targetLabel: p.targetLabel, earliness: round(p.earliness, 3),
    medianDate: p.medianDate, p10Date: p.p10Date, p90Date: p.p90Date, daysToMedian: p.daysToMedian,
    carrierBuild: p.carrierBuild || null, mode: p.mode || null, kind: p.kind || null,
    within: { d7: round(p.probWithin(7), 3), d14: round(p.probWithin(14), 3), d30: round(p.probWithin(30), 3) },
  });
});

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
