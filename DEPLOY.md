# Deploying wenFSD

The whole app (dashboard + API + poller) is **one Node service** in [`server/`](server/) that
also serves the static frontend. It runs in **MOCK mode** with zero credentials, so you can
deploy *today* and flip to real Tesla data once your Fleet API access is approved.

## Order of operations (the realistic path)

1. **Push to GitHub** — this folder is already a git repo. Create an empty GitHub repo and:
   ```bash
   git remote add origin https://github.com/<you>/wenfsd.git
   git push -u origin main
   ```

2. **Apply for Tesla Fleet API access** at https://developer.tesla.com — *start this first, it
   gates everything and can take a while.* Create an app, set redirect URI
   `https://wenfsd.com/auth/callback`, request scope `vehicle_device_data`. (Details:
   [server/README.md](server/README.md).)

3. **Deploy the service** (pick one — both read the configs already in `server/`):
   - **Railway:** New Project → Deploy from GitHub → set **Root Directory** = `server` → add the
     **PostgreSQL** plugin (auto-sets `DATABASE_URL`). Config: [`server/railway.json`](server/railway.json).
   - **Render:** New → Blueprint → pick the repo. [`server/render.yaml`](server/render.yaml)
     provisions the web service + free Postgres automatically.

4. **Set env vars** (in the host's dashboard): `MOCK_MODE=false`, `PUBLIC_BASE_URL=https://wenfsd.com`,
   `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `TESLA_REDIRECT_URI`. `SESSION_SECRET` and
   `DATABASE_URL` are generated for you.

5. **Point the domains** — `wenfsd.com` → the service (add it as a custom domain in Railway/Render,
   set the DNS record they give you). `wenfsd.info` makes a good staging/redirect domain.
   Then generate the Tesla key pair and register the domain (one `openssl` + one call — see
   [server/README.md](server/README.md)). The public key is auto-served at
   `https://wenfsd.com/.well-known/appspecific/com.tesla.3p.public-key.pem`.

6. **Migrate + go live:** `npm run migrate` once, then redeploy with `MOCK_MODE=false`. The poller
   starts on its cron; owners can hit **Connect Tesla account** in the dashboard.

## What I can't do for you
Deploying to *your* Railway/Render account, registering the *Tesla* app, and pointing *your* DNS
all require your logins — those steps are yours. Everything code-side (configs, OAuth flow,
poller, schema, health checks) is done and verified in mock mode.
