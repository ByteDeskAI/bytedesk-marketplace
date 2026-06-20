---
name: bytedesk-pr-ready
description: >-
  ByteDesk PR creation workflow. Use when opening a pull request for this repo.
  Verifies the worktree branch, rebases from origin/develop, runs tests, creates
  a BDP-N formatted PR, waits for CI, and links Jira. Invoke for "create PR",
  "open pull request", "ready to merge", "PR time", or "ship this".
user-invokable: true
argument-hint: "[BDP-N]"
allowed-tools:
  - Bash
  - Read
  - mcp__atlassian__getJiraIssue
  - mcp__atlassian__addCommentToJiraIssue
  - mcp__atlassian__transitionJiraIssue
  - mcp__atlassian__getTransitionsForJiraIssue
---

## What This Skill Does

Creates a properly-formatted PR following gitflow rules, with the right title format, test verification, CI tracking, and Jira linkage — so nothing gets missed before merge.

## Preferred Automation

For normal worktree shipping, delegate to the worktree operator first:

```bash
scripts/dev/workflow.mjs ship --message "BDP-N: concise summary" --merge --reset-localdev
```

Use the manual sequence below only when `scripts/dev/workflow.mjs` is missing or fails and you have diagnosed the failure.

## PR Sequence

### 1. Confirm the branch and Jira issue

Check which worktree and feature branch are active and identify the BDP ticket:

```bash
git rev-parse --path-format=absolute --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git branch --show-current
git log --oneline origin/develop..HEAD
```

Stop if the branch is `develop` or `main`, or if the checkout is the canonical repo instead of `.claude/worktrees/<name>`. PR prep must run from the dedicated feature worktree that owns this Jira scope.

If the branch name contains `BDP-N`, use that number. If not, search Jira for the active In Progress item matching this work.

### 2. Update branch from develop

Rebase to pick up any changes merged to develop since branching:

```bash
git fetch origin
git rebase origin/develop
```

If there are conflicts, resolve them and describe them to the user before continuing.

### 3. Run tests locally

```bash
(cd src && dotnet test ByteDesk.sln --filter "Category=Unit" --no-build 2>&1 | tail -20)
```

If tests fail: stop and report failures. Do not create the PR until tests are green. The TDD gate will block it anyway.

For frontend changes, also confirm the ESLint check would pass:
```bash
(cd src/ByteDesk.Web && npx next lint --max-warnings 0 2>&1 | tail -10)
```

### 3a. Browser smoke (BLOCKING for `src/ByteDesk.Web/**` diffs)

