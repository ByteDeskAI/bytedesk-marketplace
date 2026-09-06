---
id: "TM-113"
kind: "task"
status: "open"
created: "2026-09-06T04:55:23.788Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: an agent can approve its own architecture decision"
epic: "EP-016"
acceptance: [{"text":"The guarantee is documented accurately where an operator reads about the gate — a separate attributed act, not proof a human acted","done":false},{"text":"Either approval identity is verified, or the loopback path can be required for architecture decisions","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T04:55:23.795Z"
---

orchestration_decision_approve is a state gate, not an identity gate, and the distinction is not documented anywhere an operator would meet it.

approveDecision (src/service.mjs:530-542) enforces four things: repository authority, intent === architecture, state === waiting_for_decision, and evidence completeness with requiresHumanApproval. None of them is identity. approvedBy is a caller-supplied z.string().min(1) (src/mcp.mjs:248) that is never validated, never compared against the run's initiator, and never authenticated — it is written straight through to the decision record at service.mjs:538.

The only other writer is sessionDecide (service.mjs:465), the loopback browser path, which hardcodes approvedBy 'operator'. Nothing distinguishes that from an agent passing the literal string 'operator' itself.

Verified in source by two independent readings during the 0.4.0 review.

What the system does guarantee is still worth something and should be stated plainly rather than overclaimed: the run cannot proceed without a separate explicit call, and that call is recorded with a rationale in the hash-chained, tamper-evident journal. It is a stop-and-attest, not a separation of duties.

If real separation is wanted, the lever already exists: the loopback session UI (127.0.0.1 only, 32-byte token, 10-minute TTL, single exchange) is a path a headless agent cannot reach. Nothing currently forces its use.

Minimum acceptable outcome is honest documentation. Better would be an option that requires the loopback path for architecture approvals.