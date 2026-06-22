# Contributing to wenFSD

Thanks for helping out. Because wenFSD touches Tesla OAuth, `main` is protected and changes
ship through a small, gated pull-request flow. It takes about 20 seconds of extra ceremony per
change and means a broken test or a known vulnerability can never reach production.

The model is the product, and it's **public on purpose** — read it, poke holes in it, prove it
wrong, send better data. Sections below cover the maths and the data loop; the security/PR flow
follows.

## The model (what you're actually contributing to)

A Tesla firmware version doesn't land on every car at once — it spreads through the fleet in a
staged, VIN-gated A/B wave shaped like an **S-curve**. wenFSD models that curve, works out where
*your* car sits in line, and reports a **distribution of dates** rather than a single confident lie.

1. **Adoption is logistic:** `adoption(t) = L / (1 + e^(−k·(t − t₀)))`, where `t₀` is the wave's
   50%-midpoint and `k` is the ramp steepness.
2. **You update when the wave reaches your percentile `p`:** solve for `t` →
   `t_you = t₀ + ln(p/(1−p))/k`. Low `p` = early car (Early Access, lucky VIN block); high `p` = you wait.
3. **Region lag:** RHD/Australian waves start after the US baseline (`osLag` days). AU FSD also sits
   behind a **regulatory-approval gate** modelled as a triangular window — that gate, not the
   rollout, is the dominant uncertainty for AU FSD.
4. **Monte Carlo, not a point estimate:** `mcPredict` samples `k`, `t₀`, `p` and the region/gate
   terms thousands of times → median, an 80% band (`±1.2816·σ`), and a per-day histogram. The single
   date is just the median of that cloud; the band is the honest part.

**The two-track invariant — read before touching FSD.** FSD ships *inside* OS builds, and most OS
builds don't change the FSD version, therefore **FSD can never arrive before the OS build that
carries it.** `predictNextFSD` encodes a precedence ladder (`capped → promised → gated →
notEntitled → bundled/forthcoming → current → sameFsd`); when the next build carries a newer FSD,
the FSD date is pinned to the OS date (`bundleWithNext`). Change one branch, walk the others.
`predict.test.js` ("FSD never before software") fails loudly if you break it.

**Observed beats modelled.** Two signals override the curve when present: `pendingOverride`
(a *connected* car reporting a pending OTA returns a tight "confirmed" date — the car knows better
than the curve) and `fitRollout` (≥8 real install timings recover `k`/`t₀` by OLS of
`logit(plotting-position)` on day, instead of a prior).

### Parity rule

The model is mirrored in two files that **must agree**: [`js/predict.js`](js/predict.js) (browser)
and [`server/src/predict.js`](server/src/predict.js) (backend); and [`js/data.js`](js/data.js) must
match [`shared/wenmodel.json`](shared/wenmodel.json). [`server/test/parity.test.js`](server/test/parity.test.js)
deep-compares them. Change the model in one place, change it in both. There is no build step and no
`fetch` in the frontend — files load via classic `<script>` tags sharing a bareword global `WEN`
(*not* `window.WEN`). Keep it that way.

## The data loop (why your contribution matters)

The model starts from priors and gets *good* from real data:

```
you connect / log history → real install dates → version_snapshots
   → fitRollout recovers k & t₀ → scoreboard shows the error → next prediction is fit, not guessed
```

Three ways to feed it: **(1)** log your real update history in the garage (no account needed) — we
estimate your percentile from where updates actually landed; **(2)** connect your Tesla (backend
OAuth) so the poller records version changes and can ping you when one lands; **(3)** open a PR
correcting `shared/wenmodel.json` when a wave moves. The back-test **scoreboard** (coverage %,
median absolute error, fitted-build count) keeps us honest — we never invent those numbers.

You don't even need to read JavaScript to challenge it: the site exports the whole model as a
spreadsheet (`Download .xlsx`, built by [`js/modelsheet.js`](js/modelsheet.js)) with a live
Calculator sheet. Change `p`/`k`/`t₀`/region lag and watch the date move. If the sheet and the site
disagree, that's a bug — file it. The model is also served as JSON at `/model.json`.

## The flow

```bash
# 1. branch off main
git checkout main && git pull
git checkout -b my-change

# 2. make your change, then run the same checks CI will run
cd server
npm test                              # unit + security tests
npm audit --omit=dev --audit-level=high   # fails on a high/critical advisory
cd ..

# 3. push the branch and open a PR
git push -u origin my-change
gh pr create --fill          # or open the PR from the GitHub UI
```

Then on the PR, GitHub runs the checks automatically. **Merge only when they're green** —
the branch ruleset on `main` blocks the merge until they pass.

## What runs on every PR (and push to `main`)

| Check | What it guards | Where it's defined |
|-------|----------------|--------------------|
| **test** | unit + security tests (token encryption, OAuth/PKCE, read-only scope) | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) → [`server/test/`](server/test/) |
| **audit** | `npm audit` — fails on a high/critical advisory; also runs daily | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| **CodeQL** | static security analysis (default query suite) | [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) |
| **deploy** *(gated)* | ships to Railway **only** after `test` + `audit` pass | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens PRs for vulnerable or
outdated dependencies; treat its security PRs as high priority.

## Ground rules

- **Don't weaken a security check to make a build go green.** Fix the finding, or pin/upgrade the
  dependency. If a finding is a confirmed false positive, document why in the PR.
- **Keep `shared/wenmodel.json` and `js/data.js` in sync** — `server/test/parity.test.js` fails if
  the region/version data drifts between them.
- **Never commit secrets.** Tokens, keys, and `TOKEN_ENC_KEY` live in environment variables only.
- Security issues: please report privately — see [`SECURITY.md`](SECURITY.md), not a public issue.
