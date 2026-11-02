---
id: "TM-477"
kind: "task"
status: "open"
created: "2026-10-05T19:14:33.078Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: recognised service sender for mailbox send (gateway jobs)"
epic: "EP-028"
acceptance: [{"text":"A service sender (e.g. AO_SERVICE_ID=gateway) is read in callerIdentity and recorded as kind=service in the envelope, distinct from repo agents","done":false},{"text":"Service senders deliver cross-repo to a registered lead without claiming the destination repo, with an explicit, documented readiness rule","done":false},{"text":"Gateway can switch to it without AO_CONSUMER=<destination> (documented migration)","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "daa70b0a-77c3-4cb3-ac4b-cf212a3b1cc1"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-05T19:14:33.085Z"
---

Requested by bytedesk-remote-gateway TM-552 (scheduled agent jobs, PR #349). The gateway mails each agent-job result to the destination repo's lead with ao-topology mailbox send. There is no register verb for non-agent senders, so the gateway sets AO_AGENT_ID=bytedesk-gateway-jobs and AO_CONSUMER=<destination repo>, which puts the message on the same-repo path and skips the cross-repo lead-readiness check: the gateway effectively claims to belong to the destination repo. Unset identity fails with TOPOLOGY_SOURCE_IDENTITY_REQUIRED (lib/standing-mailbox.mjs:330; identity read in topology/lib/session-identity.mjs:36-39).