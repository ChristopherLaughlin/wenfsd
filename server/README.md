# wenFSD backend

Node + Express + PostgreSQL service that turns wenFSD into a real, crowdsourced Tesla
update tracker: owners link their Tesla account (OAuth), a cron job polls each car's
software version via the **Tesla Fleet API**, and the data feeds the fleet tracker, live
feed, and per-VIN predictions.

It serves the existing static frontend (the repo root) and exposes a JSON API the
dashboard hydrates from ([js/api.js](../js/api.js)).

---

## Run it locally in 60 seconds (MOCK mode — no Tesla account needed)

```bash
cd server
cp .env.example .env        # MOCK_MODE=true is the default
npm install
npm start                   # → http://localhost:8787  (serves the dashboard + mock API)
```

In mock mode there's **no database and no Tesla calls** — the API returns seed data, so
you can develop and deploy the whole stack before Tesla approves your Fleet API access.
The dashboard's [js/api.js](../js/api.js) will hydrate from `/api/*` and log
`hydrated from live API (source: mock backend)`.

---

## Going real — the checklist

Real mode needs three things: **a domain** (you have wenfsd.com), a **Tesla developer
app**, and a **Postgres database**. Tesla's approval is the long pole — start it first.

### 1. Tesla developer app
1. Sign in at **https://developer.tesla.com** and create an application.
2. Set the **Allowed Redirect URI** to `https://wenfsd.com/auth/callback`.
3. Request scopes: `openid offline_access vehicle_device_data` (read-only is enough).
4. Copy your **Client ID** and **Client Secret** into `.env`.

### 2. Host your public key (domain verification)
Tesla trusts your app only after it can fetch your public key from your domain:

```bash
mkdir -p server/keys
openssl ecparam -name prime256v1 -genkey -noout -out server/keys/private-key.pem
openssl ec -in server/keys/private-key.pem -pubout -out server/keys/public-key.pem
```

The server already serves it at the required path:
`https://wenfsd.com/.well-known/appspecific/com.tesla.3p.public-key.pem`.
Then register your domain once (with `MOCK_MODE=false` and creds set):

```js
// node --input-type=module -e "import('./src/tesla.js').then(t=>t.registerPartnerDomain('wenfsd.com')).then(console.log)"
```

### 3. Database + deploy (Render or Railway)
- **Render:** New → Blueprint → point at this repo. [`render.yaml`](render.yaml) provisions a
  web service + free Postgres and wires `DATABASE_URL`. Add `TESLA_CLIENT_ID` / `_SECRET`
  in the dashboard (they're marked `sync:false`).
- **Railway:** New project → deploy `/server` → add the **PostgreSQL** plugin (sets
  `DATABASE_URL`) → set the env vars from `.env.example`.

Then apply the schema and flip to real mode:

```bash
npm run migrate            # creates tables from db/schema.sql
# set MOCK_MODE=false, redeploy
```

The poller starts automatically on the `POLL_CRON` schedule (default every 30 min).
Run one cycle manually with `npm run poll`.

---

## API

| Endpoint | What it returns |
|---|---|
| `GET /api/fleet/firmware` | version distribution (version, fleet %, first seen, fitted t0/k) |
| `GET /api/fleet/firmware?merged=1` | fleet-weighted consensus merged across all external trackers (+ release notes) |
| `GET /api/sources` | status of each external tracker source (Teslascope/TeslaFi/Tessie/TeslaUpdates/FleetCtrl) |
| `GET /api/fleet/feed` | recent version-change events |
| `GET /api/stats` | fleet totals |
| `GET /api/me/vehicles` | the signed-in owner's linked vehicles |
| `GET /api/predict?vin=…&target=standard\|fsd` | prediction (median date, 80% window, within-7/14/30) |
| `GET /auth/login` → `…/callback` | Tesla OAuth link flow |
| `GET /healthz` | liveness + mock flag |

## External tracker ingestion
We don't have a large fleet of our own yet, and owners won't leave their existing tracker —
so wenFSD **aggregates** the public trackers. `src/sources/*` has one adapter per tracker
(Teslascope, TeslaFi, Tessie, Tesla Updates, FleetCtrl); `src/sources/index.js` merges them
**fleet-weighted** (Tessie's ~630k cars outweigh TeslaFi's ~13k), unions release notes, and
records which sources contributed. Run `npm run sources` (add `--live` once adapters are
wired to the real endpoints — respect each site's ToS/robots.txt). A cron refreshes a few
times a day in real mode.

## How prediction uses real data
1. The poller logs a `version_snapshots` row whenever a car's `car_version` changes.
2. `recomputeAggregates()` fits a logistic `(t0, k)` per version from the snapshot timeline.
3. A vehicle's **earliness percentile** is estimated from where its own updates landed
   relative to each version's fitted midpoint (`src/predict.js → estimateEarliness`).
4. `GET /api/predict` runs the Monte Carlo with those real parameters.

## Security notes (before real launch)
- Encrypt `oauth_tokens` at rest (pgcrypto or app-level KMS) — they're currently plaintext.
- Add per-user rate limiting and CSRF protection on `/auth`.
- Treat the EC private key as a secret (it's gitignored).
- Make `opted_in` an explicit consent toggle in the UI before aggregating a car's data.
