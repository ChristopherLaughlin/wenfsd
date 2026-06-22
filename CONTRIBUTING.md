# Contributing to wenFSD

Thanks for helping out. Because wenFSD touches Tesla OAuth, `main` is protected and changes
ship through a small, gated pull-request flow. It takes about 20 seconds of extra ceremony per
change and means a broken test or a known vulnerability can never reach production.

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
| **CodeQL** | static security analysis (`security-extended`) | [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) |
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
