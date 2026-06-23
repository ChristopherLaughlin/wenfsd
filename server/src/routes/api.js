// Public + per-user data API consumed by the wenFSD frontend.
import { Router } from "express";
import { config, pushEnabled } from "../config.js";
import { query, hasDb } from "../db.js";
import { isValidSubscription } from "../push.js";
import { predictNextOS, predictNextFSD } from "../predict.js";
import * as W from "../wendata.js";
import { SEED_VERSIONS, SEED_FEED, SEED_STATS } from "../seed.js";
import { merge, fetchAll, sourceStatus, fetchReleaseNotes } from "../sources/index.js";
import { computeCalibration } from "../calibration.js";
import * as tesla from "../tesla.js";
import { encrypt, decrypt } from "../crypto.js";
import { applyVersionReading, persistPendingUpdate } from "../poller.js";
import { deliver, confirmMessage } from "../mailer.js";
import { cleanEventType, cleanRegion, cleanVersion, cleanReason, HIGH_IMPACT } from "../events.js";
import { classifyPost } from "../community.js";
import crypto from "node:crypto";

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

// --- privacy-first funnel instrumentation: aggregate event counts only, no user id, no PII ---
export const FUNNEL_EVENTS = new Set([
  "quickstart_submitted", "prediction_generated", "demo_loaded", "vin_decoded", "vehicle_added",
  "connect_clicked", "email_subscribed", "notify_enabled", "history_logged", "bet_placed",
  "shared", "model_downloaded",
]);
export function isValidEvent(name) { return typeof name === "string" && FUNNEL_EVENTS.has(name); }
// coarse acquisition source (a referrer *bucket*, never a URL) + A/B copy arm. Both are validated
// against fixed allow-lists and fall back to safe defaults — nothing free-text reaches the DB.
export const FUNNEL_SOURCES = new Set(["reddit", "x", "facebook", "google", "youtube", "teslamotorsclub", "whirlpool", "direct", "other"]);
export const FUNNEL_VARIANTS = new Set(["a", "b"]);
export function cleanSource(s) { return FUNNEL_SOURCES.has(s) ? s : "other"; }
export function cleanVariant(v) { return FUNNEL_VARIANTS.has(v) ? v : "a"; }
// coarse geo from the edge/CDN country header (Railway/Cloudflare set one) → a default region for
// the quick-start. No IP stored, no lookup service — just a header read. Falls back to Australia.
const COUNTRY_REGION = { AU: "Australia", NZ: "New Zealand", US: "United States", CA: "Canada" };
const EU_COUNTRIES = new Set("GB IE DE FR IT ES NL BE AT PT SE NO DK FI PL CH CZ".split(" "));
export function countryToRegion(cc) {
  cc = String(cc || "").toUpperCase().slice(0, 2);
  return COUNTRY_REGION[cc] || (EU_COUNTRIES.has(cc) ? "Europe" : null);
}
apiRouter.get("/geo", (req, res) => {
  const cc = String(req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || req.get("x-country") || "").toUpperCase().slice(0, 2);
  res.set("Cache-Control", "no-store").json({ region: countryToRegion(cc), country: cc || null });
});

// honest, real social proof: how many predictions were generated lately. Never fabricated — in
// sample/no-db mode it's flagged so the client can withhold it rather than show a fake number.
apiRouter.get("/pulse", ah(async (req, res) => {
  if (config.mockMode || !hasDb()) return res.json({ predictions: 0, sample: true });
  const r = await query(`SELECT COALESCE(SUM(count),0)::int AS n FROM daily_events WHERE event='prediction_generated' AND day >= (CURRENT_DATE - INTERVAL '30 days')`).catch(() => null);
  res.set("Cache-Control", "public, max-age=300").json({ predictions: (r && r.rows[0] && r.rows[0].n) || 0, sample: false });
}));

