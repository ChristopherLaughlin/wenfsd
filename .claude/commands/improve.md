---
description: Run up to 10 disciplined, verified improvement iterations on wenFSD, then report.
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

Begin with Iteration 1 now. Work autonomously through to the report — do not stop to ask between
iterations unless you hit a genuine blocker or an owner-only decision.
