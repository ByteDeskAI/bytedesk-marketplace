---
id: "TM-138"
kind: "task"
status: "done"
created: "2026-09-09T21:32:53.018Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Presence producer: populate the header extension keys"
epic: "EP-018"
acceptance: [{"text":"collectPresenceAgents populates activity, mailboxDepth, task, roleName, slots and top-level slotQueues, and the unknown-role mapping means no agent is ever dropped from presence.","done":true,"at":"2026-09-10T05:54:05.839Z"},{"text":"The frozen validate_presence.py and test_validator.py both still pass UNCHANGED. If either needs editing, the design has leaked into the frozen contract and is wrong.","done":true,"at":"2026-09-10T03:51:50.277Z"}]
evidence: [".bytedesk/task-management/evidence/TM-138-TM138.md"]
commits: ["471c2c3","bb3e084"]
blockedBy: ["TM-136"]
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T05:54:06.007Z"
comments: [{"author":"main","ts":"2026-09-09T21:52:04.995Z","text":"See the routed finding on TM-136 for the exact shape of the collectPresenceAgents drop this task must fix: the ROLES filter at presence.mjs:160 applies to run agents only, not standing sessions, so the unknown-role mapping needs to happen in the run-agent branch. Verified in the tree by the integrator, not inferred."},{"author":"main","ts":"2026-09-10T05:48:23.961Z","text":"AC1 WAS TICKED AND IS FALSE. Un-ticked by the integrator after checking the tree rather than the record.\n\nAC1 claims collectPresenceAgents populates activity, mailboxDepth, task, roleName, slots and top-level slotQueues. Verified in presence.mjs at HEAD:\n\n  roleName            POPULATED, and the unknown-role mapping is done — ROLES.has(declared) ? declared : NEAREST_RUN_ROLE with roleName carrying the truth, so no agent is dropped. That half of the criterion is genuinely met.\n  activity            ABSENT — zero occurrences in presence.mjs\n  mailboxDepth        ABSENT — appears ONLY in the addendum, the fixtures and the countersignature request, never in producer code\n  slotQueues          ABSENT — same, spec-only\n  task                ABSENT\n  slots               ABSENT\n\nThe entry object built by add() carries exactly: agentId, displayName, title, repoRole, runRole, roleName (optional), coordinatesOnly, enrollment, lifecycle, readinessCheckedAt, session, memberships, primaryRunId. Five of the six keys the criterion names are not among them, and there is no top-level slotQueues.\n\nAC2 stays ticked and is TRUE: both frozen validators pass unchanged, which is verified on every merge in this epic and was verified again at 471c2c3.\n\nThis is the exact failure mode the rules file was written for — a green record standing in for a check nobody ran. The criterion names six keys and one of them was implemented, so anyone reading the board would have concluded the producer work was finished. It is not started apart from roleName.\n\nRecording rather than quietly fixing, because the tick has been on the board through several sessions and the next reader deserves to know it was wrong rather than find a corrected record with no history."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-138-TM138.md":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2ee26155-9e57-4cf8-8bc4-a8379f88e5a4/scratchpad/TM138.md","sha256":"c205959487b3d35886dee1a6de5c42b620277762aa30287cf571448c8c280395","bytes":3082,"at":"2026-09-10T05:54:05.673Z"}}
closed: "2026-09-10T05:54:06.001Z"
---

Producer-side implementation of the additive keys, blocked on the countersignature. slotQueues from slots.mjs, mailboxDepth from queueDepth, activity from the census, task from the management record's assignee, roleName plus the unknown-role mapping fix.