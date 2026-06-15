# Branch protection — what to configure in GitHub

Branch protection rules live in GitHub's repo settings (they can also be
set via the API, but settings-as-code for branch protection is still
brittle as of May 2026 — Settings repo / GitHub Repository Configuration
beta only). The desired configuration for `main` is documented below so
the next maintainer can reproduce it.

GitHub → Settings → Branches → Branch protection rules → New rule

## Branch name pattern: `main`

- **Require a pull request before merging** ✓
  - Required approving reviews: **1**
  - Dismiss stale pull-request approvals when new commits are pushed ✓
  - Require approval from CODEOWNERS ✓
  - Require approval of the most recent reviewable push ✓
- **Require status checks to pass before merging** ✓
  - Require branches to be up to date before merging ✓
  - **Required checks** (exact names from `.github/workflows/`):
    - `Guest web (lint + syntax)` — from `ci.yml`
    - `npm audit (high)` — from `ci.yml`
    - `Edge Function tests (Deno)` — from `ci.yml`
    - `Analyze (javascript-typescript)` — from `codeql.yml`
    - `Analyze (java-kotlin)` — from `codeql.yml`
    - `dependency-review` — from `dependency-review.yml`
    - `Secret scan` — from `gitleaks.yml`
    - `Lint + tests + debug APK` — from `qrvault-android.yml`
- **Require conversation resolution before merging** ✓
- **Require signed commits** ✓
- **Require linear history** ✓
- **Require deployments to succeed before merging** ✓
  - Environment: `staging` (forces a staging PR deploy before main)
- **Lock branch** — leave OFF (we want PRs to land)
- **Do not allow bypassing the above settings** ✓ (yes, this applies to admins too)
- **Restrict pushes that create matching branches** — leave default
- **Allow force pushes** ✗
- **Allow deletions** ✗

## Auto-merge

GitHub repo → Settings → General → Pull Requests:
- **Allow auto-merge** ✓
- **Automatically delete head branches** ✓
- **Allow squash merging** ✓ (the only allowed merge type)
- **Allow merge commits** ✗
- **Allow rebase merging** ✗
- Default commit message for squash: "Pull request title and description"

`.github/workflows/auto-merge.yml` will then auto-merge Dependabot
patch/minor PRs once required checks are green. Major bumps stay
blocked pending human review.

## After every workflow rename

If you rename a job inside any `.github/workflows/*.yml`, the required
check name changes too and the branch protection rule starts blocking
merges. Re-edit the rule above to track the new name. Both can't be
"settings-as-code'd" right now in stock GitHub — sorry.
