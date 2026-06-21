# wenFSD — Deploy Runbook

A single ordered checklist to take wenFSD from local repo → live on **wenfsd.info** with real
Tesla data. Do the steps in order; **Step 4 (Tesla API application) is the long pole — start it
first in parallel** because approval can take days.

Legend: 🟢 = I can do / have done · 🟡 = you (needs your login or a real-world action)

---

## 0. Accounts you'll need
- 🟢 **GitHub** — authenticated (ChristopherLaughlin).
- 🟡 **Railway** (recommended) or **Render** — sign in with GitHub.
- 🟡 **Tesla developer** account — https://developer.tesla.com
- 🟡 **Domain** — `wenfsd.info` (primary). You also own `wenfsd.com` — optional, can redirect to `.info` later.

---

## 1. 🟢 Push to GitHub
I'll create the repo and push all 16 commits. After that, every `git push` runs the CI
(`.github/workflows/ci.yml`, 19 tests) automatically.

```bash
# (what I run for you)
gh repo create wenfsd --private --source . --remote origin --push
```

## 2. 🟡 Start the Tesla Fleet API application
1. Sign in at **https://developer.tesla.com** → create an application.
2. Fill Registration ("Just for me") + Application Details.
3. **Scopes:** `openid offline_access vehicle_device_data` (read-only is enough).
4. ⚠️ **The "Client Details" domain fields (Allowed Origin / Redirect) will only validate once
   `wenfsd.info` is LIVE with a real TLS certificate.** Tesla checks the cert at entry time.
   So **do Steps 4 + 6 (deploy + DNS) FIRST**, confirm `https://wenfsd.info/healthz` works, then
   come back and enter:
   - Allowed Origin: `https://wenfsd.info`
   - Allowed Redirect: `https://wenfsd.info/auth/callback`
5. Do NOT front the domain with a Cloudflare proxy (orange cloud) — Tesla rejects reverse
   proxies. Railway/Render's own domain + cert is fine.
6. Finish → note your **Client ID** and **Client Secret** (used in Step 5).

## 3. 🟢 Generate the secrets (I'll print these for you to paste)
```bash
openssl rand -base64 48                                  # → SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → TOKEN_ENC_KEY
# Tesla domain key pair:
mkdir -p server/keys
openssl ecparam -name prime256v1 -genkey -noout -out server/keys/private-key.pem
openssl ec -in server/keys/private-key.pem -pubout -out server/keys/public-key.pem
```
`server/keys/*.pem` are gitignored — keep the private key secret; never commit it.

## 4. 🟡 Deploy the service (pick ONE)

### Railway (recommended — simplest)
1. **railway.app** → New Project → **Deploy from GitHub repo** → pick `wenfsd`.
2. Settings → **Root Directory = `server`** (config: `server/railway.json`).
3. **+ New → Database → PostgreSQL** (sets `DATABASE_URL` automatically).
4. Variables → add the env from Step 5.

### Render (alternative)
1. **render.com** → New → **Blueprint** → pick the repo. `server/render.yaml` provisions a
   web service + free Postgres.
2. Add the `sync:false` secrets from Step 5 in the dashboard.

## 5. 🟡 Set environment variables (in Railway/Render)
```
MOCK_MODE=false
PUBLIC_BASE_URL=https://wenfsd.info
SESSION_SECRET=<from step 3>
TOKEN_ENC_KEY=<from step 3>
TESLA_CLIENT_ID=<from step 2>
TESLA_CLIENT_SECRET=<from step 2>
TESLA_REDIRECT_URI=https://wenfsd.info/auth/callback
TESLA_FLEET_BASE=https://fleet-api.prd.na.vn.cloud.tesla.com
TESLA_AUDIENCE=https://fleet-api.prd.na.vn.cloud.tesla.com
# DATABASE_URL is set by the Postgres plugin.
# Leave ALLOW_LIVE_SOURCES unset (sample tracker data) until you've cleared each site's ToS.
```
> Note: AU/APAC uses the `na` fleet host above; EU uses `...eu...`. Confirm in the Tesla portal.

## 6. 🟡 Point the domain
1. In Railway/Render, add **custom domain `wenfsd.info`** → it gives you a CNAME/A record.
2. At your registrar, add that DNS record. Wait for it to verify (minutes–hours).
3. (Optional) add `wenfsd.com` as a second custom domain that redirects to `.info`.

## 7. 🟡 Register your domain with Tesla
Once `wenfsd.info` serves the app, the public key is auto-served at
`https://wenfsd.info/.well-known/appspecific/com.tesla.3p.public-key.pem`. Register the domain:
```bash
# from the deployed server (or locally with real env set):
node --input-type=module -e "import('./server/src/tesla.js').then(t=>t.registerPartnerDomain('wenfsd.info')).then(console.log)"
```

## 8. 🟡 Migrate the database, then go live
```bash
# one-time, against the deployed DATABASE_URL:
npm --prefix server run migrate
```
Confirm `MOCK_MODE=false` and redeploy. The poller starts on its hourly cron (skips sleeping cars).

## 9. ✅ Verify
- `https://wenfsd.info/healthz` → `{"ok":true,"mock":false}`
- The dashboard's data indicator should flip from amber **"sample data"** to **"live fleet data"** once cars/data exist.
- Click **Connect Tesla account**, complete OAuth, confirm a vehicle appears under `/api/me/vehicles`.

## Ops notes
- **Secrets** live only in the host's env + `server/keys` (gitignored). Rotate `SESSION_SECRET`/`TOKEN_ENC_KEY` by setting new values and redeploying (note: rotating `TOKEN_ENC_KEY` invalidates stored tokens — owners re-link).
- **Rollback:** redeploy a previous GitHub commit, or set `MOCK_MODE=true` to serve safe sample data while you debug.
- **CI:** every push runs the test suite; a red check means don't deploy that commit.

## What's still yours (can't be automated)
Creating the Tesla developer app, accepting Tesla's terms, clicking through Railway/Render,
and pointing DNS all require your logins / legal consent.
