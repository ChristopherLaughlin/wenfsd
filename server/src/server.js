// wenFSD backend entry point.
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieSession from "cookie-session";
import cron from "node-cron";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config, assertRealModeReady } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/api.js";
import { pollOnce } from "./poller.js";

assertRealModeReady();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// --- security headers (CSP allows our own assets + Google Fonts) ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
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
app.get("/", (req, res) => res.sendFile(path.join(REPO_ROOT, "index.html")));
app.use("/js", express.static(path.join(REPO_ROOT, "js"), STATIC_OPTS));
app.get("/styles.css", (req, res) => res.sendFile(path.join(REPO_ROOT, "styles.css")));
app.get("/index.html", (req, res) => res.sendFile(path.join(REPO_ROOT, "index.html")));
// hard block anything sensitive even if a future static mount is added
app.use((req, res, next) => {
  if (/^\/(server|node_modules|\.git|\.claude|memory)(\/|$)/.test(req.path)) return res.status(404).end();
  next();
});

// --- error handler (so thrown/rejected route handlers return JSON, not hang) ---
app.use((err, req, res, next) => {
  console.error("[error]", req.method, req.path, err && err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: config.mockMode ? String(err.message || err) : "internal error" });
});

app.listen(config.port, async () => {
  console.log(`wenFSD server on :${config.port}  (mock=${config.mockMode})`);
  console.log(`  → http://localhost:${config.port}`);
  if (config.mockMode) { console.log("  MOCK_MODE: serving seed data, no Tesla/DB calls."); return; }
  // real mode: ensure the schema exists (idempotent) so you never run a manual migrate
  try {
    const { applySchema } = await import("./db.js");
    if (await applySchema()) console.log("  ✓ database schema ensured");
  } catch (e) { console.error("  ✗ schema apply failed:", e.message); }
});

// --- scheduled jobs (real mode only) ---
if (!config.mockMode) {
  cron.schedule(config.pollCron, () => { pollOnce().catch((e) => console.error("[cron]", e)); });
  console.log(`  poller scheduled: ${config.pollCron}`);
  if (config.allowLiveSources) {
    cron.schedule("17 */6 * * *", async () => {
      try { const db = await import("./db.js"); const { refreshAll } = await import("./sources/index.js"); await refreshAll(db, { live: true }); }
      catch (e) { console.error("[sources cron]", e); }
    });
  }
}
