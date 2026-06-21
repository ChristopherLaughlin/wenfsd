// Public + per-user data API consumed by the wenFSD frontend.
import { Router } from "express";
import { config } from "../config.js";
import { query, hasDb } from "../db.js";
import { predictNextOS, predictNextFSD } from "../predict.js";
import * as W from "../wendata.js";
import { SEED_VERSIONS, SEED_FEED, SEED_STATS } from "../seed.js";
import { merge, fetchAll, sourceStatus, fetchReleaseNotes } from "../sources/index.js";
import { computeCalibration } from "../calibration.js";
import * as tesla from "../tesla.js";
import { encrypt, decrypt } from "../crypto.js";
import { applyVersionReading } from "../poller.js";

export const apiRouter = Router();

// alias so both /healthz and /api/healthz work
apiRouter.get("/healthz", (req, res) => res.json({ ok: true, mock: config.mockMode }));

// wrap async handlers so thrown errors hit the error middleware instead of hanging
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// small in-memory cache (TTL) so /api/sources & merged don't hammer external sites
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  const now = Date.now ? Date.now() : new Date().getTime();
  if (hit && now - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: now, v });
  return v;
}

apiRouter.get("/fleet/firmware", ah(async (req, res) => {
  if (req.query.merged) {
    const live = req.query.live === "1" && config.allowLiveSources;
    const versions = await cached("merge:" + live, 10 * 60_000, () => merge({ live }));
    return res.json({ source: "merged", mode: live ? "live" : "sample", versions });
  }
  if (config.mockMode || !hasDb()) return res.json({ source: "mock", mode: "sample", versions: SEED_VERSIONS });
  const r = await query(`SELECT version, branch, first_seen, install_count, fleet_pct, fit_t0 AS t0, fit_k AS k FROM firmware_versions ORDER BY first_seen DESC NULLS LAST LIMIT 40`);
  res.json({ source: "db", mode: "live", versions: r.rows });
}));

apiRouter.get("/release-notes", ah(async (req, res) => {
  const live = req.query.live === "1" && config.allowLiveSources;
  // notes change rarely once published → cache 6h
  const notes = await cached("notes:" + live, 6 * 60 * 60_000, () => fetchReleaseNotes({ live }));
  res.json({ mode: live ? "live" : "sample", notes });
}));

// Debug/watch view of the signed-in owner's own predictions (open + scored). Privacy-safe:
// never exposes another user's cars.
apiRouter.get("/predictions", ah(async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ predictions: [], summary: { open: 0, scored: 0, hits: 0 } });
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  const r = await query(
    `SELECT v.vin, p.from_version, p.target_label, p.made_at, p.median_date, p.p10_date, p.p90_date,
            p.scored, p.actual_date, p.error_days, p.hit
       FROM predictions p JOIN vehicles v ON v.id = p.vehicle_id
      WHERE v.user_id = $1 ORDER BY p.made_at DESC LIMIT 50`, [req.session.userId]);
  const rows = r.rows;
  res.json({
    predictions: rows,
    summary: {
      open: rows.filter(x => !x.scored).length,
      scored: rows.filter(x => x.scored).length,
      hits: rows.filter(x => x.hit).length,
    },
  });
}));

apiRouter.get("/calibration", ah(async (req, res) => {
  const live = req.query.live === "1" && config.allowLiveSources;
  const cal = await cached("cal:" + live, 6 * 60 * 60_000, () => computeCalibration({ live }));
  res.json(cal);
}));

apiRouter.get("/sources", ah(async (req, res) => {
  const live = req.query.live === "1" && config.allowLiveSources;
  const status = await cached("sources:" + live, 10 * 60_000, async () => sourceStatus(await fetchAll({ live })));
  res.json({ mode: live ? "live" : "sample", sources: status });
}));

apiRouter.get("/fleet/feed", ah(async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ source: "mock", mode: "sample", feed: SEED_FEED });
  const r = await query(`SELECT s.version AS "to", s.market AS region, s.hardware AS hw, s.observed_at FROM version_snapshots s ORDER BY s.observed_at DESC LIMIT 30`);
  res.json({ source: "db", mode: "live", feed: r.rows });
}));

apiRouter.get("/stats", ah(async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ mode: "sample", ...SEED_STATS });
  const r = await query(`SELECT (SELECT count(*) FROM vehicles) AS cars_tracked, (SELECT count(*) FROM vehicles WHERE market='Australia') AS au_cars, (SELECT count(*) FROM version_snapshots) AS updates_logged, (SELECT count(*) FROM firmware_versions) AS versions_tracked`);
  res.json({ mode: "live", ...r.rows[0] });
}));

apiRouter.get("/me/vehicles", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ vehicles: [{ vin: "LRWYGDEK8TC000123", model: "Model Y", model_year: 2026, hardware: "AI4", market: "Australia", current_version: "2026.14.6" }] });
  const r = await query(`SELECT vin, model, model_year, generation, hardware, market, drive, current_version, earliness, early_access, opted_in FROM vehicles WHERE user_id=$1 ORDER BY created_at`, [req.session.userId]);
  res.json({ vehicles: r.rows });
}));

