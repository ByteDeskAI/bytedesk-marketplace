---
id: "EP-018"
kind: "epic"
status: "done"
created: "2026-09-09T06:48:33.388Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Persistent repository leads, configurable agent templates, and the cross-repo presence contract"
actor: "main"
session: "156f2109-ba88-4394-bb64-201f22732700"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T23:29:05.027Z"
plan: ".bytedesk/task-management/plans/2026-09-09-coordination-primitives-for-agent-orchestration-.md"
closed: "2026-09-10T23:29:05.023Z"
---

Marketplace side of the Ryan-approved rollout described in /tmp/ao-lead-rollout-20260909/PLAN.md
(authorized in Store Codex pane %109). Three coupled changes to `agent-orchestration`:

1. A repository lead that persists across linked worktrees, keyed on the canonical git
   common-directory identity, with status/ensure/assign, serialized creation and a recursion guard.
2. A global + repo agent configuration layer (`~/.config/agent-orchestration/config.json`,
   `.bytedesk/agent-orchestration/config.json`) defining the default lead template/provider/model,
   reusable templates and composable Markdown prompts — nothing hardcoded.
3. A versioned, read-only cross-repository presence snapshot that this repo PRODUCES and
   bytedesk-remote-gateway CONSUMES to group terminals by repository and orchestration.

Ownership split (from the plan): this repo owns the producer, the lead lifecycle, the durable
mailbox and the configuration resolver. The Gateway repo owns its terminal-grouping plugin and
tracks that work on its own board; the presence contract is the only shared surface and must be
agreed before either side integrates.

Prior art already in the store: EP-014 (role-based agent sessions per project) shipped the agent
identity, team-lead role and durable role-session groundwork this builds on — TM-094, TM-096,
TM-100 in particular. This epic does not redo that work; it makes the lead survive independently
of a workflow run and makes its prompt configurable.