apiRouter.post("/event", ah(async (req, res) => {
  const b = req.body || {};
  if (!isValidEvent(b.event)) return res.status(400).json({ ok: false, error: "unknown event" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const event = b.event, source = cleanSource(b.source), variant = cleanVariant(b.variant);
  const day = new Date().toISOString().slice(0, 10);
  // legacy top-line table (preserves history) + the dimensioned table (source/variant breakdowns)
  await query(`INSERT INTO daily_events(day, event, count) VALUES($1, $2, 1)
               ON CONFLICT(day, event) DO UPDATE SET count = daily_events.count + 1`, [day, event]);
  await query(`INSERT INTO daily_funnel(day, event, source, variant, count) VALUES($1, $2, $3, $4, 1)
               ON CONFLICT(day, event, source, variant) DO UPDATE SET count = daily_funnel.count + 1`, [day, event, source, variant]);
  res.json({ ok: true });
}));

// --- no-login email capture: the retention channel for owners who don't OAuth. Double opt-in. ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(e) { return typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e); }
const newToken = () => crypto.randomBytes(24).toString("base64url");
function confirmPage(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>wenFSD</title>`
    + `<body style="background:#0a0d12;color:#e9eef5;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">`
    + `<div><div style="font-size:24px;font-weight:800;margin-bottom:10px">wen<span style="color:#e62937">FSD</span></div>`
    + `<p style="font-size:16px;max-width:440px;line-height:1.55;color:#9fb0c3">${msg}</p>`
    + `<a href="/" style="color:#39d4ff;text-decoration:none">← back to wenFSD</a></div></body>`;
}
function unsubConfirmPage(t) {
  // t is reflected only inside a URL-encoded query in the form action (no HTML-attribute breakout)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>wenFSD</title>`
    + `<body style="background:#0a0d12;color:#e9eef5;font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">`
    + `<div><div style="font-size:24px;font-weight:800;margin-bottom:10px">wen<span style="color:#e62937">FSD</span></div>`
    + `<p style="font-size:16px;max-width:440px;line-height:1.55;color:#9fb0c3">Stop wenFSD update alerts to this address?</p>`
    + `<form method="POST" action="/api/unsubscribe?t=${encodeURIComponent(t)}">`
    + `<button type="submit" style="background:#e62937;color:#fff;border:0;border-radius:10px;padding:11px 20px;font:inherit;font-weight:700;cursor:pointer">Yes, unsubscribe me</button></form>`
    + `<a href="/" style="color:#39d4ff;text-decoration:none;display:inline-block;margin-top:14px">← keep me subscribed</a></div></body>`;
}
apiRouter.post("/subscribe", ah(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: "That doesn't look like an email." });
  // sanitise the car context — only what we'd email about, all optional, all validated
  const market = b.market && W.regions[b.market] ? b.market : null;
  const model = typeof b.model === "string" ? b.model.replace(/[<>]/g, "").slice(0, 40) : null;
  const hardware = HARDWARE.has(b.hardware) ? b.hardware : null;
  const version = typeof b.version === "string" ? b.version.replace(/[^0-9.]/g, "").slice(0, 24) : null;
  const fsd = ["owned", "subscription", "none", "unknown"].includes(b.fsdEntitlement) ? b.fsdEntitlement : null;
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const confirm_token = newToken(), unsub_token = newToken();
  await query(
    `INSERT INTO email_subscribers(email, model, market, hardware, version, fsd_entitlement, confirm_token, unsub_token)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(email) DO UPDATE SET model=$2, market=$3, hardware=$4, version=$5, fsd_entitlement=$6,
       unsubscribed_at=NULL,
       confirm_token=CASE WHEN email_subscribers.confirmed THEN email_subscribers.confirm_token ELSE $7 END,
       unsub_token=COALESCE(email_subscribers.unsub_token, $8)`,
    [email, model, market, hardware, version, fsd, confirm_token, unsub_token]);
  const row = (await query(`SELECT confirmed, confirm_token, unsub_token FROM email_subscribers WHERE email=$1`, [email])).rows[0] || {};
  if (!row.confirmed) {
    const base = config.publicBaseUrl.replace(/\/$/, "");
    const msg = confirmMessage({ market, confirmUrl: `${base}/api/confirm?t=${row.confirm_token}`, unsubUrl: `${base}/api/unsubscribe?t=${row.unsub_token}` });
    deliver({ to: email, subject: msg.subject, text: msg.text, event: "subscribe_confirm" }).catch(() => {});
  }
  // generic response (no `confirmed` flag) so the endpoint can't be used to enumerate which
  // addresses are already subscribed
  res.json({ ok: true });
}));
apiRouter.get("/confirm", ah(async (req, res) => {
  const t = String(req.query.t || "");
  if (config.mockMode || !hasDb() || !t) return res.type("html").send(confirmPage("Confirmation isn't available right now."));
  const r = await query(`UPDATE email_subscribers SET confirmed=true, confirmed_at=now() WHERE confirm_token=$1 AND confirmed=false RETURNING email`, [t]);
  res.type("html").send(confirmPage(r.rowCount
    ? "✓ You're in. We'll email you the moment your update's close — and nothing else."
    : "This link's already been used (you're probably confirmed already). 👍"));
}));
// GET only shows a one-tap confirm — so an email client pre-fetching the link can't silently
// unsubscribe you. The real action is a same-origin POST from this page (passes the CSRF guard).
apiRouter.get("/unsubscribe", ah(async (req, res) => {
  res.type("html").send(unsubConfirmPage(String(req.query.t || "")));
}));
apiRouter.post("/unsubscribe", ah(async (req, res) => {
  const t = String(req.query.t || "");
  // hard-DELETE the row, not a soft flag — full erasure of the address + car context (GDPR
  // right-to-erasure + data minimisation). Re-subscribing later goes through double opt-in again.
  if (!config.mockMode && hasDb() && t) await query(`DELETE FROM email_subscribers WHERE unsub_token=$1`, [t]);
  res.type("html").send(confirmPage("Done — you're unsubscribed and your address is erased. No more emails. We'll miss you. 🫡"));
}));

