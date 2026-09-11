---
id: "TM-172"
kind: "task"
status: "open"
created: "2026-09-11T18:40:41.210Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: prompt ack trusts the caller's TMUX_PANE, so any same-user process can acknowledge for a pane"
epic: "EP-019"
acceptance: [{"text":"Decide and document the ack threat model in the observer or prompt-lifecycle docs: accidental misattribution only, or same-user forgery too","done":false},{"text":"If forgery is in scope, the ack is bound to proof the pane's own process controls (for example the caller's process ancestry includes the bound pane_pid, or a one-time token delivered only through the pane), and a caller outside the pane with the correct TMUX_PANE, nonce and revision is refused in a real-tmux test","done":false},{"text":"promotePromptForIncarnation labels a first start differently from a controlled restart, or the field is documented as covering both","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T18:41:36.670Z"
labels: ["plugin:agent-orchestration"]
---

Found by W2 during EP-019 (TM-164 AC4, 2026-09-11). acknowledgePrompt (topology/lib/prompt-lifecycle.mjs) accepts an acknowledgement when the caller's binding matches the staged incarnation, but cli.mjs builds that binding by matching the caller's TMUX_PANE environment variable against listed panes. TMUX_PANE is set by the caller, and the pane id is readable from session.json or tmux list-panes; the nonce and revision are readable from prompt-state.json. Run C (real tmux, commit 6f63b53, test edited): a process outside the observer pane set TMUX_PANE=%2 with the correct agent, session, repository, nonce and revision; prompt ack exited 0 and wrote status current with applied_binding for pane %2, so observer start would pass its readiness gate without the pane acknowledging. The committed test only covers the empty-TMUX_PANE forgery. Scope: this is a same-user trust boundary (such a process can already read the files and type into the pane), so the gate protects against a stale or replaced process acknowledging by mistake, not against a hostile same-user process. Also noted: promotePromptForIncarnation records replacement controlled-restart for a brand-new session, not only a restart.