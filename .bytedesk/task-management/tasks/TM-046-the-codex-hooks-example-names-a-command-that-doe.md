---
id: "TM-046"
kind: "task"
status: "open"
created: "2026-07-31T07:35:31.135Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The Codex hooks example names a command that does not exist"
epic: "EP-005"
acceptance: [{"text":"The command the Codex example names resolves after a documented install step","done":false},{"text":"A hook fires under a real codex exec run, not only against the captured fixture","done":false},{"text":"The capability matrix claims what the setup path actually delivers","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-048"]
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T07:35:56.913Z"
---

## Problem
`hooks/codex-hooks.example.json`, shipped by TM-042, tells the reader to run `tm-hook`. There is
no such command: `bin/` holds `tm`, `tm-dashboard`, `tm-mcp` and `tm-notify`, and the entrypoint is
`hooks/tm-hook.sh` inside the plugin. On the strength of a payload test the capability matrix moved
Codex hooks from ⚠️ to ✅, so the README now promises a setup that cannot work as written.

The tests did not catch it because they invoke `hooks/tm-hook.sh` by absolute path — they exercise
the entrypoint, never the instruction.

## Proposal
Either ship `bin/tm-hook` as a thin wrapper (`tm install` already symlinks `bin/` onto PATH, which
is the mechanism the example assumes) or rewrite the example to name a path that exists. The first
is better: the Claude manifest resolves `${CLAUDE_PLUGIN_ROOT}`, and Codex has no equivalent, so
something on PATH is what that manifest needs.

Then run it — a real `codex exec` turn with the example installed, which is the check the capability
matrix is actually claiming.
