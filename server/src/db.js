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

// Apply db/schema.sql (idempotent: all CREATE TABLE IF NOT EXISTS) — run on boot in real mode.
export async function applySchema() {
  if (!pool) return false;
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = (await import("node:path")).default;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(path.join(dir, "..", "db", "schema.sql"), "utf8");
  await pool.query(sql);
  return true;
}

export { pool };
