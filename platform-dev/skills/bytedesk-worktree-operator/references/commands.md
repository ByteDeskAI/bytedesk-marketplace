# ByteDesk Worktree Operator Commands

## Status

```bash
scripts/dev/workflow.mjs status
scripts/dev/workflow.mjs status --json
```

Checks current checkout safety, `origin/develop`, canonical `develop` drift, `develop-remote` drift, Helm `localDev.repoRoot`, open PRs, and worktree count.

## Create

```bash
scripts/dev/workflow.mjs new BDP-N-short-slug
scripts/dev/workflow.mjs new BDP-N-short-slug origin/develop
scripts/dev/workflow.mjs new BDP-N-short-slug --allow-dirty   # branch off a dirty canonical anyway
scripts/dev/workflow.mjs new BDP-N-short-slug --restore       # dotnet restore the fresh worktree (.NET work)
```

Creates `.claude/worktrees/<name>` on branch `feature/<name>` (default base `origin/develop`), wiring shared-state symlinks. This is the operator entry point for worktree creation — skills must not call `worktree.sh new` directly.

**BDP-1487 canonical-clean guard:** `new` refuses when the canonical checkout has uncommitted changes (own mis-edits or foreign concurrent WIP that would muddy isolation). Fix the canonical state — commit/stash/relocate — or pass `--allow-dirty` when the dirt is intentional. **BDP-1494:** `--restore` runs `dotnet restore src/ByteDesk.sln` in the fresh worktree (best-effort) so the first `dotnet build` works; omit it for web/docs scopes.

## Land

```bash
scripts/dev/workflow.mjs land feature/BDP-N-x
scripts/dev/workflow.mjs land feature/BDP-1-a feature/BDP-1-b
scripts/dev/workflow.mjs land feature/BDP-N-x --no-roll          # advance mirror, don't restart pods
scripts/dev/workflow.mjs land feature/BDP-N-x --services web,development
scripts/dev/workflow.mjs land feature/BDP-N-x --allow-dirty      # land despite a dirty canonical
scripts/dev/workflow.mjs land feature/BDP-N-x --no-cleanup       # keep merged worktree after land
```

Merges each branch's open PR (with retry). This is the explicit merge step; `ship` pushes + opens a PR but does **not** merge, preserving no-per-goal-auto-merge for parallel goal batches.

