---
id: "TM-074"
kind: "task"
status: "open"
created: "2026-09-02T09:44:08.465Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Document tm's agent-first surfaces end-to-end; complete skill metadata so agents can find, execute, and chain the skills"
epic: "EP-010"
acceptance: []
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T09:44:25.152Z"
---

Audit and document everything the plugin now exposes, then make it discoverable:

1. **tm binary** — every verb, including the agent-first set (caps, dispatch, collect, agent, pool, events), with flags, outputs, and refusal semantics. Check README, docs/, and `tm help` agree with lib/ reality.
2. **Surfaces parity** — CLI verbs, the 38 MCP tools, and the dashboard HTTP routes documented together so an agent on any surface knows the others exist.
3. **Skills** — every skill under skills/ has complete metadata (name, description with trigger phrases, when-to-use), and the SKILL.md files cross-link (dispatch -> pool -> collect -> events workflow) so a coding agent can find and chain them.
4. **Backends & host detection** — orchestration/fleet/tmux/manual resolution order, `tm caps`, config keys (dispatch.backends, heartbeatSeconds, agentTtlMinutes), and how a harness should auto-detect.
5. **Workflow guides** — the agent-first loop (label ready-for-agent -> pool pickup -> dispatch -> collect) as a documented recipe per harness (Claude Code, Kimi, Codex, Grok).

Acceptance: an agent that has never seen this plugin can, from the skill metadata + README alone, discover the dispatch loop and run it end-to-end without guessing a flag.
