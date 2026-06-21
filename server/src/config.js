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
    fleetBase: process.env.TESLA_FLEET_BASE || "https://fleet-api.prod.na.vn.cloud.tesla.com",
    authBase: process.env.TESLA_AUTH_BASE || "https://auth.tesla.com",
    audience: process.env.TESLA_AUDIENCE || "https://fleet-api.prod.na.vn.cloud.tesla.com",
    privateKeyPath: process.env.TESLA_PRIVATE_KEY_PATH || "keys/private-key.pem",
  },

  databaseUrl: process.env.DATABASE_URL || "",
  pollCron: process.env.POLL_CRON || "*/30 * * * *",
};

export function assertRealModeReady() {
  if (config.mockMode) return;
  const missing = [];
  if (!config.tesla.clientId) missing.push("TESLA_CLIENT_ID");
  if (!config.tesla.clientSecret) missing.push("TESLA_CLIENT_SECRET");
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (missing.length) {
    throw new Error("Missing required env for real mode: " + missing.join(", ") +
      ". Set them or run with MOCK_MODE=true.");
  }
}
