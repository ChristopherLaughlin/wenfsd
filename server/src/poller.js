// Polls each linked vehicle for its current software version and logs changes.
// Runs on a cron (see POLL_CRON) inside the server, or once via `npm run poll`.
import { config } from "./config.js";
import { query, hasDb } from "./db.js";
import * as tesla from "./tesla.js";
import { fitLogistic, predictNextOS } from "./predict.js";
import { encrypt, decrypt } from "./crypto.js";
import { deliver, arrivalMessage } from "./mailer.js";

export async function pollOnce() {
  if (config.mockMode || !hasDb()) {
    console.log("[poller] MOCK_MODE/no DB — skipping real poll.");
    return { polled: 0 };
  }
  // poll ALL linked vehicles (each owner consented by connecting, so we can read their own
  // car's version for their prediction). Aggregate fleet stats still only count opted-in cars
  // (see recomputeAggregates). Group by user so we refresh a token / list vehicles once.
  const rows = (await query(
    `SELECT v.id, v.vin, v.current_version, v.market, v.hardware, v.user_id,
            t.access_token, t.refresh_token, t.expires_at
       FROM vehicles v JOIN oauth_tokens t ON t.user_id = v.user_id`)).rows;

  const byUser = new Map();
  for (const r of rows) { if (!byUser.has(r.user_id)) byUser.set(r.user_id, { tok: r, cars: [] }); byUser.get(r.user_id).cars.push(r); }

  let polled = 0, changed = 0, skipped = 0;
  for (const [userId, { tok, cars }] of byUser) {
    try {
      let access = decrypt(tok.access_token);
      if (new Date(tok.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
        const refreshed = await tesla.refreshAccessToken(decrypt(tok.refresh_token));
        access = refreshed.access_token;
        await query(`UPDATE oauth_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=now() WHERE user_id=$4`,
          [encrypt(refreshed.access_token), encrypt(refreshed.refresh_token || decrypt(tok.refresh_token)),
           new Date(Date.now() + (refreshed.expires_in || 28800) * 1000), userId]);
      }
      // list endpoint does NOT wake cars — use it to read online state, then only poll awake cars
      const fleet = await tesla.listVehicles(access);
      const state = new Map(fleet.map(f => [f.vin, f.state]));
      for (const c of cars) {
        // Record the open prediction for the car's KNOWN version FIRST — this is a pure
        // computation from data already in the DB (no Tesla API call, no need to wake the car),
        // so it must run even for asleep cars. Otherwise a car that's asleep at every poll
        // never gets a prediction despite us knowing its version.
        if (c.current_version) { try { await ensurePrediction(c); } catch (e) { console.warn(`[poller] ensure ${c.vin}:`, e.message); } }

        // Reading a FRESH version (to detect an update → score) does need the car awake.
        if (state.get(c.vin) && state.get(c.vin) !== "online") { skipped++; continue; } // asleep/offline — don't wake it
        try {
          const { version, update } = await tesla.getVehicleState(access, c.vin);  // version + pending OTA, one call
          polled++;
          const r = await applyVersionReading(c, version);   // score-on-change + snapshot + ensure
          await persistPendingUpdate(c, update);             // live "update incoming" status
          if (r.changed) changed++;
        } catch (e) { if (e.code !== 408) console.warn(`[poller] ${c.vin}:`, e.message); }
      }
    } catch (e) { console.warn(`[poller] user ${userId}:`, e.message); }
  }
  await recomputeAggregates();
  console.log(`[poller] polled=${polled} changed=${changed} skipped(asleep)=${skipped}`);
  return { polled, changed, skipped };
}

// Record an open prediction for this car's CURRENT version, if one doesn't already exist.
// Uses the same engine the dashboard uses, so the hit-rate reflects real product accuracy.
// Exported so the OAuth link flow can capture a prediction immediately (awake cars), instead
// of waiting for the poller's next scheduled awake-poll.
export async function ensurePrediction(c) {
  try {
    const car = {
      market: c.market || "Australia", hardware: c.hardware || "AI4",
      installedVersion: c.current_version,
      earliness: c.earliness != null ? c.earliness : 0.5, earlyAccess: !!c.early_access,
    };
    const p = predictNextOS(car);
    if (!p || !p.medianDate) return;
    await query(
      `INSERT INTO predictions(vehicle_id, from_version, target_label, median_date, p10_date, p90_date)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(vehicle_id, from_version) DO NOTHING`,
      [c.id, c.current_version, p.targetLabel || null, p.medianDate, p.p10Date, p.p90Date]);
  } catch (e) { console.warn(`[poller] ensurePrediction ${c.vin}:`, e.message); }
}

// Score the open prediction once the car has moved off `fromVersion`: did the update land
// inside the predicted 80% window, and how far off was the median?
async function scorePrediction(vehicleId, fromVersion) {
  await query(
    `UPDATE predictions
        SET scored=true, actual_date=CURRENT_DATE,
            error_days=(CURRENT_DATE - median_date),
            hit=(CURRENT_DATE BETWEEN p10_date AND p90_date)
      WHERE vehicle_id=$1 AND from_version=$2 AND NOT scored`,
    [vehicleId, fromVersion]);
}

// Settle the owner's open "Call your shot" wager once the update lands: hit if the actual
// date fell inside their ± window; wenPoints reward accuracy × the nerve multiplier.
async function settleGuesses(vehicleId, fromVersion) {
  await query(
    `UPDATE guesses
        SET settled=true, actual_date=CURRENT_DATE,
            hit = (CURRENT_DATE BETWEEN (guess_date - window_days) AND (guess_date + window_days)),
            points = CASE WHEN CURRENT_DATE BETWEEN (guess_date - window_days) AND (guess_date + window_days)
              THEN GREATEST(0, ROUND(100 * mult * (1 - ABS(CURRENT_DATE - guess_date)::numeric / NULLIF(window_days,0))))::int
              ELSE 0 END
      WHERE vehicle_id=$1 AND from_version=$2 AND NOT settled`,
    [vehicleId, fromVersion]);
}

// Apply a freshly-read version to a car: if it changed, score the old prediction + log the
// snapshot + update; then ensure an open prediction exists for the current version. Shared by
// the cron poller, the OAuth link flow, and the owner-triggered refresh endpoint.
export async function applyVersionReading(c, version) {
  let changed = false;
  if (version && version !== c.current_version) {
    changed = true;
    const prevVersion = c.current_version;
    if (c.current_version) { await scorePrediction(c.id, c.current_version); await settleGuesses(c.id, c.current_version); }
    await query(`INSERT INTO version_snapshots(vehicle_id, version, market, hardware) VALUES($1,$2,$3,$4)`, [c.id, version, c.market, c.hardware]);
    await query(`UPDATE vehicles SET current_version=$1 WHERE id=$2`, [version, c.id]);
    c.current_version = version;
    // the update just LANDED — tell the owner if they opted in. Never let this break the poll.
    try { await notifyArrival(c, prevVersion, version); } catch (e) { console.warn(`[notify] ${c.vin}:`, e.message); }
  }
  if (c.current_version) await ensurePrediction(c);
  return { changed, version: c.current_version };
}

// Deliver the opt-in "your update landed" notification for a connected car (no-op if not opted in).
async function notifyArrival(c, fromVersion, toVersion) {
  if (!c.user_id) return;
  const u = await query(`SELECT email, notify_on_update FROM users WHERE id=$1`, [c.user_id]);
  const row = u.rows[0];
  if (!row || !row.notify_on_update || !row.email) return;
  const msg = arrivalMessage({ vin: c.vin, fromVersion, toVersion });
  await deliver({ to: row.email, subject: msg.subject, text: msg.text, event: { type: "update_landed", vin: c.vin, fromVersion, toVersion } });
}

// Persist the car's live pending OTA update (or clear it when there's none — e.g. it just
// installed). Shared by the cron poller and the owner-triggered refresh.
export async function persistPendingUpdate(c, update) {
  if (update && update.version && update.version !== c.current_version) {
    await query(`UPDATE vehicles SET pending_version=$1, pending_status=$2, pending_download=$3, pending_install=$4, pending_seen_at=now() WHERE id=$5`,
      [update.version, update.status || null, update.download, update.install, c.id]);
  } else {
    await query(`UPDATE vehicles SET pending_version=NULL, pending_status=NULL, pending_download=NULL, pending_install=NULL, pending_seen_at=now() WHERE id=$1`, [c.id]);
  }
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
