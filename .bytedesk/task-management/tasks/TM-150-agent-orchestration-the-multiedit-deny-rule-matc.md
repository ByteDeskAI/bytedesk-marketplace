---
id: "TM-150"
kind: "task"
status: "open"
created: "2026-09-10T01:29:13.814Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the MultiEdit deny rule matches no known tool, in the provider config and in reviewer isolation"
acceptance: [{"text":"No deny rule names a tool the CLI does not know, in either the provider config or reviewer isolation","done":false},{"text":"It is established and recorded whether an unmatched deny name voids the remaining rules, and if it does, the reviewer isolation is re-verified","done":false},{"text":"Reviewer isolation still denies every write tool the CLI actually exposes today","done":false}]
evidence: []
commits: ["4756b5c"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:29:39.832Z"
type: "bug"
labels: ["plugin:agent-orchestration"]
priority: "high"
---

The CLI now reports: "Permission deny rule 'MultiEdit' matches no known tool — check for typos." MultiEdit is no longer a tool Claude Code exposes, so a deny rule naming it denies nothing.

Two sites, not one. The routed report named only the first:

- `agent-orchestration/providers/claude.json:19` — `coordinator_args`, denying `Write,Edit,NotebookEdit,MultiEdit`.
- `agent-orchestration/topology/lib/reviewer.mjs:145` — `buildReviewerArgv`, denying `Write,Edit,NotebookEdit,MultiEdit,Agent,Task`.

The second matters more. That list is the read-only reviewer isolation policy, and the surrounding invariants treat it as load-bearing — `TOPOLOGY_REVIEWER_READ_ONLY` refuses any adapter without verified isolation, with the comment "never a silent downgrade". A stale name in that list is exactly the kind of thing that reads as protection while protecting nothing.

Must be answered before fixing, not assumed: whether an unmatched name is purely advisory or whether it invalidates the rest of the list. If the whole list is dropped, the reviewer is not read-only at all and this is urgent rather than cosmetic. The observed CLI message is a warning, which suggests advisory, but that has not been verified and the reviewer path is not the place to guess.

Reported by the TM-135 worktree dispatcher from a demo orchestration in bytedesk-tmux-manager on an isolated tmux socket; it could not file this itself because filing is a shared-checkout write. Corroborated against both files by the integrator.