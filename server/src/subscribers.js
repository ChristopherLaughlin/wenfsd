// Daily "your window is opening" alert job for no-login email subscribers — the trigger that
// turns the email channel into actual retention. Idempotent: never re-emails about the same build.
import { config } from "./config.js";
import { query, hasDb } from "./db.js";
import { predictNextOS } from "./predict.js";
import { deliver, windowAlertMessage, resumeAlertMessage } from "./mailer.js";

// Pure decision: should we email this subscriber now? Kept separate so it's unit-testable.
// Email when the model puts their next build within `windowDays` (and not long past), AND we
// haven't already alerted them about that exact target build.
export function shouldAlert(pred, lastNotifiedVersion, windowDays = 10) {
  if (!pred || pred.capped || pred.unavailable) return false;
  if (pred.paused) return false;   // rollout paused → no honest "it's close" alert until it resumes
  if (!pred.targetLabel || pred.daysToMedian == null) return false;
  if (pred.daysToMedian > windowDays || pred.daysToMedian < -30) return false;   // close, not ancient
  if (lastNotifiedVersion && lastNotifiedVersion === pred.targetLabel) return false; // already told them
  return true;
}

async function loadConfirmedEvents() {
  const r = await query(`SELECT type, version, region, reason, source, effective_at, detected_at FROM rollout_events WHERE status='confirmed' AND (expires_at IS NULL OR expires_at > now())`).catch(() => null);
  return (r && r.rows) || [];
}

export async function runSubscriberAlerts({ windowDays = 10 } = {}) {
  if (config.mockMode || !hasDb()) return { sent: 0, checked: 0, mock: true };
  const events = await loadConfirmedEvents();
  const subs = (await query(
    `SELECT id, email, market, hardware, version, fsd_entitlement, last_notified_version, unsub_token
       FROM email_subscribers WHERE confirmed = true AND unsubscribed_at IS NULL`)).rows;
  const base = config.publicBaseUrl.replace(/\/$/, "");
  let sent = 0;
  for (const s of subs) {
    let pred;
    try {
      pred = predictNextOS({
        market: s.market || "Australia", hardware: s.hardware || "AI4",
        installedVersion: s.version || undefined, earliness: 0.5, earlinessSource: "default",
        fsdEntitlement: s.fsd_entitlement || "unknown",
        // real current date, not the frozen snapshot clock — so the alert window is judged against
        // the actual day (otherwise emails fire days early/late as the snapshot ages).
      }, { events, today: new Date().toISOString().slice(0, 10) });
    } catch { continue; }
    if (!shouldAlert(pred, s.last_notified_version, windowDays)) continue;
    const msg = windowAlertMessage({
      version: pred.targetLabel, market: s.market, daysToMedian: pred.daysToMedian,
      siteUrl: base, unsubUrl: `${base}/api/unsubscribe?t=${s.unsub_token}`,
    });
    const r = await deliver({ to: s.email, subject: msg.subject, text: msg.text, event: "subscriber_window_alert" });
    if (r && r.delivered !== false) {
      await query(`UPDATE email_subscribers SET last_notified_version=$1, last_notified_at=now() WHERE id=$2`, [pred.targetLabel, s.id]);
      sent++;
    }
  }
  return { sent, checked: subs.length };
}

// THE RESUME ALARM. When a held rollout is confirmed resumed, email everyone who was waiting in that
// region — once per resume (idempotent via last_resume_event_id). Called immediately when a resume is
// confirmed (auto-unpause / admin) for true "the second it moves", plus a daily catch-all for anyone
// who confirmed their email mid-pause. Only fires for resumes confirmed in the last 7 days (a fresh
// resume is news; an ancient one isn't), and only for subscribers who signed up BEFORE it resumed.
export async function runResumeAlerts() {
  if (config.mockMode || !hasDb()) return { sent: 0, checked: 0, mock: true };
  const evs = (await query(
    `SELECT id, version, region, effective_at
       FROM rollout_events
      WHERE type IN ('resume','accelerate') AND status='confirmed'
        AND COALESCE(confirmed_at, detected_at) > now() - interval '7 days'
      ORDER BY COALESCE(confirmed_at, detected_at) DESC`).catch(() => null) || { rows: [] }).rows || [];
  if (!evs.length) return { sent: 0, checked: 0 };
  const base = config.publicBaseUrl.replace(/\/$/, "");
  // one resume per region (most recent) so a region with several resume rows can't double-email
  const byRegion = new Map();
  for (const ev of evs) { const k = ev.region || "__global"; if (!byRegion.has(k)) byRegion.set(k, ev); }
  let sent = 0, checked = 0;
  for (const [regionKey, ev] of byRegion) {
    const subs = (await query(
      `SELECT id, email, market, unsub_token FROM email_subscribers
        WHERE confirmed = true AND unsubscribed_at IS NULL
          AND ($1 = '__global' OR market = $1)
          AND (last_resume_event_id IS NULL OR last_resume_event_id <> $2)
          AND created_at < COALESCE($3, now())`,
      [regionKey, ev.id, ev.effective_at])).rows;
    for (const s of subs) {
      checked++;
      const msg = resumeAlertMessage({ version: ev.version, region: s.market || (regionKey === "__global" ? null : regionKey), siteUrl: base, unsubUrl: `${base}/api/unsubscribe?t=${s.unsub_token}` });
      const r = await deliver({ to: s.email, subject: msg.subject, text: msg.text, event: "subscriber_resume_alert" });
      if (r && r.delivered !== false) {
        await query(`UPDATE email_subscribers SET last_resume_event_id = $1, last_notified_at = now() WHERE id = $2`, [ev.id, s.id]);
        sent++;
      }
    }
  }
  return { sent, checked };
}
