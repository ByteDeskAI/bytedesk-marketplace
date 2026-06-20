---
name: bytedesk-production-release-teamcity
description: >-
  ByteDesk production release operator for the TeamCity-only release path. Use
  for release/X.Y.Z or hotfix/X.Y.Z status, production deploy questions,
  main-release PRs, TeamCity release-cut/release-cut-finalize evidence, Fleet
  GitOps verification, omnigent image rollout proof, back-merge to develop, and
  post-release local develop-runtime sync. Never use local deploy scripts as a
  production substitute.
user-invokable: true
argument-hint: "status [version] | cut X.Y.Z | finalize X.Y.Z | sync-local"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Keep production releases on the sanctioned path. TeamCity at
`https://deploy.prod.bytedesk.ai` is the source of truth. There is no
break-glass local production deploy path.

## Release Status

Start with read-only evidence:

```bash
release-status --version <X.Y.Z>
```

Collect release branch, TeamCity `release-cut`, PR to `main`, merge commit,
TeamCity `release-cut-finalize`, Fleet desired state, live image tags, HTTPS
health, and back-merge of `main` to `origin/develop`.

## Cut / Finalize Rules

- Release branches cut from `develop`.
- Hotfix branches cut from `main`.
- Pushing `release/X.Y.Z` or `hotfix/X.Y.Z` triggers TeamCity `release-cut`.
- Merging the generated PR to `main` triggers TeamCity
  `release-cut-finalize`.
- If TeamCity is slow or failed, fix TeamCity. Do not run legacy production
  scripts locally.

Legacy scripts that must not be used for production:

```bash
scripts/prod-deploy-tui.mjs
scripts/prod-deploy-headless-execute.mjs
scripts/ci/back-merge-main-to-develop.sh
```

## Post-Release Local Sync

After TeamCity finalizes and back-merges to `develop`, sync the local
source-mounted runtime:

```bash
scripts/dev/workflow.mjs sync-develop-runtime
```

This is local runtime hygiene, not a production deploy.

## Report Format

```markdown
Production release status: PASS/FAIL
Version: <X.Y.Z>
TeamCity: <release-cut + finalize build ids/states>
GitHub: <release PR + merge SHA + ancestry>
Fleet/live: <image tags + HTTPS health>
Back-merge: <main -> develop proof>
Local sync: <develop-remote/localDev status>
```
