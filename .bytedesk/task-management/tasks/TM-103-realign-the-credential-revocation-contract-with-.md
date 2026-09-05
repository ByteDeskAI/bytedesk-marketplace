---
id: "TM-103"
kind: "task"
status: "done"
created: "2026-09-05T10:29:35.908Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Realign the credential-revocation contract with subscription-CLI auth"
epic: "EP-014"
acceptance: [{"text":"The contract test passes and states why exposed is correct, so it is not 'fixed' back","done":true,"at":"2026-09-05T10:30:15.076Z"},{"text":"A credential left in a broker tree after a completed run fails the test","done":true,"at":"2026-09-05T10:30:15.210Z"},{"text":"The trade-off and its remaining guarantees are written down where the next reader will find them","done":true,"at":"2026-09-05T10:30:15.342Z"}]
evidence: [".bytedesk/task-management/evidence/TM-103-0002-provider-credential-lifetime.md"]
commits: ["42b90de"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T10:30:28.695Z"
labels: ["architecture"]
closed: "2026-09-05T10:30:15.698Z"
---

The clean-install contract test asserted bootstrap_credentials_cleared, which recorded the old behaviour: the broker shredded the staged provider credential the moment ACP bootstrap completed. Commit 27eb1c3 deliberately changed that — subscription CLIs (Claude Max) re-read their credential file on later turns, so shredding at bootstrap broke authentication for every provider of that shape, and the broker-owned copy now stays mounted until process teardown. The test was never updated, so a security contract sat permanently red and no new regression could be distinguished from the known one. Trade-off accepted as designed: the agent can read a broker-owned COPY during its run; the host file is never the mount source, the sandbox home is read-only, ancestors are protected, and teardown truncates, syncs and unlinks the copy. The assertion that replaces shred-after-bootstrap is that nothing readable survives the run — which nothing was checking.