// --- web push (no-login alerts; dormant until VAPID keys are set) ---
apiRouter.get("/push/key", (req, res) => {
  if (!pushEnabled()) return res.status(404).json({ enabled: false });
  res.json({ enabled: true, key: config.vapidPublicKey });
});
apiRouter.post("/push/subscribe", ah(async (req, res) => {
  const b = req.body || {};
  if (!pushEnabled()) return res.status(404).json({ ok: false, error: "push disabled" });
  if (!isValidSubscription(b.subscription)) return res.status(400).json({ ok: false, error: "bad subscription" });
  const market = b.market && W.regions[b.market] ? b.market : null;
  const hardware = HARDWARE.has(b.hardware) ? b.hardware : null;
  const version = typeof b.version === "string" ? b.version.replace(/[^0-9.]/g, "").slice(0, 24) : null;
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const s = b.subscription;
  await query(
    `INSERT INTO push_subscriptions(endpoint, p256dh, auth, market, hardware, version) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh=$2, auth=$3, market=$4, hardware=$5, version=$6`,
    [s.endpoint, s.keys.p256dh, s.keys.auth, market, hardware, version]);
  res.json({ ok: true });
}));
apiRouter.post("/push/unsubscribe", ah(async (req, res) => {
  const endpoint = String((req.body && req.body.endpoint) || "");
  if (endpoint && !config.mockMode && hasDb()) await query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [endpoint]);
  res.json({ ok: true });
}));

// --- rollout events: confirmed, active events the client overlays on its prediction (PR-B) ---
// Confirmed only + not expired → only human-verified state-changes ever reach the public UI.
export async function activeConfirmedEvents() {
  if (config.mockMode || !hasDb()) return [];
  const r = await query(
    `SELECT type, version, region, reason, source, effective_at, detected_at
       FROM rollout_events
      WHERE status='confirmed' AND (expires_at IS NULL OR expires_at > now())
      ORDER BY effective_at DESC NULLS LAST LIMIT 200`).catch(() => null);
  return (r && r.rows) || [];
}
apiRouter.get("/events", ah(async (req, res) => {
  res.set("Cache-Control", "public, max-age=120").json({ events: await activeConfirmedEvents() });
}));

// community report (UGC): owners tell us what they saw (e.g. the "rollout paused" email). Reports
// land as 'pending' and NEVER touch the public prediction until a human confirms them in /admin.
// No PII — submitter is a salted daily hash, free text is sanitised + length-capped.
function submitterHash(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const ua = String(req.get("user-agent") || "").slice(0, 200);
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(day + "|" + ip + "|" + ua + "|" + config.sessionSecret).digest("hex").slice(0, 32);
}
apiRouter.post("/report", ah(async (req, res) => {
  const b = req.body || {};
  // a report can be structured (type/region/version) and/or free text we classify
  const text = typeof b.text === "string" ? b.text.replace(/[<>]/g, "").slice(0, 600) : "";
  const guess = text ? classifyPost(text) : null;
  const type = cleanEventType(b.type) || (guess && guess.type) || null;
  if (!type) return res.status(400).json({ ok: false, error: "Tell us what happened (pause, resume, halt…)." });
  const region = cleanRegion(b.region) || (guess && guess.region) || null;
  const version = cleanVersion(b.version) || (guess && cleanVersion(guess.version)) || null;
  const reason = cleanReason(b.reason || text);
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  await query(
    `INSERT INTO rollout_events(type, version, region, status, reason, source, submitted_by, confidence)
     VALUES($1,$2,$3,'pending',$4,'community-report',$5,$6)`,
    [type, version, region, reason, submitterHash(req), guess ? guess.confidence : 0.4]);
  res.json({ ok: true });   // generic success — we don't expose whether/when it goes live (anti-manipulation)
}));

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
  const r = await query(`SELECT vin, model, model_year, generation, hardware, market, drive, current_version, earliness, early_access, opted_in,
    pending_version, pending_status, pending_download, pending_install, pending_seen_at FROM vehicles WHERE user_id=$1 ORDER BY created_at`, [req.session.userId]);
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

