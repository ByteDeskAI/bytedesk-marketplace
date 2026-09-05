---
id: "TM-106"
kind: "task"
status: "blocked"
created: "2026-09-05T12:31:13.829Z"
board: "bytedeskai/bytedesk-marketplace"
title: "TeamCity agent environments expose live secrets through the REST API"
epic: "EP-015"
acceptance: [{"text":"The four exposed credentials are rotated","done":false},{"text":"Secrets are no longer supplied as agent-wide environment variables","done":false},{"text":"An agent that legitimately carries design.agent.trust=credential-free exists, or the requirement is retired","done":false}]
evidence: []
commits: ["b2a6ad4"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T14:17:46.196Z"
type: "bug"
labels: ["architecture"]
priority: "highest"
blockedReason: "Rotation and secret-manager migration are the operator's; the finding and remediation path are recorded"
comments: [{"author":"main","ts":"2026-09-05T13:27:23.147Z","text":"Worse than first recorded, and it raises the priority of design-system#70.\n\nTriggering a ci-validate build returns its inherited parameters, and the validation build carries the full publishing credential set: env.NPM_TOKEN, env.R2_SECRET_ACCESS_KEY, env.R2_DESIGN_SECRET_ACCESS_KEY, env.CLOUDFLARE_DESIGN_TOKEN, env.HARBOR_PASSWORD and github.token, all inherited from the project. R2_ACCOUNT_ID, R2_ENDPOINT, R2_DESIGN_ACCESS_KEY_ID and the Harbor robot username are in plaintext beside them.\n\nci-validate runs on EVERY branch (branchFilter '+:*') and on pull requests. Its single step is 'bash .teamcity/scripts/ci-validate.sh' from the checkout being tested. So anyone who can get a branch or a PR built on that server can read the npm publish token and the R2 keys for the design CDN by echoing its own environment - no exploit needed, it is just there.\n\nThis is precisely what maskPublishingCredentials() in commit 7a4987f was written to blank, and it has never executed because the settings file it lives in does not compile. The masking is inert, so the pre-7a4987f configuration is what is running.\n\nLanding design-system#70 makes the masking take effect for the first time. It does NOT fix the root cause - project-level parameters should not be inherited into a build that only validates - but it removes them from the build that anyone can trigger."},{"author":"main","ts":"2026-09-05T14:17:46.192Z","text":"Measured after design-system#70 landed: the build-side exposure is closed, the agent-side is not.\n\nGET /app/rest/builds/id:2190/resulting-properties on a ci-validate build of main now returns every publishing credential BLANK — NPM_TOKEN, NODE_AUTH_TOKEN, NPM_PASSWORD, R2_SECRET_ACCESS_KEY, R2_DESIGN_SECRET_ACCESS_KEY, R2_ACCESS_KEY_ID, R2_DESIGN_ACCESS_KEY_ID, CLOUDFLARE_DESIGN_TOKEN, HARBOR_PASSWORD, HARBOR_USERNAME, HARBOR_CI_PUSH_PASSWORD/USERNAME, BYTEDESK_GITHUB_TOKEN, SOPS_AGE_KEY, INFISICAL_CLIENT_ID/SECRET and the AWS_* trio are all empty strings, and github.token reads *******. maskPublishingCredentials() has executed for the first time since it was written. That is the anyone-can-trigger-a-branch-build path shut.\n\nThe root cause is untouched. GET /app/rest/agents?locator=authorized:true still lists env.BYTEDESK_GITHUB_TOKEN, env.HARBOR_CI_PUSH_PASSWORD and env.SOPS_AGE_KEY on tc-agent-1, and env.INFISICAL_CLIENT_SECRET on wf-agent-amd64, with values readable to any caller holding agent-view. Masking blanks a credential per build; it does not stop the agent from carrying it.\n\nSo all three criteria stand. They are the operator's: rotating four live credentials and moving them out of agent-wide environment into a secret manager is not something a session should do to a production build server, and AC3 stays until a genuinely credential-free pool exists or the requirement is retired. Values still deliberately unrecorded."}]
---

Found while checking whether design-system's ci-validate agent-trust requirement could be satisfied (TM-105). GET /app/rest/agents?fields=agent(properties) returns each agent's full environment as plaintext to any caller with agent-view permission.

Exposed on tc-agent-1: env.BYTEDESK_GITHUB_TOKEN (a ghp_ personal access token), env.HARBOR_CI_PUSH_PASSWORD with its robot username, env.SOPS_AGE_KEY (an AGE secret key, which decrypts whatever that repo's SOPS-encrypted secrets are).
Exposed on wf-agent-amd64: env.INFISICAL_CLIENT_SECRET with env.INFISICAL_CLIENT_ID and the Infisical host and project id — i.e. machine-identity credentials for the secret manager itself.

Values are deliberately NOT recorded here or in any evidence file; they are readable from the API by anyone who needs to confirm this, and copying them into a git-tracked store would make the exposure worse.

Why it matters beyond the obvious: an AGE key and an Infisical machine identity are not leaf credentials, they unlock other secrets. And a TeamCity build step can read its own agent's environment, so any build that anyone can trigger on these agents can exfiltrate all of it - which is precisely the threat model design-system commit 7a4987f was written to address with maskPublishingCredentials() and a credential-free agent pool. That commit has never taken effect because the settings file it lives in does not compile (TM-105).

Recommended: rotate all four, move them out of agent environment variables into per-build TeamCity parameters or the Vault/Infisical integration (teamcity.vault.supported is true on both agents), and provision the credential-free pool 7a4987f assumes.