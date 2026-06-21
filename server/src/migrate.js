// Run the schema against DATABASE_URL:  npm run migrate
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { query, hasDb } from "./db.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (config.mockMode) {
    console.log("MOCK_MODE is on — nothing to migrate. Set MOCK_MODE=false and DATABASE_URL to run migrations.");
    return;
  }
  if (!hasDb()) throw new Error("No DATABASE_URL configured.");
  const sql = await readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await query(sql);
  console.log("✓ schema applied");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
