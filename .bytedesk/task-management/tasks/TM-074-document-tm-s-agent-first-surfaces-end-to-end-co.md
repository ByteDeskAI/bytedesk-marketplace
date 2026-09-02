---
id: "TM-074"
kind: "task"
status: "done"
created: "2026-09-02T09:44:08.465Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Document tm's agent-first surfaces end-to-end; complete skill metadata so agents can find, execute, and chain the skills"
epic: "EP-010"
acceptance: [{"text":"docs/agent-first.md exists and documents every agent-first CLI verb (caps, dispatch, collect, agent, pool, events) with flags, outputs, and refusal semantics that match tm help / lib/","done":true,"at":"2026-09-02T10:18:34.436Z"},{"text":"CLI, the 38 MCP tools, and dashboard HTTP routes for the same verbs sit in one parity table so an agent on any surface can find the others","done":true,"at":"2026-09-02T10:18:34.445Z"},{"text":"skills/ has complete frontmatter (name, description with trigger phrases, when-to-use) for caps, dispatch, pool, collect, agent, events; SKILL.md files cross-link dispatch → pool → collect → events","done":true,"at":"2026-09-02T10:18:34.452Z"},{"text":"Backends (orchestration → fleet → tmux → manual), tm caps, and config keys (dispatch.backends, dispatch.heartbeatSeconds, agentTtlMinutes, dispatch.enabled/poolWip/pollSeconds) are documented with how a harness auto-detects","done":true,"at":"2026-09-02T10:18:34.461Z"},{"text":"README links docs/agent-first.md and contains a per-harness recipe (Claude Code, Codex, Grok, Kimi) for label ready-for-agent → pool/dispatch → collect","done":true,"at":"2026-09-02T10:18:34.470Z"}]
evidence: [".bytedesk/task-management/evidence/TM-074-1788344314426.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T10:18:39.072Z"
session: "01a06199-2a58-7962-bb20-0d244201385f"
closed: "2026-09-02T10:18:39.069Z"
---

Audit and document everything the plugin now exposes, then make it discoverable:

1. **tm binary** — every verb, including the agent-first set (caps, dispatch, collect, agent, pool, events), with flags, outputs, and refusal semantics. Check README, docs/, and `tm help` agree with lib/ reality.
2. **Surfaces parity** — CLI verbs, the 38 MCP tools, and the dashboard HTTP routes documented together so an agent on any surface knows the others exist.
3. **Skills** — every skill under skills/ has complete metadata (name, description with trigger phrases, when-to-use), and the SKILL.md files cross-link (dispatch -> pool -> collect -> events workflow) so a coding agent can find and chain them.
4. **Backends & host detection** — orchestration/fleet/tmux/manual resolution order, `tm caps`, config keys (dispatch.backends, heartbeatSeconds, agentTtlMinutes), and how a harness should auto-detect.
5. **Workflow guides** — the agent-first loop (label ready-for-agent -> pool pickup -> dispatch -> collect) as a documented recipe per harness (Claude Code, Kimi, Codex, Grok).

Acceptance: an agent that has never seen this plugin can, from the skill metadata + README alone, discover the dispatch loop and run it end-to-end without guessing a flag.