// --- the owner's REAL update history (from logged version snapshots) ---
apiRouter.get("/me/history", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ history: [] });
  const r = await query(
    `SELECT s.version, s.observed_at, v.vin
       FROM version_snapshots s JOIN vehicles v ON v.id = s.vehicle_id
      WHERE v.user_id=$1 ORDER BY s.observed_at`, [req.session.userId]);
  res.json({ history: r.rows.map(x => ({ vin: x.vin, version: x.version, date: String(x.observed_at).slice(0, 10), source: "tesla" })) });
}));

// --- social profile (opt-in identity for the leaderboard) ---
apiRouter.get("/me/profile", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ displayName: "", tmcUsername: "", publicShare: false });
  const r = await query(`SELECT display_name, tmc_username, public_share FROM users WHERE id=$1`, [req.session.userId]);
  const u = r.rows[0] || {};
  res.json({ displayName: u.display_name || "", tmcUsername: u.tmc_username || "", publicShare: !!u.public_share });
}));
apiRouter.patch("/me/profile", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const clean = (s) => typeof s === "string" ? s.replace(/[<> -]/g, "").trim().slice(0, 40) : null;
  const sets = [], vals = [];
  const dn = clean(req.body.displayName); if (dn !== null) { sets.push(`display_name=$${sets.length + 1}`); vals.push(dn || null); }
  const tmc = clean(req.body.tmcUsername); if (tmc !== null) { sets.push(`tmc_username=$${sets.length + 1}`); vals.push(tmc || null); }
  if (typeof req.body.publicShare === "boolean") { sets.push(`public_share=$${sets.length + 1}`); vals.push(req.body.publicShare); }
  if (!sets.length) return res.json({ ok: true, unchanged: true });
  vals.push(req.session.userId);
  await query(`UPDATE users SET ${sets.join(", ")} WHERE id=$${vals.length}`, vals);
  res.json({ ok: true });
}));

// --- save a "Call your shot" wager (connected owner) — settles when the car updates ---
apiRouter.post("/me/guess", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const cr = await query(`SELECT id, current_version FROM vehicles WHERE user_id=$1 AND current_version IS NOT NULL ORDER BY created_at LIMIT 1`, [req.session.userId]);
  const car = cr.rows[0];
  if (!car) return res.status(400).json({ error: "no connected car with a known version yet" });
  const gd = String(req.body.guessDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gd)) return res.status(400).json({ error: "bad guess date" });
  const win = [2, 5, 10].includes(+req.body.windowDays) ? +req.body.windowDays : 5;
  const mult = [1, 2.5, 6].includes(+req.body.mult) ? +req.body.mult : 2.5;
  const target = typeof req.body.target === "string" ? req.body.target.slice(0, 40) : null;
  await query(
    `INSERT INTO guesses(vehicle_id, from_version, target_label, guess_date, window_days, mult)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(vehicle_id, from_version) DO UPDATE SET guess_date=$4, window_days=$5, mult=$6, target_label=$3, made_at=now()
     WHERE NOT guesses.settled`,
    [car.id, car.current_version, target, gd, win, mult]);
  res.json({ ok: true, staked: true });
}));

