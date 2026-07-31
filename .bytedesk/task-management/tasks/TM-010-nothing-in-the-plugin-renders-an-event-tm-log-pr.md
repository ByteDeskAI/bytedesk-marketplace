---
id: "TM-010"
kind: "task"
status: "done"
created: "2026-07-29T23:08:51.323Z"
title: "Nothing in the plugin renders an event: tm log prints JSON.stringify per line"
epic: "EP-002"
acceptance: []
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/68"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T00:52:26.907Z"
labels: ["ux","rank-08"]
priority: "high"
comments: [{"author":"main","ts":"2026-07-29T23:08:51.434Z","text":"Build plan (from the ranked survey): lib/events-format.mjs, no imports: eventLine(e) → '14:22:07  claude/main  blocked      TM-007  waiting on counsel', aligned kind column, reason/to/via/tasks folded in per kind. CATALOG.events in lib/ntfy.mjs is the authoritative kind list, so the set is not invented. It lives in lib/ because it is shared with the CLI, and it stays dependency-free because lib/render.mjs imports node:fs and cannot be bundled. | bin/tm log() (lines 420-425) renders eventLine; --json stays raw. That is the whole CLI diff. | Drawer HISTORY: pass the events prop App.tsx already holds into TaskDrawer (App.tsx:320) and render the existing <Activity> component over events.filter((e) => e.id === task.id) — reuse the component, do not write a third formatter. Switch the ad-hoc template literal at Activity.tsx:23 to eventLine so the terminal and the board describe an event the same way. | tests/unit/events-format.te"},{"author":"main","ts":"2026-07-29T23:08:51.478Z","text":"Watch out for: Scope, because this proposal wants to grow into three features. Do NOT extract standup()'s byId grouping (lib/render.mjs:130-139): the drawer filters, it does not group, so the refactor gains zero callers. Do NOT add kind/actor dropdowns or same-kind run collapsing to Activity — the log already exports via tm export json --events. No bundler work is needed: dashboard/vite.config.ts:5 already imports ../lib/paths.mjs and App.tsx:7 imports ../metrics.mjs, so the boundary is already crossed."}]
closed: "2026-07-30T00:52:26.906Z"
---

