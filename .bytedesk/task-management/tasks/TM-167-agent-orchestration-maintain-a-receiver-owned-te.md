---
id: "TM-167"
kind: "task"
status: "open"
created: "2026-09-10T22:09:09.006Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: maintain a receiver-owned team lead for every enrolled repository"
epic: "EP-019"
acceptance: [{"text":"Enrollment has one provider-neutral resolver: repo enabled:true or project plugin enablement enrolls, explicit enabled:false wins, and existing managed-lead registrations remain compatible.","done":false},{"text":"Session startup and other qualifying repository activation start the canonical per-repository supervisor and converge concurrent linked-worktree activations on one managed lead.","done":false},{"text":"Cross-repository mail is durably persisted before recovery; missing or confirmed-dead managed source or destination leads schedule receiver-owned supervision, and the same envelope is delivered exactly once after recovery.","done":false},{"text":"A responsive lead is reused; a live unresponsive lead is not restarted or duplicated; a dead externally owned lead is held with an actionable reassignment alert and is never replaced automatically.","done":false},{"text":"Recovery failures expose action, last error, attempt count, and next retry time using 10s, 30s, 2m, and 10m-capped backoff, resetting after responsiveness returns.","done":false},{"text":"Ordinary unrelated commands do not run inline supervision or enumerate unscoped tmux servers; all process ownership, lock, repository, and incarnation checks fail closed.","done":false},{"text":"Unit and real-tmux tests cover enrollment precedence, disabled repos, N-way first contact, linked worktrees, durable hold/resume deduplication, provider failure, dead external ownership, and live unresponsive preservation; docs and installed-plugin validation pass.","done":false}]
evidence: []
commits: []
blockedBy: ["TM-164"]
blocks: []
actor: "main"
session: "01a088d4-54f3-7781-a6df-8860bd57ba9a"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T18:53:55.813Z"
labels: ["ready-for-agent","plugin:agent-orchestration"]
type: "story"
touches: ["agent-orchestration/tests","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/config.mjs","agent-orchestration/topology/lib/lead.mjs","agent-orchestration/topology/lib/standing-mailbox.mjs","agent-orchestration/topology/lib/startup.mjs","agent-orchestration/topology/lib/supervision.mjs"]
---

Make each explicitly enrolled repository converge on one responsive, receiver-owned managed lead so durable cross-repository requests always have a recipient. Enrollment is established by repo Agent Orchestration configuration or project plugin enablement; an explicit enabled:false wins. Repository activation eagerly starts the canonical supervisor. Cross-repository delivery persists its immutable envelope before scheduling destination-local recovery. The supervisor may ensure a missing lead or restart a confirmed-dead managed lead, then resume held mail. It must never duplicate or kill a live unresponsive lead, replace a dead externally owned lead, bypass canonical common-Git-directory identity, or start agents for an unenrolled repository. Provider and startup failures remain visible and retry at 10 seconds, 30 seconds, 2 minutes, then a 10-minute cap.