// --- regional leaderboard (only owners who opted into public sharing) ---
apiRouter.get("/leaderboard", ah(async (req, res) => {
  const region = req.query.region && W.regions[req.query.region] ? req.query.region : "Australia";
  if (config.mockMode || !hasDb()) return res.json(sampleLeaderboard(region));
  const r = await query(
    `SELECT u.display_name, u.tmc_username, v.current_version, v.hardware, v.earliness
       FROM users u JOIN vehicles v ON v.user_id = u.id
      WHERE u.public_share = true AND v.market = $1 AND v.current_version IS NOT NULL`, [region]);
  const people = r.rows.map(x => ({
    name: x.display_name || x.tmc_username || "Anonymous Tesla", tmc: x.tmc_username || null,
    version: x.current_version, hardware: x.hardware, earliness: x.earliness, _k: W.verKey(x.current_version),
  }));
  // wenPoints: settled "Call your shot" wagers, summed per sharing owner
  const pr = await query(
    `SELECT u.display_name, u.tmc_username, COALESCE(SUM(g.points),0)::int AS pts, count(*) FILTER (WHERE g.hit) AS hits
       FROM users u JOIN vehicles v ON v.user_id=u.id JOIN guesses g ON g.vehicle_id=v.id AND g.settled
      WHERE u.public_share=true AND v.market=$1
      GROUP BY u.id, u.display_name, u.tmc_username HAVING SUM(g.points) > 0
      ORDER BY pts DESC LIMIT 10`, [region]);
  res.json({
    region, participants: people.length, sample: false,
    ahead: [...people].sort((a, b) => b._k - a._k).slice(0, 10).map(p => ({ name: p.name, tmc: p.tmc, version: p.version })),
    overdue: [...people].sort((a, b) => a._k - b._k).slice(0, 10).map(p => ({ name: p.name, tmc: p.tmc, version: p.version })),
    earliest: people.filter(p => p.earliness != null).sort((a, b) => a.earliness - b.earliness).slice(0, 10).map(p => ({ name: p.name, tmc: p.tmc, pct: Math.round(p.earliness * 100) })),
    points: pr.rows.map(p => ({ name: p.display_name || p.tmc_username || "Anonymous Tesla", tmc: p.tmc_username || null, pts: p.pts, hits: +p.hits })),
  });
}));
function sampleLeaderboard(region) {
  return {
    region, participants: 5, sample: true,
    ahead: [{ name: "JuniperJoy", tmc: "JuniperJoy", version: "2026.20.3" }, { name: "wenFSDplz", tmc: "wenFSDplz", version: "2026.20" }, { name: "SilentSentry", tmc: null, version: "2026.14.6.11" }],
    overdue: [{ name: "StillWaiting", tmc: "StillWaiting", version: "2026.8.3.10" }, { name: "TwoWeeksBro", tmc: "TwoWeeksBro", version: "2026.14.2" }],
    earliest: [{ name: "FirstInLine", tmc: "FirstInLine", pct: 8 }, { name: "JuniperJoy", tmc: "JuniperJoy", pct: 22 }],
    points: [{ name: "CalledIt", tmc: "CalledIt", pts: 540, hits: 3 }, { name: "JuniperJoy", tmc: "JuniperJoy", pts: 210, hits: 2 }],
  };
}

// --- The Five Stages of wenFSD Grief: log + community board ---
const GRIEF_STAGES = new Set(["denial", "anger", "bargaining", "depression", "acceptance"]);
apiRouter.post("/me/grief", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  const stage = String(req.body.stage || "");
  if (!GRIEF_STAGES.has(stage)) return res.status(400).json({ error: "bad stage" });
  const predicted = GRIEF_STAGES.has(String(req.body.predicted)) ? req.body.predicted : null;
  const note = typeof req.body.note === "string" ? req.body.note.replace(/[<>]/g, "").trim().slice(0, 180) : null;
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  const cr = await query(`SELECT market FROM vehicles WHERE user_id=$1 ORDER BY created_at LIMIT 1`, [req.session.userId]);
  const region = cr.rows[0] && W.regions[cr.rows[0].market] ? cr.rows[0].market : null;
  await query(`INSERT INTO grief_logs(user_id, region, stage, predicted, note) VALUES($1,$2,$3,$4,$5)`,
    [req.session.userId, region, stage, predicted, note || null]);
  res.json({ ok: true });
}));
apiRouter.get("/grief", ah(async (req, res) => {
  const region = req.query.region && W.regions[req.query.region] ? req.query.region : "Australia";
  if (config.mockMode || !hasDb()) return res.json(sampleGrief(region));
  const cr = await query(`SELECT stage, count(*)::int AS n FROM grief_logs WHERE region=$1 GROUP BY stage`, [region]);
  const counts = {}; for (const r of cr.rows) counts[r.stage] = r.n;
  // latest note per public-share user (no anonymous oversharing leaks an identity that wasn't opted in)
  const nr = await query(
    `SELECT DISTINCT ON (g.user_id) g.stage, g.note, u.display_name, u.tmc_username
       FROM grief_logs g JOIN users u ON u.id = g.user_id
      WHERE g.region=$1 AND u.public_share=true AND g.note IS NOT NULL AND g.note <> ''
      ORDER BY g.user_id, g.created_at DESC LIMIT 12`, [region]);
  res.json({ region, sample: false, counts,
    notes: nr.rows.map(x => ({ stage: x.stage, note: x.note, handle: x.tmc_username || x.display_name || "anon" })) });
}));
function sampleGrief(region) {
  return { region, sample: true,
    counts: { denial: 3, anger: 7, bargaining: 5, depression: 4, acceptance: 2 },
    notes: [
      { stage: "anger", handle: "wenFSDplz", note: "Same car as my mate in Cali. He has v14. I have a loading spinner." },
      { stage: "bargaining", handle: "JuniperJoy", note: "Rebooted twice and washed the car. Open to other suggestions." },
      { stage: "depression", handle: "StillWaiting", note: "It's been 'two weeks' for fourteen months." },
      { stage: "acceptance", handle: "ZenAndTheArt", note: "Autopilot is fine. I am fine. Everything is fine. 🧘" },
      { stage: "denial", handle: "AnyDayNow", note: "The tracker is lying. It's coming tonight. I can feel it." },
    ] };
}

