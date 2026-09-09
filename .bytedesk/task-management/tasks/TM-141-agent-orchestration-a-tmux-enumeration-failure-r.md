---
id: "TM-141"
kind: "task"
status: "open"
created: "2026-09-09T22:11:41.929Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a tmux enumeration failure restarts the supervisor instead of skipping a tick"
epic: "EP-018"
acceptance: [{"text":"A transient failure to enumerate tmux panes degrades one reconcile tick rather than ending superviseRepository — or, if ending it is the deliberate choice, that is stated in a comment at the throw site with its reasoning, so the next reader does not treat it as an oversight.","done":false},{"text":"Whichever is chosen, the restarts counter no longer conflates 'tmux was briefly unavailable' with 'the supervisor crashed', since doctor uses that number to identify a crash loop.","done":false},{"text":"The asymmetry between the caught census listing and the uncaught presence listing is preserved and documented, because the two have different owners and different failure semantics.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-09T22:11:41.937Z"
---

Flagged by the TM-131 worker while writing its supervision patch, correcting its own earlier phrasing. Pre-existing TM-127 behaviour, unchanged by TM-131. A throw out of reconcile() — the likely one being TOPOLOGY_TMUX_OBSERVATION_FAILED from collectPresenceAgents when list-panes cannot be run — propagates through the do...while loop, out of withLock, and ends superviseRepository entirely. So a transient tmux hiccup does not skip a tick, it takes the supervisor down; the monitor then restarts it, which now increments the restarts counter TM-127 added. The end state is the same (the presence document ages out and reads stale, the census reads unknown) but it arrives by a much louder route, and a repeatedly flaky tmux would look like a crash loop in doctor rather than like what it is. Note the deliberate contrast the TM-131 patch preserves: the census's OWN cheap-tick listing is caught, because that listing exists only for the census and it may absorb its own failure; the reconcile listing is not caught, because it belongs to presence and its failure semantics are TM-127's to define. That asymmetry is correct and should survive whatever is decided here.