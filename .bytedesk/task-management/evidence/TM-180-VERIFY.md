# TM-180 verification: the PR finish line, and documentation that matches the code

**Result:** all five acceptance criteria are met. Merged to `main` as `59e72e4`.

- Worker commits: `e6877ff` (handoff, collect PR lookup, docs; preserved by the lead when the worker
  hit the account session limit) and the merge `45d55af` that brought the TM-178 pool work in.
- Lead commit `f240f1f` wrote the pool sections the worker had deliberately left as placeholders,
  against the merged code.

## What was measured

| Tree | Command | Exit | Result |
|---|---|---|---|
| `e6877ff`, clean | `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1466 / 1466 |
| `e6877ff`, clean | `bash task-management/run-tests.sh contract` | 0 | all green |
| `45d55af`, clean | unit glob | 0 | 1481 / 1481 |
| `f240f1f`, clean | unit glob | 0 | 1481 / 1481 |
| `f240f1f`, clean | contract | 0 | all green |
| `f240f1f`, clean | `agent-first-docs.test.mjs` alone | 0 | 8 / 8 |

## Acceptance criteria

1. **The handoff ends at a PR.** The "When you finish" section states the order: tick the criteria,
   commit, `git push -u origin <the task's tm/ branch>` (named literally when the task records one),
   `gh pr create --title "<TM-id>: <title>"`, attach evidence, `tm done`. If the push or the PR fails
   — no remote, no `gh`, no auth — the worker runs `tm block <id> "<the error>"` instead of closing.
   It never merges.
2. **`collect` records the pull request.** On the done path only, it asks
   `gh pr list --head <branch> --json url --jq '.[0].url'` with a 5 s timeout and appends the url to
   the task's `commits` — the array `tm link` already writes and the handoff already renders as
   "Commits / PRs", rather than a new field. A missing `gh`, an unauthenticated one, a branch with no
   PR, or any error records nothing and never fails the collect. Unit-tested through an injected
   exec; no real `gh` is ever run.
3. **The docs match the code.** Readiness, the sticky human veto, the pool on by default, the
   detached process model, the brake, the worker guard and the PR finish line are described across
   `README.md`, `AGENTS.md`, `docs/agent-first.md`, `docs/use-cases.md`, the `pool`, `tickets`,
   `groom`, `dispatch` and `implement` skills, and `.claude/rules/project-management.md`. A sweep for
   `opt-in`, `human's go-ahead`, `applied by hand`, `PLACEHOLDER` and `being redesigned` across those
   files returns nothing; the only remaining "placeholder" hits are unrelated dashboard design notes.
4. **Changelog.** The `[EP-021]` section names TM-174 to TM-178, TM-180 and ADR-0012. No `version`
   field was added anywhere: `task-management` is Claude-side versionless.
5. **Suites.** The unit glob and the contract suite exit 0, including `agent-first-docs.test.mjs`.

## Deliberate gap

The changelog keeps one commented placeholder for **TM-179** (a pool card on the dashboard, and
readiness with `triageMissing` surfaced in `tm why`), because that work does not exist yet. The rule
the worker applied, and which I confirmed: document what can be run, not what a brief claims. TM-179
stays open, and its entry gets written against that code when it lands.
