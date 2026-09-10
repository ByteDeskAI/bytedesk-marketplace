---
id: "TM-150"
kind: "task"
status: "done"
created: "2026-09-10T01:29:13.814Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the MultiEdit deny rule matches no known tool, in the provider config and in reviewer isolation"
acceptance: [{"text":"No deny rule names a tool the CLI does not know, in either the provider config or reviewer isolation","done":true,"at":"2026-09-10T06:27:41.174Z"},{"text":"It is established and recorded whether an unmatched deny name voids the remaining rules, and if it does, the reviewer isolation is re-verified","done":true,"at":"2026-09-10T01:35:36.685Z"},{"text":"Reviewer isolation still denies every write tool the CLI actually exposes today","done":true,"at":"2026-09-10T06:27:41.374Z"},{"text":"reviewer.mjs states, next to the deny list, that --restricted/--safe-mode are what enforce read-only and that the deny list alone is not sufficient","done":true,"at":"2026-09-10T06:27:41.518Z"}]
evidence: [".bytedesk/task-management/evidence/TM-150-TM150.md"]
commits: ["26927d6","71b60e3"]
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T06:30:55.105Z"
type: "bug"
labels: ["plugin:agent-orchestration"]
priority: "medium"
comments: [{"author":"main","ts":"2026-09-10T01:35:13.045Z","text":"OPEN QUESTION ANSWERED, and the answer inverts what this task should protect. Measured by the TM-135 dispatcher with three bounded `claude -p` runs in throwaway temp dirs.\n\nAn unmatched deny name is ADVISORY. It does not void the remaining rules, so the reviewer is NOT compromised and this drops from high to medium.\n\nBut the reason isolation holds is not the reason the code implies, and that is the finding:\n\n- Run 1, control, `--disallowed-tools Write,Edit`: refused, \"the Write tool is not available in this session\", no file.\n- Run 2, same list plus the unmatched name, `Write,Edit,MultiEdit`: warned about MultiEdit, Write still denied — AND THE FILE WAS CREATED, because the model reached for Bash, which that list never denied.\n- Run 3, the reviewer real argv (`--restricted --safe-mode --strict-mcp-config --disallowed-tools Write,Edit,NotebookEdit,MultiEdit,Agent,Task --permission-prompts none`): refused, \"no file-writing tool is available to me (no Write/Edit/Bash)\", no file.\n\nSo: the deny list ALONE makes nothing read-only. Run 2 is an agent with that list writing a file. Read-only holds because `--restricted`/`--safe-mode` remove Bash entirely. The load-bearing flags are the two nobody is looking at, and the deny list — the thing that LOOKS like the enforcement — is the part that is merely advisory.\n\nThe danger this creates is concrete: anyone \"simplifying\" buildReviewerArgv by dropping --restricted/--safe-mode and trusting --disallowed-tools plus TOPOLOGY_REVIEWER_READ_ONLY would break isolation SILENTLY — precisely what the \"never a silent downgrade\" comment fears, arriving through the door that comment is not watching. Hence the added criterion: say in the code which flags actually enforce.\n\nMethod note worth keeping. The dispatcher first attempt was to ask the LIVE reviewer to write a probe file. It refused — but cited ITS PROMPT INSTRUCTIONS (\"my standing reviewer instructions prohibit modifying files\"), not a tool denial. No file appeared, so the run looked like a pass and proved nothing: the agent own compliance masked the mechanism. That is the \"prompt text is not enforcement\" trap TM-127 AC15 names, and it was nearly recorded as evidence. The three bounded runs replaced it. Recording this because the failed attempt is more instructive than the successful ones — a refusal for the wrong reason is indistinguishable from a refusal for the right one unless you check which.\n\nThe stale MultiEdit name itself remains worth removing in both sites, but it is now cosmetic rather than a security question."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-150-TM150.md":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2ee26155-9e57-4cf8-8bc4-a8379f88e5a4/scratchpad/TM150.md","sha256":"eb7c47fb98e81d74007408e473d52a03b0521477c54c84ba6b5c2f9d9f412eac","bytes":2506,"at":"2026-09-10T06:27:59.016Z"}}
closed: "2026-09-10T06:27:59.146Z"
---

The CLI now reports: "Permission deny rule 'MultiEdit' matches no known tool — check for typos." MultiEdit is no longer a tool Claude Code exposes, so a deny rule naming it denies nothing.

Two sites, not one. The routed report named only the first:

- `agent-orchestration/providers/claude.json:19` — `coordinator_args`, denying `Write,Edit,NotebookEdit,MultiEdit`.
- `agent-orchestration/topology/lib/reviewer.mjs:145` — `buildReviewerArgv`, denying `Write,Edit,NotebookEdit,MultiEdit,Agent,Task`.

The second matters more. That list is the read-only reviewer isolation policy, and the surrounding invariants treat it as load-bearing — `TOPOLOGY_REVIEWER_READ_ONLY` refuses any adapter without verified isolation, with the comment "never a silent downgrade". A stale name in that list is exactly the kind of thing that reads as protection while protecting nothing.

Must be answered before fixing, not assumed: whether an unmatched name is purely advisory or whether it invalidates the rest of the list. If the whole list is dropped, the reviewer is not read-only at all and this is urgent rather than cosmetic. The observed CLI message is a warning, which suggests advisory, but that has not been verified and the reviewer path is not the place to guess.

Reported by the TM-135 worktree dispatcher from a demo orchestration in bytedesk-tmux-manager on an isolated tmux socket; it could not file this itself because filing is a shared-checkout write. Corroborated against both files by the integrator.