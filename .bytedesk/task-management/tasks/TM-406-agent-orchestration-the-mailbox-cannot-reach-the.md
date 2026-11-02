---
id: "TM-406"
kind: "task"
status: "open"
created: "2026-10-05T13:41:33.406Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the mailbox cannot reach the marketplace's own lead (AO_PLUGIN_ROOT_IS_NOT_CONSUMER)"
epic: "EP-028"
acceptance: [{"text":"bytedesk-marketplace's source checkout and its linked worktrees are valid mailbox sources and destinations; the installed plugin cache and other non-repo plugin roots are still refused","done":false},{"text":"A cross-repo mailbox send to bytedesk-marketplace is durably delivered to its lead and read without a person stepping in","done":false},{"text":"Filing a ticket for another repo's lead also sends that lead a mailbox notice naming the task","done":false},{"text":"Regression tests: agent-fabric to marketplace send delivered; plugin cache path still refused","done":false}]
evidence: []
commits: ["TM-350"]
blockedBy: []
blocks: []
actor: "main"
session: "83f65be5-7b0d-41d9-a894-03d84e1227d5"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-11-01T21:30:17.342Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:58:56.214Z","text":"Related: within one repo, mail to=lead from agent-fabric to agent-fabric is held as unknown_recipient although lead c2c984bc is registered. Same-repo addressing of the lead also needs to resolve."},{"author":"main","ts":"2026-11-01T21:30:17.332Z","text":"Still live 2026-11-01 (TM-528 worker ec523743): orchestration_mailbox_send MCP tool refuses bytedesk-marketplace with AO_PLUGIN_ROOT_IS_NOT_CONSUMER; workers fall back to the CLI."}]
---

Reported by Ryan from the agent-fabric lead session, 2026-10-05. Direction: leads and workers send and read messages autonomously, across repos and within one repo. Nobody relays messages by hand through tmux or tickets. Part of TM-350.

## What happened

The agent-fabric lead had to reach the agent-orchestration lead (the "Marketplace Conductor", agent fd2b831f) about TM-392. It called `orchestration_mailbox_send` with `destinationConsumerCwd=/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace`, which was refused:

> AO_PLUGIN_ROOT_IS_NOT_CONSUMER: The plugin installation or marketplace source cannot be used as a consumer repository.

The check is in `agent-orchestration/src/workspace/repository.mjs:58` and `:68`. bytedesk-marketplace is also a real repository with an enrolled, managed lead and its own task store, and every plugin's tickets are filed there. So the one lead that every repo needs to reach is the one the mailbox cannot address. As a workaround, the agent-fabric lead typed into the lead's pane with `tmux send-keys`. It had to do this twice: once to answer a question, once to correct that answer.

## Required behaviour

- The marketplace source checkout (and any linked worktree of it) is a valid mailbox **destination** and **source** for its own lead and workers. The guard still refuses the installed plugin cache (`~/.claude/plugins/cache/...`) and other non-repository plugin roots.
- `orchestration_mailbox_send` / `mailbox send` to bytedesk-marketplace from another repo delivers the message durably to its lead. The lead's pane rings, and the message is read without a person stepping in (TM-351/TM-352 behaviour).
- Filing a ticket for another repo's lead sends a mailbox notice to that lead naming the task id. The ticket and the message are one action, not two.
