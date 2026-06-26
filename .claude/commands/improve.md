---
description: Run up to 10 Council-vetted improvement iterations on wenFSD, report, then improve the loop itself.
---

# wenFSD — perpetual improvement loop (10 iterations)

You are improving **wenFSD** (the Tesla update-prediction site in this repo). Run **up to 10
iterations**. Each iteration ships ONE genuinely valuable, fully-verified improvement. After the
10th — or the moment you honestly run out of high-value work — produce the final report.

## The honest contract (read first)
- "10x in every respect ×10" is not literally achievable, and you will NOT pretend otherwise. The
  goal is the **single highest-value real improvement each iteration**, done safely — not volume.
- **Quality over motion.** A blind loop on an already-polished site produces slop. You will not:
  fabricate data/metrics (the brand is honesty), over-engineer, add dependencies casually, or churn
  things that are defensible as-is just to have a diff.
- **Stop early and say so** if there is no genuinely high-value change left. An honest "iterations
  3–10 would be low-value polish; here's what's actually worth doing next" is a SUCCESS, not a
  failure. Do not invent work to hit 10.
- **But earn the stop — exhaust the checklist first (don't stop early out of laziness).** An honest stop
  comes AFTER you've cleared the concrete, knowable work, not after the first fix. Before declaring done:
  (a) clear every item a PRIOR run consciously DEFERRED ("fix when activated", "noted for later") — a
  deferral is a TODO, not a closed item; (b) DRIVE THE ACTUAL APP in a browser at MOBILE *and* desktop
  widths (preview + screenshots + a real prediction + a console/a11y scan), not just the server/cards/
  tests — layout/UX defects are width-specific (an uneven button-wrap showed only at 375px); when
  verifying CSS/JS edits, proactively cache-bust the static preview (`link.href+'?v='+Date.now()`)
  BEFORE trusting computed styles (the preview caches assets — see preview-cache gotcha); (c) run the
  measurements (quantify prevalence, sweep all configs for anomalies, and for DESIGN work measure the
  layout — px from the payload to the CTA, above-vs-below-the-fold — don't just eyeball). Only once that checklist is empty
  do you weigh stop-vs-continue. "It's already polished" is a conclusion you reach by looking, not a
  reason to skip looking. Stopping with known-deferred work on the board reads as laziness — because it is.
  **For a functional/QA pass, drive the REAL backend, not the static stub, and verify every contract
  BOTH ways before calling anything broken.** The static preview (`wenfsd`) can't serve `/api/*`; run
  the Express server in mock mode (`wenfsd-api`, port 8787 — it boots with zero env) so all ~38
  endpoints + the integration flows actually execute. Before reporting a result as a bug, read BOTH the
  client call and the server handler — two false alarms this run came from assuming the payload shape
  (the client sends `{event}` not `{name}`; `/me/*` 401 and `push/key` 404 are BY DESIGN, not failures).
  State-accumulation bugs only surface under repetition: the "≥5× the same action" rule is what exposed
  the garage piling up a duplicate vehicle on every re-predict (one click looked fine; six didn't).
- This loop spawns multiple PRs and uses significant tokens — that's expected; keep each iteration
  tight.

## Each iteration (repeat up to 10×)
1. **Pick the next best step — convene the Claude Council first.** Before choosing, run a short,
   honest debate between five advisors, then converge on ONE decision. Each gets 1–3 crisp lines;
   they may disagree — surface it, don't paper over it:
   - **Strategist** — does this move the long-term goal, or is it motion? What's the real constraint?
   - **Skeptic** — the weak assumption, the risk, the blind spot. Is this vanity work? Is the product
     even being *used*? (Engineering on an unused product is the classic trap.)
   - **Creative** — is there a sharper, higher-leverage angle than the obvious one?
   - **Operator** — concretely shippable this iteration (build→test→CI→merge)? Smallest viable cut?
   - **Audience Advocate** — what does the actual Tesla owner need right now? Does this serve them?
   **Converge:** state the single highest-value step and *why the Council landed there* (note any
   dissent and why you overrode it). Tiebreaker priority order:
   1. Correctness/bugs (anything wrong, misleading, or broken — highest priority for the honesty brand)
   2. Security/privacy regressions
   3. Activation gaps that block a built feature from working
   4. Conversion/UX wins backed by the funnel or a clear usability principle
   5. Growth loops (acquisition/retention/virality) and prediction-model accuracy
   6. Performance, accessibility, then cosmetic polish
   Ground the choice in the real code/data and the memory files (project, growth plan, event engine,
   preview-cache gotcha, autonomy preference). Prefer impact over novelty. If the Council concludes
   the real constraint is distribution/activation rather than code, SAY SO and stop — don't build slop.
   **Cross-surface consistency scan (learned the hard way):** a feature is only "done" when it behaves
   identically on EVERY surface — interactive site, `/p/` share pages, OG cards, email/push alerts,
   admin. The real bugs hide in the gaps between surfaces (e.g. a state that updates on the main page
   but goes stale on the share pages). Scan for those before picking new work.
   **LOOK at rendered artifacts — don't trust "valid buffer / 200 OK" (the most expensive lesson):**
   a server-rendered image, PDF, or card can return a perfectly valid PNG and HTTP 200 while being
   visibly BLANK or full of tofu — and "is it a valid buffer?" / "does it 200?" will never catch it.
   Every production OG card was an empty box for ~24 PRs because each check asserted bytes, never
   pixels. So for any visual/binary surface: render it AND **Read the actual image** (or fetch the
   LIVE production artifact and Read it) before believing it works. Verify on a host that mimics
   production (e.g. resvg with `loadSystemFonts:false`), not just your font-rich dev machine.
   **When you change a shared format/contract, sweep every producer AND consumer:** if an iteration
   changes a slug scheme, API shape, cache key, event type, or any cross-module contract, immediately
   grep for everything that builds or reads it (client + server + sitemap + tests) and fix them in the
   same breath — a contract change silently breaks the surfaces you didn't touch (one run's fix #3
   existed only because fix #2 changed the slug rules and left the client building dead links).
   **Quantify before dismissing as an edge case:** when a possible issue looks marginal ("just thin-data
   Cybertruck", "rare"), MEASURE its prevalence across the whole catalog before waving it off — edge-case
   vs widespread is a COUNT, not a guess. A prior run saw the exact degenerate card and stopped calling it
   an edge case; the next run measured it and it was 41% (90/219) — which flipped the decision from stop to
   fix. One `node` loop over `allSlugs()` (or the equivalent enumeration) turns a hunch into a number.
   **Frozen-clock / time-drift check (a value that's right today and rots tomorrow):** compare every
   date or relative-time the USER sees against the REAL current date — not the model's internal clock.
   A hardcoded or data-snapshot "today" (e.g. `W.today`/`WEN.today`) used as the prediction clock is
   correct the day it's authored and silently slides into the past as real time advances: a whole run
   was one bug where every "next update — PREDICTED" date had drifted days into the past on every
   surface, plus a stale "today" label. Ask up front: does any shown date come from a frozen `today`?
   Is anything displayed already in the past? Render/predict on the REAL clock and confirm dates land
   today-or-future.
2. **Build it end-to-end on a branch:** implement → `node --check` / run `npm test` (in `server/`) →
   verify in the live preview if it's browser-observable (respect the preview-cache gotcha: confirm
   via the served file + the engine, not the stale page) → open a PR → wait for CI green
   (test + audit + CodeQL/Analyze) → merge → sync `main`.
3. **If CI flags something real, fix it properly** (don't dismiss; the CodeQL/regex lesson stands).
4. **Log one line:** `Iteration N — <what> — <why it's worth it> — <result/verification>`.

## Guardrails
- Never weaken security to bypass a gate; never commit secrets; branch before committing on `main`.
- Match the surrounding code style; keep predictions honest (no invented dates/accuracy numbers).
- If an idea needs the owner's input (a brand/taste call, a paid dependency, an irreversible action),
  don't guess — note it for the report and pick a different iteration.

## Final report (after iteration 10 or an honest early stop)
- A table: each iteration — change, why, impact (real, not hype), PR #.
- What measurably improved vs. what was marginal (be honest).
- What's left that's genuinely high-value, and what needs the owner (activation, decisions).
- One-line bottom line on the site's current state.

## Loop retrospective — improve the loop itself (do this AFTER the report)
The loop must get smarter every run. Convene one more Council round focused on the **process, not the
product**. Each advisor, one line: what made this run sharp or dull, and the single change that would
make the NEXT `/improve` run better. Then:
- **Converge on 1–3 concrete improvements to THIS command file** — a better pickup signal, a scan we
  skipped, a sharper stop rule, a guardrail that should've fired, a recurring bug-class to check first.
- **Apply the top one** by editing `.claude/commands/improve.md` and ship it with the run, so the loop
  compounds — each run leaves the next one smarter. (Edit the protocol above; add a changelog line below.)
- **Same honesty bar:** only apply a genuinely valuable process change. If the protocol is already sound,
  write "no process change earns its keep this run" and apply nothing — never bloat the command for show.
- Mine the run for the **why behind the bugs**, not just the bugs: if two fixes shared a root cause,
  encode a check for that class so it's caught up front next time.

### Loop changelog (newest first)
- **v14** — A prediction-ENGINE audit (1 agent on calibration/confidence-honesty + my own statistical
  reproduction). New rule: **verify the proposed FIX is correct, not just that the finding is real — for
  statistical/calibration changes, check the lever measures the right quantity before wiring it in.** A
  finding can be REAL while its suggested fix is WRONG: the agent correctly flagged that "80% confidence"
  rides the *unvalidated* distributed branch, but proposed threading the back-test `bandFactor` into it —
  which would MIS-apply a branch-*cadence* calibration to a per-car *rollout-timing* window, introducing a
  real miscalibration to patch an honesty nit. Caught by asking "what does this number actually measure?"
  (cadence residuals ≠ rollout residuals) → rejected the mis-fix. The cheap, correct wins shipped instead:
  gate the back-test hit-rate % below 8 trials (a "50%-of-4" headline was meaningless, #111) and scope
  "High confidence" to the rollout *position*, not the validated *date* (#112). Proved the negatives too —
  MC sampling sound, the 80% interval a genuine model quantile, the L=0.95-curve-vs-L=1-placement bias
  ≤2d (negligible), no fabricated accuracy, math/parity unchanged + invariant sweep clean (0/480).
- **v13** — A dedicated SECURITY audit (3 agents per attack-surface + my own npm-audit/SQL/fs/innerHTML
  scans). Refined v12 into: **for an audit pass, make agents PROVE THE NEGATIVE, not just assert "clean."**
  A surface is only trustworthy-clean when the agent shows a *repro that the defense holds* — e.g. "I
  forced `</title><script>alert(1)` through `renderPage`/`ogPng` and the output contains `&lt;script&gt;`,
  not `<script>`", or "ReDoS regex is linear: here's why", or "the auto-unpause needs ≥2 distinct submitter
  hashes, so one attacker can't flip it." Proven-clean negatives are what *earn the stop* — they let you
  end after the one real fix instead of second-guessing. This run that discipline gave high-confidence
  cleans across injection/auth/headers/secrets/IDOR/ReDoS/deps, and surfaced exactly ONE real, reproduced
  vuln: an unauthenticated CPU-amplification DoS — `/p/<slug>/og.png?v=<junk>` rasterized a fresh ~16ms
  resvg PNG per distinct `?v` (unbounded cache key), one IP forcing ~10 CPU-sec/min + evicting the legit
  card cache. Fixed with a per-route limiter + collapsing junk `?v` to the representative card (#108),
  verified end-to-end (130 reqs → 118×200/12×429; garbage `?v` → identical cached PNG) AND by reading the
  rendered card pixels. Honest stop after one fix — earned by proven-clean negatives, not assumed.
- **v12** — An audit/review run (parallel agents scanning security, prediction/parity, honesty, client).
  The agents were great at coverage but **three of their findings were FALSE POSITIVES**, and acting on
  one ("seed.js is dead code, delete it") broke the suite — the file is imported and served by the
  sample-mode `/api/fleet/*` endpoints. Added the rule: **VERIFY EVERY AUDIT/AGENT FINDING against the
  real code before acting** — especially "X is unused / dead / a leak". For "unused/dead": grep for real
  USAGE (not just the import) — and on macOS that means `-E` for `a|b` alternation, `-a` because emoji-
  heavy files (app.js, api.js) are treated as binary and silently suppress matches, and a CONSISTENT cwd
  (a `cd` in a prior compound command had moved it, so the grep was reading nothing). For "it's a
  leak/bug": reproduce it (the claimed unbounded `Map` simply did not exist). The genuine wins were the
  cheap, verifiable ones — a `✓ real` label over sample numbers (#103), a region "current" FSD set to a
  build that region never receives (#104) — not the scary-sounding ones. Net: 4 real fixes (#103 honesty,
  #104 data, #105 server hygiene, #106 backend-seed cross-surface sync), 2 findings correctly discarded.
- **v11** — A deep design/aesthetics run. All three wins were the SAME class — **browser-native defaults
  leaking through the custom dark theme**, invisible to the eye until queried: 9 text inputs rendered as
  white default boxes (the themed rule matched `select,input[type=date]` but the inputs carry no `type`
  attribute, so `input[type=text]` never matched — needed `input:not([type])`); `color-scheme` was never
  declared, so native date-pickers/scrollbars/spinners/autofill rendered light; and `::selection` was the
  default browser blue. Lesson for design passes: run a **native-default-leakage scan** —
  programmatically read computed styles of every form control (flag white/near-white bg, mismatched
  radius/height vs siblings), and check for a missing `:root{color-scheme}` and an unstyled `::selection`.
  These silently bypass a theme and don't show up in a glance. PRs #87 (theme inputs), #88 (color-scheme),
  #89 (branded selection). Humor untouched (pure CSS).
- **v10** — A wide+deep QA run (219 /p/ pages, client/server prediction PARITY [exact median/p90/target
  match on every car], VIN decode, the event/pause engine, prediction-math invariants, adversarial
  /api/predict inputs, security headers) — **zero real bugs; everything works as promised.** Sharpened
  v9's contract rule: when unit-testing a function in ISOLATION, copy a REAL call site's exact arguments
  (grep an actual invocation or a test fixture) instead of hand-rolling inputs from memory. This run had
  FOUR false "bugs", every one from a guessed field name or incomplete object — `earliness` vs
  `earlinessPercentile`, `decode` vs `decodeVIN`, `year` vs `model_year`, and pause/resume events
  missing `effective_at`. The tell: a "broken" result that contradicts the app plainly working in the
  browser → suspect the TEST inputs first, read the real signature/call-site, then re-test.
- **v9** — A full functional-QA run ("test everything ≥5×, no assumptions"). Added: drive the REAL
  Express backend (mock mode, port 8787) for QA — the static preview can't serve `/api/*` — and a
  `wenfsd-api` launch config to make that one command. Also: verify every contract BOTH ways (client
  call + server handler) before calling a result a bug — two false alarms came from assuming the
  payload shape (`{event}` not `{name}`; `/me/*` 401 / `push/key` 404 are by-design). The one real bug
  the pass found: the garage deduped only by VIN, so re-predicting the same car piled up duplicate
  vehicles — surfaced precisely by repeating the same action ≥5×. Fixed in PR #84. Everything else
  (21 pages, ~38 API routes, predict/garage/bet/modal/email/report/grief, and the promises "no login
  / nothing leaves your browser / confirm-link / 80% window") tested clean.
- **v8** — A designer/UX/PM run. Sharpened v7's "drive the app" into **drive it at mobile AND desktop**
  (the funnel reads per-breakpoint; an uneven button-wrap showed only at 375px), added **proactively
  cache-bust the preview** before trusting computed styles (the stale CSS bit again), and **measure the
  layout for design work** (px from payload→CTA). This run: measuring the reveal showed the share button
  sat ~1,190px / 1.6 screens below the date and the alert capture ~617px down — so the two growth loops
  were buried below peak attention. Fixes: a peak-delight Share + alert row right at the prediction
  (PR #81) and a coherent rolling-now confidence module (PR #82, no more three redundant 100% chips).
  Humor preserved throughout per the owner's standing constraint.
- **v7** — Added **"earn the stop — exhaust the checklist first."** The owner pushed back that prior runs
  stopped too early (and one even asked them to decide). Both times there WAS concrete known work left:
  a consciously-deferred frozen-clock sweep (push/subscribers/poller still on the snapshot clock) and the
  live interactive app, which had never once been driven in a browser. This run cleared both — the alert
  sweep (PR #78) and a browser walkthrough that verified #74/#76 in-situ and found two unlabeled form
  controls (PR #79, an a11y fix). Lesson: clear deferred items + drive the real app + run the measurements
  BEFORE judging stop-vs-continue; a stop with known-deferred work on the board is laziness, not honesty.
- **v6** — Added **"quantify before dismissing as an edge case."** Run v5 (live-clock fix) made fast-region
  cards collapse to a zero-width "80% by <today>" — false precision. Run v4 had SEEN this exact card
  (Cybertruck) but dismissed it as thin-data and stopped; this run measured it first (41%, 90/219), which
  flipped the call from stop to fix. Lesson: when something looks marginal, count its prevalence across the
  catalog before waving it off. PR #76 (server card/page + client hero say "rolling out now").
- **v5** — Added the **frozen-clock / time-drift check**. This run's single fix: both the share cards
  and the interactive site computed predictions against a frozen data-snapshot `today` (`W.today`/
  `WEN.today` = 2026-06-21), so as real time advanced every "next update — PREDICTED" date slid into
  the PAST (a US card read "21 Jun" on the 25th) and the site showed a stale "today" label. Surfaced
  by v4's "exercise edge cases" (rendering the Cybertruck/NZ cards, not just the happy path). The
  check — compare every shown date to the REAL clock, flag anything from a frozen `today` — finds the
  whole class up front. PR #74 (live-clock predictions, server + client).
- **v4** — Added **"LOOK at rendered artifacts"** (Read the actual pixels / fetch the live production
  artifact — never trust "valid buffer / 200 OK"; verify on a production-like host) and a
  **contract-change sweep** (change a slug/API/cache-key/event format → grep every producer+consumer
  the same iteration). Root cause of this run's 3 fixes: every OG share card was rendering BLANK in
  production (Railway has no system fonts; resvg has none) and had been for ~24 PRs because every
  prior check asserted bytes, not pixels — found instantly the moment the scan said "render it and
  look." Fix #3 also showed a contract change (slug rules) breaking an untouched surface (client
  share links). PRs #70 (font bundling), #71 (no phantom pages), #72 (client/server slug parity).
- **v3** — Added this self-retrospective so the loop improves itself each run, and a **cross-surface
  consistency scan** to the pickup step. Root cause of the two real bugs found in the prior runs:
  features that worked on the interactive site but went stale on the `/p/` share pages — i.e. surface
  gaps. Now checked up front.
- **v2** — Added the Claude Council (5 advisors debate → converge) before each pick.
- **v1** — Initial: up to 10 disciplined, verified iterations; honest early-stop instead of slop.

Begin with Iteration 1 now. Work autonomously through to the report + retrospective — do not stop to ask
between iterations unless you hit a genuine blocker or an owner-only decision.
