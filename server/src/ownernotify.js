// Owner alerts: ping the creator the moment a rollout event is queued for review, so a pause can be
// confirmed fast instead of waiting for the next /admin visit. Two channels (both optional):
//   • webhook  (NOTIFY_WEBHOOK_URL → Slack/Discord/ntfy/Zapier) — instant phone push
//   • email    (OWNER_EMAIL via the Resend mailer)
// Deduped at the call site (one ping per distinct pause, not per duplicate report).
import { config } from "./config.js";
import { deliver } from "./mailer.js";

const LABEL = { pause: "⏸ PAUSE", halt: "🛑 HALT", resume: "▶️ RESUME", accelerate: "⏩ ACCELERATE", note: "📝 NOTE" };

// Pure — unit-testable. Builds the subject + body the owner sees.
export function ownerAlertMessage(ev) {
  const what = LABEL[ev.type] || String(ev.type || "EVENT").toUpperCase();
  const where = [ev.version || "next build", ev.region || "global"].join(" · ");
  const base = (config.publicBaseUrl || "").replace(/\/$/, "");
  const subject = `wenFSD: ${what} pending review — ${where}`;
  const text =
    `A rollout event is awaiting your confirmation.\n\n` +
    `${what} · ${where}\n` +
    `Source: ${ev.source || "?"}\n` +
    (ev.reason ? `Reason: ${ev.reason}\n` : "") +
    `\nReview (confirm/dismiss): ${base}/admin\n\n` +
    `Nothing changes for users until you confirm it.`;
  return { subject, text };
}

// Fire both configured channels. Never throws (fire-and-forget from request paths).
export async function notifyOwnerOfPending(ev) {
  const msg = ownerAlertMessage(ev);
  const out = { webhook: false, email: false };
  if (config.notifyWebhookUrl) {
    try {
      // keys cover Slack (text), Discord (content), ntfy (title/message) — extras are ignored
      const r = await fetch(config.notifyWebhookUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${msg.subject}\n${msg.text}`, content: `${msg.subject}\n${msg.text}`, title: msg.subject, message: msg.text }),
      });
      out.webhook = !!(r && r.ok);
    } catch (e) { /* best-effort */ }
  }
  if (config.ownerEmail) {
    // owner alert mails only YOU → can use Resend's no-setup sender when no verified domain is set,
    // so it works with just RESEND_API_KEY + OWNER_EMAIL (no DNS/domain verification needed).
    const from = config.notifyFromEmail || "wenFSD alerts <onboarding@resend.dev>";
    try { const r = await deliver({ to: config.ownerEmail, subject: msg.subject, text: msg.text, event: "owner_event_pending", from }); out.email = !!(r && r.delivered !== false); }
    catch (e) { /* best-effort */ }
  }
  if (!out.webhook && !out.email) console.log("[owner-notify] no channel configured — would alert:", msg.subject);
  return out;
}
