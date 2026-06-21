// wenFSD backend entry point.
import express from "express";
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
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieSession({
  name: "wenfsd",
  secret: config.sessionSecret,
  maxAge: 30 * 24 * 60 * 60 * 1000,
  sameSite: "lax",
  secure: config.publicBaseUrl.startsWith("https"),
}));

// --- Tesla partner public key (Tesla fetches this to trust your domain) ---
// Hosts keys/public-key.pem at the exact path Tesla requires.
app.get("/.well-known/appspecific/com.tesla.3p.public-key.pem", async (req, res) => {
  try {
    const pem = await readFile(path.join(__dirname, "..", "keys", "public-key.pem"), "utf8");
    res.type("application/x-pem-file").send(pem);
  } catch {
    res.status(404).send("public key not configured — see server/README.md");
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true, mock: config.mockMode }));
app.use("/auth", authRouter);
app.use("/api", apiRouter);

// Serve the static frontend (the repo root, one level up from /server).
const FRONTEND = path.join(__dirname, "..", "..");
app.use(express.static(FRONTEND));

app.listen(config.port, () => {
  console.log(`wenFSD server on :${config.port}  (mock=${config.mockMode})`);
  console.log(`  → http://localhost:${config.port}`);
  if (config.mockMode) console.log("  MOCK_MODE: serving seed data, no Tesla/DB calls.");
});

// --- scheduled polling + external-source refresh (real mode only) ---
if (!config.mockMode) {
  cron.schedule(config.pollCron, () => { pollOnce().catch((e) => console.error("[cron]", e)); });
  console.log(`  poller scheduled: ${config.pollCron}`);
  // refresh external tracker data a few times a day
  cron.schedule("17 */6 * * *", async () => {
    try { const db = await import("./db.js"); const { refreshAll } = await import("./sources/index.js"); await refreshAll(db, { live: true }); }
    catch (e) { console.error("[sources cron]", e); }
  });
}
