---
name: release
description: >
  Hands-off Gitflow ship kickoff: VERSION + CHANGELOG, commit, merge to main,
  tag vX.Y.Z, back-merge develop, push so TeamCity v* builds start. Then
  verify CDN + GitHub Release. Not a host restart (that is /cutover). Use
  when the user runs /release, says "cut a release", "start a hotfix",
  "tag and publish", or "is this version shipped".
---

# /release — Gitflow start (hands-off ship) + Releaseflow verify

Portable skill for **bytedesk-remote-gateway**. Filesystem + `git` + `curl`
(+ `gh` when present). Same on Claude, Codex, Grok, Kimi, Cursor.

**This is the commercial ship entry.** `/release start` (or `hotfix`) is the
hands-off kickoff: it tags, updates `main`, reverse-migrates `develop`, and
pushes so TeamCity can publish. `/commit` is for ordinary feature work, not
the version cut. `/cutover` restarts a host.

Canonical spec: repo `docs/BRANCHING.md` (joint Gitflow + Releaseflow table)
and `docs/RELEASEFLOW.md` (TeamCity SoT).

## Hard rules

1. **Author is only the local git identity.** Same as `/commit`: never
   `--author`, never `Co-Authored-By`, never agent/model trailers.
2. If `user.name` or `user.email` is empty, **stop**.
3. **`/release start` / `hotfix` own the candidate tag and the PR.** They
   commit VERSION, create annotated `vMAJOR.MINOR.PATCH` on the
   release/hotfix branch, push branch + tag (TeamCity starts), and open a
   PR into `main`. They do **not** update `main` or `develop`. `/release
   finish` merges that PR only after `/release verify` PASSes.
4. **Never force-push** `main` or `develop`.
5. **Never** treat laptop `release-core.sh` or a local Tauri build as the
   commercial publish path. TeamCity `release-publish` → get.bytedesk.ai is
   SoT for the **server** (`gateway`). GitHub Actions `release-core.yml` is
   SoT for the **desktop client** (`gateway-desktop`). No laptop `aws s3 cp`.
6. **Never** start a **prod** cutover unless the user said prod.
7. After `start` (or `hotfix`) pushes `v*`, TeamCity is building. Run
   `verify` when checking artifacts (CDN may still be warming). After
   `verify` PASS, **ask** `/cutover` for **dev**. Do not auto-cutover prod.
8. Do not claim “shipped” without: tag on `main` + published GH Release +
   get.bytedesk.ai artifacts (or a documented offline path).

## Modes

Resolve the skill root (directory containing this `SKILL.md`):

```bash
SKILL_DIR="<path-to-setup/skills/release>"
RF="$SKILL_DIR/scripts/release-gitflow.sh"
```

| Mode | User phrases | Command |
|------|----------------|---------|
| **`status`** (default `/release`) | status, where is this version | `"$RF" status` |
| `start [vX.Y.Z]` | cut a release, start release | `"$RF" start [vX.Y.Z]` |
| `hotfix [vX.Y.Z]` | start a hotfix | `"$RF" hotfix [vX.Y.Z]` |
| `finish` | optional recovery if start was interrupted | `"$RF" finish` |
| `verify [vX.Y.Z]` | is it shipped, check CDN | `"$RF" verify [vX.Y.Z]` |
| `plan` | dry-run, rehearse | `"$RF" plan` |

Default version: `start` bumps **minor** of `VERSION`; `hotfix` bumps **patch**.
`finish` and `verify` read `VERSION` / the branch name.

`start` / `hotfix` require a clean worktree, write `VERSION`, fold CHANGELOG
`[Unreleased]` into `[X.Y.Z]`, sync `src/embedded_changelog.md`, **commit**
that cut as the local git user, annotated tag `vX.Y.Z` on the **release
branch**, **push** branch + tag (TeamCity `+:refs/tags/v*` starts), and
open a GitHub PR **into `main`**. They do **not** merge `main` or
`develop`. `--no-push` still commits and tags locally.

`finish` on `release/vX.Y.Z` or `hotfix/vX.Y.Z` **requires verify PASS**
(unless `--no-push` / `--no-verify`), then `--no-ff` merges into `main`
and back-merges `develop`. If already on both, finish is a no-op.

Load `references/runbook.md` for script flags and refuse conditions.

## Agent loop

1. Parse mode. On `/release` with no args → `status`, then stop unless they
   asked to start/hotfix/finish/verify.
2. Show the plan (branch, version, that start will commit/tag/merge/push).
3. Run **one** `$RF` mode. Do not invent extra git commands around it
   (no raw `git tag` on a feature branch).
4. Report script stdout. On non-zero, stop.
5. `start`/`hotfix` → candidate tag + PR are done; `main` is unchanged.
   Tell the operator TeamCity is building; offer `/release verify`.
6. `verify` PASS → offer `/release finish` to merge `main` + `develop`,
   then `/cutover` on **dev**. Prod only if they asked.
7. `finish` without verify PASS (when pushing) must refuse to merge `main`.

## Related

- `/commit` — land ordinary feature work; **not** required after `/release start`
- `/cutover` — host process restart after artifacts exist
- `docs/BRANCHING.md` — joint workflow table
- `docs/RELEASEFLOW.md` — TeamCity, CDN, env URLs
