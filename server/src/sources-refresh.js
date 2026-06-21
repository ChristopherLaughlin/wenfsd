// Refresh external tracker data into the DB:  npm run sources  (add --live for real fetch)
import * as db from "./db.js";
import { refreshAll } from "./sources/index.js";

const live = process.argv.includes("--live");
refreshAll(db, { live }).then(merged => {
  console.log(`✓ merged ${merged.length} versions from external trackers${live ? " (live)" : " (sample)"}`);
  for (const v of merged.slice(0, 6)) console.log(`  ${v.version.padEnd(14)} ${v.fleetPct != null ? v.fleetPct + "%" : "—"}  [${v.sources.join(", ")}]`);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