// --- creator-only stats (signups, vehicles, regions, visits). Gated by ADMIN_TOKEN. ---
function adminOk(req) {
  const t = String(req.get("x-admin-token") || "");   // header only — never accept the token in a URL (leaks via logs/referrer/history)
  if (!config.adminToken || !t || t.length !== config.adminToken.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(config.adminToken)); } catch { return false; }
}
// --- admin: rollout-event review + manual override (the human-confirmed gate) ---
apiRouter.get("/admin/events", ah(async (req, res) => {
  if (!config.adminToken) return res.status(404).json({ error: "admin disabled — set ADMIN_TOKEN" });
  if (!adminOk(req)) return res.status(401).json({ error: "bad or missing admin token" });
  if (config.mockMode || !hasDb()) return res.json({ mode: "sample", events: [] });
  const r = await query(`SELECT id, type, version, region, status, reason, source, source_url, confidence, corroborations, detected_at, effective_at, confirmed_at FROM rollout_events ORDER BY (status='pending') DESC, detected_at DESC LIMIT 200`);
  res.json({ mode: "live", events: r.rows });
}));
apiRouter.post("/admin/events", ah(async (req, res) => {   // manual override: create (and optionally confirm) an event
  if (!config.adminToken) return res.status(404).json({ error: "admin disabled — set ADMIN_TOKEN" });
  if (!adminOk(req)) return res.status(401).json({ error: "bad or missing admin token" });
  const b = req.body || {};
  const type = cleanEventType(b.type);
  if (!type) return res.status(400).json({ error: "bad type" });
  const version = cleanVersion(b.version), region = cleanRegion(b.region), reason = cleanReason(b.reason);
  const effective_at = b.effective_at ? new Date(b.effective_at) : new Date();
  const status = b.confirm === false ? "pending" : "confirmed";   // admin-created defaults to confirmed
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true, event: { type, version, region, status } });
  const r = await query(
    `INSERT INTO rollout_events(type, version, region, status, reason, source, confidence, effective_at, confirmed_at)
     VALUES($1,$2,$3,$4,$5,'admin',1,$6,CASE WHEN $4='confirmed' THEN now() ELSE NULL END) RETURNING id`,
    [type, version, region, status, reason, effective_at]);
  res.json({ ok: true, id: r.rows[0].id });
}));
apiRouter.patch("/admin/events/:id", ah(async (req, res) => {   // confirm / dismiss / expire a pending event
  if (!config.adminToken) return res.status(404).json({ error: "admin disabled — set ADMIN_TOKEN" });
  if (!adminOk(req)) return res.status(401).json({ error: "bad or missing admin token" });
  const next = String((req.body && req.body.status) || "");
  if (!["confirmed", "dismissed", "expired"].includes(next)) return res.status(400).json({ error: "bad status" });
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  await query(`UPDATE rollout_events SET status=$1, confirmed_at=CASE WHEN $1='confirmed' THEN now() ELSE confirmed_at END WHERE id=$2`, [next, id]);
  res.json({ ok: true });
}));