// update per-car settings that must PERSIST server-side (so they survive reloads / devices):
// fleet-contribution opt-in, Early Access flag, market. Body: { optedIn?, earlyAccess?, market? }
apiRouter.patch("/me/vehicle/:vin", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const sets = [], vals = [];
  if (typeof req.body.optedIn === "boolean") { sets.push(`opted_in=$${sets.length + 1}`); vals.push(req.body.optedIn); }
  if (typeof req.body.earlyAccess === "boolean") { sets.push(`early_access=$${sets.length + 1}`); vals.push(req.body.earlyAccess); }
  if (req.body.market && W.regions[req.body.market]) { sets.push(`market=$${sets.length + 1}`); vals.push(req.body.market); }
  if (!sets.length) return res.json({ ok: true, unchanged: true });
  vals.push(req.session.userId, req.params.vin);
  await query(`UPDATE vehicles SET ${sets.join(", ")} WHERE user_id=$${vals.length - 1} AND vin=$${vals.length}`, vals);
  res.json({ ok: true });
}));

// owner-triggered WAKE + version read. Unlike the poller (which never wakes a car), this is an
// explicit user action on their own vehicle. Cooldown to avoid draining the battery.
const lastWake = new Map();
apiRouter.post("/me/vehicle/:vin/refresh", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true, version: "2026.20.3", state: "online", changed: false });
  const key = req.session.userId + ":" + req.params.vin, now = Date.now();
  if (lastWake.get(key) && now - lastWake.get(key) < 60_000) return res.status(429).json({ error: "Just refreshed — wait a minute before waking your car again." });

  const car = (await query(`SELECT id, vin, market, hardware, current_version, earliness, early_access FROM vehicles WHERE user_id=$1 AND vin=$2`, [req.session.userId, req.params.vin])).rows[0];
  if (!car) return res.status(404).json({ error: "vehicle not found" });
  const tok = (await query(`SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id=$1`, [req.session.userId])).rows[0];
  if (!tok) return res.status(400).json({ error: "no linked Tesla token" });
  lastWake.set(key, now);

  let access = decrypt(tok.access_token);
  if (new Date(tok.expires_at).getTime() - now < 5 * 60_000) {
    const refreshed = await tesla.refreshAccessToken(decrypt(tok.refresh_token));
    access = refreshed.access_token;
    await query(`UPDATE oauth_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now() WHERE user_id=$4`,
      [encrypt(refreshed.access_token), encrypt(refreshed.refresh_token || decrypt(tok.refresh_token)), new Date(now + (refreshed.expires_in || 28800) * 1000), req.session.userId]);
  }

  const wake = await tesla.wakeVehicle(access, car.vin);
  if (!wake.woke) return res.json({ ok: false, state: wake.state, error: "Your car didn't wake in time (deep sleep or no signal). Try again in a minute." });
  let version;
  try { version = await tesla.getVehicleVersion(access, car.vin); }
  catch (e) { return res.json({ ok: false, state: "online", error: "Woke the car, but couldn't read its version: " + e.message }); }
  if (!version) return res.json({ ok: false, state: "online", error: "Woke the car, but its version was unavailable." });
  const r = await applyVersionReading(car, version);
  res.json({ ok: true, state: "online", version, changed: r.changed });
}));

// delete one of the signed-in user's vehicles (+ its snapshots) — data-deletion right
apiRouter.delete("/me/vehicle/:vin", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  await query(`DELETE FROM vehicles WHERE user_id=$1 AND vin=$2`, [req.session.userId, req.params.vin]);
  res.json({ ok: true });
}));

// delete the whole account (vehicles, snapshots cascade, tokens, user)
apiRouter.delete("/me", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (!config.mockMode && hasDb()) await query(`DELETE FROM users WHERE id=$1`, [req.session.userId]);
  req.session = null;
  res.json({ ok: true });
}));

const HARDWARE = new Set(["AI4", "AI3", "AI2.5"]);
apiRouter.get("/predict", ah(async (req, res) => {
  const target = req.query.target === "fsd" ? "fsd" : "standard";
  // validate + clamp inputs
  const market = req.query.market && W.regions[req.query.market] ? req.query.market : "Australia";
  const hardware = req.query.hardware && HARDWARE.has(req.query.hardware) ? req.query.hardware : "AI4";
  let earliness = req.query.earliness != null ? Number(req.query.earliness) : 0.45;
  if (!Number.isFinite(earliness)) earliness = 0.45;
  earliness = Math.min(0.97, Math.max(0.03, earliness));

  const car = { market, hardware, installedVersion: req.query.installed || "2026.14.6", earliness, earlinessSource: "default", earlyAccess: req.query.earlyAccess === "true", fsdVersion: req.query.fsd };

  if (!config.mockMode && hasDb() && req.query.vin) {
    const v = await query(`SELECT market, hardware, current_version, earliness, early_access FROM vehicles WHERE vin=$1`, [req.query.vin]);
    if (v.rows[0]) {
      const r = v.rows[0];
      if (r.market && W.regions[r.market]) car.market = r.market;
      if (r.hardware && HARDWARE.has(r.hardware)) car.hardware = r.hardware;
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
}));

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
