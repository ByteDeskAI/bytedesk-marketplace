---
id: "TM-203"
kind: "task"
status: "parked"
created: "2026-09-13T21:42:14.238Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the Claude model catalog names ids the current ACP build does not advertise"
epic: "EP-021"
acceptance: [{"text":"The catalog's Claude entries route to ids the installed ACP build accepts, proved by a live doctor run plus one executed turn","done":false},{"text":"Any id mapping is justified by evidence from the agent, not inferred from the alias name","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/116","acb5dd4"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-203"
branch: "tm/TM-203-agent-orchestration-the-claude-model-catalog-nam"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-203-agent-orchestration-the-claude-model-catalog-nam"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-13T22:10:01.993Z"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-203","session":"pool-tm-203","at":"2026-09-13T21:54:27.999Z"}
parkedReason: "worker exited without closing"
comments: [{"author":"worker:tmux","ts":"2026-09-13T22:10:01.990Z","text":"worker exited without closing"}]
---

TM-193 made an unadvertised model ineligible for routing, which is correct and makes the drift visible: on Claude Code 2.1.270 the ACP agent advertises 'default, opus[1m], sonnet, haiku', while the catalog names claude-opus-5, claude-fable-5-1, claude-fable-5 and claude-opus-4-8. Every Claude endpoint is therefore refused at routing time, so design and implementation aliases report AO_ROUTING_BLOCKED when codex is also unavailable.

Refusing is better than the old behaviour (a route that looked eligible and died at its first turn with ACP_MODEL_UNSUPPORTED), but Claude should be routable. Decide what the catalog should name: the advertised aliases, the 'default' entry, or a documented mapping proved against the agent rather than guessed - 'opus[1m]' states a context window, not which model family runs, so the mapping needs evidence.

Evidence of the current drift: .bytedesk/task-management/evidence/TM-193-VERIFY.md (live doctor output).