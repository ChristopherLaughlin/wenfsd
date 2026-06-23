// wenFSD backend entry point.
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieSession from "cookie-session";
import cron from "node-cron";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { config, ensureModeReady } from "./config.js";
import { query, hasDb } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/api.js";
import { pollOnce } from "./poller.js";

const modeStatus = ensureModeReady();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Force HTTPS. Railway terminates TLS and forwards x-forwarded-proto; if a bare-domain
// navigation (e.g. typing "wenfsd.info" in Chrome on Android) arrives over http, 301 it to
// https so it never dead-ends on plain http and falls back to a search.
app.use((req, res, next) => {
  if (config.publicBaseUrl.startsWith("https") && req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

// --- security headers (CSP allows our own assets + Google Fonts) ---
app.use(helmet({
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },  // 2y — tell browsers to always use https
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: "32kb" }));
app.use(cookieSession({
  name: "wenfsd",
  secret: config.sessionSecret,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
  secure: config.publicBaseUrl.startsWith("https"),
}));

// --- rate limits ---
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
// generous catch-all so every route — including the static asset / og / robots / sitemap / key
// handlers — is rate-limited (defence against fs-access abuse); the stricter limiters above still apply.
app.use(rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));

// CSRF protection for state-changing requests: require a same-origin Origin/Referer token.
// Pairs with SameSite=lax cookies; a cross-site page can't forge a matching Origin header.
const SELF_ORIGIN = config.publicBaseUrl.replace(/\/$/, "");
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const src = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : "");
  if (!config.mockMode && SELF_ORIGIN.startsWith("http") && src && src.replace(/\/$/, "") !== SELF_ORIGIN) {
    return res.status(403).json({ error: "cross-origin write refused (CSRF protection)" });
  }
  next();
});

// --- Tesla partner public key (Tesla fetches this to trust your domain) ---
app.get("/.well-known/appspecific/com.tesla.3p.public-key.pem", async (req, res) => {
  try {
    // prefer the env var (works on git-based deploys where keys/*.pem aren't committed)
    const pem = config.tesla.publicKey || await readFile(path.join(__dirname, "..", "keys", "public-key.pem"), "utf8");
    if (!pem) throw new Error("no key");
    res.type("application/x-pem-file").send(pem);
  } catch { res.status(404).send("public key not configured — set TESLA_PUBLIC_KEY or add server/keys/public-key.pem"); }
});

app.get("/healthz", (req, res) => res.json({ ok: true, mock: config.mockMode }));
app.use("/auth", authLimiter, authRouter);
app.use("/api", apiLimiter, apiRouter);

// --- static frontend: serve ONLY the known assets, never server/ or dotfiles ---
const STATIC_OPTS = { dotfiles: "ignore", index: false };
// Cache-bust JS/CSS per deploy so browsers always load matching code (no stale-JS bugs).
const BUILD = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || String(Date.now());
let _indexHtml = null;
async function serveIndex(req, res) {
  try {
    if (_indexHtml == null) {
      const raw = await readFile(path.join(REPO_ROOT, "index.html"), "utf8");
      _indexHtml = raw.replace(/(src|href)="(js\/[^"?]+|styles\.css)"/g, `$1="$2?v=${BUILD}"`);
    }
    recordVisit(req);   // privacy-respecting page-view counter (fire-and-forget)
    res.type("html").set("Cache-Control", "no-cache").send(_indexHtml);
  } catch { res.sendStatus(500); }
}
app.get("/", serveIndex);
app.get("/index.html", serveIndex);

