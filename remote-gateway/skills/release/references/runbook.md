# /release runbook

```bash
SKILL_DIR=<path-to-setup/skills/release>
RF="$SKILL_DIR/scripts/release-gitflow.sh"
```

| Command | Effect |
|---------|--------|
| `"$RF" status` | VERSION, branch, latest `v*` tag, GH release, CDN HEAD |
| `"$RF" start [vX.Y.Z] [--no-push]` | From `origin/develop`: branch `release/vX.Y.Z`, bump VERSION (default **minor**), fold changelog, commit, annotated tag `vX.Y.Z` on the **release branch**, push branch + tag, open PR → `main`. Does **not** update `main`. |
| `"$RF" hotfix [vX.Y.Z] [--no-push]` | Same from `origin/main`; default **patch** bump; branch `hotfix/vX.Y.Z`. |
| `"$RF" finish [--no-push] [--no-verify]` | On `release/*` or `hotfix/*`: require verify PASS (unless `--no-push`/`--no-verify`), merge `--no-ff` → `main`, back-merge `develop`. |
| `"$RF" verify [vX.Y.Z]` | `curl -fsSI` get.bytedesk.ai amd64+arm64 + `gh release view`. Exit 1 if CDN or GH release missing/draft |
| `"$RF" plan` | Print the commands; no git writes |

Env: `ORIGIN` (default `origin`), `BYTEDESK_GET_ORIGIN` (default `https://get.bytedesk.ai`).

`--no-push` still performs the local commit, annotated tag, and both merges; it does not require a remote.

## Refuse

- Empty `git config user.name` / `user.email`
- `start`/`hotfix`/`finish` if the worktree is dirty
- `start`/`hotfix` if `release/v*` or `hotfix/v*` already exists locally or on origin
- `start`/`hotfix` without `--no-push` if remote `origin` is missing
- `start`/`hotfix` if tag `vX.Y.Z` already exists
- `finish` unless the current branch is `release/vX.Y.Z` or `hotfix/vX.Y.Z`
- `finish` if `VERSION`, branch name, CHANGELOG `## [X.Y.Z]`, or embed disagree
- `--force` push

## After start

TeamCity (`deploy.prod.bytedesk.ai`) runs `release-amd64` + `release-arm64` + `release-windows-amd64` → `release-publish` on the pushed `v*` tag. Then `verify`. Then `/cutover` on **dev**. Prod only with explicit operator intent. Do not `/commit` then `/release finish` to get the tag or the `main`/`develop` updates.
