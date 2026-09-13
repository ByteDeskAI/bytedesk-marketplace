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
commits: ["TM-168"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "feat/dispatch-duplicate-guard"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-13T21:33:16.598Z"
blockedReason: "Blocked by bytedesk-remote-gateway TM-317, in another repository, which has no date. Their tmux-manager plugin runs under a bwrap sandbox mounting no executable directory, so the gateway enumerates zero session tabs and there is no terminal badge to photograph. The fix their operator chose on 2026-09-12 is a host-resolved tmux service, not a sandbox bind (--tmpfs /tmp also hides the tmux socket, so a bound binary would start an empty server and report zero sessions successfully - a silent wrong answer). Partial contribution in flight: bytedesk-tmux-manager e9e01c9 on tm/TM-317-injectable-runner implements the plugin-side runner seam; the gateway-side operations wait on an SDK tag (TM-260) carrying cmd.tmux.v1.* and on subject-lease minting, which is ADR 0025's own unclosed gap. Neither is ours."
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
