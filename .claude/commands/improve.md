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
