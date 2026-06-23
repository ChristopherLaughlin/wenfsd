// Daily "your window is opening" alert job for no-login email subscribers — the trigger that
// turns the email channel into actual retention. Idempotent: never re-emails about the same build.
import { config } from "./config.js";
import { query, hasDb } from "./db.js";
import { predictNextOS } from "./predict.js";
import { deliver, windowAlertMessage } from "./mailer.js";

// Pure decision: should we email this subscriber now? Kept separate so it's unit-testable.
// Email when the model puts their next build within `windowDays` (and not long past), AND we
// haven't already alerted them about that exact target build.
export function shouldAlert(pred, lastNotifiedVersion, windowDays = 10) {
  if (!pred || pred.capped || pred.unavailable) return false;
  if (!pred.targetLabel || pred.daysToMedian == null) return false;
  if (pred.daysToMedian > windowDays || pred.daysToMedian < -30) return false;   // close, not ancient
  if (lastNotifiedVersion && lastNotifiedVersion === pred.targetLabel) return false; // already told them
  return true;
}

export async function runSubscriberAlerts({ windowDays = 10 } = {}) {
  if (config.mockMode || !hasDb()) return { sent: 0, checked: 0, mock: true };
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
      });
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