If the PR diff touches anything under `src/ByteDesk.Web/**`, **invoke the `bytedesk-browser-test` skill** before opening the PR. A green dotnet build is not proof the page renders — many of our shipped regressions (e.g. workflow-surface-v2 "Unable to render this workflow's YAML" across PRs #974–977) compiled fine and broke the page.

```bash
git diff --name-only origin/develop... | grep -q '^src/ByteDesk\.Web/' && WEB_CHANGED=1
```

If `WEB_CHANGED=1`:
1. Identify the route(s) under change from the diff (`src/ByteDesk.Web/src/app/(app)/<route>/page.tsx` → URL `/<route>`; component-only diffs use the closest hosting page).
2. Invoke the **`bytedesk-browser-test`** skill against each route with the BDP key as the session name. The skill handles login, screenshot, console + errors capture, and **strong cleanup** (including aggressive Chrome process tree killing — see the hardened skill).
3. After the smoke(s), run a final browser reaper pass as belt-and-suspenders hygiene:
   ```bash
   node scripts/dev/workflow.mjs browser-reap --force
   ```
   (This was added as part of the 2026 laptop stability work to prevent the 40+ leaked Chrome instances problem.)
4. **A non-empty `agent-browser errors` stream BLOCKS the ship.** Save the failure screenshot to `~/<BDP-N>-failure.png`, paste both the path and the errors into the PR body, and stop.
5. On success, attach the screenshot path to the PR body under a `## Browser smoke` section.

Do not call `agent-browser` directly from this skill — go through `bytedesk-browser-test` so the login / cleanup / artifact conventions stay consistent.

### 3b. Workflow/Omnigent Runtime Proof

If the diff touches Office workflows, Omnigent, workflow harness contracts,
workflow runtime tools, `omnigent.json`, or cross-repo workflow integration,
invoke the relevant runtime skill before declaring the PR ready:

- `bytedesk-workflow-runtime-smoke` for Office workflow execution, `/sources`,
  run debugger, SignalR, and live workflow state.
- `bytedesk-omnigent-operator` for Omnigent plugin/config/runtime freshness.
- `bytedesk-maya-workflow-router` for Maya Office-chat workflow-routing paths.

For workflow/Omnigent work, PR readiness requires current evidence, not just
merged commits: Platform PR ancestry, Omnigent PR ancestry when applicable,
runtime plugin inspect output, gateway health/readiness, and the final user path
that proves the loaded runtime matches the branch.

### 3c. Architecture sync audit (when arch-relevant paths change)

If the PR diff touches any partition in `docs/architecture/anchors.yaml`
(`src/ByteDesk.*`, `src/ByteDesk.Shared.*`, `infra/k8s/**` service wiring), run:

```bash
git diff --name-only origin/develop... | head -50
architecture-sync --mode audit --base origin/develop
bash scripts/testing/local-test.sh architecture-sync
```

Requirements:

- PR includes `docs/architecture/workspace.dsl` and/or `fragments/*.dsl` when code
  partitions changed.
- Audit exits 0. On failure, invoke `/bytedesk-architecture-sync` before opening PR.
- Add a `## Architecture` section to the PR body listing touched partitions and
  confirming audit passed.

### 4. Create the PR

**Title format** (mandatory):
```
BDP-N: <concise description of what this PR does>
```

**Body template**:

```markdown
## Summary
- [bullet 1: what changed]
- [bullet 2: why]
- [bullet 3: any notable decision or tradeoff]

## Jira
https://bytedesk.atlassian.net/browse/BDP-N

## Test plan
- [ ] Unit tests pass (`dotnet test --filter "Category=Unit"`)
- [ ] Integration tests pass (`dotnet test --filter "Category=Integration"`)
- [ ] Architecture sync audit (`architecture-sync --mode audit`) if service/topology paths changed
- [ ] [specific manual step if UI changed]
- [ ] Dark mode checked (UI changes only)

## Notes
[Any migration steps, env var changes, or reviewer context]
```

**Target branch**: always `develop` (never `main` directly — that's for release branches only).

Use GitHub MCP or `gh pr create` to open the PR:

```bash
gh pr create \
  --base develop \
  --title "BDP-N: <description>" \
  --body "$(cat <<'EOF'
[body above]
EOF
)"
```

### 5. Wait for CI and report status

After creating the PR, check CI status:

```bash
gh pr checks <PR-number> --watch
```

Report back the result. If checks fail:
- Read the failure logs
- Identify root cause
- Suggest a targeted fix (don't push blindly)

### 6. Link PR to Jira issue

Add a comment on the Jira issue with the PR URL:

```
addCommentToJiraIssue:
  cloudId: bytedesk.atlassian.net
  issueIdOrKey: BDP-N
  body: "PR opened: <PR URL>"
```

### 7. After merge

Once the PR is merged to develop:
1. Delete the feature branch: `git push origin --delete feature/BDP-N-slug`
2. Transition Jira to **Done** (use `transitionJiraIssue`)
3. Check if the parent Epic should also be closed

## Output

```
PR created: https://github.com/ByteDeskAI/bytedesk-platform/pull/N
  Title: BDP-123: Add HVAC lead scraper for AZ ROC
  Base: develop
  CI: [passing / failing / pending]
  Jira: BDP-123 commented with PR link

After merge:
  - Transition BDP-123 to Done
  - Delete feature/BDP-123-add-hvac-scraper
```

## PR Rules (from general.md and gitflow)

- Never target `main` directly — `main` only accepts PRs from `release/*` or `hotfix/*`
- PRs to main require passing `gateway`, `web`, and `helm-chart` checks
- Never open a feature PR from the canonical checkout; use the owning `.claude/worktrees/<name>` feature branch
- Never use `--force-push` to `develop`; rebase, don't force
- Include `BDP-N` in the PR title — this is how status reviews are reconciled from git history
