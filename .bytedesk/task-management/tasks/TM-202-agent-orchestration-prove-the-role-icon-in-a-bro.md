---
id: "TM-202"
kind: "task"
status: "blocked"
created: "2026-09-13T21:33:06.852Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: prove the role icon in a browser, once the gateway can enumerate terminals"
epic: "EP-019"
acceptance: [{"text":"Browser acceptance shows the same Unicode character in a managed terminal title bar and in the gateway GUI agent view for the same agent, captured in one screenshot showing both the character the gateway derived and the character agent-orchestration transmitted.","done":false},{"text":"The user-facing browser tests from the role-icon countersignature request pass against a gateway running the shipped orchestration-terminals provider.","done":false}]
evidence: []
commits: ["TM-168","3418262"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "feat/dispatch-duplicate-guard"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-14T01:09:55.445Z"
blockedReason: "Blocked on the gateway's TM-330, not TM-317 any more. TM-317 merged and cut over on 2026-09-13 (postflight PASS, live=7 durable=7) with our two branches in it: bytedesk-remote-gateway aa587986 (PR 142) and bytedesk-tmux-manager e9e01c9 (PR 1).\n\nIt does NOT unblock this task, by design rather than by shortfall. TM-317 shipped only the availability operation (cmd.tmux.v1.availability, hostClassPublicRead). Listing sessions, windows and panes names a person's terminals, so it is subject-scoped, and no production site mints a subject lease yet - declaring those operations would have merged clean and refused every real call. So the gateway's sessions view is still empty and there is still no terminal badge to photograph.\n\nThe gateway session removed TM-317's own AC2 ('the gateway enumerates tmux sessions again and the sessions view shows tabs') rather than ticking it, and moved it verbatim to their TM-330 AC3. That is the criterion this task now waits on, together with the lease-minting gap they filed separately against ADR 0025.\n\nResume when TM-330 lands and a terminal tab actually appears. The screenshot can then show both halves at once: the character the gateway derives and the character agent-orchestration transmits."
---

The marketplace half of TM-168 shipped in agent-orchestration v0.9.0 and is countersigned. This task
carries the only part that could not be finished here: the browser evidence.

Why it is separate. The screenshot needs a live terminal tab in the gateway, and the gateway
enumerates zero of them — its tmux-manager plugin runs under a bwrap sandbox that mounts no
executable directory, so it cannot find the tmux binary it manages. Badges are per-terminal, so with
no terminals there is nothing to photograph. That is bytedesk-remote-gateway TM-317, in another
repository, and its owner has no date for it.

What is already true, so this is evidence-gathering rather than engineering:
- Our producer emits `roleIcon`/`roleLabel` on every agent in live snapshots (verified 10/10 on the
  gateway's repository, 3/3 here, after restarting supervisors that predated v0.9.0).
- The gateway derives its own pair from `repoRole`/`roleName` and never echoes ours, so the
  screenshot can show BOTH halves at once — the character they derived and the character we
  transmitted, matching. That is a stronger artefact than either half alone.
- Their implementation is pushed and countersigned: all 7 confirmations answered, our hashes
  verified, `check.py` passing.

One known deviation to re-confirm at acceptance: their SDK validates `badge.icon` as
`^[a-z0-9-]{1,64}$`, so the emoji cannot ride in that field. The plugin sends an ASCII role token and
the SPA maps it to the character from a byte-identical copy of our `role-icon-map.json`. Same
character in both views, but the map is duplicated downstream and can drift — tracked as TM-189.

Resume when TM-317 lands. Nothing here needs doing before that.
