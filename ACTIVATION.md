# wenFSD — Owner Setup (just 2 things, done once)

You set a few **variables** in Railway. That's the whole job — no code, no commands you have to run.

**Where:** [railway.app](https://railway.app) → your **wenFSD** project → click the **service** →
**Variables** tab → **New Variable** → type a name + value → **Add**. It restarts itself (~1 min).

---

## 1️⃣ Log into your dashboard

1. Add one variable:
   - **Name:** `ADMIN_TOKEN`
   - **Value:** a long random string (≈30 characters). Use a password manager's "generate password",
     or the one your assistant gave you. *This is the only thing protecting your dashboard — keep it private.*
2. Go to **`https://wenfsd.info/admin`**, paste the **same** value, click **Log in**.
3. **Bookmark that page.** You're now logged in on this device **and you stay logged in** — no
   re-entering it next time. (To log out: there's a "Forget my token" button at the bottom.)

That's the dashboard done.

---

## 2️⃣ Get an email when something needs your attention

1. Go to **[resend.com](https://resend.com)** → sign up free **with your own email address**.
2. In Resend: **API Keys → Create API Key** → copy the key (starts with `re_…`).
3. Add two variables in Railway:
   - **Name:** `RESEND_API_KEY` **Value:** *(the `re_…` key)*
   - **Name:** `OWNER_EMAIL` **Value:** *(your email — the same one you signed up to Resend with)*

Done. Now, whenever a rollout pause is detected or someone reports one, **you get an email** with a
one-line summary and a link to your dashboard to confirm or dismiss it. **No domain or DNS setup** —
it emails you from Resend's own address.

---

## ✅ Test it (1 minute)

After both are set: open the site → scroll to **Community → "📡 Seen a rollout change?"** → type
anything → **Report it**. Within a minute you should get an **email**, and it appears in your
**dashboard** as a pending item to **✓ Confirm** or **✕ Dismiss**. That proves it all works.

---

## 🔐 Is it secure?

Yes, by design — the important bits:
- These values live **only in Railway**, never in the website's code (so they can't leak from the repo).
- Your `ADMIN_TOKEN` is checked securely on the server, only accepted from the dashboard page over
  **HTTPS**, and the dashboard is completely **disabled** until you set it. Keep the token private
  (don't paste it in emails/chats); if it's ever exposed, just change the variable in Railway and
  re-paste the new one.
- The email only ever goes to **your** address (`OWNER_EMAIL`).

No system is literally "100% secure," but strong-random token + Railway-only secrets + HTTPS is the
standard that keeps this locked down.

---

<details>
<summary>Optional extras (ignore these unless you want them later)</summary>

- **Phone push** instead of / as well as email — set `NOTIFY_WEBHOOK_URL` to a Slack, Discord, or
  ntfy webhook URL. (Email is simpler; only do this if you'd rather get a push.)
- **Web push for your users** (the "🔔 Push to this device" button) — run `npx web-push generate-vapid-keys`
  and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- **Automatic pause detection from the trackers** — set `ALLOW_LIVE_SOURCES` = `true` (otherwise you
  rely on community reports + your own manual entries; both still work).
- **Send emails from your own domain** (e.g. `updates@wenfsd.info` instead of Resend's address) — verify
  your domain in Resend, then set `NOTIFY_FROM_EMAIL`. Purely cosmetic; not required.

Already configured and working — you don't touch these: `DATABASE_URL`, `SESSION_SECRET`,
`TOKEN_ENC_KEY`, `TESLA_CLIENT_ID/SECRET`, `PUBLIC_BASE_URL`.
</details>
