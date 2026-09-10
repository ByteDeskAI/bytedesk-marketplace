---
id: "TM-141"
kind: "task"
status: "done"
created: "2026-09-09T22:11:41.929Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a tmux enumeration failure restarts the supervisor instead of skipping a tick"
epic: "EP-018"
acceptance: [{"text":"A transient failure to enumerate tmux panes degrades one reconcile tick rather than ending superviseRepository — or, if ending it is the deliberate choice, that is stated in a comment at the throw site with its reasoning, so the next reader does not treat it as an oversight.","done":true,"at":"2026-09-10T01:13:35.396Z"},{"text":"Whichever is chosen, the restarts counter no longer conflates 'tmux was briefly unavailable' with 'the supervisor crashed', since doctor uses that number to identify a crash loop.","done":true,"at":"2026-09-10T01:13:35.639Z"},{"text":"The asymmetry between the caught census listing and the uncaught presence listing is preserved and documented, because the two have different owners and different failure semantics.","done":true,"at":"2026-09-10T01:13:35.880Z"}]
evidence: [".bytedesk/task-management/evidence/TM-141-TM-140-141-INTEGRATION-VERIFICATION.md"]
commits: ["14b3ecd","73536a1"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:18:02.780Z"
comments: [{"author":"main","ts":"2026-09-09T23:40:04.599Z","text":"In progress with a live teammate, spawned this session as part of the EP-018 close-out wave. Nothing committed to its branch yet; work is in flight in its own worktree. Deliberately not merged or closed early: every worker this session returned at least one finding that changed the outcome, and two of those were bugs that a green diff and a passing test both agreed with — an unreachable retry rung whose stub reported an empty composer forever, and a brief instruction that would have granted the same cutover slot to two agents. The lead session owns the merge, the gates and the closure."},{"author":"main","ts":"2026-09-10T01:17:32.541Z","text":"Reconciled by the mainline integrator. Status was already correct — the fix is on main and verified (topology-supervision-consistency.test.mjs 3/3, npm run test:topology 294/294, npm run test:unit 465 pass / 4 skipped, matching the wave-2 baseline). The provenance was not: this task recorded commits 59ca483 and 04d26a6, and neither carries the fix. 59ca483 is TM-142's merge (mailbox.mjs, topology-addressing.test.mjs) and 04d26a6 is a rules/agent-scaffolding commit. The real change is 14b3ecd, merged at 73536a1 — topology/cli.mjs, topology/lib/supervision.mjs, and the new topology-supervision-consistency.test.mjs. Corrected to those two.\n\nCause: the git-link hook stamps `git rev-parse HEAD` at hook time onto the active claim, so any commit made while this task held the claim was stapled on regardless of what it touched. That is the same-repo sibling of TM-144 (which fixed the cross-repo case by reading the ref instead of the cwd); the in-repo case is still open and is worth its own task."}]
parkedReason: "session ended (e01dd923-50ea-45d8-9911-b9d5faed94bd)"
evidenceSources: {".bytedesk/task-management/evidence/TM-141-TM-140-141-INTEGRATION-VERIFICATION.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-140-141-INTEGRATION-VERIFICATION.md","sha256":"6dc87d055cdcba7dfade254d0d4076a71c96d7da376f9629bc408c412f491429","bytes":3089,"at":"2026-09-10T01:13:35.153Z"}}
closed: "2026-09-10T01:13:36.131Z"
---

Flagged by the TM-131 worker while writing its supervision patch, correcting its own earlier phrasing. Pre-existing TM-127 behaviour, unchanged by TM-131. A throw out of reconcile() — the likely one being TOPOLOGY_TMUX_OBSERVATION_FAILED from collectPresenceAgents when list-panes cannot be run — propagates through the do...while loop, out of withLock, and ends superviseRepository entirely. So a transient tmux hiccup does not skip a tick, it takes the supervisor down; the monitor then restarts it, which now increments the restarts counter TM-127 added. The end state is the same (the presence document ages out and reads stale, the census reads unknown) but it arrives by a much louder route, and a repeatedly flaky tmux would look like a crash loop in doctor rather than like what it is. Note the deliberate contrast the TM-131 patch preserves: the census's OWN cheap-tick listing is caught, because that listing exists only for the census and it may absorb its own failure; the reconcile listing is not caught, because it belongs to presence and its failure semantics are TM-127's to define. That asymmetry is correct and should survive whatever is decided here.