**BDP-1489 service auto-detection:** when neither `--services` nor `--no-roll` is given, `land` derives the source-mounted pods to roll from the merged diff via the path→service map (`src/ByteDesk.Web`→`web`, `src/ByteDesk.Office`→`office`, `src/ByteDesk.AI.Development`→`development`, …) — so a backend/contract change no longer silently serves stale code, and a scripts/docs-only PR rolls nothing. `--services` still overrides verbatim; `--no-roll` skips. (The omnigent harness lives in a sibling repo and is BDP-1495's concern — not mapped here.) **BDP-1487:** `land` also refuses when the canonical checkout is dirty unless `--allow-dirty`.

After the merge, `land` keeps all local integration surfaces current: it fast-forwards the canonical `develop` checkout to the freshly merged `origin/develop`, advances the **develop-remote** mirror, rolls source-mounted pods (default derived from changed paths; `--services` overrides; `--no-roll` advances mirrors without rolling), and removes clean merged-equivalent worktrees for the landed branches. For Omnigent `ap-web/` changes, the develop-remote static SPA build is required before the roll, so `omnigent.bytedesk.localhost` serves the landed bundle instead of an older checkout. This is otherwise **safe/best-effort** — it never discards canonical dirty work, skips diverged local `develop`, skips dirty worktrees, and skips worktrees still mounted by localDev. Use `--no-cleanup` when you intentionally need to keep a landed worktree around.

## Landed (BDP-2112)

```bash
scripts/dev/workflow.mjs landed                 # current worktree's branch
scripts/dev/workflow.mjs landed feature/BDP-N-x # a named branch
scripts/dev/workflow.mjs landed --json
```

Answers "is this landed?" in one read-only call so the question doesn't have to be re-asked. Gathers three facts — the PR state (`gh pr view`), commits ahead of `origin/develop`, and the develop-remote mirror sync — and prints a one-line verdict plus the suggested next command:

- **LANDED ✓** — PR merged and the develop-remote mirror is at `origin/develop`.
- **LANDED — mirror stale** — merged but the localDev mirror is behind/dirty/missing → `sync-develop-runtime`.
- **NOT LANDED** — PR open (→ `land`/`ship --land`), closed without merge, or commits ahead with no PR (→ `ship --land`).
- **NOTHING TO LAND** — no commits ahead of `origin/develop` and no PR.

PR state is authoritative because a rebase/squash merge rewrites the branch's commit SHAs; the merged PR — not an ancestor check — is the source of truth.

## Develop Runtime

```bash
scripts/dev/workflow.mjs sync-develop-runtime --roll web
```

Fetches `origin/develop`, creates or updates `.claude/worktrees/develop-remote` as a detached mirror, and optionally rolls deployments.

For Omnigent, this also rebuilds `ap-web` into `omnigent/server/static/web-ui` for develop-remote and for the currently mounted repo-local source root when localDev already points at canonical or a worktree. That keeps both "switch to develop-remote" and "I am already looking at this checkout" cases current.

## LocalDev

```bash
scripts/dev/workflow.mjs use-localdev --services web
scripts/dev/workflow.mjs use-localdev --services web,office --wait 600
scripts/dev/workflow.mjs reset-localdev --services web
scripts/dev/workflow.mjs localdev-lock status
scripts/dev/workflow.mjs localdev-lock release --force-lock  # break-glass only
```

`use-localdev` points Helm `localDev.repoRoot` at the active worktree or `--target`.
When the target is a feature/external worktree, it acquires the shared localDev lease in `.claude/localdev-lease.json` before changing Helm. A competing terminal gets the owner, target, and release instructions instead of silently taking over. Use `--wait <seconds>` when another terminal is expected to reset soon, and `--force-lock` only after confirming the owner is stale.

`reset-localdev` syncs `develop-remote`, points Helm at it, rolls requested services, and releases the lease. Run it from the owning worktree/terminal when live validation is complete. `localdev-lock status` is read-only; `localdev-lock release --force-lock` removes only the lease file and should be reserved for stale/dead owners.

For Omnigent, `use-localdev` builds the target checkout's `ap-web` static bundle before remapping, and `reset-localdev` builds develop-remote's bundle before remapping. The build step checks `ap-web/node_modules`: it skips a fresh install, hardlink-clones canonical modules when lockfiles match and canonical is fresh, or runs `npm ci --legacy-peer-deps --no-audit --no-fund` when dependencies are missing or stale. It then runs `npm run build`.

**BDP-1490:** both run `helm upgrade --reuse-values` from the **canonical** checkout (absolute canonical chart path + `cwd=canonical`), because the chart and the gitignored `values-microk8s-local.yaml` live only in canonical. Assembling the Helm call from a worktree (where those files are absent) silently no-ops the remap and the pod keeps serving `develop-remote` — so never hand-build the `helm upgrade` invocation; use the verb.

**BDP-2000:** nested help is safe now: `workflow.mjs use-localdev --help` prints help instead of treating `--help` as a target path.

## Prepare web

```bash
scripts/dev/workflow.mjs prepare-web
```

Populates the active worktree's `src/ByteDesk.Web/node_modules` so host-side
`tsc`/`next build`/`npm run lint`/`npm run test:run` work. A fresh worktree has no
`node_modules`, and symlinking the canonical copy breaks Turbopack ("symlink
points out of the filesystem root"). Strategy:

- worktree already has `node_modules` → **skip**;
- canonical `node_modules` exists and `package-lock.json` matches canonical →
  **hardlink-clone** (`cp -al`, instant, ~0 extra disk, a real dir tree; drops
  `node_modules/.cache` so caches aren't shared through inodes);
- otherwise (no canonical copy or lockfile drift) → **`npm ci`**.

`verify` runs this automatically when web files changed, so the suggested
`npm run lint`/`test:run` commands are runnable on a fresh worktree.

This verb is for Platform Web. Omnigent's equivalent `ap-web/node_modules` and static bundle preparation is tied to `land`, `sync-develop-runtime`, `use-localdev`, and `reset-localdev` because the source-mounted Omnigent pod serves the checked-out static files directly.

## Verify

```bash
scripts/dev/workflow.mjs verify --dry-run
scripts/dev/workflow.mjs verify
```

Infers a lightweight verification plan from `git diff --name-only origin/develop...HEAD`.
When web files changed, it first runs `prepare-web` so host-side npm checks work.

## Ship

```bash
scripts/dev/workflow.mjs ship --message "BDP-N: concise summary"            # push + PR, no merge
scripts/dev/workflow.mjs ship --message "BDP-N: concise summary" --land      # "ship and land" in one verb
scripts/dev/workflow.mjs ship --message "BDP-N: concise summary" --merge --reset-localdev
```

Runs only from a managed feature worktree. It fetches/rebases on `origin/develop`, verifies, commits dirty work when `--message` is supplied, pushes, and creates or reuses a PR.

- **`--land` (BDP-2112)** — after the PR exists, run the FULL `land` pipeline for this branch: merge → fast-forward canonical `develop` → apply landed raw manifests → advance the develop-remote mirror + roll touched source-mounted pods → clean up the merged worktree. This is the "ship and land" ritual collapsed into one verb.
- **`--merge`** — the lighter merge path: fast-forwards canonical `develop` and removes the clean merged-equivalent worktree (no manifest-apply, no pod roll). Kept for back-compat; prefer `--land` when you want the runtime mirror + pods rolled.

Both keep the no-per-goal-auto-merge invariant for parallel goal batches: plain `ship` never merges.

## Cleanup

```bash
scripts/dev/workflow.mjs cleanup BDP-N-short-slug          # targeted teardown
scripts/dev/workflow.mjs cleanup BDP-N-short-slug --force  # discard uncommitted work
scripts/dev/workflow.mjs cleanup --dry-run                 # merged-equivalent sweep report
```

With a `<name>`: removes that worktree **and** its `feature/<name>` branch, and runs `reset-localdev` (which releases the mount) **before** removal when the worktree was the current `localDev.repoRoot` source mount (so teardown never outages source-mounted pods). `--force` discards uncommitted work.

Without a name: shows merged-equivalent worktree candidates using `git cherry -v origin/develop` (report-only — use `reap-merged` to actually tear them down).

`land` and `ship --merge` now call the same cleanup path automatically for branches they just merged, but only after proving the local branch is merged-equivalent and the worktree is clean and not the active localDev mount.

## Reap merged (BDP-2113)

```bash
scripts/dev/workflow.mjs reap-merged             # tear down all merged-equivalent worktrees
scripts/dev/workflow.mjs reap-merged --dry-run   # list candidates + skip reasons, remove nothing
```

The bulk counterpart to `cleanup <name>`: in one pass it tears down **every** managed worktree that is merged-equivalent to `origin/develop` (`git cherry`), clean, and not the active localDev mount — reusing `classifyMergedWorktreeCleanup` for the decision and the localDev-safe `cleanup <name>` teardown for each. Dirty / localDev-mounted / unmerged worktrees are skipped with a printed reason. This is the "clean up merged worktrees" sweep; `cleanup --dry-run` only reports, `reap-merged` acts.

**BDP-1486 root-owned-artifact recovery:** the source-mounted web pod runs as root and writes root-owned `.next/dev/*` into the worktree, which makes host-side `git worktree remove` fail with `Permission denied` / `Directory not empty`. `cleanup` recovers automatically: a directory *rename* only needs write on the user-owned parent, so it moves the husk to `.claude/worktrees/.trash/<name>-<ts>` and runs `git worktree prune` instead of aborting. Reclaim the trashed disk later with `sudo rm -rf .claude/worktrees/.trash`.

## Diagnose (BDP-1492)

```bash
scripts/dev/workflow.mjs diagnose
```

One-shot triage when the gateway serves old code or a checkout blocks: canonical dirty state (with the files that block `new`/`land`), every managed worktree's lane (**dirty** → relocate/cleanup, **stale** → merged-equivalent/empty and reclaimable, **in-review** → has an open PR, **active** → unmerged work), and the current `localDev.repoRoot` mount label. Heavier than `status` (per-worktree git calls), so it's a separate verb. `status` shows the localDev mount label inline; reach for `diagnose` to find stale/dirty worktrees to clean up.

## Apply Helm (BDP-1246)

```bash
scripts/dev/workflow.mjs apply-helm
scripts/dev/workflow.mjs apply-helm --dry-run
scripts/dev/workflow.mjs apply-helm --target /path/to/repo
scripts/dev/workflow.mjs apply-helm --reuse-values
scripts/dev/workflow.mjs apply-helm --no-create-namespace
```

Encodes the canonical `microk8s helm upgrade --install bytedesk ./infra/k8s/bytedesk -n bytedesk --create-namespace -f values-microk8s.yaml -f values-microk8s-local.yaml -f values-microk8s-dev.yaml --set-string config.appVersion=<v> --set localDev.repoRoot=<root>` invocation. Resolves `APP_VERSION` from the repo-root `VERSION` file and picks `localDev.repoRoot` from the active cwd (feature worktree → worktree path; canonical → `develop-remote` mirror if present; `--target` always wins). Materializes `values-microk8s-local.yaml` from canonical into the worktree if missing. Prints the new Helm revision on success.

## Verify Pod (BDP-1246)

```bash
scripts/dev/workflow.mjs verify-pod web
scripts/dev/workflow.mjs verify-pod ai --tail 500
scripts/dev/workflow.mjs verify-pod office --watch
scripts/dev/workflow.mjs verify-pod web --namespace bytedesk
```

Resolves the pod via `app.kubernetes.io/name=<service>`, pulls `--tail` lines (default 200), classifies each line as `compile-error` / `runtime-error` / `ready` / `info` / `noise`, and summarizes. Exits non-zero on `compile-failed` or `runtime-failed`. `--watch` re-polls every 10s while the verdict stays `still-starting` (timeout 5m). Designed to replace local host builds, which OOM the laptop at ~85% memory.

## Health Check (BDP-1246)

```bash
scripts/dev/workflow.mjs health-check
scripts/dev/workflow.mjs health-check --namespace bytedesk-test
scripts/dev/workflow.mjs health-check --since 1h
```

Cluster-wide pod severity table (phase, ready, restart count, severity, reason), recent Warning events (default `--since 15m`), and a `BrokenCircuitException` storm scan across `app.kubernetes.io/part-of=bytedesk` logs. Exit code: 0 healthy, 1 warnings, 2 degraded. Useful as a pre-roll smoke before `verify-pod` or as a quick triage when something feels off.

## Drift Remediate (BDP-1246)

```bash
scripts/dev/workflow.mjs drift-remediate           # proposal only
scripts/dev/workflow.mjs drift-remediate --apply   # execute safe apply-source actions
scripts/dev/workflow.mjs drift-remediate --dry-run # never execute
```

Walks the auto-apply manifest allowlist, runs `microk8s kubectl diff -f <manifest>` per file, and classifies any drift into:

- **apply-source** — replicas / imagePullSecrets / env var drift; canonical Helm value wins; safe to `kubectl apply`.
- **open-jira** — image tag drift (needs a release) or resource ceilings (needs a source-sync ticket); the verb prints the `atlassian-mcp` snippet instead of opening the issue.
- **ignore** — no drift.

Without `--apply`: prints the proposal and exits 0. With `--apply`: executes `apply-source` actions and prints Jira snippets for `open-jira` actions.