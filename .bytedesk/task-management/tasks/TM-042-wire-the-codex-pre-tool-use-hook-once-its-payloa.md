---
id: "TM-042"
kind: "task"
status: "done"
created: "2026-07-31T04:00:31.240Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Wire the Codex pre_tool_use hook, once its payload schema is verified"
epic: "EP-003"
acceptance: [{"text":"A real Codex pre_tool_use payload is captured and committed as a fixture, not described from memory","done":true,"at":"2026-07-31T04:30:26.837Z"},{"text":"The hook fires under Codex and gates the same actions it gates under Claude Code","done":true,"at":"2026-07-31T04:30:26.906Z"},{"text":"The README capability matrix moves Codex hooks from warning to supported","done":true,"at":"2026-07-31T04:30:26.978Z"}]
evidence: [".bytedesk/task-management/evidence/TM-042-codex-pre-tool-use.json"]
commits: ["2bb38e1","caae8c8"]
blockedBy: ["TM-039"]
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T04:30:48.670Z"
comments: [{"author":"main","ts":"2026-07-31T04:30:27.125Z","text":"Captured, not described: a PreToolUse hook writing its stdin to a file during a real `codex exec` turn (codex-cli 0.146.0). The payload is Claude-Code-shaped — session_id, turn_id, transcript_path, cwd, hook_event_name, tool_name, tool_input, tool_use_id — and the manifest shape matches Claude's too, verified against a real .codex/hooks.json already on this machine. The load-bearing surprise, worth the second capture: Codex passes a hook NO environment variables at all. Without adopting session_id from the payload, every claim, gate and event under Codex would attribute to nobody — so the hook sets TM_SESSION_ID once, and nothing downstream needs to know which harness it is under. That also corrects a TM-039 README claim: CODEX_THREAD_ID exists in the binary but is not present in a hook's environment."}]
closed: "2026-07-31T04:30:37.252Z"
---

## Problem
TM-039 established that Codex CLI has a hook surface — `.codex/hooks.json`, with at least a
`pre_tool_use` event, evidenced by a live `[hooks.state]` entry in `~/.codex/config.toml` pointing
at another repo. The plugin does not use it, so under Codex there is no session briefing, no Stop
gate and no automatic commit linking. The capability matrix says so honestly, which is the most
that could be claimed without guessing.

## Why it was not done with TM-039
The payload schema is unverified. Every other harness fact in TM-039 was read off an installed
binary or a session file the tool had already written; the hook payload cannot be read that way
without running Codex through a real tool call and capturing what it sends. Guessing the shape is
exactly the failure that ticket exists to prevent — `CODEX_SESSION_ID` was in the code for a
release and exists nowhere in Codex.

## Proposal
Capture a real `pre_tool_use` payload from Codex, then wire the existing hook entrypoint to it and
extend the capability matrix from warning to supported. The adapters in `lib/harness/` are already
the right shape for this — `codex.mjs` converts wire payloads to intents and nothing in `bin/tm`
needs to learn about Codex.