// --- privacy-respecting visit counter (no cookies, no stored IPs) ---
// Per-day TOTAL views + rough uniques via a SALTED daily hash of IP+UA (not reversible,
// pruned after 90 days). Never blocks or breaks a page load.
async function recordVisit(req) {
  if (config.mockMode || !hasDb()) return;
  try {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const ua = String(req.headers["user-agent"] || "");
    const day = new Date().toISOString().slice(0, 10);
    const hash = crypto.createHash("sha256").update(day + "|" + ip + "|" + ua + "|" + config.sessionSecret).digest("hex");
    await query(`INSERT INTO daily_visits(day, views) VALUES($1, 1) ON CONFLICT(day) DO UPDATE SET views = daily_visits.views + 1`, [day]);
    await query(`INSERT INTO daily_unique_visitors(day, visitor_hash) VALUES($1, $2) ON CONFLICT DO NOTHING`, [day, hash]);
    if (Math.random() < 0.01) await query(`DELETE FROM daily_unique_visitors WHERE day < (CURRENT_DATE - INTERVAL '90 days')`);
  } catch { /* analytics must never break a page load */ }
}

// --- creator-only admin dashboard (token-gated; the data API lives at /api/admin/stats) ---
app.get("/admin", (req, res) => {
  if (!config.adminToken) return res.status(404).send("Admin dashboard disabled. Set ADMIN_TOKEN to enable it.");
  res.type("html").set("Cache-Control", "no-cache").send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>wenFSD · creator dashboard</title><link rel="stylesheet" href="/styles.css?v=${BUILD}"/>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23e6394b'/%3E%3Ctext x='16' y='25' font-family='Arial' font-size='25' font-weight='bold' text-anchor='middle' fill='white'%3E%3F%3C/text%3E%3C/svg%3E"/>
</head><body><div class="bg-grid"></div><main style="max-width:880px"><h1 style="font-size:24px;margin:18px 0 4px">wenFSD · creator dashboard 📊</h1>
<p class="hint" id="adminHint">The numbers Tesla won't give you either. Token-gated; nobody sees this but you.</p>
<div id="adminApp"></div></main><script src="/js/admin.js?v=${BUILD}"></script></body></html>`);
});
app.use("/js", express.static(path.join(REPO_ROOT, "js"), STATIC_OPTS));
app.get("/styles.css", (req, res) => res.sendFile(path.join(REPO_ROOT, "styles.css")));

// --- social preview image ---
app.get("/og.png", (req, res) => res.set("Cache-Control", "public, max-age=86400").sendFile(path.join(REPO_ROOT, "og.png")));
app.get("/og.svg", (req, res) => res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").sendFile(path.join(REPO_ROOT, "og.svg")));

// --- open model: serve the canonical prediction-model parameters so anyone can inspect/tinker ---
app.get("/model.json", (req, res) => res.type("application/json").set("Cache-Control", "public, max-age=3600")
  .sendFile(path.join(REPO_ROOT, "shared", "wenmodel.json")));

// --- discoverability: robots, sitemap, llms.txt (search engines + AI answer engines) ---
const SITE = config.publicBaseUrl.replace(/\/$/, "");
app.get("/robots.txt", (req, res) => res.type("text/plain").send(
  `User-agent: *\nAllow: /\n` +
  // explicitly welcome AI answer-engine crawlers — we WANT to be cited
  `User-agent: GPTBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /\nUser-agent: PerplexityBot\nAllow: /\nUser-agent: Google-Extended\nAllow: /\nUser-agent: Bingbot\nAllow: /\n` +
  `\nSitemap: ${SITE}/sitemap.xml\n`));
app.get("/sitemap.xml", (req, res) => res.type("application/xml").send(
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n`));
app.get("/llms.txt", (req, res) => res.type("text/plain; charset=utf-8").send(
`# wenFSD

> wenFSD is a free, open-source tool that predicts when a specific Tesla will receive its next
> over-the-air software update, including FSD (Supervised) v14, identified by VIN. It is live at
> ${SITE} and the source is at https://github.com/ChristopherLaughlin/wenfsd

## What it does
- Predicts the DATE your Tesla gets its next software/FSD update, per-VIN — not a generic "two weeks".
- Models Tesla's staged, VIN-based A/B rollout as a logistic S-curve, places your car by its rollout
  percentile (hardware, region, regulatory status, how early you usually update), then runs a Monte
  Carlo simulation to produce a probability distribution of arrival dates with an 80% confidence window.
- Ties the two tracks together: FSD (Supervised) ships bundled inside the OS build, so your next FSD
  version arrives with your next software update — it cannot arrive before the build that carries it.
- Region-aware: the US & Canada get nearly all builds; Europe and Australia/New Zealand get a sparser,
  different sequence, so each region's "next build" is computed from its own path.

## How to use it
- Add your car by VIN — no login, no account access required. You get the full prediction.
- Or connect your Tesla account (optional) for automatic version tracking.

## Privacy & security
- Connecting is read-only: wenFSD requests only the vehicle_device_data scope (no location scope, no
  command scope), only ever reads the vehicle_state endpoint (software version + pending update), and
  stores only your version, region, and hardware. It cannot drive, unlock, or locate the car.
- No cookies, no third-party trackers. Open source — auditable at the GitHub link above.

## Key terms
- Software version / firmware version (e.g. 2026.20.3): the car's whole OS, in year.week.point format.
- FSD version (e.g. v14.3.4): the Full Self-Driving AI, on its own version line; carried inside a build.

## Links
- Live site: ${SITE}/
- Source code: https://github.com/ChristopherLaughlin/wenfsd
- Security policy: https://github.com/ChristopherLaughlin/wenfsd/blob/main/SECURITY.md
`));
// hard block anything sensitive even if a future static mount is added
app.use((req, res, next) => {
  if (/^\/(server|node_modules|\.git|\.claude|memory)(\/|$)/.test(req.path)) return res.status(404).end();
  next();
});

