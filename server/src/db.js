import pg from "pg";
import { config } from "./config.js";

// In mock mode we never touch Postgres — db.query() throws if called.
let pool = null;
if (config.databaseUrl && !config.mockMode) {
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    // Railway/Render managed Postgres require SSL; local usually doesn't.
    ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: false },
    max: 8,
  });
}

export async function query(text, params) {
  if (!pool) throw new Error("Database not configured (running in MOCK_MODE or no DATABASE_URL).");
  return pool.query(text, params);
}

export function hasDb() { return !!pool; }
export { pool };
