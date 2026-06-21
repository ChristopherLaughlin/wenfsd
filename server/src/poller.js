// Polls each linked vehicle for its current software version and logs changes.
// Runs on a cron (see POLL_CRON) inside the server, or once via `npm run poll`.
import { config } from "./config.js";
import { query, hasDb } from "./db.js";
import * as tesla from "./tesla.js";
import { fitLogistic } from "./predict.js";

export async function pollOnce() {
  if (config.mockMode || !hasDb()) {
    console.log("[poller] MOCK_MODE/no DB — skipping real poll.");
    return { polled: 0 };
  }
  const vehicles = await query(
    `SELECT v.id, v.vin, v.current_version, v.market, v.hardware,
            t.access_token, t.refresh_token, t.expires_at, v.user_id
       FROM vehicles v JOIN oauth_tokens t ON t.user_id = v.user_id
      WHERE v.opted_in = true`);

  let polled = 0, changed = 0;
  for (const v of vehicles.rows) {
    try {
      let access = v.access_token;
      if (new Date(v.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
        const refreshed = await tesla.refreshAccessToken(v.refresh_token);
        access = refreshed.access_token;
        await query(
          `UPDATE oauth_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now() WHERE user_id=$4`,
          [refreshed.access_token, refreshed.refresh_token || v.refresh_token,
           new Date(Date.now() + (refreshed.expires_in || 28800) * 1000), v.user_id]);
      }
      const version = await tesla.getVehicleVersion(access, v.vin);
      polled++;
      if (version && version !== v.current_version) {
        changed++;
        await query(
          `INSERT INTO version_snapshots(vehicle_id, version, market, hardware) VALUES($1,$2,$3,$4)`,
          [v.id, version, v.market, v.hardware]);
        await query(`UPDATE vehicles SET current_version=$1 WHERE id=$2`, [version, v.id]);
      }
    } catch (e) {
      if (e.code === 408) continue; // asleep — try next cycle
      console.warn(`[poller] ${v.vin}:`, e.message);
    }
  }
  await recomputeAggregates();
  console.log(`[poller] polled=${polled} changed=${changed}`);
  return { polled, changed };
}

// Recompute per-version install counts, fleet %, and the fitted logistic (t0, k).
async function recomputeAggregates() {
  const total = (await query(`SELECT count(*)::int AS n FROM vehicles WHERE opted_in`)).rows[0].n || 1;

  // current install counts (each vehicle's latest version)
  const counts = await query(`
    SELECT current_version AS version, count(*)::int AS n
      FROM vehicles WHERE current_version IS NOT NULL AND opted_in
      GROUP BY current_version`);

  for (const row of counts.rows) {
    // adoption curve: cumulative share of cars that had reached this version by each day
    const series = await query(`
      SELECT date_trunc('day', observed_at) AS d, count(*)::int AS n
        FROM version_snapshots WHERE version=$1 GROUP BY 1 ORDER BY 1`, [row.version]);
    let cum = 0; const points = [];
    for (const s of series.rows) { cum += s.n; points.push({ t: new Date(s.d), frac: cum / total }); }
    const fit = fitLogistic(points);
    const firstSeen = series.rows.length ? series.rows[0].d : null;

    await query(`
      INSERT INTO firmware_versions(version, branch, first_seen, install_count, fleet_pct, fit_t0, fit_k, updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7, now())
      ON CONFLICT(version) DO UPDATE SET
        first_seen=COALESCE(firmware_versions.first_seen,$3),
        install_count=$4, fleet_pct=$5, fit_t0=$6, fit_k=$7, updated_at=now()`,
      [row.version, branchOf(row.version), firstSeen, row.n, (row.n / total) * 100,
       fit ? fit.t0 : null, fit ? fit.k : null]);
  }
}
function branchOf(version) { return /fsd|v14/i.test(version) ? "fsd" : "standard"; }

// CLI: `node src/poller.js --once`
if (process.argv.includes("--once")) {
  pollOnce().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
