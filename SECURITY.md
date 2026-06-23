# Security & Privacy Policy

wenFSD predicts when your Tesla will get its next software/FSD update. This document explains
exactly what data it touches, how it's protected, and how to report a security issue.

If you find a vulnerability, please report it responsibly (see [Reporting](#reporting-a-vulnerability)
below) — thank you for helping keep wenFSD safe.

---

## What wenFSD accesses (and what it deliberately doesn't)

You can use wenFSD **without any login at all** — "Add by VIN" gives you the full prediction and
grants zero account access. Connecting your Tesla account is an optional convenience that
auto-reads your software version.

If you *do* connect your Tesla account:

- **Login is on Tesla's own page** via official OAuth (PKCE + single-use state). wenFSD never
  sees your Tesla password — it only ever receives an access token.
- **Scope requested:** `openid offline_access vehicle_device_data` — and nothing else. We do
  **not** request Tesla's separate `vehicle_location` scope, nor any command/charging scope.
- **Why Tesla's consent screen looks broad:** Tesla's permissions are coarse. `vehicle_device_data`
  is the *narrowest* read scope that includes the software version, and Tesla's consent screen
  describes everything that scope *could* cover (location, ownership, superchargers, service) —
  **not** what wenFSD actually fetches. Every app that reads your version sees the same screen.
- **What the code actually fetches:** exactly one data call —
  `GET /api/1/vehicles/{vin}/vehicle_data?endpoints=vehicle_state` — which returns your software
  version (`car_version`) and any pending-update status (`software_update`). It never calls the
  location, drive, charge, supercharger, or ownership endpoints. (Search this repo for
  `vehicle_data` — you'll find one call.)
- **It cannot command your car.** With no `vehicle_cmds` / `vehicle_charging_cmds` scope, the grant
  has no ability to drive, steer, unlock, open, honk, or charge.

## What wenFSD stores

- **OAuth tokens:** encrypted at rest with **AES-256-GCM** (key from the `TOKEN_ENC_KEY` env var),
  transmitted only over HTTPS.
- **Per vehicle:** software version, region/market, hardware generation, and any pending update.
  **No location, no trip history, no odometer, no ownership records** — there is no such column in
  the schema (`server/db/schema.sql`).
- **Per user:** your Tesla account id and the email from the OIDC login.
- **Email alerts (no-login):** if you ask us to email you when your update's close, we store your
  email + your car's region/hardware/version (to know what to alert on) — double opt-in, so we
  can't be signed up by someone else. **Unsubscribing erases the record entirely** (a hard delete,
  not a flag).
- **Web-push alerts (no-login):** if you enable browser/PWA push, we store only the browser's push
  endpoint + its public keys and your car's region/hardware/version — no email, no PII. Turning
  push off (or the browser expiring the subscription) **deletes the record**.
- **Sharing is opt-in and off by default.** Your handle, car, or notes only appear on the public
  leaderboard/community views if you explicitly enable public sharing.
- **No cookies, no third-party trackers, no analytics SDKs.** Aggregate visit counts use a salted
  daily hash of IP + user-agent (not the IP itself, not reversible, pruned after 90 days).

## Your controls

- **Disconnect** in-app at any time, or **delete all your data** with one click.
- **Revoke wenFSD entirely** from your Tesla Account → Security → Third-Party Apps.
- **Or never connect** — use Add by VIN and grant nothing.

## How access is protected (server)

- HTTPS enforced (HTTP → HTTPS redirect) with HSTS.
- Security headers via `helmet`, including a strict Content-Security-Policy.
- Rate limiting on API and auth routes.
- OAuth tokens encrypted at rest; DB connections support a verified TLS CA.
- Static serving is allow-listed — server source, keys, and dotfiles are never served.
- The creator dashboard (`/admin`) is gated by an `ADMIN_TOKEN` (constant-time comparison) and is
  disabled entirely when that variable is unset.

## Automated security checks (CI)

Every push and pull request to `main` runs, via GitHub Actions:

- **Test suite** (`npm test`) — including [`server/test/security.test.js`](server/test/security.test.js),
  which asserts token encryption round-trips + tamper-detection, PKCE/`state` correctness, that the
  authorize URL never carries the client secret, and that only a read-only scope is requested.
- **Dependency audit** (`npm audit --audit-level=high`) — a high/critical advisory fails the build;
  this also runs on a **daily schedule** so a newly-disclosed CVE is caught even without a push.
- **CodeQL** static analysis (`security-extended` queries) — results in the repo's
  **Security → Code scanning** tab.
- **Dependabot** opens PRs for vulnerable/outdated npm packages and GitHub Actions.

With branch protection on `main`, a failing check blocks the merge (rather than auto-disabling the
live site, which would turn any false positive into self-inflicted downtime).

---

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

**Preferred:** use GitHub's private vulnerability reporting —
**Security** tab → **Report a vulnerability** (GitHub Security Advisories).
> Maintainer note: enable this once under repo **Settings → Code security and analysis →
> Private vulnerability reporting**.

If that's unavailable, contact the maintainer privately via their GitHub profile rather than a
public issue.

**Please include:** a description, steps to reproduce, affected URL/endpoint, and the impact.
Please give us a reasonable window to fix it before any public disclosure.

**Scope (in):** this application's web app and API (`wenfsd.info`), the server in this repo, auth
and data-handling flows.
**Out of scope:** Tesla's own systems and the third-party trackers wenFSD aggregates; report those
to the respective owners. Volumetric DoS, social engineering, and findings that require a
physically compromised device are also out of scope.

## Response targets

This is a free, open-source side project, so these are good-faith targets, not contractual SLAs —
but we take them seriously:

| Stage | Target |
|---|---|
| Acknowledge your report | within **3 business days** |
| Triage + initial severity | within **7 days** |
| Fix or mitigation for High/Critical | within **30 days** |
| Coordinated public disclosure | by mutual agreement — typically **after a fix ships** (or 90 days, whichever comes first) |

**Rewards:** there's no paid bounty (the site is free and ad-free), but every valid, good-faith
report is credited in the release notes / a security hall-of-fame, unless you'd prefer to stay
anonymous. The machine-readable contact lives at
[`/.well-known/security.txt`](https://wenfsd.info/.well-known/security.txt) (RFC 9116).

## Good-faith research

We won't pursue or support action against researchers who:
- act in good faith and avoid privacy violations, data destruction, or service disruption;
- only interact with their **own** account/data (never another user's);
- give us a reasonable chance to remediate before disclosing.

Thanks for keeping wenFSD honest. 🙏
