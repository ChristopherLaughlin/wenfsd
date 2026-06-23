// Tier-1 OBSERVED pause detection job: read the TeslaFi daily-install series, flag builds whose
// rollout has flatlined mid-roll, and queue them as 'pending' rollout events for human review.
// Quantitative, no scraping/rumor. Idempotent: won't re-queue a stall already pending/confirmed.
import { config } from "./config.js";
import { query, hasDb } from "./db.js";
import { detectStalls } from "./events.js";
import { fetchDailySeries } from "./sources/teslafi.js";
import { notifyOwnerOfPending } from "./ownernotify.js";

export async function runStallDetection({ live = false } = {}) {
  if (config.mockMode || !hasDb() || !live) return { queued: 0, checked: 0, skipped: "not-live" };
  let series = [];
  try { series = (await fetchDailySeries()).series || []; } catch (e) { return { queued: 0, error: String(e && e.message || e) }; }
  const stalls = detectStalls(series);
  let queued = 0;
  for (const s of stalls) {
    // dedupe: skip if a pause for this version is already pending or confirmed in the last 21 days
    const dup = await query(
      `SELECT 1 FROM rollout_events WHERE type IN ('pause','halt') AND version=$1
         AND status IN ('pending','confirmed') AND detected_at > now() - interval '21 days' LIMIT 1`, [s.version]).catch(() => null);
    if (dup && dup.rowCount) continue;
    const reason = `Installs flatlined ${s.stalledDays}+ days after averaging ~${s.priorAvg}/day — possible pause (auto-detected, needs confirmation).`;
    await query(
      `INSERT INTO rollout_events(type, version, region, status, reason, source, confidence)
       VALUES('pause',$1,NULL,'pending',$2,'observed-plateau',0.6)`,
      [s.version, reason]).catch(() => {});
    // each queued stall is already deduped (21-day window) → genuinely new → alert the owner
    notifyOwnerOfPending({ type: "pause", version: s.version, region: null, reason, source: "observed-plateau" }).catch(() => {});
    queued++;
  }
  return { queued, checked: series.length };
}
