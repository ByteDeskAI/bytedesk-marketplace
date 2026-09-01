---
id: "ADR-0003"
kind: "adr"
status: "proposed"
created: "2026-09-01T19:40:00.654Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Design base: use ByteDesk design system (Recommended)"
epic: null
decisionKey: "7d5d8f2100d7"
date: "2026-09-01"
updated: "2026-09-01T19:40:00.659Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-01.
The question asked was: Which visual foundation should the rewritten dashboard use? Today it is 100% Atlassian Design System (@atlaskit, --ds-* tokens); this repo has never adopted the ByteDesk design system (no .design-authority, no task-management profile).

## Decision

**Which visual foundation should the rewritten dashboard use? Today it is 100% Atlassian Design System (@atlaskit, --ds-* tokens); this repo has never adopted the ByteDesk design system (no .design-authority, no task-management profile).** → chose **ByteDesk design system (Recommended)**.

Rejected:
- **Keep Atlaskit, restyle** — Stay on @atlaskit components and --ds-* tokens; rewrite screens/UX only. Fastest, but stays Atlassian-branded and outside the house system.
- **Bespoke token set** — Own CSS variables like fleet/web does. Full freedom, no house-system gates, no reuse of the designer pipeline.

**What should Codex generate? House rules (codex-image-studio, bytedesk-designer-surface) forbid raster images of application UI as implementation source; the sanctioned path is Codex writing real HTML/CSS mockups against the token stylesheet, plus abstract mood/direction imagery.** → chose **HTML mockups + mood imagery (Recommended)**.

Rejected:
- **Raster UI mockups anyway** — Use Codex's native image_gen to render dashboard screenshots as visual targets, overriding the house rule. Explorations only; nothing pasted into the app.
- **Mood imagery only** — Codex only produces abstract art/texture/empty-state illustrations; screen design is done directly in code by Fable.

**Many plugin features exist only on the CLI with no HTTP route (why, graph, standup, handoff, export, doctor, time, stale, per-entity log, find with field filters, claims/sweep/release, parallel, ntfy test, goal import, override, config). Should the rewrite add the server routes needed to expose them?** → chose **Add routes for everything (Recommended)**.

Rejected:
- **UI over existing routes only** — Rewrite the SPA against the current ~50 routes; CLI-only features stay CLI-only and are linked from a 'run this command' panel.

**How should the implementation workers run? You named Fable 5.1 as lead and grader. Both options keep this session as lead/integrator owning commits.** → chose **Agent-tool subagents (Recommended)**.

Rejected:
- **agent-orchestration MCP spawns** — Durable runs in isolated worktrees via orchestration_spawn (catalog pins claude.fable-5, not 5.1). Patches collected and merged by me. Slower, more isolation, live session URLs.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._