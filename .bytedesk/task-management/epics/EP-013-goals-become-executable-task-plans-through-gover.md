---
id: "EP-013"
kind: "epic"
status: "open"
created: "2026-09-02T18:12:47.099Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Goals become executable task plans through governed AI chat"
actor: "main"
session: "01a062eb-2024-7368-bdb3-ad3fcf853ad4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T18:12:47.104Z"
---

## Why

The Plans area can only import prewritten goal files. Users need a bounded AI planning conversation that can reason over attached documents, invoke the installed task-management skills, preview governed board mutations, and apply approved changes through the same gates and event stream as the CLI.

## Done when

- A user can discuss a goal, attach repository documents or uploads, and resume the planning session.
- The planner can run planning skills such as interview, map, spec, tickets, epic, ADR, and goal import against the current board through typed task-management operations.
- Every mutation is validated, previewed, explicitly approved, audited, and applied without partial imports.
- Single-goal, one-epic, and multi-epic program packages round-trip through production import behavior.
- Approved Codex image-generated mockups live under `bytedesk/designer/mockups/` and govern a responsive, accessible implementation.
- Claude Fable 5.1 implements the feature and Codex GPT-5.6 Sol independently reviews it.

## Out of scope

- General-purpose dashboard chat.
- Unattended code implementation, dispatch, pool, override, deletion, or task completion from ordinary planning mode.
- Direct model writes to task-store files or indexes.
