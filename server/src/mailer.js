// Notification delivery — deliberately transport-agnostic and dependency-free.
// If NOTIFY_WEBHOOK_URL is set, we POST the event as JSON (point it at your email provider,
// a serverless function, Zapier/Make, ntfy, Discord, etc.). If not, we log and no-op — so the
// feature is safe to ship before any provider is wired, and never blocks the poller.
import { config } from "./config.js";

export async function deliver({ to, subject, text, event, from }) {
  // Provider order: a real email sender (Resend HTTP API) if configured, else a generic webhook,
  // else log-only. All dependency-free (plain fetch). Pick whichever you've set env for.
  // `from` lets the OWNER alert use Resend's no-setup test sender (it only mails the account owner),
  // so owner email works with just RESEND_API_KEY — without verifying a sending domain.
  const sender = from || config.notifyFromEmail;
  if (config.resendApiKey && sender) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.resendApiKey}` },
        body: JSON.stringify({ from: sender, to: [to], subject, text }),
      });
      if (!res.ok) { console.warn(`[notify] resend ${res.status} for ${to}`); return { delivered: false, channel: "resend", status: res.status }; }
      return { delivered: true, channel: "resend" };
    } catch (e) { console.warn(`[notify] resend error for ${to}:`, e.message); return { delivered: false, channel: "resend", error: e.message }; }
  }
  const url = config.notifyWebhookUrl;
  if (!url) {
    console.log(`[notify] (no email provider / webhook configured) would send to ${to}: ${subject}`);
    return { delivered: false, channel: "none" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text, event, sentAt: new Date().toISOString() }),
    });
    if (!res.ok) { console.warn(`[notify] webhook ${res.status} for ${to}`); return { delivered: false, channel: "webhook", status: res.status }; }
    return { delivered: true, channel: "webhook" };
  } catch (e) {
    console.warn(`[notify] webhook error for ${to}:`, e.message);
    return { delivered: false, channel: "webhook", error: e.message };
  }
}

// Build the "your update landed" message body. Pure + tested.
export function arrivalMessage({ nickname, vin, fromVersion, toVersion }) {
  const car = nickname || (vin ? "Tesla " + vin.slice(-6) : "your Tesla");
  return {
    subject: `🚗 ${car} just updated to ${toVersion}`,
    text: `wen FSD? Now. ${car} moved from ${fromVersion || "an earlier build"} to ${toVersion}. `
      + `Open wenFSD to see what's in it and what's predicted next. `
      + `(You're getting this because you asked to be told the moment your update lands. Turn it off anytime in your garage.)`,
  };
}

// "Your window is opening" alert — the trigger that brings non-connected subscribers back.
// Fired by the daily job when the model puts their next build within the alert window.
export function windowAlertMessage({ version, market, daysToMedian, siteUrl, unsubUrl }) {
  const when = daysToMedian <= 0 ? "any day now" : `in about ${daysToMedian} day${daysToMedian === 1 ? "" : "s"}`;
  return {
    subject: `🔔 Your Tesla update window is opening${version ? ` — ${version}` : ""}`,
    text: `wen FSD? Soon — and that's the closest we ever get to good news. `
      + `Our model now puts ${version || "your next build"}${market ? ` for ${market}` : ""} landing on your car ${when} (the 80% window). `
      + `It's a prediction, not a Tesla promise — but it's close enough to start refreshing the software menu with intent. 📲\n\n`
      + `See your full forecast: ${siteUrl}\n\n`
      + `You're getting this because you asked us to email you when it's close. One click to stop: ${unsubUrl}`,
  };
}

// Double-opt-in confirmation for the no-login email channel. One click to confirm; we send
// nothing else until they do, so we can't be used to spam an address someone else typed in.
export function confirmMessage({ market, confirmUrl, unsubUrl }) {
  const where = market ? ` in ${market}` : "";
  return {
    subject: `Confirm your wenFSD update alerts 🔔`,
    text: `Almost there. Tap to confirm you want wenFSD to email you when your Tesla's next update`
      + ` is close (or when a new build lands${where}):\n\n${confirmUrl}\n\n`
      + `We'll only email you about your updates — never spam, never sold, and you can unsubscribe in one click: ${unsubUrl}\n\n`
      + `Didn't ask for this? Someone probably mistyped their address. Just ignore this — we won't email again unless you confirm.`,
  };
}
