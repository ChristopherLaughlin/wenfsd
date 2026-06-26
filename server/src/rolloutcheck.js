// Daily rollout reconciliation: compare the LIVE consensus (builds + FSD versions) from the public
// trackers against the model's seed data, and QUEUE any drift as a 'model-update' event for the owner
// to apply. We deliberately do NOT auto-rewrite the committed seed (a server can't safely commit to
// git, and high-impact rollout changes are human-gated per the event engine) — the 6-hourly sources
// refresh already feeds live build data into the predictions in real mode; this is the daily "is the
// model itself still accurate?" check that catches new OS builds, new FSD versions, and a stale date.
import { config } from "./config.js";
import { query, hasDb } from "./db.js";
import * as W from "./wendata.js";
import { merge } from "./sources/index.js";
import { notifyOwnerOfPending } from "./ownernotify.js";

const DAY = 86400000;

// Pure drift detector (no DB/network) so it can be unit-tested. Returns a list of {kind, detail, ...}.
// `rows` are merged consensus rows ({version, fleetPct, fsdBuild, status, regions}); `realNow` is an
// ISO date string for "today" in the real world. `model` defaults to the live seed but is injectable.
export function detectModelDrift(rows, realNow, model = { versions: W.versions, today: W.today }) {
  const drift = [];
  const versions = model.versions || [];
  const modelVers = new Set(versions.map(v => v.version));
  const newestKey = versions.length ? Math.max(...versions.map(v => W.verKey(v.version))) : 0;
  const newestLabel = versions[0] && versions[0].version;

  // (1) NEW OS BUILDS the model doesn't know that are newer than its newest AND modestly rolled out
  //     (≥0.5% fleet) — filters one-off test builds. Strongest signal the version list is behind.
  for (const r of (rows || [])) {
    if (modelVers.has(r.version)) continue;
    const pct = r.fleetPct != null ? r.fleetPct : 0;
    if (W.verKey(r.version) > newestKey && pct >= 0.5) {
      drift.push({ kind: "new-build", version: r.version, detail: `New OS build ${r.version} (~${pct}% of the fleet) is newer than the model's newest (${newestLabel}). Add it to versions[] + check region markets.` });
    }
  }

  // (2) NEW FSD VERSIONS in the wild, newer than anything the model carries for that hardware.
  const maxF = { AI4: 0, AI3: 0 };
  for (const v of versions) for (const hw of ["AI4", "AI3"]) {
    const f = v.fsdBuild && v.fsdBuild[hw];
    if (f && f !== "—") maxF[hw] = Math.max(maxF[hw], W.fsdKey(f));
  }
  for (const r of (rows || [])) {
    if (!r.fsdBuild) continue;
    for (const hw of ["AI4", "AI3"]) {
      const f = r.fsdBuild[hw];
      if (!f || f === "—") continue;
      if (W.fsdKey(f) > maxF[hw]) {
        drift.push({ kind: "new-fsd", hardware: hw, fsd: f, version: r.version, detail: `New FSD ${f} (${hw}) seen in build ${r.version} — newer than the model's newest ${hw} FSD. Update the relevant region.fsd + fsdBuild.` });
        maxF[hw] = W.fsdKey(f); // report each new FSD once, not per build that carries it
      }
    }
  }

  // (3) STALE DATE anchor — the model's `today` lagging real now by >10 days skews every prediction.
  const daysStale = Math.round((new Date(realNow + "T00:00:00Z") - new Date(model.today + "T00:00:00Z")) / DAY);
  if (daysStale > 10) {
    drift.push({ kind: "stale-date", detail: `Model 'today' is ${model.today}, ~${daysStale} days behind real now (${realNow}). Every prediction drifts late — bump 'today' + refresh build fleet %s.` });
  }
  return drift;
}

export async function runRolloutReconciliation({ live = false, realNow = null } = {}) {
  if (config.mockMode || !hasDb() || !live) return { queued: 0, drift: [], skipped: "not-live" };
  let rows = [];
  try { rows = await merge({ live }); } catch (e) { return { queued: 0, error: String(e && e.message || e) }; }
  if (!rows.length) return { queued: 0, drift: [], note: "no source rows" };

  const today = realNow || new Date().toISOString().slice(0, 10);
  const drift = detectModelDrift(rows, today);

  let queued = 0;
  for (const d of drift) {
    // dedupe: skip if this exact drift is already pending/confirmed in the last 14 days
    const dup = await query(
      `SELECT 1 FROM rollout_events WHERE type='model-update' AND reason=$1
         AND status IN ('pending','confirmed') AND detected_at > now() - interval '14 days' LIMIT 1`, [d.detail]).catch(() => null);
    if (dup && dup.rowCount) continue;
    await query(
      `INSERT INTO rollout_events(type, version, region, status, reason, source, confidence)
       VALUES('model-update',$1,NULL,'pending',$2,'rollout-reconcile',0.7)`,
      [d.version || null, d.detail]).catch(() => {});
    // 'model-update' is inert for predictions (the overlay only acts on pause/halt/resume/accelerate);
    // it surfaces in the owner's review queue + an alert so the seed can be corrected by a human.
    notifyOwnerOfPending({ type: "model-update", version: d.version || null, region: null, reason: d.detail, source: "rollout-reconcile" }).catch(() => {});
    queued++;
  }
  return { queued, drift, checked: rows.length };
}
