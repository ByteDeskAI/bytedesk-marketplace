---
id: "TM-093"
kind: "task"
status: "blocked"
created: "2026-09-05T04:01:23.240Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Enforce cross-repo routing at the mailbox"
epic: "EP-014"
acceptance: [{"text":"recordReply verifies the writing agent's identity rather than trusting --agent","done":false},{"text":"The routing predicate redirects a disallowed direct contact to the receiving repo's lead","done":false},{"text":"A redirect emits a journal event and is acknowledged to the sender with the original addressee preserved","done":false},{"text":"A wait barrier is satisfied by a reply to the message regardless of which agent answered","done":false},{"text":"An empty reply file no longer satisfies a barrier","done":false}]
evidence: []
commits: ["8f135ad"]
blockedBy: ["TM-094"]
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:08:51.511Z"
touches: ["agent-orchestration/topology/lib/mailbox.mjs"]
---

Decided: cross-repo routing is enforced at the mailbox, and a blocked direct contact is redirected to the lead rather than rejected to the sender. Four changes land at the same chokepoint. (1) recordReply (topology/lib/mailbox.mjs:141-149) takes --agent <id> on trust with no authorization check, so any agent can write into any other agent's outbox and satisfy its barrier; the only control is a BOOTSTRAP.md line. (2) The routing predicate: from.project != to.project AND to.agent is not the lead AND no open delegation names (from.agent, to.agent, task) -> route to the lead. (3) A redirect must be loud though it is not an error - journal a route.redirect event, acknowledge to the sender, and keep the original addressee in the envelope. (4) pendingReplies waits on a named agent set, so it is keyed by responder; a redirected message answered by the lead never satisfies a barrier waiting on the original addressee, and the sender times out after 20 minutes on a message that was handled. Key the barrier on message id, or teach it to accept a reply from the lead on the addressee's behalf. Also worth fixing here: a zero-byte file satisfies a barrier because pendingReplies tests exists() only.