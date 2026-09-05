---
id: "TM-106"
kind: "task"
status: "blocked"
created: "2026-09-05T12:31:13.829Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TeamCity agent environments expose live secrets through the REST API"
epic: "EP-013"
acceptance: [{"text":"The four exposed credentials are rotated","done":false},{"text":"Secrets are no longer supplied as agent-wide environment variables","done":false},{"text":"An agent that legitimately carries design.agent.trust=credential-free exists, or the requirement is retired","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T12:31:37.243Z"
type: "bug"
labels: ["architecture"]
priority: "highest"
blockedReason: "Rotation and secret-manager migration are the operator's; the finding and remediation path are recorded"
---

Found while checking whether design-system's ci-validate agent-trust requirement could be satisfied (TM-105). GET /app/rest/agents?fields=agent(properties) returns each agent's full environment as plaintext to any caller with agent-view permission.

Exposed on tc-agent-1: env.BYTEDESK_GITHUB_TOKEN (a ghp_ personal access token), env.HARBOR_CI_PUSH_PASSWORD with its robot username, env.SOPS_AGE_KEY (an AGE secret key, which decrypts whatever that repo's SOPS-encrypted secrets are).
Exposed on wf-agent-amd64: env.INFISICAL_CLIENT_SECRET with env.INFISICAL_CLIENT_ID and the Infisical host and project id — i.e. machine-identity credentials for the secret manager itself.

Values are deliberately NOT recorded here or in any evidence file; they are readable from the API by anyone who needs to confirm this, and copying them into a git-tracked store would make the exposure worse.

Why it matters beyond the obvious: an AGE key and an Infisical machine identity are not leaf credentials, they unlock other secrets. And a TeamCity build step can read its own agent's environment, so any build that anyone can trigger on these agents can exfiltrate all of it - which is precisely the threat model design-system commit 7a4987f was written to address with maskPublishingCredentials() and a credential-free agent pool. That commit has never taken effect because the settings file it lives in does not compile (TM-105).

Recommended: rotate all four, move them out of agent environment variables into per-build TeamCity parameters or the Vault/Infisical integration (teamcity.vault.supported is true on both agents), and provision the credential-free pool 7a4987f assumes.