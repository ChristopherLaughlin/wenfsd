# wenFSD — Activation & Admin Guide

Everything here is **configuration, not code**. You add variables in **Railway**; it redeploys
itself (~1 min). You never have to touch the codebase or run a deploy by hand.

> **Status:** your site is already **live and in real mode** (`wenfsd.info/healthz` → `mock:false`).
> The hard part (database, Tesla auth, encryption, session) is **already configured** — predictions,
> logins, and user alerts work today. This guide is only the *owner* switches you haven't flipped yet.

---

## 🔐 Three security rules (read once — they make this safe)

1. **Secrets live only in Railway → Variables.** Never in the repo, a commit, a screenshot, or a
   chat message. (The repo's `.env` files are git-ignored; the app reads everything from the host env.)
2. **Generate strong values with the commands below** — don't hand-pick them.
3. **If a value is ever seen anywhere it shouldn't be, rotate it:** change it in Railway → Save →
   it redeploys → the old value is dead. (No system is ever "100% secure," but rotate-on-exposure +
   strong random secrets + HTTPS is the standard that keeps it locked down.)

**Where to set any variable:** [railway.app](https://railway.app) → your **wenFSD** project → click the
**service** → **Variables** tab → **New Variable** → name + value → **Add**. It auto-redeploys.

---

## ⚡ The 5‑minute setup — dashboard + phone alerts

This is all most owners ever need. Two variables.

### 1) `ADMIN_TOKEN` — turns on your dashboard
- **Generate a value:**
  ```
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
  ```
- In Railway, add variable **`ADMIN_TOKEN`** = *(that value)*.
- After it redeploys, open **`https://wenfsd.info/admin`** and paste the **same** value. You're in.
  (Until this is set, `/admin` returns 404 on purpose — no token, no dashboard.)

### 2) `NOTIFY_WEBHOOK_URL` — buzzes your phone the moment something needs review
There's no magic push — the app sends an HTTP POST to a URL **you** provide, and that URL belongs to
a push app. Easiest is **ntfy** (free, no account):
- Install the **ntfy** app (iOS / Android).
- Generate an **unguessable topic name** (this acts like a password — see security note):
  ```
  node -e "console.log('wenfsd-'+require('crypto').randomBytes(6).toString('hex'))"
  ```
- In the ntfy app, tap **+** and subscribe to that topic.
- In Railway, add variable **`NOTIFY_WEBHOOK_URL`** = `https://ntfy.sh/<that-topic>`.

> Prefer Slack or Discord? Create an **Incoming Webhook** in either and paste *its* URL instead —
> same variable, works the same way.

### ✅ Test it end‑to‑end (no real pause needed)
On the live site, scroll to **Community → "📡 Seen a rollout change?"**, submit any quick report.
Within seconds: your **phone buzzes**, and the report shows up in **`/admin`** as a **pending** event
to **✓ Confirm** or **✕ Dismiss**. That proves the whole chain.

---

## ✉️ Optional — email alerts as well as (or instead of) the webhook
- Add **`OWNER_EMAIL`** = your address.
- Email needs a verified sender: **`RESEND_API_KEY`** + **`NOTIFY_FROM_EMAIL`** (set up at
  [resend.com](https://resend.com)). **If you already receive the user "your update window is opening"
  emails, these two are already set** — you only need to add `OWNER_EMAIL`.

## 🔔 Optional — web push for your *users* (the PWA "🔔 Push to this device" button)
- Generate keys:
  ```
  npx web-push generate-vapid-keys
  ```
- Add **`VAPID_PUBLIC_KEY`**, **`VAPID_PRIVATE_KEY`**, and **`VAPID_SUBJECT`** = `mailto:you@yourdomain`.
- Keep the keys stable once users subscribe (regenerating invalidates their subscriptions).

## 🛰️ Optional — automatic pause detection + live tracker data
- Add **`ALLOW_LIVE_SOURCES`** = `true`.
- Every ~6 h, wenFSD pulls the public trackers and **auto‑queues a `pending` pause** when a rollout's
  install rate flatlines — you still confirm it in `/admin`. Without this, you rely on community
  reports + manual entry. (No rumor ever goes live unconfirmed either way.)

---

## 📋 Full variable reference

**Already set (real mode) — don't change:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (stores predictions, subscribers, events) |
| `SESSION_SECRET` | signs the login cookie (≥32 random chars) |
| `TOKEN_ENC_KEY` | AES‑256 key encrypting Tesla tokens at rest |
| `TESLA_CLIENT_ID` / `TESLA_CLIENT_SECRET` | Tesla OAuth app credentials |
| `PUBLIC_BASE_URL` | `https://wenfsd.info` (canonical host) |

**Owner features (this guide):**

| Variable | Turns on | Required value |
|---|---|---|
| `ADMIN_TOKEN` | the `/admin` dashboard | strong random string |
| `NOTIFY_WEBHOOK_URL` | phone push on pending events | an ntfy / Slack / Discord webhook URL |
| `OWNER_EMAIL` | email on pending events | your email (needs Resend, below) |
| `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` | any email sending | from resend.com + a verified sender |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | user web‑push | `npx web-push generate-vapid-keys` |
| `ALLOW_LIVE_SOURCES` | auto pause‑detection + live trackers | `true` |

*(Other optional knobs read by the app: `PORT`, `POLL_CRON`, `DATABASE_CA`, `TESLA_*` endpoint
overrides. Defaults are fine — leave them unless you have a specific reason.)*

---

## 🔐 Security checklist

- [ ] **Secrets only in Railway Variables** — never committed, screenshotted, or pasted into chat.
      (The repo's `.env` is git-ignored; verified.)
- [ ] **`ADMIN_TOKEN` is long + random** (the generator above = 24 random bytes). The server compares
      it in **constant time**, accepts it **only via the request header** (never a URL, so it can't
      leak through logs/referrers), and `/admin` is **disabled (404) when it's unset**. You only ever
      paste it over **HTTPS**, and the browser keeps it in `sessionStorage` (gone when the tab closes).
- [ ] **ntfy topic name is random/unguessable.** Public ntfy topics are readable by anyone who knows
      the exact name — so treat the topic like a password. The alert itself only contains a
      version/region + an `/admin` link, and **that link is useless without `ADMIN_TOKEN`**, so even a
      leaked topic can't reach your dashboard. For stricter privacy, use a **private Slack/Discord
      webhook** or **ntfy with auth / self-hosted**.
- [ ] **Never set `DATABASE_SSL_INSECURE`.** (It disables DB TLS verification — escape hatch only.)
- [ ] **Rotate on exposure:** change the value in Railway → Save → redeploy. For `ADMIN_TOKEN` you'll
      just re-paste the new one at `/admin`.
- [ ] Already enforced for you: **HTTPS + HSTS preload**, strict CSP, `httpOnly`/`secure`/`SameSite=lax`
      cookies, rate limiting, and same-origin CSRF protection. You don't need to configure these.

---

## TL;DR for right now
1. Generate an `ADMIN_TOKEN`, add it in Railway → open `/admin` and paste it.
2. Make an ntfy topic, set `NOTIFY_WEBHOOK_URL` → submit a test report on the site → phone buzzes.

That's the whole owner workflow: **get pinged → open `/admin` → Confirm/Dismiss.**
