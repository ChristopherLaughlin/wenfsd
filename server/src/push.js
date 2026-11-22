// Web-push channel for no-login subscribers — the same "your window is opening" trigger as the
// email job, delivered as a browser/PWA push. Dormant unless VAPID keys are configured.
import webpush from "web-push";
import { config, pushEnabled } from "./config.js";
import { query, hasDb } from "./db.js";
import { predictNextOS } from "./predict.js";
import { shouldAlert } from "./subscribers.js";

let _configured = false;
function ensureVapid() {
  if (_configured || !pushEnabled()) return pushEnabled();
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  _configured = true;
  return true;
}

// Only the browser vendors' push services are valid endpoints (Chrome/Edge/Android → FCM, Firefox →
// Mozilla autopush, Safari → Apple, legacy Edge/Windows → WNS). Anything else is not a real
// PushSubscription, and we don't want the server making requests to arbitrary hosts.
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];
export function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  let u; try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((sfx) => host.endsWith(sfx));
}
// upper bound on stored subscriptions (the table is written by an unauthenticated endpoint)
export const MAX_PUSH_SUBSCRIPTIONS = 50000;

// Validate the PushSubscription shape the browser hands us (defends the DB write).
export function isValidSubscription(s) {
  return !!(s && isAllowedPushEndpoint(s.endpoint)
    && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string"
    && s.keys.p256dh.length <= 256 && s.keys.auth.length <= 256);
}

// Send one push. Returns { ok } or { gone:true } if the subscription is dead (404/410) so the
// caller can prune it.
export async function sendPush(sub, payload) {
  if (!ensureVapid()) return { ok: false };
  // rows stored before the allow-list existed: never contact them, let the caller prune
  if (!isAllowedPushEndpoint(sub.endpoint)) return { ok: false, gone: true };
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    const code = e && e.statusCode;
    if (code === 404 || code === 410) return { ok: false, gone: true };
    return { ok: false };
  }
}

export async function runPushAlerts({ windowDays = 10 } = {}) {
  if (!pushEnabled() || config.mockMode || !hasDb()) return { sent: 0, checked: 0, disabled: !pushEnabled() };
  ensureVapid();
  const ev = await query(`SELECT type, version, region, reason, source, effective_at, detected_at FROM rollout_events WHERE status='confirmed' AND (expires_at IS NULL OR expires_at > now())`).catch(() => null);
  const events = (ev && ev.rows) || [];
  const subs = (await query(
    `SELECT endpoint, p256dh, auth, market, hardware, version, last_notified_version FROM push_subscriptions`)).rows;
  const base = config.publicBaseUrl.replace(/\/$/, "");
  let sent = 0;
  for (const s of subs) {
    let pred;
    try {
      pred = predictNextOS({
        market: s.market || "Australia", hardware: s.hardware || "AI4",
        installedVersion: s.version || undefined, earliness: 0.5, earlinessSource: "default",
        // real current date, not the frozen snapshot clock — so "your update is close" fires on the
        // actual day rather than days off as the data snapshot ages.
      }, { events, today: new Date().toISOString().slice(0, 10) });
    } catch { continue; }
    if (!shouldAlert(pred, s.last_notified_version, windowDays)) continue;
    const days = Math.max(0, Math.round(pred.daysToMedian));
    const payload = {
      title: "🔔 Your Tesla update is close",
      body: `${pred.targetLabel} looks likely for your ${s.market || "car"} in ~${days} day${days === 1 ? "" : "s"}. Tap to see the window.`,
      url: base + "/",
    };
    const r = await sendPush(s, payload);
    if (r.gone) { await query(`DELETE FROM push_subscriptions WHERE endpoint=$1`, [s.endpoint]); continue; }
    if (r.ok) { await query(`UPDATE push_subscriptions SET last_notified_version=$1 WHERE endpoint=$2`, [pred.targetLabel, s.endpoint]); sent++; }
  }
  return { sent, checked: subs.length };
}