// --- error handler (so thrown/rejected route handlers return JSON, not hang) ---
app.use((err, req, res, next) => {
  // strip CR/LF from request-derived values before logging (no log-injection / forged log lines)
  const safe = (s) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").slice(0, 200);
  console.error("[error]", safe(req.method), safe(req.path), safe(err && err.message));
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: config.mockMode ? String(err.message || err) : "internal error" });
});

app.listen(config.port, async () => {
  console.log(`wenFSD server on :${config.port}  (mock=${config.mockMode})`);
  console.log(`  → http://localhost:${config.port}`);
  if (modeStatus.degraded) {
    console.error("  ⚠ MOCK_MODE=false but real-mode config is incomplete: " + modeStatus.missing.join(", "));
    console.error("  ⚠ Falling back to SAMPLE mode so the site stays up. Set the missing vars to go live.");
  }
  if (config.mockMode) { console.log("  MOCK_MODE: serving seed data, no Tesla/DB calls."); return; }
  // real mode: ensure the schema exists (idempotent) so you never run a manual migrate
  try {
    const { applySchema } = await import("./db.js");
    if (await applySchema()) console.log("  ✓ database schema ensured");
  } catch (e) { console.error("  ✗ schema apply failed:", e.message); }
  // one-shot poll on boot so predictions + aggregates refresh immediately after a deploy,
  // instead of waiting up to an hour for the next cron tick. Non-blocking; never crashes boot.
  pollOnce().then((r) => console.log("  ✓ boot poll:", JSON.stringify(r))).catch((e) => console.error("  boot poll failed:", e && e.message));
});

// --- scheduled jobs (real mode only) ---
if (!config.mockMode) {
  cron.schedule(config.pollCron, () => { pollOnce().catch((e) => console.error("[cron]", e)); });
  console.log(`  poller scheduled: ${config.pollCron}`);
  // daily "your window is opening" alerts to no-login email subscribers (idempotent per build)
  cron.schedule("0 9 * * *", async () => {
    try { const { runSubscriberAlerts } = await import("./subscribers.js"); const r = await runSubscriberAlerts(); if (r.sent) console.log("[alerts]", JSON.stringify(r)); }
    catch (e) { console.error("[alerts cron]", e); }
  });
  if (config.allowLiveSources) {
    cron.schedule("17 */6 * * *", async () => {
      try { const db = await import("./db.js"); const { refreshAll } = await import("./sources/index.js"); await refreshAll(db, { live: true }); }
      catch (e) { console.error("[sources cron]", e); }
    });
  }
}
