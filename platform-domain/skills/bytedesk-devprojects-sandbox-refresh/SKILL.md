---
name: bytedesk-devprojects-sandbox-refresh
description: >-
  ByteDesk DevProjects sandbox refresh and validation operator. Use when
  DevProject tenant runtimes, sandbox agent tools, deploy-git.js, Railway
  deploys, preview/production DevProject testing, sandbox image rebuilds,
  GitHub-token mounted pod failures, stale tenant runtimes, or "how do I test
  this through a real DevProject?" are involved. Produces rebuild/roll/recycle
  steps plus real UI and runtime proof.
user-invokable: true
argument-hint: "status | plan | refresh <devProjectId> | deploy-git | test-in-ui"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Make DevProjects sandbox work verifiable through the real tenant runtime. Code
changes under `infra/docker/sandbox/**`, sandbox agents, deploy tooling, or
DevProject assistant tools are not complete until the sandbox image is rebuilt,
the local platform points at it, and the specific DevProject runtime is recycled.

## First Checks

```bash
devproject-sandbox-refresh-proof --status
scripts/dev/workflow.mjs status
```

For sandbox code, also read:

```bash
.claude/rules/sandbox.md
.claude/rules/devproject-ledger.md
```

## Refresh Ladder

1. **Build source is current**: confirm worktree, branch, and `localDev.repoRoot`.
2. **Build and publish sandbox image**: record the immutable image tag or digest.
3. **Update local Helm values**: set `config.sandbox.sandboxImage` and roll only
   affected deployments.
4. **Recycle target DevProject runtime**: remove the stale tenant runtime and
   wait for a fresh one from the new image.
5. **Validate through the real UI**: use `/development`, open the target
   DevProject, and run the assistant/tool/deploy flow.
6. **Capture proof**: image tag, runtime pod/container id, DevProject id/name,
   UI route or screenshot, and deploy/run result.

Use the helper to print the checklist with command placeholders:

```bash
devproject-sandbox-refresh-proof --project <devProjectId>
```

## deploy-git.js Failures

For deploy-git or Railway deploy issues, capture:

- remote URL and branch, without printing secrets
- `git pull --rebase` result
- auth/token presence, not token value
- Railway service/resource id
- deployment id and final state

If `GITHUB_TOKEN` is missing in a local pod, fix the platform secret/config
mount path; do not hardcode tokens into repo files.

For custom-domain or DNS issues after deploy, hand off to
`bytedesk-devproject-domain-operator`; sandbox refresh proves the tenant runtime,
not public DNS truth.

## Tenant Boundary

Tenant sandboxes must stay blind to host localDev, Helm, MicroK8s namespaces,
worktree paths, and platform internals. Those are platform control-plane
concerns, not tenant runtime concerns.

## Report Format

```markdown
DevProject sandbox refresh: PASS/FAIL
Image: <tag/digest>
Platform runtime: <localDev + deployment roll evidence>
Tenant runtime: <DevProject id + recycled runtime evidence>
UI/deploy proof: <route, screenshot, deployment/run id>
Residual risk: <only real remaining risk>
```
