# wenFSD 🚗⚡

**Predict when your Tesla gets its next software update — including FSD v14 in Australia.**

wenFSD models Tesla's over-the-air rollout as a logistic S-curve, places *your specific car*
on that curve by its historical "rollout percentile," layers on Australian regional lag and an
FSD regulatory-approval gate, then runs a Monte Carlo to produce a **probability distribution**
of arrival dates — not a single guess. Tuned for a **2026 Model Y (Juniper)** in Australia.

## Run it

No build step, no dependencies, no server required (uses plain `<script>` tags, no `fetch`/modules):

```bash
# simplest — just open the file
open index.html
```

Or serve it (pick any free port — 4173 may be taken by the live preview):

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## What it does

| Feature | wenFSD | Teslascope / TeslaFi / Tessie |
|---|---|---|
| Fleet firmware distribution (% on each version) | ✅ | ✅ |
| Live update feed | ✅ | ✅ |
| **Predicts when *your* car updates** | ✅ | ❌ |
| **Confidence interval / date distribution** | ✅ | ❌ |
| **Per-VIN rollout-percentile model** | ✅ | ❌ |
| **FSD regulatory-gate model (Australia)** | ✅ | ❌ |
| **Guess-the-date game with scoring** | ✅ | ❌ |

## How the prediction works

1. **Rollout S-curve** — each firmware version spreads through the fleet as
   `adoption(t) = L / (1 + e^(-k(t - t₀)))`.
2. **Your position** — your car updates when adoption reaches your rollout percentile *p*:
   `t_you = t₀ + logit(p)/k`. Earlier-than-average cars have low *p*.
3. **Regional lag** — Australia/RHD waves start later than the US baseline.
4. **FSD gate** — FSD (Supervised) can't roll out in AU until regulators approve. wenFSD models
   the approval date as a triangular window (the dominant uncertainty), then the rollout wave on top.
5. **Monte Carlo** — thousands of samples over all the above → median date, 80% confidence window,
   and a per-day probability histogram.

## Your garage (VIN + multi-vehicle)

Add vehicles by **VIN** — wenFSD decodes the model, year, plant and **infers the Autopilot
hardware** (AI4/AI3/AI2.5). Vehicles persist in your browser (`localStorage`), and you can
log your **real update history**; wenFSD then estimates your rollout percentile from where
your updates actually landed, instead of a guessed slider.

## Make it real — the backend

[`server/`](server/) is a Node + Express + Postgres service that turns this into a real
crowdsourced tracker: owners link their Tesla account (OAuth), a cron polls each car's
software version via the **Tesla Fleet API**, and the dashboard hydrates from its `/api/*`.
Runs in **MOCK mode** with zero credentials so you can develop/deploy before Tesla approves
Fleet API access. Deploy to Railway/Render (see [`server/README.md`](server/README.md)).

```bash
cd server && cp .env.example .env && npm install && npm start   # → http://localhost:8787
```

## Files

- `index.html` / `styles.css` — UI
- `js/data.js` — seed fleet/firmware/FSD data (mid-2026 tracker snapshots, AU-tuned)
- `js/vin.js` — Tesla VIN decoder (model/year/plant + hardware inference)
- `js/garage.js` — persistent multi-vehicle store + history→earliness estimation
- `js/predict.js` — the prediction engine (logistic model + Monte Carlo + guess scoring)
- `js/charts.js` — dependency-free SVG charts
- `js/app.js` — wiring
- `js/api.js` — optional live-data bridge (hydrates from the backend when served by it)
- `server/` — Node/Postgres backend: Tesla OAuth, polling, aggregation + prediction API

> Independent modelling demo. Probabilistic estimates, not Tesla commitments. Not affiliated with
> Tesla, Teslascope, TeslaFi, or Tessie.
