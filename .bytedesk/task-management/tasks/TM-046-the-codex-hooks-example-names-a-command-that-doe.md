---
id: "TM-046"
kind: "task"
status: "done"
created: "2026-07-31T07:35:31.135Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The Codex hooks example names a command that does not exist"
epic: "EP-005"
acceptance: [{"text":"The command the Codex example names resolves after a documented install step","done":true,"at":"2026-07-31T08:41:46.062Z"},{"text":"A hook fires under a real codex exec run, not only against the captured fixture","done":true,"at":"2026-07-31T08:41:46.128Z"},{"text":"The capability matrix claims what the setup path actually delivers","done":true,"at":"2026-07-31T08:41:46.187Z"}]
evidence: [".bytedesk/task-management/evidence/TM-046-tm-hook"]
commits: ["475d4fc","700f4f1"]
blockedBy: []
blocks: ["TM-048"]
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T09:03:21.542Z"
comments: [{"author":"main","ts":"2026-07-31T08:41:46.304Z","text":"bin/tm-hook now exists and tm install puts it on PATH alongside tm and tm-dashboard — Codex's hooks.json holds a bare command with no plugin-root substitution, so a resolvable name is the only thing that manifest can carry. Verified by running it rather than by reading it: installed the example verbatim into a scratch repo, ran codex exec, and watched PreToolUse and Stop fire and an update_plan land on the board as TM-002/TM-003. That run found a second bug the fixture could not: a hook inherits the environment of whatever launched the harness, so running codex from a Claude Code shell left CLAUDE_CODE_SESSION_ID set and every task Codex created was attributed to MY session. The payload now wins over the environment — the same rule subagent-stop already followed. One thing that looked like a third bug and was not: two later events carried my session because exporting TM_ROOT in that shell leaked into my own session's hooks, which then wrote into the scratch store. Test artifact, not product."}]
closed: "2026-07-31T08:41:46.362Z"
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