apiRouter.get("/admin/stats", ah(async (req, res) => {
  if (!config.adminToken) return res.status(404).json({ error: "admin disabled — set ADMIN_TOKEN" });
  if (!adminOk(req)) return res.status(401).json({ error: "bad or missing admin token" });
  if (config.mockMode || !hasDb()) return res.json({ mode: "sample", ...sampleAdmin() });
  const z = (p, fb) => p.catch(() => ({ rows: [fb] }));
  const [users, vehicles, byRegion, signupsByDay, visits, grief, guesses, emailSubs, events, dims] = await Promise.all([
    z(query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE email IS NOT NULL)::int AS with_email FROM users`), { n: 0, with_email: 0 }),
    z(query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE opted_in)::int AS opted_in, count(*) FILTER (WHERE current_version IS NOT NULL)::int AS with_version FROM vehicles`), { n: 0, opted_in: 0, with_version: 0 }),
    z(query(`SELECT market, count(*)::int AS n FROM vehicles GROUP BY market ORDER BY n DESC`), null),
    z(query(`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM users GROUP BY 1 ORDER BY 1 DESC LIMIT 30`), null),
    z(query(`SELECT to_char(v.day, 'YYYY-MM-DD') AS day, v.views::int AS views, (SELECT count(*)::int FROM daily_unique_visitors u WHERE u.day = v.day) AS uniques FROM daily_visits v ORDER BY v.day DESC LIMIT 30`), null),
    z(query(`SELECT count(*)::int AS n FROM grief_logs`), { n: 0 }),
    z(query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE settled)::int AS settled FROM guesses`), { n: 0, settled: 0 }),
    z(query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE confirmed)::int AS confirmed FROM email_subscribers WHERE unsubscribed_at IS NULL`), { n: 0, confirmed: 0 }),
    z(query(`SELECT event, count::int AS n FROM daily_events WHERE day >= (CURRENT_DATE - INTERVAL '30 days') ORDER BY event`), null),
    z(query(`SELECT source, variant, event, sum(count)::int AS n FROM daily_funnel WHERE day >= (CURRENT_DATE - INTERVAL '30 days') GROUP BY source, variant, event`), null),
  ]);
  // roll the per-day event rows up into a 30-day funnel total per event
  const funnel = {}; for (const r of (events.rows || [])) funnel[r.event] = (funnel[r.event] || 0) + r.n;
  res.json({
    mode: "live",
    signups: users.rows[0].n, usersWithEmail: users.rows[0].with_email,
    emailSubscribers: emailSubs.rows[0].n, emailConfirmed: emailSubs.rows[0].confirmed,
    vehicles: vehicles.rows[0].n, optedIn: vehicles.rows[0].opted_in, vehiclesWithVersion: vehicles.rows[0].with_version,
    byRegion: byRegion.rows || [], signupsByDay: signupsByDay.rows || [], visitsByDay: visits.rows || [],
    griefLogs: grief.rows[0].n, guesses: guesses.rows[0].n, guessesSettled: guesses.rows[0].settled,
    funnel, funnelDims: dims.rows || [],
  });
}));
function sampleAdmin() {
  return {
    signups: 42, usersWithEmail: 40, vehicles: 51, optedIn: 23, vehiclesWithVersion: 48,
    emailSubscribers: 137, emailConfirmed: 119,
    funnel: { prediction_generated: 1840, demo_loaded: 410, email_subscribed: 137, connect_clicked: 88, notify_enabled: 61, history_logged: 73, bet_placed: 156, shared: 94 },
    byRegion: [{ market: "Australia", n: 30 }, { market: "New Zealand", n: 8 }, { market: "United States", n: 7 }, { market: "Europe", n: 4 }, { market: "Canada", n: 2 }],
    signupsByDay: [{ day: "2026-06-21", n: 5 }, { day: "2026-06-20", n: 9 }, { day: "2026-06-19", n: 12 }, { day: "2026-06-18", n: 16 }],
    visitsByDay: [{ day: "2026-06-21", views: 340, uniques: 210 }, { day: "2026-06-20", views: 512, uniques: 331 }, { day: "2026-06-19", views: 720, uniques: 470 }],
    griefLogs: 88, guesses: 25, guessesSettled: 9,
    funnelDims: [
      { source: "reddit", variant: "a", event: "prediction_generated", n: 520 },
      { source: "reddit", variant: "a", event: "shared", n: 41 },
      { source: "reddit", variant: "a", event: "notify_enabled", n: 18 },
      { source: "reddit", variant: "b", event: "prediction_generated", n: 540 },
      { source: "reddit", variant: "b", event: "shared", n: 67 },
      { source: "reddit", variant: "b", event: "notify_enabled", n: 22 },
      { source: "google", variant: "a", event: "prediction_generated", n: 410 },
      { source: "google", variant: "a", event: "shared", n: 12 },
      { source: "google", variant: "b", event: "prediction_generated", n: 395 },
      { source: "google", variant: "b", event: "shared", n: 19 },
      { source: "x", variant: "a", event: "prediction_generated", n: 150 },
      { source: "x", variant: "b", event: "prediction_generated", n: 145 },
      { source: "x", variant: "b", event: "shared", n: 14 },
      { source: "direct", variant: "a", event: "prediction_generated", n: 88 },
      { source: "direct", variant: "b", event: "prediction_generated", n: 92 },
    ],
  };
}

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
  let version, update = null;
  try { ({ version, update } = await tesla.getVehicleState(access, car.vin)); }
  catch (e) {
    // log the upstream detail server-side; never reflect Tesla's raw response body to the client
    console.warn(`[refresh] version read failed for ${String(car.vin).slice(-6)}:`, e && e.message);
    return res.json({ ok: false, state: "online", error: "Woke the car, but couldn't read its version just now. Give it a moment and try again." });
  }
  if (!version) return res.json({ ok: false, state: "online", error: "Woke the car, but its version was unavailable." });
  const r = await applyVersionReading(car, version);
  await persistPendingUpdate(car, update);
  res.json({ ok: true, state: "online", version, changed: r.changed, update });
}));

