import dotenv from "dotenv";
dotenv.config();

const bool = (v, d = false) => (v == null ? d : /^(1|true|yes)$/i.test(String(v)));

export const config = {
  port: parseInt(process.env.PORT || "8787", 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:8787",
  sessionSecret: process.env.SESSION_SECRET || "dev-insecure-secret",
  mockMode: bool(process.env.MOCK_MODE, true),

  tesla: {
    clientId: process.env.TESLA_CLIENT_ID || "",
    clientSecret: process.env.TESLA_CLIENT_SECRET || "",
    scopes: process.env.TESLA_SCOPES || "openid offline_access vehicle_device_data",
    redirectUri: process.env.TESLA_REDIRECT_URI || "http://localhost:8787/auth/callback",
    fleetBase: process.env.TESLA_FLEET_BASE || "https://fleet-api.prd.na.vn.cloud.tesla.com",
    authBase: process.env.TESLA_AUTH_BASE || "https://auth.tesla.com",
    audience: process.env.TESLA_AUDIENCE || "https://fleet-api.prd.na.vn.cloud.tesla.com",
    privateKeyPath: process.env.TESLA_PRIVATE_KEY_PATH || "keys/private-key.pem",
    // PEM keys can also come straight from env (preferred on hosts that deploy from git,
    // where keys/*.pem are gitignored). Literal "\n" sequences are unescaped to newlines.
    publicKey: (process.env.TESLA_PUBLIC_KEY || "").replace(/\\n/g, "\n"),
    privateKey: (process.env.TESLA_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },

  databaseUrl: process.env.DATABASE_URL || "",
  databaseCa: process.env.DATABASE_CA || "",            // PEM CA cert for verified DB TLS
  databaseSslInsecure: bool(process.env.DATABASE_SSL_INSECURE, false), // escape hatch (discouraged)
  pollCron: process.env.POLL_CRON || "0 * * * *",        // hourly (was */30 — too aggressive)
  tokenEncKey: process.env.TOKEN_ENC_KEY || "",          // 32-byte key (base64/hex) for token encryption
  allowLiveSources: bool(process.env.ALLOW_LIVE_SOURCES, false), // explicit opt-in to fetch external trackers
  adminToken: process.env.ADMIN_TOKEN || "",             // gates the creator-only /admin dashboard (unset ⇒ disabled)
};

// If real mode is requested but its required config is incomplete, DEGRADE to sample
// mode (and log loudly) instead of crashing — so a missing DB/credential never takes the
// whole site dark. Returns { degraded, missing }.
export function ensureModeReady() {
  if (config.mockMode) return { degraded: false, missing: [] };
  const missing = [];
  if (!config.tesla.clientId) missing.push("TESLA_CLIENT_ID");
  if (!config.tesla.clientSecret) missing.push("TESLA_CLIENT_SECRET");
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.tokenEncKey) missing.push("TOKEN_ENC_KEY");
  if (!config.sessionSecret || config.sessionSecret === "dev-insecure-secret" || config.sessionSecret.length < 32) missing.push("SESSION_SECRET(>=32 chars)");
  if (missing.length) { config.mockMode = true; return { degraded: true, missing }; }
  return { degraded: false, missing: [] };
}
