import pg from "pg";
import { config } from "./config.js";

// In mock mode we never touch Postgres — db.query() throws if called.
function sslConfig() {
  if (/localhost|127\.0\.0\.1/.test(config.databaseUrl)) return false;       // local: no SSL
  if (config.databaseCa) return { ca: config.databaseCa, rejectUnauthorized: true }; // verified
  if (config.databaseSslInsecure) return { rejectUnauthorized: false };       // explicit opt-out
  return { rejectUnauthorized: true };                                        // default: verify
}

let pool = null;
if (config.databaseUrl && !config.mockMode) {
  pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: sslConfig(), max: 8 });
}

export async function query(text, params) {
  if (!pool) throw new Error("Database not configured (running in MOCK_MODE or no DATABASE_URL).");
  return pool.query(text, params);
}

export function hasDb() { return !!pool; }
export { pool };
