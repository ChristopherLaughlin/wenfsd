// Manually apply the schema:  npm run migrate
// (Real mode also auto-applies it on server boot, so this is rarely needed.)
import { applySchema, hasDb } from "./db.js";
import { config } from "./config.js";

async function main() {
  if (config.mockMode) { console.log("MOCK_MODE is on — nothing to migrate."); return; }
  if (!hasDb()) throw new Error("No DATABASE_URL configured.");
  await applySchema();
  console.log("✓ schema applied");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
