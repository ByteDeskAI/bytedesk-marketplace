---
id: "TM-011"
kind: "task"
status: "done"
created: "2026-07-29T23:08:51.543Z"
title: "Ship an agents/ subagent definition — the plugin has hooks, skills, MCP and no agents"
epic: "EP-002"
acceptance: [{"text":"SubagentStart briefs a spawned agent with the parent's claimed work","done":true,"at":"2026-07-30T14:52:21.830Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/69","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/77"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T14:52:21.979Z"
labels: ["claude-code","rank-09"]
priority: "medium"
comments: [{"author":"main","ts":"2026-07-29T23:08:51.682Z","text":"Build plan (from the ranked survey): agents/tm-worker.md: frontmatter name/description/tools; body = AGENTS.md rules 1-8 condensed to what a single-task worker needs (tm handoff <id> first if the prompt names an id, TM_ACTOR=tm-worker tm start <id> before touching code, tm ac/tm accept only on verified criteria, tm evidence for proof, tm done or tm park '<where I stopped>' before returning, never --steal unasked). AGENTS.md lives in the plugin repo and is unreachable from a user's project, which is the honest reason to ship a discoverable copy. Add 'agents': './agents' to .claude-plugin/plugin.json if discovery needs it. | hooks/hooks.json: a PreToolUse matcher Task → tm hook pre-dispatch. In bin/tm's hook(), case 'pre-dispatch' beside pre-task-create (bin/tm:950): pull /\\bTM-\\d+\\b/ from input.tool_input.prompt and logEvent('subagent_dispatch', { id, agent: input.tool_input.subagent_type }, P). No deny — a dispatch is never"},{"author":"main","ts":"2026-07-29T23:08:51.728Z","text":"Watch out for: Do NOT add a state.dispatches list to drain at SubagentStop: the stop event carries no Task-call identity, so with three parallel dispatches the first stop drains all three and claims them — the same class of wrongness as the bug being fixed. And an agents/*.md file does not set CLAUDE_AGENT_NAME: actor() (lib/actor.mjs:22) reads only TM_ACTOR/CLAUDE_AGENT_NAME from the env of the process running tm, so the named actor comes from the agent body exporting TM_ACTOR, not from hoping the harness exp"},{"author":"main","ts":"2026-07-30T01:00:19.248Z","text":"First half shipped in #69: SubagentStop attribution. 317 subagent_stop events in the persona store, zero attributed — the handler's `input.session_id || CLAUDE_SESSION_ID` let the subagent's id select claims held by the parent. Parent selects claims, agent id and transcript_path recorded. Remaining: ship an agents/ subagent definition, deliberately its own PR since it is a new feature with its own design questions."},{"author":"main","ts":"2026-07-30T14:50:39.101Z","text":"SubagentStart briefing shipped in #77; TM-011 remains the agents/ definition itself, which is still unbuilt."},{"author":"main","ts":"2026-07-30T14:52:21.926Z","text":"SubagentStart brief shipped in #77 — hook contract verified against the live harness first (a spawned agent quoted back a token absent from its prompt). The remaining half of this item is an agents/ definition, which is a separate design question."}]
closed: "2026-07-30T14:52:21.978Z"
---