// delete one of the signed-in user's vehicles (+ its snapshots) — data-deletion right
apiRouter.delete("/me/vehicle/:vin", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ ok: true, mock: true });
  await query(`DELETE FROM vehicles WHERE user_id=$1 AND vin=$2`, [req.session.userId, req.params.vin]);
  res.json({ ok: true });
}));

// opt-in: be notified the moment a new software version lands on your car (connected cars only)
apiRouter.get("/me/notify", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  if (config.mockMode || !hasDb()) return res.json({ enabled: false, hasEmail: false, mock: true });
  const u = (await query(`SELECT notify_on_update, email FROM users WHERE id=$1`, [req.session.userId])).rows[0];
  res.json({ enabled: !!(u && u.notify_on_update), hasEmail: !!(u && u.email) });
}));
apiRouter.post("/me/notify", ah(async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not linked" });
  const enabled = !!(req.body && req.body.enabled === true);
  if (!config.mockMode && hasDb()) await query(`UPDATE users SET notify_on_update=$1 WHERE id=$2`, [enabled, req.session.userId]);
  res.json({ ok: true, enabled });
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

  const entitlement = ["owned", "subscription", "none", "unknown"].includes(req.query.fsdEntitlement) ? req.query.fsdEntitlement : "unknown";
  const car = { market, hardware, installedVersion: req.query.installed || "2026.14.6", earliness, earlinessSource: "default", earlyAccess: req.query.earlyAccess === "true", fsdVersion: req.query.fsd, fsdEntitlement: entitlement };

  // VIN lookup is scoped to the signed-in owner — never reveal another user's car attributes.
  if (!config.mockMode && hasDb() && req.query.vin && req.session && req.session.userId) {
    const v = await query(`SELECT market, hardware, current_version, earliness, early_access FROM vehicles WHERE vin=$1 AND user_id=$2`, [req.query.vin, req.session.userId]);
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
  // FSD can resolve to a no-date state (promised / sameFsd / not-entitled) — these have no
  // probWithin(); return them as-is rather than crashing on the within-window call.
  if (p.promised || p.sameFsd || p.notEntitled) {
    return res.json({ target, vin: req.query.vin || null, market: car.market, hardware: car.hardware, current: p.current, targetLabel: p.targetLabel || null, mode: p.mode || null, note: p.note || null, promised: !!p.promised, sameFsd: !!p.sameFsd, notEntitled: !!p.notEntitled, bundledWith: p.bundledWith || null });
  }
  const within = typeof p.probWithin === "function" ? { d7: round(p.probWithin(7), 3), d14: round(p.probWithin(14), 3), d30: round(p.probWithin(30), 3) } : null;
  res.json({
    target, vin: req.query.vin || null, market: car.market, hardware: car.hardware,
    targetLabel: p.targetLabel, earliness: round(p.earliness, 3),
    medianDate: p.medianDate, p10Date: p.p10Date, p90Date: p.p90Date, daysToMedian: p.daysToMedian,
    carrierBuild: p.carrierBuild || null, bundledWith: p.bundledWith || null, mode: p.mode || null, kind: p.kind || null,
    ...(within ? { within } : {}),
  });
}));

function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
