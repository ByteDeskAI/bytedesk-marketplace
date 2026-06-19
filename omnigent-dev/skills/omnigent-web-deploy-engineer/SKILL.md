---
name: omnigent-web-deploy-engineer
description: Omnigent web UI, desktop UI, deployment, auth, server-managed host, sandbox, and packaging skill. Use for ap-web changes, frontend tests, Playwright/e2e_ui coverage, Docker/Kubernetes/Render/Railway/Fly/HF/Modal deploy work, sandbox providers, server/runner topology, accounts/OIDC/header auth, and deploy docs.
---

# Omnigent Web Deploy Engineer

## Mission

Keep user-facing UI and deployment paths aligned with the server/runner execution model. A server deploy is not proof that agents can execute; prove host/runner connectivity when the behavior depends on it.

## References

Read:
- `references/generated/deploy-sandbox-map.md`
- `references/generated/repo-map.md`
- `references/generated/test-matrix.md`

## Web Rules

- For `ap-web/` behavior changes, add or update a colocated Vitest test.
- For user-facing UI flows, add or update `tests/e2e_ui/` unless there is an explicit maintainer waiver.
- Keep UI state tied to server snapshots plus live streams; do not invent a parallel client-only truth source for persisted behavior.

## Deploy Rules

- Separate server responsibilities from runner/host execution responsibilities.
- Preserve auth mode semantics: accounts, OIDC, and trusted header mode have different threat models.
- For managed sandboxes, prove provider config, callback URL, launch token, host registration, and cleanup behavior where touched.
- Never put model keys, OAuth tokens, registry passwords, or local auth artifacts in docs, examples, logs, or committed config.